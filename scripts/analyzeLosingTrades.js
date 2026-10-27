#!/usr/bin/env node
/**
 * Collects losing trades from all JSON files, maps to candle CSVs,
 * extracts OHLC context, and computes Brooks metrics for analysis.
 */
const fs = require('fs');
const path = require('path');

const TRADE_DIR = path.join(__dirname, '..', 'live-backtest-results');
const CANDLE_DIR = path.join(__dirname, '..', 'candles', 'live');
const OUTPUT_FILE = path.join(__dirname, '..', 'losing-trades-analysis.json');

function loadCandles(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length < 2) return null;
    const bars = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 8) continue;
        bars.push({
            timestamp: cols[0],
            open: parseFloat(cols[1]),
            high: parseFloat(cols[2]),
            low: parseFloat(cols[3]),
            close: parseFloat(cols[4]),
            volume: parseFloat(cols[5]),
            barNumber: parseInt(cols[6]) || i
        });
    }
    return bars;
}

function extractLosingTrades(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const losingTrades = [];
    const instrumentKey = data.instrument || '';
    const parts = instrumentKey.split('|');
    const exchange = parts[0] || '';
    const token = parts[1] || '';
    const threshold = data.threshold || 0;
    const sourceFile = data.sourceFile || '';
    const instrumentDir = exchange + '_' + token;

    for (const [versionKey, strategyData] of Object.entries(data.strategies || {})) {
        const trades = strategyData.results?.trades || [];
        for (const trade of trades) {
            if (trade.pnl >= 0) continue;
            const direction = trade.stopLoss < trade.entryPrice ? 'long' : 'short';
            losingTrades.push({
                sourceFile, filePath: path.basename(filePath),
                instrument: instrumentKey, instrumentDir, threshold,
                exchange, token,
                version: versionKey, direction,
                entryIndex: trade.entryIndex, exitIndex: trade.exitIndex,
                entryPrice: trade.entryPrice, exitPrice: trade.exitPrice,
                stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
                pnl: trade.pnl, pnlAmount: trade.pnlAmount,
                confidence: trade.confidence, exitReason: trade.exitReason,
                holdingPeriod: trade.holdingPeriod
            });
        }
    }
    return losingTrades;
}

function computeMetrics(context, entryIdx, direction) {
    const bars = context.map(c => ({ o: c.open, h: c.high, l: c.low, c: c.close }));
    const relIdx = context.findIndex(c => c.idx === entryIdx);
    if (relIdx < 0 || !bars[relIdx]) return {};
    
    const sigBar = bars[relIdx];
    const body = Math.abs(sigBar.c - sigBar.o);
    const range = sigBar.h - sigBar.l;
    const bodyRatio = range > 0 ? body / range : 0;
    const barDir = sigBar.c > sigBar.o ? 'bull' : 'bear';
    const barAligned = (direction === 'long' && barDir === 'bull') || (direction === 'short' && barDir === 'bear');
    
    // EMA 20 estimate
    let estEMA20 = null, priceAboveEMA = null, emaSlope = null;
    if (context.length >= 20) {
        const prices = bars.map(b => b.c);
        let ema = prices[0];
        const mult = 2 / 21;
        const emaSeries = [];
        for (let i = 0; i < prices.length; i++) {
            ema = (prices[i] - ema) * mult + ema;
            emaSeries.push(ema);
        }
        estEMA20 = Math.round(emaSeries[emaSeries.length - 1] * 100) / 100;
        priceAboveEMA = sigBar.c > estEMA20;
        if (emaSeries.length >= 5) {
            const last5 = emaSeries.slice(-5);
            emaSlope = (last5[4] - last5[0]) / 5;
            emaSlope = Math.round(emaSlope * 10000) / 10000;
        }
    }
    
    // Prior bars analysis
    const priorBars = bars.slice(Math.max(0, relIdx - 5), relIdx);
    let priorDojiCount = 0, priorAvgBody = 0, priorAvgRange = 0;
    if (priorBars.length > 0) {
        const bodies = priorBars.map(b => Math.abs(b.c - b.o));
        const ranges = priorBars.map(b => b.h - b.l);
        priorAvgBody = Math.round((bodies.reduce((s, v) => s + v, 0) / priorBars.length) * 100) / 100;
        priorAvgRange = Math.round((ranges.reduce((s, v) => s + v, 0) / priorBars.length) * 100) / 100;
        priorDojiCount = priorBars.filter((b, i) => ranges[i] > 0 && bodies[i] / ranges[i] < 0.15).length;
    }
    
    // Post-entry analysis (bars AFTER entry up to exit)
    const exitRelIdx = context.findIndex(c => c.idx > entryIdx);
    let postEntryHigh = sigBar.h, postEntryLow = sigBar.l;
    for (let i = relIdx + 1; i < bars.length && i < exitRelIdx; i++) {
        postEntryHigh = Math.max(postEntryHigh, bars[i].h);
        postEntryLow = Math.min(postEntryLow, bars[i].l);
    }
    
    return {
        signalBarBodyRatio: Math.round(bodyRatio * 100) / 100,
        signalBarBody: Math.round(body * 100) / 100,
        signalBarRange: Math.round(range * 100) / 100,
        isDoji: bodyRatio < 0.15,
        signalBarDir: barDir,
        barAligned,
        estEMA20,
        priceAboveEMA,
        emaSlope,
        priorDojiCount,
        priorAvgBody,
        priorAvgRange,
        priorBarbWire: priorDojiCount >= 3,
        contextLength: context.length
    };
}

function main() {
    console.log('=== LOSING TRADES ANALYSIS ===\n');
    
    const allLost = [];
    const files = fs.readdirSync(TRADE_DIR).filter(f => f.endsWith('.json'));
    console.log(`Scanning ${files.length} trade files...`);
    
    for (const f of files) {
        const losing = extractLosingTrades(path.join(TRADE_DIR, f));
        allLost.push(...losing);
    }
    console.log(`Total losing trades: ${allLost.length}\n`);
    
    // Select diverse sample: up to 8 from NSE_FO, 8 from NSE_EQ, 9 from MCX_FO
    const selected = [];
    const exchangeLimits = { 'NSE_FO': 8, 'NSE_EQ': 8, 'MCX_FO': 9 };
    const exchangeCounts = { 'NSE_FO': 0, 'NSE_EQ': 0, 'MCX_FO': 0 };
    // Shuffle to randomize
    const shuffled = [...allLost].sort(() => Math.random() - 0.5);
    for (const t of shuffled) {
        const ex = t.instrument.split('|')[0];
        const limit = exchangeLimits[ex] || 5;
        if (exchangeCounts[ex] >= limit) continue;
        // Avoid duplicate (instrument, version) pairs
        const dup = selected.find(s => s.instrument === t.instrument && s.version === t.version);
        if (dup) continue;
        selected.push(t);
        exchangeCounts[ex]++;
        if (selected.length >= 25) break;
    }
    console.log(`Selected ${selected.length} for analysis\n`);
    
    // Enrich with OHLC
    const enriched = [];
    for (let i = 0; i < selected.length; i++) {
        const t = selected[i];
        const candlePath = path.join(CANDLE_DIR, t.instrumentDir, String(t.threshold), t.sourceFile + '_candles.csv');
        const candles = loadCandles(candlePath);
        if (!candles) { console.log(`SKIP: ${t.filePath} — no candles at ${candlePath}`); continue; }
        
        // Extract context: 10 bars before entry, up to 8 after
        const start = Math.max(0, t.entryIndex - 10);
        const end = Math.min(candles.length, t.entryIndex + 8 + 1);
        const context = [];
        for (let j = start; j < end; j++) {
            context.push({
                idx: j,
                o: candles[j].open, h: candles[j].high, l: candles[j].low, c: candles[j].close,
                isEntry: j === t.entryIndex,
                isExitStart: j >= t.entryIndex + 1 && j <= t.exitIndex
            });
        }
        
        const metrics = computeMetrics(context, t.entryIndex, t.direction);
        
        enriched.push({
            instrument: t.instrument,
            threshold: t.threshold,
            version: t.version,
            direction: t.direction,
            entryIdx: t.entryIndex,
            exitIdx: t.exitIndex,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            stopLoss: t.stopLoss,
            takeProfit: t.takeProfit,
            pnl: t.pnl,
            pnlAmount: t.pnlAmount,
            confidence: t.confidence,
            metrics,
            ohlc: context
        });
    }
    
    // Summary stats
    const doji = enriched.filter(t => t.metrics.isDoji).length;
    const misaligned = enriched.filter(t => !t.metrics.barAligned).length;
    const barbWire = enriched.filter(t => t.metrics.priorBarWire).length;
    const longs = enriched.filter(t => t.direction === 'long');
    const shorts = enriched.filter(t => t.direction === 'short');
    const avgConf = enriched.reduce((s, t) => s + t.confidence, 0) / enriched.length;
    
    console.log(`Enriched: ${enriched.length} trades`);
    console.log(`\n=== KEY METRICS ===`);
    console.log(`Doji signal bars:         ${doji}/${enriched.length} (${(doji/enriched.length*100).toFixed(0)}%)`);
    console.log(`Direction misaligned:      ${misaligned}/${enriched.length} (${(misaligned/enriched.length*100).toFixed(0)}%)`);
    console.log(`Barb-wire prior:           ${barbWire}/${enriched.length} (${(barbWire/enriched.length*100).toFixed(0)}%)`);
    console.log(`Avg confidence:            ${avgConf.toFixed(1)}`);
    console.log(`Long/Short:                ${longs.length}/${shorts.length}`);

    // Write report
    const report = {
        generatedAt: new Date().toISOString(),
        totalLosing: allLost.length,
        analyzed: enriched.length,
        summary: {
            dojiPct: (doji/enriched.length*100).toFixed(0),
            misalignedPct: (misaligned/enriched.length*100).toFixed(0),
            barbWirePct: (barbWire/enriched.length*100).toFixed(0),
            avgConfidence: avgConf.toFixed(1),
            longs: longs.length,
            shorts: shorts.length
        },
        trades: enriched
    };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    console.log(`\nReport: ${OUTPUT_FILE}`);
}

main();
