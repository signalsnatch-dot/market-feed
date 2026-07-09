/**
 * Backtest Worker — processes ONE tick file for ALL thresholds.
 * Each worker reuses the existing processTickFile logic: reads the CSV once,
 * builds volume candles for all thresholds simultaneously, evaluates all
 * strategies on each bar close, and writes result JSONs.
 *
 * Invoked by worker_threads in backtesterAsLive.js cmdRunAllParallel()
 */
'use strict';

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// ─── Load the strategy module ONCE per worker ───────────────────
const { STRATEGIES } = require('../priceActionStrategyV2');

const EXTRACTED_DIR = path.resolve(__dirname, '..', 'extracted');
const RESULTS_DIR = path.resolve(__dirname, '..', 'live-backtest-results');
const CANDLES_DIR = path.resolve(__dirname, '..', 'candles', 'live');

// ─── Lot multipliers (same as backtesterAsLive.js) ──────────────
const MCX_MULTIPLIERS = {
    '538685': 1250, '538686': 250, '520702': 100, '520703': 10,
    '464150': 30, '471726': 5, '488788': 1, '568831': 2500,
    '568836': 5000, '568833': 5000, '568830': 5000, '466583': 100,
    '510764': 10, '552721': 1, '552706': 5000, '552709': 5000,
    '552708': 2500, '552711': 5000, '464151': 5, '477177': 1, '510464': 1
};
const INDEX_MULTIPLIERS = { '61093': 75, '61088': 30, '61091': 40, '61092': 120 };

function getLotMultiplier(instKey) {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
        const i = cfg.instruments?.find(x => x.key === instKey);
        if (i && i.lotSize !== undefined) return i.lotSize;
    } catch (e) { }
    try {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'build-version-config.json'), 'utf8'));
        const i = cfg.find(x => x.instrument_key === instKey);
        if (i && i.lotSize !== undefined) return i.lotSize;
    } catch (e) { }
    const id = instKey.includes('|') ? instKey.split('|')[1] : instKey;
    return MCX_MULTIPLIERS[id] ?? INDEX_MULTIPLIERS[id] ?? 1;
}

// ─── VolumeCandle ───────────────────────────────────────────────
class VolumeCandle {
    constructor(t, instKey, name) {
        this.targetVolume = t;
        this.instrument_key = instKey;
        this.name = name;
        this.reset();
    }
    reset() {
        this.open = null; this.high = null; this.low = null; this.close = null;
        this.volume = 0; this.transactions = 0; this.priceChanges = 0;
        this.startTime = null; this.startTimestamp = null;
        this.endTime = null; this.endTimestamp = null;
        this.barNumber = 0;
    }
    isNew() { return this.open === null; }
}

// ─── Candle CSV cache ───────────────────────────────────────────
const candleCSVHeaders = {};

function saveCandleToCSV(closedBar, threshold, instrumentKey, tickFile) {
    const safeKey = instrumentKey.replace(/[^a-zA-Z0-9_|]/g, '_').replace(/[|]/g, '_');
    const baseName = path.basename(tickFile, '.csv');
    const candleDir = path.join(CANDLES_DIR, safeKey, String(threshold));
    if (!fs.existsSync(candleDir)) fs.mkdirSync(candleDir, { recursive: true });
    const candleFile = path.join(candleDir, `${baseName}_candles.csv`);
    const headerKey = `${safeKey}_${threshold}_${baseName}`;
    if (!candleCSVHeaders[headerKey]) {
        fs.writeFileSync(candleFile, 'timestamp,open,high,low,close,volume,barNumber,targetVolume,transactions,priceChanges,startTime,endTime,durationMs,priceChange,priceChangePercent,priceRange,priceRangePercent,volumeEfficiency\n', { flag: 'w' });
        candleCSVHeaders[headerKey] = true;
    }
    const row = [closedBar.endTime, closedBar.open, closedBar.high, closedBar.low, closedBar.close,
        closedBar.volume, closedBar.barNumber, closedBar.targetVolume, closedBar.transactions,
        closedBar.priceChanges, closedBar.startTime, closedBar.endTime, closedBar.durationMs,
        closedBar.priceChange, closedBar.priceChangePercent, closedBar.priceRange,
        closedBar.priceRangePercent, closedBar.volumeEfficiency
    ].join(',') + '\n';
    fs.appendFileSync(candleFile, row);
}

// ─── processTickFile — processes ALL thresholds in ONE pass ─────
function processTickFile(instrumentKey, tickFile, thresholds, buildInst) {
    const tickPath = path.join(EXTRACTED_DIR, tickFile);
    const lotMul = getLotMultiplier(instrumentKey);
    const tickSize = buildInst.tickSize || 0.05;

    // Build per-threshold state
    const states = thresholds.map(th => ({
        threshold: th,
        candle: new VolumeCandle(th, instrumentKey, buildInst.name),
        completedBars: [],
        activeTrades: new Map(),
        tradeHistory: [],
        totalBars: 0,
        barIndex: 0,
        tickSize,
        initialCapital: 100000
    }));

    const fileContent = fs.readFileSync(tickPath, 'utf8');
    const allLines = fileContent.split('\n');

    let colIdx = { idxInst: -1, idxLtp: -1, idxLtq: -1, idxExt: -1, idxExIso: -1, idxVolToday: -1 };
    let headerFound = false;
    let lastVolToday = null;
    let tickCount = 0;
    let nextTickLog = 10000;

    for (const rawLine of allLines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (!headerFound) {
            const hLine = line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line;
            const h = hLine.split(',').map(x => x.trim());
            colIdx.idxInst = h.indexOf('instrument_key');
            colIdx.idxLtp = h.indexOf('ltp');
            colIdx.idxLtq = h.indexOf('last_traded_quantity');
            colIdx.idxExt = h.indexOf('exchange_timestamp');
            colIdx.idxExIso = h.indexOf('exchange_time_iso');
            colIdx.idxVolToday = h.indexOf('volume_today');
            headerFound = true;
            continue;
        }

        const parts = line.split(',');
        if (parts.length < Math.max(colIdx.idxInst, colIdx.idxLtp, colIdx.idxLtq, colIdx.idxExt) + 1) continue;
        if (colIdx.idxInst === -1 || !parts[colIdx.idxInst].includes('|')) continue;
        if (parts[colIdx.idxInst] !== instrumentKey) continue;

        const ltp = parseFloat(parts[colIdx.idxLtp]);
        const ltq = parseInt(parts[colIdx.idxLtq], 10);
        const ext = parseInt(parts[colIdx.idxExt], 10);
        if (isNaN(ltp) || isNaN(ltq) || isNaN(ext)) continue;

        tickCount++;

        let tickVolume = 0;
        const currentVolToday = parseInt(parts[colIdx.idxVolToday], 10);
        if (!isNaN(currentVolToday) && currentVolToday > 0) {
            const prevVolToday = lastVolToday;
            if (prevVolToday !== null) {
                if (currentVolToday >= prevVolToday) {
                    tickVolume = (currentVolToday - prevVolToday) / lotMul;
                } else {
                    tickVolume = (ltq || 0) / lotMul;
                }
            } else {
                tickVolume = (ltq || 0) / lotMul;
            }
            lastVolToday = currentVolToday;
        } else {
            tickVolume = (ltq || 0) / lotMul;
        }
        if (tickVolume <= 0) continue;

        if (tickCount >= nextTickLog) {
            nextTickLog += 10000;
        }

        const exIso = colIdx.idxExIso !== -1 ? parts[colIdx.idxExIso] : '';
        const currentTime = ext;

        // Process ALL thresholds simultaneously
        for (const s of states) {
            const c = s.candle;
            let tv = tickVolume;

            while (tv > 0) {
                const isFirstTransaction = c.transactions === 0 || c.open === null;
                if (isFirstTransaction) {
                    c.barNumber = s.totalBars + 1;
                    c.open = ltp; c.high = ltp; c.low = ltp; c.close = ltp;
                    c.startTime = currentTime;
                    c.startTimestamp = exIso;
                    c.transactions = 0; c.priceChanges = 0;
                }

                const needed = c.targetVolume - c.volume;
                let add, exceeded;
                if (tv <= needed) { add = tv; tv = 0; exceeded = false; }
                else { add = needed; tv -= needed; exceeded = true; }

                if (c.transactions > 0) {
                    if (ltp !== c.close) c.priceChanges++;
                    c.high = Math.max(c.high, ltp);
                    c.low = Math.min(c.low, ltp);
                    c.close = ltp;
                }
                c.volume += add;
                c.endTime = currentTime;
                c.endTimestamp = exIso;
                c.transactions++;

                if (c.volume >= c.targetVolume) {
                    s.barIndex++;
                    const closedBar = {
                        barNumber: c.barNumber,
                        open: c.open, high: c.high, low: c.low, close: c.close,
                        volume: c.volume, targetVolume: c.targetVolume,
                        transactions: c.transactions, priceChanges: c.priceChanges,
                        startTime: c.startTimestamp, endTime: c.endTimestamp,
                        durationMs: c.endTime - c.startTime,
                        priceChange: c.close - c.open,
                        priceChangePercent: ((c.close - c.open) / c.open) * 100,
                        priceRange: c.high - c.low,
                        priceRangePercent: ((c.high - c.low) / c.open) * 100,
                        volumeEfficiency: c.volume / c.targetVolume
                    };
                    s.completedBars.push(closedBar);
                    s.totalBars++;

                    saveCandleToCSV(closedBar, s.threshold, instrumentKey, tickFile);

                    // Check active trades for TP/SL on bar close
                    for (const [stratName, trade] of s.activeTrades) {
                        if (trade.exitPrice !== null) continue;
                        if (trade.createdAtBarIndex === s.barIndex) continue;
                        trade.highestPrice = Math.max(trade.highestPrice, closedBar.high);
                        trade.lowestPrice = Math.min(trade.lowestPrice, closedBar.low);
                        if (!trade.triggered) continue;

                        let hit = false;
                        if (trade.direction === 'BUY') {
                            if (ltp >= trade.takeProfit) { trade.exitPrice = trade.takeProfit; trade.exitReason = 'take_profit'; hit = true; }
                            else if (ltp <= trade.stopLoss) { trade.exitPrice = trade.stopLoss; trade.exitReason = 'stop_loss'; hit = true; }
                        } else {
                            if (ltp <= trade.takeProfit) { trade.exitPrice = trade.takeProfit; trade.exitReason = 'take_profit'; hit = true; }
                            else if (ltp >= trade.stopLoss) { trade.exitPrice = trade.stopLoss; trade.exitReason = 'stop_loss'; hit = true; }
                        }
                        if (hit) {
                            trade.exitIndex = s.barIndex; trade.exitTime = currentTime;
                            trade.pnlAmount = trade.quantity * (trade.direction === 'BUY' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice);
                            trade.pnl = trade.direction === 'BUY' ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 : ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
                            trade.holdingPeriod = trade.exitIndex - trade.entryIndex;
                            const tpDistVal = Math.abs(trade.takeProfit - trade.entryPrice) || 1;
                            const riskVal = trade.risk || 1;
                            if (trade.direction === 'BUY') {
                                trade.mafePercent = Math.max(0, ((trade.highestPrice - trade.entryPrice) / tpDistVal) * 100);
                                trade.maePercent = Math.max(0, ((trade.entryPrice - trade.lowestPrice) / riskVal) * 100);
                            } else {
                                trade.mafePercent = Math.max(0, ((trade.entryPrice - trade.lowestPrice) / tpDistVal) * 100);
                                trade.maePercent = Math.max(0, ((trade.highestPrice - trade.entryPrice) / riskVal) * 100);
                            }
                            s.tradeHistory.push(trade);
                            s.activeTrades.delete(stratName);
                        }
                    }

                    // Evaluate ALL strategies on bar close
                    evaluateStrategiesOnBarClose(s);

                    const nextOhlc = exceeded ? c.close : null;
                    const nst = exceeded ? c.endTime : null;
                    const nstIso = exceeded ? c.endTimestamp : null;
                    c.reset();
                    c.barNumber = s.totalBars + 1;
                    if (nextOhlc !== null) {
                        c.open = nextOhlc; c.high = nextOhlc; c.low = nextOhlc; c.close = nextOhlc;
                        c.startTime = nst; c.startTimestamp = nstIso;
                    }
                }
            }

            // Update trade extremes on every tick
            for (const [stratName, trade] of s.activeTrades) {
                if (trade.exitPrice !== null) continue;
                trade.highestPrice = Math.max(trade.highestPrice, ltp);
                trade.lowestPrice = Math.min(trade.lowestPrice, ltp);
                if (!trade.triggered) {
                    if (trade.direction === 'BUY' && ltp >= trade.entryPrice) trade.triggered = true;
                    else if (trade.direction === 'SELL' && ltp <= trade.entryPrice) trade.triggered = true;
                }
                if (!trade.triggered) continue;

                let hit = false;
                if (trade.direction === 'BUY') {
                    if (ltp >= trade.takeProfit) { trade.exitPrice = trade.takeProfit; trade.exitReason = 'take_profit'; hit = true; }
                    else if (ltp <= trade.stopLoss) { trade.exitPrice = trade.stopLoss; trade.exitReason = 'stop_loss'; hit = true; }
                } else {
                    if (ltp <= trade.takeProfit) { trade.exitPrice = trade.takeProfit; trade.exitReason = 'take_profit'; hit = true; }
                    else if (ltp >= trade.stopLoss) { trade.exitPrice = trade.stopLoss; trade.exitReason = 'stop_loss'; hit = true; }
                }
                if (hit) {
                    trade.exitIndex = s.barIndex; trade.exitTime = currentTime;
                    trade.pnlAmount = trade.quantity * (trade.direction === 'BUY' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice);
                    trade.pnl = trade.direction === 'BUY' ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 : ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
                    trade.holdingPeriod = trade.exitIndex - trade.entryIndex;
                    const tpDist2 = Math.abs(trade.takeProfit - trade.entryPrice) || 1;
                    const risk2 = trade.risk || 1;
                    if (trade.direction === 'BUY') {
                        trade.mafePercent = Math.max(0, ((trade.highestPrice - trade.entryPrice) / tpDist2) * 100);
                        trade.maePercent = Math.max(0, ((trade.entryPrice - trade.lowestPrice) / risk2) * 100);
                    } else {
                        trade.mafePercent = Math.max(0, ((trade.entryPrice - trade.lowestPrice) / tpDist2) * 100);
                        trade.maePercent = Math.max(0, ((trade.highestPrice - trade.entryPrice) / risk2) * 100);
                    }
                    s.tradeHistory.push(trade);
                    s.activeTrades.delete(stratName);
                }
            }
        }
    }

    // ─── Flush remaining trades ──────────────────────────────────
    for (const s of states) {
        if (s.candle && s.candle.open !== null && s.candle.transactions > 0) s.totalBars++;
        for (const [stratName, trade] of s.activeTrades) {
            if (trade.exitPrice === null) {
                trade.exitPrice = s.candle.close || trade.entryPrice;
                trade.exitReason = 'end_of_data'; trade.exitIndex = s.barIndex; trade.exitTime = s.candle.endTime;
                trade.pnlAmount = trade.quantity * (trade.direction === 'BUY' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice);
                trade.pnl = trade.direction === 'BUY' ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 : ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
                trade.holdingPeriod = trade.exitIndex - trade.entryIndex;
                const tpDist3 = Math.abs(trade.takeProfit - trade.entryPrice) || 1;
                const risk3 = trade.risk || 1;
                if (trade.direction === 'BUY') {
                    trade.mafePercent = Math.max(0, ((trade.highestPrice - trade.entryPrice) / tpDist3) * 100);
                    trade.maePercent = Math.max(0, ((trade.entryPrice - trade.lowestPrice) / risk3) * 100);
                } else {
                    trade.mafePercent = Math.max(0, ((trade.entryPrice - trade.lowestPrice) / tpDist3) * 100);
                    trade.maePercent = Math.max(0, ((trade.highestPrice - trade.entryPrice) / risk3) * 100);
                }
                s.tradeHistory.push(trade);
            }
        }
    }

    // ─── Build results ──────────────────────────────────────────
    const allResults = {};
    for (const s of states) {
        const stratTrades = s.tradeHistory;
        const strategiesMap = {};
        const uniqueStrats = [...new Set(stratTrades.map(t => t.strategy))];
        for (const strat of uniqueStrats) {
            const sts = stratTrades.filter(t => t.strategy === strat);
            const sWins = sts.filter(t => t.pnlAmount > 0);
            const sLosses = sts.filter(t => t.pnlAmount <= 0);
            const sTotalPnl = sts.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
            const finalEquity = 100000 + sTotalPnl;
            const sAvgReturn = sts.length ? sts.reduce((sum, t) => sum + (t.pnl || 0), 0) / sts.length : 0;
            const sVariance = sts.length > 1 ? sts.reduce((sum, t) => sum + Math.pow((t.pnl || 0) - sAvgReturn, 2), 0) / sts.length : 0;
            const sSharpe = sVariance > 0 ? (sAvgReturn / Math.sqrt(sVariance)).toFixed(2) : '0.00';
            const pw = sWins.reduce((ss, t) => ss + Math.abs(t.pnl || 0), 0);
            const pl = sLosses.reduce((ss, t) => ss + Math.abs(t.pnl || 0), 0);
            let peak = 0, maxDD = 0, running = 0;
            for (const t of sts) { running += t.pnlAmount || 0; if (running > peak) peak = running; const dd = peak > 0 ? (peak - running) / peak * 100 : 0; if (dd > maxDD) maxDD = dd; }

            strategiesMap[strat] = {
                signalCount: sts.length,
                results: {
                    totalTrades: sts.length, winningTrades: sWins.length, losingTrades: sLosses.length,
                    winRate: sts.length ? ((sWins.length / sts.length) * 100).toFixed(2) : '0.00',
                    totalReturn: ((sTotalPnl / 100000) * 100).toFixed(2), totalPnl: sTotalPnl.toFixed(2), finalEquity: finalEquity.toFixed(2),
                    avgWin: sWins.length ? (sWins.reduce((ss, t) => ss + t.pnl, 0) / sWins.length).toFixed(2) : '0.00',
                    avgLoss: sLosses.length ? (sLosses.reduce((ss, t) => ss + t.pnl, 0) / sLosses.length).toFixed(2) : '0.00',
                    largestWin: sWins.length ? Math.max(...sWins.map(t => t.pnl)).toFixed(2) : '0.00',
                    largestLoss: sLosses.length ? Math.min(...sLosses.map(t => t.pnl)).toFixed(2) : '0.00',
                    sharpeRatio: sSharpe, maxDrawdown: maxDD.toFixed(2),
                    profitFactor: (pl > 0 ? (pw / pl) : 0).toFixed(2),
                    avgConfidence: sts.length ? (sts.reduce((ss, t) => ss + (t.confidence || 0), 0) / sts.length).toFixed(1) : null,
                    stopExits: sts.filter(t => t.exitReason === 'stop_loss').length,
                    targetExits: sts.filter(t => t.exitReason === 'take_profit').length,
                    avgRRR: (sts.reduce((ss, t) => ss + (t.reward / (t.risk > 0 ? t.risk : 1)), 0) / sts.length || 1.50).toFixed(2),
                    trades: sts.map(t => ({ entryIndex: t.entryIndex, exitIndex: t.exitIndex, entryPrice: t.entryPrice, exitPrice: t.exitPrice, quantity: t.quantity, pnl: t.pnl, pnlAmount: t.pnlAmount, holdingPeriod: t.holdingPeriod, confidence: t.confidence, exitReason: t.exitReason, mafePercentage: t.mafePercent, maePercentage: t.maePercent, stopLoss: t.stopLoss, takeProfit: t.takeProfit }))
                }
            };
        }

        const sourceFileName = path.basename(tickFile, '.csv');
        allResults[s.threshold] = {
            instrument: instrumentKey, instrumentName: buildInst.name,
            threshold: s.threshold, sourceFile: sourceFileName, mode: 'live', candlesCount: s.totalBars,
            strategies: strategiesMap, timestamp: Date.now()
        };
    }

    // ─── Save all thresholds ────────────────────────────────────
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const safeKey = instrumentKey.replace(/[^a-zA-Z0-9_|]/g, '_').replace(/[|]/g, '_');
    const baseName = path.basename(tickFile, '.csv');
    let totalTrades = 0;
    for (const [threshold, data] of Object.entries(allResults)) {
        const outPath = path.join(RESULTS_DIR, `live_${threshold}_${baseName}.json`);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
        totalTrades += Object.values(data.strategies).reduce((s, sd) => s + sd.results.totalTrades, 0);
    }

    return { thresholds: Object.keys(allResults).map(Number), totalTrades };
}

// ─── Strategy evaluation on bar close ──────────────────────────
function evaluateStrategiesOnBarClose(s) {
    const startIdx = Math.max(0, s.completedBars.length - 100);
    const strategyCandles = s.completedBars.slice(startIdx).map(b => ({
        open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, timestamp: b.endTime
    }));

    if (strategyCandles.length < 32) return;

    for (const [versionName, strategyFn] of Object.entries(STRATEGIES)) {
        const signals = strategyFn(strategyCandles, { tickSize: s.tickSize });
        if (!signals || !signals.length) continue;
        const latestSignal = signals[signals.length - 1];
        if (latestSignal.index !== strategyCandles.length - 1) continue;

        const signalDirection = latestSignal.type && latestSignal.type.startsWith('BUY') ? 'BUY' : 'SELL';

        let wasOppositeClose = false;
        if (s.activeTrades.has(versionName)) {
            const et = s.activeTrades.get(versionName);
            if (et.exitPrice === null && et.direction !== signalDirection) {
                et.exitPrice = latestSignal.triggerPrice; et.exitReason = 'opposite_signal';
                et.exitIndex = s.barIndex; et.exitTime = s.candle.endTime;
                et.pnlAmount = et.quantity * (et.direction === 'BUY' ? et.exitPrice - et.entryPrice : et.entryPrice - et.exitPrice);
                et.pnl = et.direction === 'BUY' ? ((et.exitPrice - et.entryPrice) / et.entryPrice) * 100 : ((et.entryPrice - et.exitPrice) / et.entryPrice) * 100;
                et.holdingPeriod = s.barIndex - et.entryIndex;
                s.tradeHistory.push(et);
                s.activeTrades.delete(versionName);
                wasOppositeClose = true;
            }
        }

        if (!s.activeTrades.has(versionName) && !wasOppositeClose) {
            const confidenceScale = (latestSignal.confidence || 50) / 100;
            const risk = Math.abs(latestSignal.triggerPrice - latestSignal.stopLoss);
            const quantity = risk > 0 ? (s.initialCapital * 0.01 * confidenceScale) / risk : 0;
            s.activeTrades.set(versionName, {
                strategy: versionName,
                direction: signalDirection, entryPrice: latestSignal.triggerPrice,
                stopLoss: latestSignal.stopLoss, takeProfit: latestSignal.takeProfit,
                confidence: latestSignal.confidence || 50,
                quantity, risk, entryIndex: s.barIndex, entryTime: s.candle.endTime,
                exitPrice: null, exitTime: null, exitIndex: null, exitReason: null,
                pnl: null, pnlAmount: null,
                highestPrice: latestSignal.triggerPrice, lowestPrice: latestSignal.triggerPrice,
                createdAtBarIndex: s.barIndex, triggered: false,
            });
        }
    }
}

// ============================================================
// Worker entry point
// ============================================================
const { tickFile, instrumentKey, thresholds, buildInst } = workerData;

try {
    const result = processTickFile(instrumentKey, tickFile, thresholds, buildInst);
    parentPort.postMessage({ type: 'done', tickFile, thresholds: result.thresholds, totalTrades: result.totalTrades });
} catch (err) {
    parentPort.postMessage({ type: 'error', tickFile, error: err.message, stack: err.stack });
}