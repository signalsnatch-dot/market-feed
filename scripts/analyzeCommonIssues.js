#!/usr/bin/env node
/**
 * scripts/analyzeCommonIssues.js
 * Analyzes losing trades from losing-trades-analysis.json to find top 3 issues.
 * Data structure: instrument, direction, entryIdx, exitIdx, entryPrice, exitPrice, stopLoss, takeProfit, pnl, confidence, metrics, ohlc[]
 * ohlc[]: { idx, o, h, l, c, isEntry, isExitStart }
 * metrics: { signalBarBodyRatio, isDoji, barAligned, signalBarDir, ... }
 */

const fs = require('fs');
const path = require('path');

const ANALYSIS_FILE = path.join(__dirname, '..', 'losing-trades-analysis.json');
let trades = [];
if (fs.existsSync(ANALYSIS_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf-8'));
    trades = loaded.trades || loaded;
}

console.log(`Loaded ${trades.length} losing trades for analysis\n`);

// ============================================================================
// CATEGORIES & HELPERS
// ============================================================================

function getSignalBar(ohlc, entryIdx) { return ohlc.find(b => b.idx === entryIdx - 1) || null; }
function getEntryBar(ohlc, entryIdx) { return ohlc.find(b => b.idx === entryIdx) || null; }

function isDoji(metrics) {
    return metrics.isDoji === true || (metrics.signalBarBodyRatio !== undefined && metrics.signalBarBodyRatio === 0);
}

function signalWrongDir(metrics, dir) {
    if (metrics.barAligned === false) return true;
    // Also check if signalBarDir contradicts trade direction
    if (dir === 'long' && metrics.signalBarDir === 'bear') return true;
    if (dir === 'short' && metrics.signalBarDir === 'bull') return true;
    return false;
}

function isLowConf(conf) { return conf < 70; }

function stopTooTight(trade, signalBar) {
    if (!signalBar) return false;
    const sl = trade.stopLoss;
    const ep = trade.entryPrice;
    const dir = trade.direction;
    if (sl === undefined || ep === undefined) return false;
    // stop must be ABOVE signal bar high FOR SHORT (price goes up to hit it)
    // and BELOW signal bar low FOR LONG (price goes down to hit it)
    if (dir === 'long') return sl > signalBar.l * 0.995; // stop is at or above signal bar low
    if (dir === 'short') return sl < signalBar.h * 1.005; // stop is at or below signal bar high
    return false;
}

function isMicroCounterOahlc(ohlc, entryIdx, direction) {
    const signalIdx = entryIdx - 1;
    const bars = ohlc.filter(b => b.idx >= signalIdx - 5 && b.idx < signalIdx).sort((a,b) => a.idx - b.idx);
    if (bars.length < 3) return false;

    // For long trades: check if prior bars show lower highs/lows (bearish micro)
    // For short trades: check if prior bars show higher highs/lows (bullish micro)
    if (direction === 'long') {
        const lows = bars.map(b => b.l);
        const highs = bars.map(b => b.h);
        let bearCount = 0;
        for (let i = 1; i < lows.length; i++) {
            if (lows[i] < lows[i-1]) bearCount++;
            if (highs[i] < highs[i-1]) bearCount++;
        }
        // More than 50% of pairs show lower structure → micro-downtrend
        return bearCount >= bars.length;
    } else {
        const lows = bars.map(b => b.l);
        const highs = bars.map(b => b.h);
        let bullCount = 0;
        for (let i = 1; i < lows.length; i++) {
            if (lows[i] > lows[i-1]) bullCount++;
            if (highs[i] > highs[i-1]) bullCount++;
        }
        return bullCount >= bars.length;
    }
}

function afterStrongMove(ohlc, entryIdx, direction) {
    const signalIdx = entryIdx - 1;
    const bars = ohlc.filter(b => b.idx >= signalIdx - 6 && b.idx < signalIdx).sort((a,b) => a.idx - b.idx);
    if (bars.length < 3) return false;

    let consec = 0;
    for (const b of bars) {
        const body = Math.abs(b.c - b.o);
        const range = b.h - b.l;
        if (range <= 0) continue;
        const ratio = body / range;
        if (direction === 'long') {
            // Strong bear bars before a long signal is chasing
            if (b.c < b.o && ratio >= 0.5) consec++;
            else if (b.c < b.o && ratio >= 0.3) consec += 0.5;
            else consec = 0;
        } else {
            if (b.c > b.o && ratio >= 0.5) consec++;
            else if (b.c > b.o && ratio >= 0.3) consec += 0.5;
            else consec = 0;
        }
        if (consec >= 2) return true;
    }
    return false;
}

function strongEntryBarAgainst(ohlc, entryIdx, direction) {
    const eb = getEntryBar(ohlc, entryIdx);
    const sb = getSignalBar(ohlc, entryIdx);
    if (!eb || !sb) return false;
    const body = Math.abs(eb.c - eb.o);
    const range = eb.h - eb.l;
    if (range <= 0) return false;
    const ratio = body / range;
    if (direction === 'long') {
        if (eb.c < eb.o && ratio >= 0.4 && eb.l < sb.l) return true;
    } else {
        if (eb.c > eb.o && ratio >= 0.4 && eb.h > sb.h) return true;
    }
    return false;
}

// ============================================================================
// CATEGORIES
// ============================================================================

const cats = {
    DOJI_SIGNAL: { count: 0, trades: [], desc: 'Signal bar is a doji - Brooks requires a TREND BAR.' },
    WRONG_SIGNAL_DIR: { count: 0, trades: [], desc: 'Signal bar points in wrong direction (barAligned=false).' },
    LOW_CONFIDENCE: { count: 0, trades: [], desc: 'Confidence below 70 - low probability setup.' },
    MICRO_COUNTER5END: { count: 0, trades: [], desc: 'Entry is against micro-trend of last 5 bars.' },
    STOP_TOO_TIGHT: { count: 0, trades: [], desc: 'Stop loss too close to signal bar extreme.' },
    AFTER_STRONG_MOVE: { count: 0, trades: [], desc: 'Signal bar follows 2+ strong bars — exhaustion/chasing.' },
    ENTRY_BAR_AGAINST: { count: 0, trades: [], desc: 'Entry bar moved strongly against trade direction.' },
    OTHER: { count: 0, trades: [], desc: 'Other issues or marketplace noise.' },
};

// ============================================================================
// CLASSIFY
// ============================================================================

for (const tr of trades) {
    const { instrument, version, direction, entryIdx, metrics, confidence, ohlc } = tr;
    const sb = getSignalBar(ohlc, entryIdx);
    const eb = getEntryBar(ohlc, entryIdx);
    const doji = isDoji(metrics);
    const wrongDir = signalWrongDir(metrics);
    const lowConf = isLowConf(confidence);
    const micro = isMicroCounterOndc(ohlc, entryIdx);
    const tight = stopTooTight(tr, sb);
    const strongMove = afterStrongMove(ohlc, entryIdx, direction);
    const entryBarAgainstDirection = barStrongBarAgainst(ohlc, entryIdx, direction);

    if (try) {
        categories['DOJI_SIGNAL'].count++;
        categories['DOJI_SIGNAL'].trades.push({ instrument, version, direction, entryIdx, confidence, pnl: tr.pnl });
    } else if (wrongDir) {
        categories['WRONG_SIGNAL_DIR'].count++;
        categories['WRONG_SIGNAL_DIR'].trades.push({ instrument, version, direction, entryIdx, confidence, pnl: tr.pnl });
    } else if (lowConf) {
        categories['LOW_CONFIDENCE'].count++;
        categories['LOW_CONFIDENCE'].trades.push({ instrument, version, direction, entryIdx, confidence, pnl: tr.pnl });
    } else if (microCT) {
        categories['MICRO_COUNTER_TREND'].count++;
        categories['MICRO_COUNTER_TREND'].trades.push({ instrument, version, direction, entryIdx, confidence, pnl: tr.pnl });
    } else if (tight) {
        categories['STOP_TOO_TIGHT'].count++;
        categories['STOP_TOO_TIGHT'].trades.push({ instrument, version, direction, entryIdx, confidence, pnl: tr.pnl });
    } else if (strongMove) {
        categories['AFTER_STRONG_MOVE'].count++;
        categories['AFTER_STRONG_MOVE'].trades.push({ instrument, version, direction, entryIdx, confidence, pnl: tr.pnl });
    } else if (entryBarAgainstDir) {
        categories['ENTRY_BAR_AGAINST'].count++;
        categories['ENTRY_BAR_AGAINST'].trades.push({ instrument, version, direction, entryIdx, confidence, pnl: tr.pnl });
    } else {
        categories['OTHER'].count++;
    }
}

// ============================================================================
// OUTPUT
// ============================================================================

console.log('='.repeat(70));
console.log('QUANTITATIVE ANALYSIS OF 25 LOSING TRADES');
console.log('='.repeat(70));

const sorted = Object.entries(categories).sort((a,b) => b[1].count - a[1].count);
for (let i = 0; i < sorted.length; i++) {
    const [name, data] = sorted[i];
    if (data.count === 0) continue;
    const pct = ((data.count / trades.length) * 100).toFixed(1);
    console.log(`\n#${i+1} ${name}: ${data.count} trades (${pct}%)`);
    console.log(`  ${data.desc}`);
    for (let j = 0; j < Math.min(3, data.trades.length); j++) {
        const td = data.trades[j];
        console.log(`    - ${td.instrument || '?'} ${td.version?.slice(0,10) || ''} ${td.direction} | Conf: ${td.confidence} | PnL: ${(td.pnl||0).toFixed(4)}`);
    }
}

console.log('\n' + '='.repeat(70));
console.log('TOP 3 BROOKS IMPLEMENTATION ISSUES REQUIRING CODE FIXES');
console.log('='.repeat(70));

const top3 = sorted.filter(([name]) => name !== 'OTHER').slice(0, 3);
top3.forEach(([name, data], idx) => {
    console.log(`\n${idx+1}. ${name}: ${data.count} trades`);
    console.log(`   Brooks Ch 2 (p.28-35): Signal bar MUST be a TREND BAR`);
    console.log(`   Fix: Add doji rejection in the applyBrooksStrictFilters reason builder.`);
    if (name === 'DOJI_SIGNAL') {
    console.log(`   SPECIFIC: In the evaluate() function, before counting validReasons,`);
    console.log(`   check: if (signalBar is doji) → failures.push('signal_bar_doji')`);
    }
});

console.log('\nDone.');