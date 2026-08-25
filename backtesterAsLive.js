// backtesterAsLive.js - Tick-by-tick live simulation backtester
// Streams raw ticks, builds volume candles exactly like production, evaluates all 53+ strategies
// on each bar close, tracks trades with MAE/MAFE per tick, and outputs per-threshold JSON matching
// version-backtest-results format (suitable for generateReport.js consumption)
//
// CLI Commands:
//   run <instrument_key> [--date YYYY-MM-DD] [--threshold N]
//     e.g. node backtesterAsLive.js run "MCX_FO|538685" --date 2026-07-03 --threshold 215
//   run-all                    Process all tick files from ./extracted (all dates, all thresholds)
//   compare <instrument_key>   Print report for one instrument from live-backtest-results
//   compare-all                Print report across all live-backtest-results JSON files

const fs = require('fs');
const path = require('path');
const { STRATEGIES, runPriceActionBacktest } = require('./priceActionStrategyV2');

const EXTRACTED_DIR = './extracted-2';
const CONFIG_FILE = './build-version-config.json';
const RESULTS_DIR = './live-backtest-results';
const CANDLES_DIR = './candles/live';

// ─── UPDATED SEPTEMBER/OCTOBER 2026 MULTIPLIERS ────────────────────────
const MCX_MULTIPLIERS = {
    '568245': 1250, '568246': 250,  // Natural Gas & Mini
    '565899': 100,  '565900': 10,   // Crude Oil & Mini
    '574824': 30,   '483080': 5,    '562058': 1,    // Silver, Mini, Micro
    '571298': 2500, '571303': 5,    '571300': 5,    '571297': 5,    // Copper, Zinc, Lead, Alu
    '483079': 1,    '569003': 100,  '568839': 1     // Gold, Mini, Petal
};

const INDEX_MULTIPLIERS = { 
    '68407': 65, '68390': 30, '68391': 60, '68406': 120 // Nifty, Bank, Fin, Midcap
};

function getLotMultiplier(instKey) {
    try {
        const cfg = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        const i = cfg.instruments?.find(x => x.key === instKey);
        if (i && i.lotSize !== undefined) return i.lotSize;
    } catch (e) {}
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        const i = cfg.find(x => x.instrument_key === instKey);
        if (i && i.lotSize !== undefined) return i.lotSize;
    } catch (e) {}
    const id = instKey.includes('|') ? instKey.split('|')[1] : instKey;
    return MCX_MULTIPLIERS[id] ?? INDEX_MULTIPLIERS[id] ?? 1;
}

function buildColumnIndex(headersLine) {
    const hLine = headersLine.charCodeAt(0) === 0xFEFF ? headersLine.slice(1) : headersLine;
    const h = hLine.split(',').map(x => x.trim());
    return {
        idxInst: h.indexOf('instrument_key'),
        idxLtp: h.indexOf('ltp'),
        idxLtq: h.indexOf('last_traded_quantity'),
        idxExt: h.indexOf('exchange_timestamp'),
        idxExIso: h.indexOf('exchange_time_iso'),
        idxVolToday: h.indexOf('volume_today')
    };
}

function resolveDateKey(extTs) {
    if (extTs === null || isNaN(extTs)) return null;
    let ts = extTs;
    if (ts < 10000000000) ts *= 1000;
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`;
}

function formatDateFromTimestamp(extTs) {
    if (extTs === null || isNaN(extTs)) return null;
    let ts = extTs;
    if (ts < 10000000000) ts *= 1000;
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function resolveThresholds(buildInst, liveInst, dateKey) {
    let thresholds = [];

    // 1. Date-specific thresholds (NEW format: date → [10 values])
    const hasDateMap = buildInst.thresholds && typeof buildInst.thresholds === 'object' && !Array.isArray(buildInst.thresholds);

    if (hasDateMap) {
        if (dateKey && buildInst.thresholds[dateKey] !== undefined) {
            const dateVal = buildInst.thresholds[dateKey];
            if (Array.isArray(dateVal)) {
                // NEW format: date → array of 10 threshold values
                // Date-specific arrays are self-contained — no merging needed
                return dateVal.sort((a, b) => a - b);
            } else if (typeof dateVal === 'number') {
                // LEGACY format: p-index → look up actual threshold from static_thresholds
                const idx = dateVal - 1; // legacy was 1-indexed
                if (Array.isArray(buildInst.static_thresholds) && buildInst.static_thresholds[idx] !== undefined) {
                    thresholds.push(buildInst.static_thresholds[idx]);
                }
            }
        }
        // If instrument has date-specific thresholds object but NO mapping for this date,
        // return empty array — caller should skip this instrument/date combination.
        // Do NOT fall back to static_thresholds.
        return thresholds;
    }

    // LEGACY: thresholds is a flat array (no date keys)
    if (Array.isArray(buildInst.thresholds)) {
        thresholds = [...buildInst.thresholds];
    }

    // 2. Static thresholds from build config (only for legacy instruments without date map)
    if (Array.isArray(buildInst.static_thresholds) && thresholds.length === 0) {
        for (const v of buildInst.static_thresholds) {
            if (!thresholds.includes(v)) thresholds.push(v);
        }
    }

    // 3. Fallback: config.json volumePerBar (only if still empty)
    if (liveInst && Array.isArray(liveInst.volumePerBar) && thresholds.length === 0) {
        for (const v of liveInst.volumePerBar) {
            if (!thresholds.includes(v)) thresholds.push(v);
        }
    }

    thresholds.sort((a, b) => a - b);
    return thresholds;
}

function findTickFilesForInstrument(instKey) {
    const safeKey = instKey.replace('|', '_');
    return fs.readdirSync(EXTRACTED_DIR)
        .filter(f => f.toLowerCase().endsWith('.csv') && f.startsWith(safeKey))
        .sort();
}

// ============================================================
// CLASSES
// ============================================================

class VolumeCandle {
    constructor(t, instKey, name) {
        this.targetVolume = t;
        this.instrument_key = instKey;
        this.name = name;
        this.reset();
    }
    reset() {
        this.open = null;
        this.high = null;
        this.low = null;
        this.close = null;
        this.volume = 0;
        this.transactions = 0;
        this.priceChanges = 0;
        this.startTime = null;
        this.startTimestamp = null;
        this.endTime = null;
        this.endTimestamp = null;
        this.barNumber = 0;
    }
    isNew() { return this.open === null; }
}

class Trade {
    constructor(strategy, signal, barNumber, entryTime, entryIndex, initialCapital, confidenceScale, tickSize, slippageTicks) {
        this.strategy = strategy;
        // Normalize BUY_STOP/SELL_STOP → BUY/SELL for direction checks
        this.direction = signal.type && signal.type.startsWith('BUY') ? 'BUY' : 'SELL';
        this.slippage = (slippageTicks || 0) * (tickSize || 0.05);
        // Apply 2-tick slippage: adjust 2*tickSize unfavorably from entry
        if (this.direction === 'BUY') {
            this.entryPrice = signal.triggerPrice + this.slippage;
        } else {
            this.entryPrice = signal.triggerPrice - this.slippage;
        }
        this.stopLoss = signal.stopLoss;
        this.takeProfit = signal.takeProfit;
        this.confidence = signal.confidence || 50;
        this.entryBar = barNumber;
        this.entryIndex = entryIndex;
        this.entryTime = entryTime;
        this.exitPrice = null;
        this.exitTime = null;
        this.exitIndex = null;
        this.exitReason = null;
        this.pnl = null;
        this.pnlAmount = null;
        this.pnlPercent = null;
        // 1% risk-based position sizing (matches priceActionStrategy.js runPriceActionBacktest)
        //this.risk = Math.abs(this.entryPrice - this.stopLoss);

        this.risk = Math.abs(signal.triggerPrice - signal.stopLoss);
        this.reward = Math.abs(this.takeProfit - this.entryPrice);
        this.quantity = this.risk > 0 ? (initialCapital * 0.01 * (confidenceScale || 1)) / this.risk : 0;
        this.holdingPeriod = null;
        this.mafePercent = null;
        this.maePercent = null;
        this.highestPrice = this.entryPrice;
        this.lowestPrice = this.entryPrice;
        this.createdAtBarIndex = entryIndex; // Tracks which bar index this trade was created at, to prevent same-tick exit
        this.filled = false; // Trade starts unfilled (stop-entry order); set to true when LTP crosses entry price
        this.triggered = false; // Kept for backward compat, but no longer used for TP/SL gating
    }
}

// ============================================================
// CORE PROCESSOR
// ============================================================
function processThresholdBarClose(s, closedBar, currentTime, ltp, exIso, barIndex) {
    const startIdx = Math.max(0, s.completedBars.length - 100);
    const strategyCandles = s.completedBars.slice(startIdx).map(b => ({
        open: b.open, high: b.high, low: b.low, close: b.close,
        volume: b.volume, timestamp: b.endTime
    }));

    // 1. CHECK PENDING TRIGGERS USING BAR HIGH/LOW
    for (const [versionName, pending] of s.pendingSignals) {
        const isBuy = pending.type && pending.type.startsWith('BUY');
        let triggeredInBar = false;

        // Use the bar's extreme to see if it touched our trigger at any point
        if (isBuy && closedBar.high >= pending.triggerPrice) triggeredInBar = true;
        if (!isBuy && closedBar.low <= pending.triggerPrice) triggeredNow = true;

        if (triggeredInBar && !s.activeTrades.has(versionName)) {
            const confidenceScale = (pending.confidence || 50) / 100;
            
            // Create trade. We assume entry at triggerPrice (or Bar Open if it gapped)
            const trade = new Trade(versionName, pending, closedBar.barNumber, currentTime, barIndex, s.initialCapital, confidenceScale, s.tickSize, 0);
            
            // Assume we entered at the trigger price 
            // (Note: This is the 'Bias' point - we don't know the exact tick)
            trade.entryPrice = isBuy ? Math.max(closedBar.open, pending.triggerPrice) 
                                     : Math.min(closedBar.open, pending.triggerPrice);
            
            trade.triggered = true; 
            trade.filled = true;
            s.activeTrades.set(versionName, trade);
        }
        
        // Brooks N+1 Rule: If the bar finishes and didn't trigger, or even if it did, 
        // the setup window for this specific signal is now closed.
        s.pendingSignals.delete(versionName);
    }

    // 2. SCAN FOR NEW SIGNALS (SETUP GENERATION)
    if (strategyCandles.length >= 32) {
        for (const [versionName, strategyFn] of Object.entries(STRATEGIES)) {
            const params = {
                tickSize: s.tickSize,
                instrument_key: s.instrument_key || 'default',
                lotSize: s.lotSize || 1
            };
            const signals = strategyFn(strategyCandles, params);
            if (signals && signals.length > 0) {
                const latestSignal = signals[signals.length - 1];
                if (latestSignal.index === strategyCandles.length - 1) {
                    if (!s.activeTrades.has(versionName)) {
                        s.pendingSignals.set(versionName, { ...latestSignal });
                    }
                }
            }
        }
    }
}

function processTickFile(instrumentKey, tickFile, thresholds, buildInst, liveInst) {
    const tickPath = path.join(EXTRACTED_DIR, tickFile);
    const lotMul = getLotMultiplier(instrumentKey);
    const tickSize = liveInst?.tickSize || 0.05;

    console.error(`   📂 ${tickFile} | lotMul=${lotMul} tickSize=${tickSize}`);

    // Peek for date
    const peekBuf = Buffer.alloc(65536);
    const peekFd = fs.openSync(tickPath, 'r');
    const bytesRead = fs.readSync(peekFd, peekBuf, 0, 65536, 0);
    fs.closeSync(peekFd);
    const peekStr = peekBuf.toString('utf8', 0, bytesRead);
    const fn = peekStr.indexOf('\n');
    const sn = peekStr.indexOf('\n', fn + 1);
    const hdrsLine = peekStr.slice(0, fn);
    const firstDataLine = peekStr.slice(fn + 1, sn !== -1 ? sn : undefined).trim();
    const cols = buildColumnIndex(hdrsLine);
    const firstParts = firstDataLine.split(',');
    let extTs = null;
    if (cols.idxExt !== -1 && firstParts.length > cols.idxExt) {
        extTs = parseInt(firstParts[cols.idxExt], 10);
    }
    const dateKey = resolveDateKey(extTs);
    const dateStr = formatDateFromTimestamp(extTs) || 'unknown';

    // Resolve thresholds
    const t = thresholds.length ? thresholds : resolveThresholds(buildInst, liveInst, dateKey);
    if (!t.length) {
        console.error(`   ⚠️ No thresholds resolved for ${tickFile}`);
        return { dateKey, dateStr, thresholds: t, results: {} };
    }

    // Build per-threshold state
    const states = t.map(th => ({
        threshold: th,
        instrument_key: instrumentKey,
        instrumentKey: instrumentKey,
        lotSize: lotMul,
        candle: new VolumeCandle(th, instrumentKey, buildInst.name),
        completedBars: [],
        activeTrades: new Map(),
        pendingSignals: new Map(), // FIX #5: Deferred signals awaiting confirmation bar
        tradeHistory: [],
        totalBars: 0,
        barIndex: 0,
        tickSize,
        initialCapital: 100000
    }));

    // Read file synchronously
    const fileContent = fs.readFileSync(tickPath, 'utf8');
    const allLines = fileContent.split('\n');

    let colIdx = { idxInst: -1, idxLtp: -1, idxLtq: -1, idxExt: -1, idxExIso: -1, idxVolToday: -1 };
    let headerFound = false;
    let lastVolToday = null;
    let lineCount = 0;
    let tickCount = 0;
    let skippedNotThisInst = 0;
    let skippedBadCols = 0;
    let skippedNaN = 0;
    let skippedZeroVol = 0;
    let nextDiagLog = 1000;
    let nextTickLog = 10000;
    let firstTickLogged = false;
    const startTime = Date.now();

    for (const rawLine of allLines) {
        const line = rawLine.trim();
        if (!line) continue;
        lineCount++;

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
        if (parts.length < Math.max(colIdx.idxInst, colIdx.idxLtp, colIdx.idxLtq, colIdx.idxExt) + 1) {
            skippedBadCols++;
            continue;
        }
        if (colIdx.idxInst === -1 || !parts[colIdx.idxInst].includes('|')) {
            skippedBadCols++;
            continue;
        }
        if (parts[colIdx.idxInst] !== instrumentKey) {
            skippedNotThisInst++;
            continue;
        }

        const ltp = parseFloat(parts[colIdx.idxLtp]);
        const ltq = parseInt(parts[colIdx.idxLtq], 10);
        const ext = parseInt(parts[colIdx.idxExt], 10);
        if (isNaN(ltp) || isNaN(ltq) || isNaN(ext)) {
            skippedNaN++;
            continue;
        }

        tickCount++;

        if (!firstTickLogged) {
            console.error(`   🔍 Tick #1: ltp=${ltp} ltq=${ltq} ext=${ext} inst=${parts[colIdx.idxInst]} volToday=${parts[colIdx.idxVolToday] || 'N/A'}`);
            firstTickLogged = true;
        }

        // Diagnostic counters every 1000 lines
        if (lineCount >= nextDiagLog) {
            console.error(`   📊 scanned ${lineCount}/${allLines.length} lines | matched ${tickCount} ticks | skipped: otherInst=${skippedNotThisInst} badCols=${skippedBadCols} nan=${skippedNaN} zeroVol=${skippedZeroVol}`);
            nextDiagLog += 1000;
        }

        // === VOLUME CALCULATION: Exact match of volumeBarBuilder.processTick() ===
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

        if (tickVolume <= 0) {
            skippedZeroVol++;
            continue;
        }

        // Progress logging every 10K ticks
        if (tickCount >= nextTickLog) {
            const barInfo = states.map(s => `T${s.threshold}=${s.totalBars}`).join(' | ');
            console.error(`   ⏳ ${tickCount.toLocaleString()} ticks | ${barInfo}`);
            nextTickLog += 10000;
        }

        const exIso = colIdx.idxExIso !== -1 ? parts[colIdx.idxExIso] : '';
        const currentTime = ext;

        // Per-threshold processing
        for (const s of states) {
            const c = s.candle;
            let tv = tickVolume;

            while (tv > 0) {
                // FIX: Use isNew() consistently (mirrors volumeBarBuilder's bar.open === null check)
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

                    // Save candle to CSV for visualization
                    saveCandleToCSV(closedBar, s, instrumentKey, tickFile);
/*
                    // === TEST: IMMEDIATE STOP ENTRY (N+1 Wick Entry) ===
                    if (s.pendingSignals.size > 0) {
                        for (const [versionName, pending] of s.pendingSignals) {
                            const isBuy = pending.type && pending.type.startsWith('BUY');
                            let triggeredNow = false;

                            // Check if this tick hits the trigger price from the previous bar
                            if (isBuy && ltp >= pending.triggerPrice) triggeredNow = true;
                            if (!isBuy && ltp <= pending.triggerPrice) triggeredNow = true;

                            if (triggeredNow && !s.activeTrades.has(versionName)) {
                                const confidenceScale = (pending.confidence || 50) / 100;
                                // Create the trade at the EXACT trigger price (simulating a stop order fill)
                                const trade = new Trade(versionName, pending, s.totalBars + 1, currentTime, s.barIndex, s.initialCapital, confidenceScale);
                                trade.triggered = true; 
                                trade.filled = true;
                                s.activeTrades.set(versionName, trade);
                                
                                // Remove from pending so we don't create multiple trades
                                s.pendingSignals.delete(versionName);
                            }
                        }
                    }
*/
                    // Check active trades for TP/SL on bar close (direction is normalized to BUY/SELL)
                     for (const [stratName, trade] of s.activeTrades) {
                        if (trade.exitPrice !== null) continue;
                        
                        // Track extremes for MAE/MAFE
                        trade.highestPrice = Math.max(trade.highestPrice, ltp);
                        trade.lowestPrice = Math.min(trade.lowestPrice, ltp);

                        // Check for Fill (for STOP orders only, Confirmed orders are already filled)
                        if (!trade.filled) {
                            if (trade.direction === 'BUY' && ltp >= trade.entryPrice) trade.filled = true;
                            else if (trade.direction === 'SELL' && ltp <= trade.entryPrice) trade.filled = true;
                            
                            if (trade.filled) trade.triggered = true;
                            else continue; // Still waiting for fill
                        }

                        // Only check TP/SL if trade is triggered (LTP crossed entry price)
                        if (!trade.triggered) continue;

                        let hit = false;
                        if (trade.direction === 'BUY') {
                            if (ltp >= trade.takeProfit) { trade.exitPrice = trade.takeProfit - trade.slippage; trade.exitReason = 'take_profit'; hit = true; }
                            else if (ltp <= trade.stopLoss) { trade.exitPrice = trade.stopLoss - trade.slippage; trade.exitReason = 'stop_loss'; hit = true; }
                        } else {
                            if (ltp <= trade.takeProfit) { trade.exitPrice = trade.takeProfit + trade.slippage; trade.exitReason = 'take_profit'; hit = true; }
                            else if (ltp >= trade.stopLoss) { trade.exitPrice = trade.stopLoss + trade.slippage; trade.exitReason = 'stop_loss'; hit = true; }
                        }
                        if (hit) {
                            trade.exitIndex = s.barIndex;
                            trade.exitTime = currentTime;
                            trade.pnlAmount = trade.quantity * (
                                trade.direction === 'BUY'
                                    ? trade.exitPrice - trade.entryPrice
                                    : trade.entryPrice - trade.exitPrice
                            );
                            trade.pnl = trade.direction === 'BUY'
                                ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                                : ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
                            trade.holdingPeriod = trade.exitIndex - trade.entryIndex;
                            // MAFE = excursion toward TP relative to TP distance (can exceed 100%)
                            // MAE = excursion toward SL relative to risk (can exceed 100%)
                            // MAFE = excursion toward TP / TP distance. TP distance must be > 0.
                            // MAE = excursion toward SL / risk.
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

                    // Run strategies on bar close
                    processThresholdBarClose(s, closedBar, currentTime, ltp, exIso, s.barIndex);

                    // Start next candle
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

            // Update active trade extremes on every tick
            for (const [stratName, trade] of s.activeTrades) {
                if (trade.exitPrice !== null) continue;
                trade.highestPrice = Math.max(trade.highestPrice, ltp);
                trade.lowestPrice = Math.min(trade.lowestPrice, ltp);

                // Check if trade is triggered (LTP crossed entry price)
                if (!trade.triggered) {
                    if (trade.direction === 'BUY' && ltp >= trade.entryPrice) {
                        trade.triggered = true;
                    } else if (trade.direction === 'SELL' && ltp <= trade.entryPrice) {
                        trade.triggered = true;
                    }
                }

    // CRITICAL FIX: For stop-entry orders (BUY_STOP/SELL_STOP), the stop loss must be
    // checked even before the trade is "triggered" (LTP crossed entry price).
    // If market hits the stop before reaching the entry, the order never filled in reality.
    // We close it here as "never_filled" to prevent unlimited phantom losses (MAE 200%+).
    if (!trade.triggered) {
        // Check if stop loss was hit before entry (market moved against the stop-entry direction)
        let stopHit = false;
        if (trade.direction === 'BUY' && ltp <= trade.stopLoss) {
            stopHit = true;
        } else if (trade.direction === 'SELL' && ltp >= trade.stopLoss) {
            stopHit = true;
        }
        if (stopHit) {
            // Order never filled in reality - close with minimal loss (slippage on stop)
            trade.exitPrice = ltp; // Exit at current price (stop was hit)
            trade.exitReason = 'never_filled';
            trade.exitIndex = s.barIndex;
            trade.exitTime = currentTime;
            trade.pnlAmount = 0; // No real profit/loss - order was never filled
            trade.pnl = 0;
            trade.holdingPeriod = 0;
            trade.mafePercent = 0;
            trade.maePercent = 100;
            s.tradeHistory.push(trade);
            s.activeTrades.delete(stratName);
            continue;
        }
        continue; // Still not triggered, but stop was not hit, so keep waiting
    }

                // Check for intra-bar TP/SL hit
                let hit = false;
                if (trade.direction === 'BUY') {
                    if (ltp >= trade.takeProfit) { trade.exitPrice = trade.takeProfit - trade.slippage; trade.exitReason = 'take_profit'; hit = true; }
                    else if (ltp <= trade.stopLoss) { trade.exitPrice = trade.stopLoss - trade.slippage; trade.exitReason = 'stop_loss'; hit = true; }
                } else {
                    if (ltp <= trade.takeProfit) { trade.exitPrice = trade.takeProfit + trade.slippage; trade.exitReason = 'take_profit'; hit = true; }
                    else if (ltp >= trade.stopLoss) { trade.exitPrice = trade.stopLoss + trade.slippage; trade.exitReason = 'stop_loss'; hit = true; }
                }
                if (hit) {
                    trade.exitIndex = s.barIndex;
                    trade.exitTime = currentTime;
                    trade.pnlAmount = trade.quantity * (
                        trade.direction === 'BUY'
                            ? trade.exitPrice - trade.entryPrice
                            : trade.entryPrice - trade.exitPrice
                    );
                    trade.pnl = trade.direction === 'BUY'
                        ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
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

    console.error(`   ⏱ Read ${allLines.length} lines from file in ${Date.now() - startTime}ms`);

    // Flush remaining active trades
    for (const s of states) {
        if (s.candle && s.candle.open !== null && s.candle.transactions > 0) {
            s.totalBars++;
        }
        for (const [stratName, trade] of s.activeTrades) {
            if (trade.exitPrice === null) {
                trade.exitPrice = s.candle.close || trade.entryPrice;
                trade.exitReason = 'end_of_data';
                trade.exitIndex = s.barIndex;
                trade.exitTime = s.candle.endTime;
                trade.pnlAmount = trade.quantity * (
                    trade.direction === 'BUY'
                        ? trade.exitPrice - trade.entryPrice
                        : trade.entryPrice - trade.exitPrice
                );
                trade.pnl = trade.direction === 'BUY'
                    ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                    : ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
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

    // Build per-threshold results matching version-backtest-results format
    const results = {};
    for (const s of states) {
        const allTrades = s.tradeHistory;
        const winningTrades = allTrades.filter(t => t.pnlAmount > 0);
        const losingTrades = allTrades.filter(t => t.pnlAmount <= 0);
        const totalPnl = allTrades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
        const pnlPercentTrades = allTrades.filter(t => t.pnl != null);
        const avgReturn = pnlPercentTrades.length ? pnlPercentTrades.reduce((sum, t) => sum + t.pnl, 0) / pnlPercentTrades.length : 0;
        const variance = pnlPercentTrades.length > 1 ? pnlPercentTrades.reduce((sum, t) => sum + Math.pow(t.pnl - avgReturn, 2), 0) / pnlPercentTrades.length : 0;
        const sharpe = variance > 0 ? (avgReturn / Math.sqrt(variance)).toFixed(2) : '0.00';

        let peak = 0, maxDrawdown = 0, running = 0;
        for (const t of allTrades) {
            running += t.pnlAmount || 0;
            if (running > peak) peak = running;
            const dd = peak > 0 ? (peak - running) / peak * 100 : 0;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }

        const avgWin = winningTrades.length ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length : 0;
        const avgLoss = losingTrades.length ? losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length : 0;
        const largestWin = winningTrades.length ? Math.max(...winningTrades.map(t => t.pnl)) : 0;
        const largestLoss = losingTrades.length ? Math.min(...losingTrades.map(t => t.pnl)) : 0;

        const profitFactorWins = winningTrades.reduce((s, t) => s + Math.abs(t.pnl || 0), 0);
        const profitFactorLosses = losingTrades.reduce((s, t) => s + Math.abs(t.pnl || 0), 0);

        // Aggregate per strategy
        const strategiesMap = {};
        const uniqueStrats = [...new Set(allTrades.map(t => t.strategy))];
        for (const strat of uniqueStrats) {
            const stratTrades = allTrades.filter(t => t.strategy === strat);
            const sWins = stratTrades.filter(t => t.pnlAmount > 0);
            const sLosses = stratTrades.filter(t => t.pnlAmount <= 0);
            const sTotalPnl = stratTrades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
            const finalEquity = 100000 + sTotalPnl;
            const sAvgReturn = stratTrades.length ? stratTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / stratTrades.length : 0;
            const sVariance = stratTrades.length > 1 ? stratTrades.reduce((sum, t) => sum + Math.pow((t.pnl || 0) - sAvgReturn, 2), 0) / stratTrades.length : 0;
            const sSharpe = sVariance > 0 ? (sAvgReturn / Math.sqrt(sVariance)).toFixed(2) : '0.00';

            strategiesMap[strat] = {
                signalCount: stratTrades.length,
                results: {
                    totalTrades: stratTrades.length,
                    winningTrades: sWins.length,
                    losingTrades: sLosses.length,
                    winRate: stratTrades.length ? ((sWins.length / stratTrades.length) * 100).toFixed(2) : '0.00',
                    totalReturn: ((sTotalPnl / 100000) * 100).toFixed(2),
                    totalPnl: sTotalPnl.toFixed(2),
                    finalEquity: finalEquity.toFixed(2),
                    avgWin: sWins.length ? (sWins.reduce((ss, t) => ss + t.pnl, 0) / sWins.length).toFixed(2) : '0.00',
                    avgLoss: sLosses.length ? (sLosses.reduce((ss, t) => ss + t.pnl, 0) / sLosses.length).toFixed(2) : '0.00',
                    largestWin: sWins.length ? Math.max(...sWins.map(t => t.pnl)).toFixed(2) : '0.00',
                    largestLoss: sLosses.length ? Math.min(...sLosses.map(t => t.pnl)).toFixed(2) : '0.00',
                    sharpeRatio: sSharpe,
                    maxDrawdown: maxDrawdown.toFixed(2),
                    profitFactor: (profitFactorLosses > 0 ? (profitFactorWins / profitFactorLosses) : 0).toFixed(2),
                    avgConfidence: stratTrades.length ? (stratTrades.reduce((ss, t) => ss + (t.confidence || 0), 0) / stratTrades.length).toFixed(1) : null,
                    stopExits: stratTrades.filter(t => t.exitReason === 'stop_loss').length,
                    targetExits: stratTrades.filter(t => t.exitReason === 'take_profit').length,
                    avgRRR: (stratTrades.reduce((ss, t) => ss + (t.reward / (t.risk > 0 ? t.risk : 1)), 0) / stratTrades.length || 1.50).toFixed(2),
                    trades: stratTrades.map(t => ({
                        entryIndex: t.entryIndex,
                        exitIndex: t.exitIndex,
                        entryPrice: t.entryPrice,
                        exitPrice: t.exitPrice,
                        quantity: t.quantity,
                        pnl: t.pnl,
                        pnlAmount: t.pnlAmount,
                        holdingPeriod: t.holdingPeriod,
                        confidence: t.confidence,
                        exitReason: t.exitReason,
                        mafePercentage: t.mafePercent,
                        maePercentage: t.maePercent,
                        rrr: t.risk > 0 ? parseFloat((t.reward / t.risk).toFixed(2)) : 0,
                        stopLoss: t.stopLoss,
                        takeProfit: t.takeProfit
                    }))
                }
            };
        }

        // Compute averages across all V-strategies
        let totalWinRate = 0, totalReturn = 0, totalRRR = 0, pCount = 0;
        for (const [strat, sd] of Object.entries(strategiesMap)) {
            if (strat.startsWith('V')) {
                totalWinRate += parseFloat(sd.results.winRate) || 0;
                totalReturn += parseFloat(sd.results.totalReturn) || 0;
                totalRRR += parseFloat(sd.results.avgRRR) || 1.50;
                pCount++;
            }
        }

        const sourceFileName = path.basename(tickFile, '.csv');

        results[s.threshold] = {
            instrument: instrumentKey,
            threshold: s.threshold,
            sourceFile: sourceFileName,
            mode: 'live',
            candlesCount: s.totalBars,
            strategies: strategiesMap,
            averages: {
                avgWinRate: pCount > 0 ? parseFloat((totalWinRate / pCount).toFixed(2)) : 0,
                avgReturnPct: pCount > 0 ? parseFloat((totalReturn / pCount).toFixed(2)) : 0,
                avgRRR: pCount > 0 ? parseFloat((totalRRR / pCount).toFixed(2)) : 1.50
            },
            timestamp: Date.now()
        };
    }

    return { dateKey, dateStr, thresholds: t, results, tickCount };
}

// ============================================================
// SAVE PER-THRESHOLD JSON FILES
// ============================================================

const candleCSVHeaders = {};

function saveCandleToCSV(closedBar, s, instrumentKey, tickFile) {
    const safeKey = instrumentKey.replace(/[^a-zA-Z0-9_|]/g, '_').replace(/[|]/g, '_');
    const baseName = path.basename(tickFile, '.csv');
    const candleDir = path.join(CANDLES_DIR, safeKey, String(s.threshold));
    if (!fs.existsSync(candleDir)) fs.mkdirSync(candleDir, { recursive: true });
    const candleFile = path.join(candleDir, `${baseName}_candles.csv`);

    // Write headers only once per file
    const headerKey = `${safeKey}_${s.threshold}_${baseName}`;
    if (!candleCSVHeaders[headerKey]) {
        fs.writeFileSync(candleFile, 'timestamp,open,high,low,close,volume,barNumber,targetVolume,transactions,priceChanges,startTime,endTime,durationMs,priceChange,priceChangePercent,priceRange,priceRangePercent,volumeEfficiency\n', { flag: 'w' });
        candleCSVHeaders[headerKey] = true;
    }

    const row = [
        closedBar.endTime, closedBar.open, closedBar.high, closedBar.low, closedBar.close,
        closedBar.volume, closedBar.barNumber, closedBar.targetVolume, closedBar.transactions,
        closedBar.priceChanges, closedBar.startTime, closedBar.endTime, closedBar.durationMs,
        closedBar.priceChange, closedBar.priceChangePercent, closedBar.priceRange,
        closedBar.priceRangePercent, closedBar.volumeEfficiency
    ].join(',') + '\n';
    fs.appendFileSync(candleFile, row);
}

function saveThresholdResults(instrumentKey, tickFile, resultsObj) {
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const safeKey = instrumentKey.replace(/[^a-zA-Z0-9_|]/g, '_').replace(/[|]/g, '_');
    const baseName = path.basename(tickFile, '.csv');

    for (const [threshold, data] of Object.entries(resultsObj)) {
        const outFileName = `live_${threshold}_${baseName}.json`;
        const outPath = path.join(RESULTS_DIR, outFileName);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    }
}

// ============================================================
// COMMANDS
// ============================================================

async function cmdRun(instrumentKey, opts = {}) {
    const buildConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const liveConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

    if (process.argv.includes('--brooks-only')) {
        Object.keys(STRATEGIES).forEach(k => {
            const num = parseInt(k.substring(1), 10);
            if (!k.startsWith('V') || isNaN(num) || !(num == 955 ||num == 25 ||num == 935 || num == 125 ||num == 925 ||num == 945) ) {
                delete STRATEGIES[k];
            }
        });
    }
    const buildInst = buildConfig.find(x => x.instrument_key === instrumentKey);
    const liveInst = liveConfig.instruments?.find(x => x.key === instrumentKey);
    if (!buildInst) {
        console.error(`❌ No config for ${instrumentKey}`);
        return;
    }

    // Find all tick files for this instrument
    let tickFiles;
    if (opts.date) {
        const f = tickFile => tickFile.includes(opts.date);
        tickFiles = findTickFilesForInstrument(instrumentKey).filter(f);
    } else {
        tickFiles = findTickFilesForInstrument(instrumentKey);
    }

    if (!tickFiles.length) {
        console.error(`❌ No tick files found for ${instrumentKey}`);
        return;
    }

    console.log(`\n🎯 Running backtest for ${instrumentKey} (${buildInst.name})`);
    console.log(`   Found ${tickFiles.length} tick file(s)\n`);

    for (const tickFile of tickFiles) {
        // Peek for thresholds
        const peekBuf = Buffer.alloc(65536);
        const peekFd = fs.openSync(path.join(EXTRACTED_DIR, tickFile), 'r');
        const bytes = fs.readSync(peekFd, peekBuf, 0, 65536, 0);
        fs.closeSync(peekFd);
        const peekStr = peekBuf.toString('utf8', 0, bytes);
        const fn = peekStr.indexOf('\n');
        const sn = peekStr.indexOf('\n', fn + 1);
        const hdrsLine = peekStr.slice(0, fn);
        const firstDataLine = peekStr.slice(fn + 1, sn !== -1 ? sn : undefined).trim();
        const cols = buildColumnIndex(hdrsLine);
        const firstParts = firstDataLine.split(',');
        let extTs = null;
        if (cols.idxExt !== -1 && firstParts.length > cols.idxExt) {
            extTs = parseInt(firstParts[cols.idxExt], 10);
        }
        const dateKey = resolveDateKey(extTs);
        const thresholds = resolveThresholds(buildInst, liveInst, dateKey);

        // Filter by threshold if specified
        let activeThresholds = thresholds;
        if (opts.threshold) {
            const t = parseInt(opts.threshold, 10);
            activeThresholds = thresholds.filter(v => v === t);
        }

        if (!activeThresholds.length) {
            console.warn(`   ⚠️ No thresholds for ${tickFile} -> date ${dateKey || '??'}`);
            continue;
        }

        console.log(`📄 ${tickFile} | date: ${formatDateFromTimestamp(extTs) || '??'} | thresholds: ${activeThresholds.join(', ')}`);
        try {
            const { results } = processTickFile(instrumentKey, tickFile, activeThresholds, buildInst, liveInst);
            if (Object.keys(results).length) {
                saveThresholdResults(instrumentKey, tickFile, results);
                const totalInfos = Object.entries(results).map(([th, d]) => {
                    const trades = Object.values(d.strategies).reduce((s, sd) => s + sd.results.totalTrades, 0);
                    return `T${th}: ${trades} trades`;
                });
                console.log(`   ✅ ${totalInfos.join(', ')}`);
            } else {
                console.error(`   ⚠️ No results produced`);
            }
        } catch (err) {
            console.error(`   ❌ Error processing ${tickFile}: ${err.message}`);
        }
    }
}

async function cmdRunAll() {
    const buildConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const liveConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

    const allTickFiles = fs.readdirSync(EXTRACTED_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    const processedInstruments = new Set();

    console.log(`📂 Found ${allTickFiles.length} tick file(s) in ./extracted`);

    let totalFiles = 0;
    for (const tickFile of allTickFiles) {
        // Extract instrument key from filename: MCX_FO_538685_raw_ticks_2026-07-03.csv
        const parts = tickFile.replace('.csv', '').split('_raw_ticks_');
        if (parts.length < 2) continue;
        const safeKey = parts[0]; // e.g. MCX_FO_538685
        // Replace the LAST underscore with | to get e.g. MCX_FO|538685 (safeKey = MCX_FO_538685)
        const lastUnderscore = safeKey.lastIndexOf('_');
        const instKey = lastUnderscore !== -1 
            ? safeKey.substring(0, lastUnderscore) + '|' + safeKey.substring(lastUnderscore + 1)
            : safeKey;

        const buildInst = buildConfig.find(x => x.instrument_key === instKey);
        const liveInst = liveConfig.instruments?.find(x => x.key === instKey);
        if (!buildInst) continue; // skip instruments not in config

        // Peek for date-based thresholds
        const peekBuf = Buffer.alloc(65536);
        const peekFd = fs.openSync(path.join(EXTRACTED_DIR, tickFile), 'r');
        const bytes = fs.readSync(peekFd, peekBuf, 0, 65536, 0);
        fs.closeSync(peekFd);
        const peekStr = peekBuf.toString('utf8', 0, bytes);
        const fn = peekStr.indexOf('\n');
        const sn = peekStr.indexOf('\n', fn + 1);
        const hdrsLine = peekStr.slice(0, fn);
        const firstDataLine = peekStr.slice(fn + 1, sn !== -1 ? sn : undefined).trim();
        const cols = buildColumnIndex(hdrsLine);
        const firstParts = firstDataLine.split(',');
        let extTs = null;
        if (cols.idxExt !== -1 && firstParts.length > cols.idxExt) {
            extTs = parseInt(firstParts[cols.idxExt], 10);
        }
        const dateKey = resolveDateKey(extTs);
        const thresholds = resolveThresholds(buildInst, liveInst, dateKey);
        if (!thresholds.length) continue;

        if (!processedInstruments.has(instKey)) {
            console.log(`\n🎯 ${instKey} (${buildInst.name})`);
            processedInstruments.add(instKey);
        }

        console.log(`   📄 ${tickFile} | date: ${formatDateFromTimestamp(extTs) || '??'} | thresholds: ${thresholds.join(', ')}`);
        try {
            const { results } = processTickFile(instKey, tickFile, thresholds, buildInst, liveInst);
            if (Object.keys(results).length) {
                saveThresholdResults(instKey, tickFile, results);
                const totalInfos = Object.entries(results).map(([th, d]) => {
                    const trades = Object.values(d.strategies).reduce((s, sd) => s + sd.results.totalTrades, 0);
                    return `T${th}: ${trades} trades`;
                });
                console.log(`      ✅ ${totalInfos.join(', ')}`);
                totalFiles++;
            } else {
                console.error(`      ⚠️ No results (empty)`);
            }
        } catch (err) {
            console.error(`      ❌ Error: ${err.message}`);
        }
    }

    console.log(`\n✅ Done! Processed ${totalFiles} files into ${RESULTS_DIR}/`);
}

// ============================================================
// PARALLEL RUN-ALL using child_process.fork()
// ============================================================
async function cmdRunAllParallel() {
    const { spawn } = require('child_process');
    const os = require('os');

    const buildConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    const allTickFiles = fs.readdirSync(EXTRACTED_DIR).filter(f => f.toLowerCase().endsWith('.csv'));

    // Group tick files by instrument key (each process handles ALL thresholds for one instrument)
    const instrumentTasks = new Map();
    for (const tickFile of allTickFiles) {
        const parts = tickFile.replace('.csv', '').split('_raw_ticks_');
        if (parts.length < 2) continue;
        const safeKey = parts[0];
        const lastUnderscore = safeKey.lastIndexOf('_');
        const instKey = lastUnderscore !== -1
            ? safeKey.substring(0, lastUnderscore) + '|' + safeKey.substring(lastUnderscore + 1)
            : safeKey;

        const buildInst = buildConfig.find(x => x.instrument_key === instKey);
        if (!buildInst) continue;
        if (!instrumentTasks.has(instKey)) instrumentTasks.set(instKey, []);
        instrumentTasks.get(instKey).push(tickFile);
    }

    let instKeys = [...instrumentTasks.keys()];

    // Sort: lotMultiplier=1 first (most work-intensive, maximize parallel utilization)
    instKeys.sort((a, b) => {
        const la = getLotMultiplier(a);
        const lb = getLotMultiplier(b);
        return la - lb;
    });

    const numWorkers = parseInt(process.env.BACKTEST_WORKERS, 10) || Math.max(1, os.cpus().length - 1);
    console.log(`📂 Found ${allTickFiles.length} files → ${instKeys.length} instruments`);
    console.log(`🔧 Dynamic worker pool: ${numWorkers} parallel node processes`);

    let completed = 0;
    const startTime = Date.now();
    const scriptPath = path.resolve(__dirname, 'backtesterAsLive.js');

    // Dynamic worker pool: workers pick next available instrument from queue
    let nextIdx = 0;

    async function runWorker() {
        while (nextIdx < instKeys.length) {
            const idx = nextIdx++;
            const instKey = instKeys[idx];
            const inst = instrumentTasks.get(instKey);
            const name = `${inst[0].split('_raw_ticks_')[0]} (${inst.length} files)`;

            await new Promise((resolve) => {
                const child = spawn('node', [scriptPath, 'run', instKey], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: { ...process.env, BACKTEST_WORKERS: '1' } // prevent recursion
                });

                child.stdout.on('data', d => process.stdout.write(`[${name}] ${d}`));
                child.stderr.on('data', d => process.stderr.write(`[${name}] ${d}`));

                child.on('close', (code) => {
                    completed++;
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                    if (code === 0) {
                        console.log(`   ✅ [${completed}/${instKeys.length}] ${name}: done (${elapsed}s)`);
                    } else {
                        console.error(`   ❌ [${completed}/${instKeys.length}] ${name}: exit code ${code} (${elapsed}s)`);
                    }
                    resolve();
                });

                child.on('error', (err) => {
                    completed++;
                    console.error(`   ❌ ${name} (${instKey}): ${err.message}`);
                    resolve();
                });
            });
        }
    }

    // Start numWorkers workers concurrently
    const workers = [];
    for (let i = 0; i < numWorkers; i++) {
        workers.push(runWorker());
    }
    await Promise.all(workers);

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Done! ${instKeys.length} instruments in ${totalSec}s`);
}

async function cmdRunBrooksParallel() {
    const { spawn } = require('child_process');
    const os = require('os');
    const buildConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const allTickFiles = fs.readdirSync(EXTRACTED_DIR).filter(f => f.toLowerCase().endsWith('.csv'));

    // Unique instrument keys from files
    const instKeys = [...new Set(allTickFiles.map(f => {
        const safe = f.split('_raw_ticks_')[0];
        const lastU = safe.lastIndexOf('_');
        return safe.substring(0, lastU) + '|' + safe.substring(lastU + 1);
    }))].filter(k => buildConfig.find(x => x.instrument_key === k));

    // Sort instruments: lotMultiplier=1 first (slowest/critical for throughput)
    // Instruments with larger lotMultiplier process less per tick (fewer bars) and finish faster
    const sortedKeys = [...instKeys].sort((a, b) => {
        const la = getLotMultiplier(a);
        const lb = getLotMultiplier(b);
        return la - lb; // lotMul=1 first (most work-intensive)
    });

    // Count files per instrument for logging
    const instFileCounts = {};
    for (const f of allTickFiles) {
        const safe = f.split('_raw_ticks_')[0];
        const lastU = safe.lastIndexOf('_');
        const k = safe.substring(0, lastU) + '|' + safe.substring(lastU + 1);
        instFileCounts[k] = (instFileCounts[k] || 0) + 1;
    }

    const numWorkers = parseInt(process.env.BACKTEST_WORKERS, 10) || Math.max(1, os.cpus().length - 1);
    console.log(`🚀 Parallel Brooks Run: ${sortedKeys.length} instruments, ${numWorkers} workers.`);
    console.log(`   Instruments sorted by lotMultiplier (1 first = most work-intensive first)`);
    const scriptPath = path.resolve(__dirname, 'backtesterAsLive.js');

    // Dynamic worker pool: pick from queue instead of batch waiting
    let totalCompleted = 0;
    const startTime = Date.now();
    let nextIdx = 0;
    const active = new Set();

    async function runWorker() {
        while (nextIdx < sortedKeys.length) {
            const idx = nextIdx++;
            const instKey = sortedKeys[idx];
            const lotMul = getLotMultiplier(instKey);
            const fileCount = instFileCounts[instKey] || 0;

            await new Promise((resolve) => {
                const child = spawn('node', [scriptPath, 'run', instKey, '--brooks-only'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: { ...process.env, BACKTEST_WORKERS: '1' }
                });
                child.stdout.on('data', d => process.stdout.write(`[W${active.size}/${numWorkers}][${instKey}] ${d}`));
                child.stderr.on('data', d => process.stderr.write(`[W${active.size}/${numWorkers}][${instKey}] ${d}`));
                child.on('close', () => {
                    totalCompleted++;
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                    console.log(`   ✅ [${totalCompleted}/${sortedKeys.length}] ${instKey} (lotMul=${lotMul}, ${fileCount} files, ${elapsed}s)`);
                    resolve();
                });
            });
        }
    }

    // Start numWorkers workers concurrently
    const workers = [];
    for (let i = 0; i < numWorkers; i++) {
        workers.push(runWorker());
    }
    await Promise.all(workers);

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Done! ${sortedKeys.length} instruments in ${totalSec}s (${numWorkers} workers)`);
}


function cmdCompare(instrumentKey) {
    if (!instrumentKey) {
        console.error('Usage: node backtesterAsLive.js compare <instrument_key>');
        return;
    }
    const safeKey = instrumentKey.replace(/[^a-zA-Z0-9_|]/g, '_').replace(/[|]/g, '_');
    if (!fs.existsSync(RESULTS_DIR)) { console.log('No results found.'); return; }

    const resultFiles = fs.readdirSync(RESULTS_DIR)
        .filter(f => f.endsWith('.json') && f.includes(safeKey))
        .sort();

    if (!resultFiles.length) {
        console.log(`No results found for ${instrumentKey}`);
        return;
    }

    const allResults = [];
    for (const file of resultFiles) {
        const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
        if (!data.strategies) continue;
        for (const [strategy, stratData] of Object.entries(data.strategies)) {
            allResults.push({
                instrument: data.instrument || data.sourceFile,
                threshold: data.threshold,
                source: data.sourceFile,
                strategy,
                trades: stratData.results.totalTrades,
                winRate: stratData.results.winRate,
                returnPct: stratData.results.totalReturn,
                sharpe: stratData.results.sharpeRatio,
                maxDD: stratData.results.maxDrawdown,
                avgRRR: stratData.results.avgRRR || 1.50
            });
        }
    }

    console.log('\n📊 LIVE BACKTEST COMPARISON');
    console.table(allResults);
    return allResults;
}

function cmdCompareAll() {
    if (!fs.existsSync(RESULTS_DIR)) { console.log('No results found.'); return; }
    const resultFiles = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
    if (!resultFiles.length) { console.log('No results found.'); return; }

    const allResults = [];
        for (const file of resultFiles) {
        const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
        if (!data.strategies) continue;
        for (const [strategy, stratData] of Object.entries(data.strategies)) {
            allResults.push({
                instrument: data.instrument || data.sourceFile,
                threshold: data.threshold,
                source: data.sourceFile,
                strategy,
                trades: stratData.results.totalTrades,
                winRate: stratData.results.winRate,
                returnPct: stratData.results.totalReturn,
                sharpe: stratData.results.sharpeRatio,
                maxDD: stratData.results.maxDrawdown,
                avgRRR: stratData.results.avgRRR || 1.50
            });
        }
    }

    console.log('\n📊 ALL LIVE BACKTEST COMPARISON');
    console.log(`   ${resultFiles.length} files, ${allResults.length} strategy results\n`);
    console.table(allResults);
    return allResults;
}

// ============================================================
// CLI
// ============================================================

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        console.log(`
📊 Live Backtester CLI (Tick-by-tick simulation)
Usage:
  node backtesterAsLive.js run "<instrument_key>" [--date YYYY-MM-DD] [--threshold N]
  node backtesterAsLive.js run-all
  node backtesterAsLive.js compare "<instrument_key>"
  node backtesterAsLive.js compare-all

Examples:
  node backtesterAsLive.js run "MCX_FO|538685"
  node backtesterAsLive.js run "MCX_FO|538685" --date 2026-07-03
  node backtesterAsLive.js run "MCX_FO|538685" --threshold 215
  node backtesterAsLive.js run-all
  node backtesterAsLive.js compare "MCX_FO|538685"
  node backtesterAsLive.js compare-all
        `);
        return;
    }

    switch (command) {
        case 'run': {
            const instKey = args[1];
            if (!instKey) { console.error('❌ Usage: node backtesterAsLive.js run <instrument_key>'); process.exit(1); }
            const dateIdx = args.indexOf('--date');
            const thresholdIdx = args.indexOf('--threshold');
            const opts = {};
            if (dateIdx !== -1 && args[dateIdx + 1]) opts.date = args[dateIdx + 1];
            if (thresholdIdx !== -1 && args[thresholdIdx + 1]) opts.threshold = args[thresholdIdx + 1];
            await cmdRun(instKey, opts);
            break;
        }
        case 'run-all':
            await cmdRunAll();
            break;
        case 'run-all-parallel':
            await cmdRunAllParallel();
            break;

        case 'run-brooks-all-parallel':
            await cmdRunBrooksParallel();
            break;

        case 'compare':
            cmdCompare(args[1]);
            break;
        case 'compare-all':
            cmdCompareAll();
            break;
        default:
            console.error(`❌ Unknown command: ${command}`);
            process.exit(1);
    }
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});