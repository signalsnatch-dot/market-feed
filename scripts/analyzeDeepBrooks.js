/**
 * analyzeDeepBrooks.js — v2 — Scan ALL losing trades from live-backtest-results,
 * checking for Brooks violations NOT covered by existing 22 filters.
 * Reports Top 3 most common unseen Brooks violations.
 *
 * Existing filters already implemented in applyBrooksStrictFilters():
 *   doji_signal, signal_wrong_dir, low_confidence, micro_counter_5bar,
 *   stop_too_tight, after_strong_move, entry_bar_against_dir,
 *   close_position_not_near_high/low, wick_dominance, small_body,
 *   outside_bar, exhaustion, micro_trend_3bar, close_dir_mismatch,
 *   entry_bar_strong_against, countertrend_trilogy (TL break + test + reversal),
 *   first_entry_in_strong_trend, exhaustion_range_bar, reversal_overlap
 *
 * NEW DETECTORS (Brooks-authorized, orthogonal):
 *   A. Spike Zone Entry (Ch 3) — 4+ consecutive trend bars = spike phase, don't fade
 *   B. Barb Wire cluster (Ch 5) — 3+ consecutive doji/narrow/inside bars
 *   C. Two-Bar Reversal Trap (Ch 9) — entering AGAINST a valid 2-bar reversal pattern
 *   D. Inside Bar cluster (Ch 5) — 3+ consecutive inside bars = tight range
 *   E. Measured Move Target (Ch 7) — entry when price near equal-leg target
 *   F. Failed Breakout Trap (Ch 6) — entry during breakout pullback that's failing
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'live-backtest-results');
const CANDLES_DIR = path.join(__dirname, '..', 'candles', 'live');

// ===== HELPERS =====

function parseCSV(content) {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const oi = header.indexOf('open'), hi = header.indexOf('high'),
        li = header.indexOf('low'), ci = header.indexOf('close');
  if (oi < 0 || hi < 0 || li < 0 || ci < 0) return [];
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    bars.push({
      open: parseFloat(cols[oi]), high: parseFloat(cols[hi]),
      low: parseFloat(cols[li]), close: parseFloat(cols[ci])
    });
  }
  return bars;
}

// ===== DETECTORS =====

function detectBarbWire(bars, signalIdx) {
  // Brooks Ch 5 (p.137-148): 3+ consecutive doji/narrow/inside bars
  if (signalIdx < 3) return false;
  let narrowCount = 0;
  for (let i = signalIdx - 2; i <= signalIdx; i++) {
    if (i < 0 || i >= bars.length) continue;
    const bar = bars[i];
    const body = Math.abs(bar.close - bar.open);
    const range = bar.high - bar.low;
    if (range <= 0) { narrowCount++; continue; }
    if (body / range < 0.20) { narrowCount++; continue; }
    if (i > 0) {
      const prev = bars[i - 1];
      if (bar.high <= prev.high && bar.low >= prev.low) { narrowCount++; continue; }
    }
  }
  return narrowCount >= 3;
}

function detectSpikeZone(bars, signalIdx, direction) {
  // Brooks Ch 3 (p.78-84): entering countertrend DURING a spike (4+ strong trend bars)
  if (signalIdx < 3) return false;
  let trendCount = 0;
  for (let i = signalIdx; i >= Math.max(0, signalIdx - 5); i--) {
    const bar = bars[i];
    const body = Math.abs(bar.close - bar.open);
    const range = bar.high - bar.low;
    if (range <= 0) break;
    const bodyRatio = body / range;
    if (direction === 'long') {
      // Bear spike before long entry: bear bars with body > 50% range
      if (bar.close < bar.open && bodyRatio > 0.5) trendCount++;
      else break;
    } else {
      // Bull spike before short entry: bull bars with body > 50% range
      if (bar.close > bar.open && bodyRatio > 0.5) trendCount++;
      else break;
    }
  }
  return trendCount >= 4;
}

function detectTwoBarReversalFade(bars, signalIdx, direction) {
  // Brooks Ch 9 (p.221-226): entering AGAINST a 2-bar reversal pattern
  // For a losing LONG trade: there was a 2-bar BEAR reversal (bar1 huge bull, bar2 bear)
  // For a losing SHORT trade: there was a 2-bar BULL reversal (bar1 huge bear, bar2 bull)
  if (signalIdx < 2) return false;
  const bar2 = bars[signalIdx];     // signal bar
  const bar1 = bars[signalIdx - 1]; // prior bar
  if (!bar2 || !bar1) return false;

  const b1r = bar1.high - bar1.low;
  const b2r = bar2.high - bar2.low;
  const b1body = Math.abs(bar1.close - bar1.open);
  const b2body = Math.abs(bar2.close - bar2.open);
  if (b1r <= 0 || b2r <= 0) return false;
  const b1ratio = b1body / b1r;

  if (direction === 'long') {
    // Long trade lost. Was there a 2-bar BEAR reversal trap?
    // Bar1: strong bull (close > open, bodyRatio > 0.5)
    // Bar2: bear reversal (close < open, closes below midpoint of bar1)
    const isBullBar1 = bar1.close > bar1.open && b1ratio > 0.5;
    const isBearBar2 = bar2.close < bar2.open;
    const closesBelowMid = bar2.close < (bar1.high + bar1.low) / 2;
    return isBullBar1 && isBearBar2 && closesBelowMid;
  } else {
    // Short trade lost. Was there a 2-bar BULL reversal trap?
    // Bar1: strong bear (close < open, bodyRatio > 0.5)
    // Bar2: bull reversal (close > open, closes above midpoint of bar1)
    const isBearBar1 = bar1.close < bar1.open && b1ratio > 0.5;
    const isBullBar2 = bar2.close > bar2.open;
    const closesAboveMid = bar2.close > (bar1.high + bar1.low) / 2;
    return isBearBar1 && isBullBar2 && closesAboveMid;
  }
}

function detectInsideBarCluster(bars, signalIdx) {
  // Brooks Ch 5: 3+ consecutive inside bars = tight range, avoid entries
  if (signalIdx < 3) return false;
  let insideCount = 0;
  for (let i = signalIdx - 2; i <= signalIdx; i++) {
    if (i < 0 || i >= bars.length) continue;
    if (i > 0) {
      const prev = bars[i - 1], curr = bars[i];
      if (curr.high <= prev.high && curr.low >= prev.low) insideCount++;
    }
  }
  return insideCount >= 3;
}

function detectMeasuredMoveTarget(bars, signalIdx, direction) {
  // Brooks Ch 7 (p.163-170): If the market has traveled a distance equal to
  // the prior leg (measured move), it's at a target area — low probability for continuation
  // We check: has the prior 5-10 bars moved approximately the same distance as the leg before?
  if (signalIdx < 10) return false;
  const lookback = bars.slice(Math.max(0, signalIdx - 10), signalIdx + 1);
  if (lookback.length < 5) return false;

  // Find the most recent significant swing
  const dir = direction === 'long' ? -1 : 1; // For long, we look at down moves; for short, up moves
  let leg1Start = -1, leg1End = -1, leg2Start = -1, leg2End = -1;
  
  // Scan for two swings of similar magnitude
  let recentHighs = [], recentLows = [];
  for (let i = 1; i < lookback.length - 1; i++) {
    const b = lookback[i];
    // Look for swing highs/lows
    if (b.high >= lookback[i-1].high && b.high >= lookback[i+1].high) {
      recentHighs.push({ idx: signalIdx - lookback.length + 1 + i, price: b.high });
    }
    if (b.low <= lookback[i-1].low && b.low <= lookback[i+1].low) {
      recentLows.push({ idx: signalIdx - lookback.length + 1 + i, price: b.low });
    }
  }
  
  if (direction === 'long') {
    // For long entries: check if last down-leg equals prior down-leg (measured move down)
    if (recentLows.length >= 2) {
      const lastLow = recentLows[recentLows.length-1];
      const prevLow = recentLows[recentLows.length-2];
      const highBetween = recentHighs.filter(h => h.idx > prevLow.idx && h.idx < lastLow.idx);
      if (highBetween.length > 0) {
        const swingHigh = Math.max(...highBetween.map(h => h.price));
        const leg1 = swingHigh - prevLow.price;
        const leg2 = swingHigh - lastLow.price;
        if (leg1 > 0 && leg2 > 0) {
          const ratio = Math.min(leg1, leg2) / Math.max(leg1, leg2);
          if (ratio > 0.8) return true; // Similar legs = measured move
        }
      }
    }
  } else {
    // For short entries: check if last up-leg equals prior up-leg
    if (recentHighs.length >= 2) {
      const lastHigh = recentHighs[recentHighs.length-1];
      const prevHigh = recentHighs[recentHighs.length-2];
      const lowBetween = recentLows.filter(l => l.idx > prevHigh.idx && l.idx < lastHigh.idx);
      if (lowBetween.length > 0) {
        const swingLow = Math.min(...lowBetween.map(l => l.price));
        const leg1 = prevHigh.price - swingLow;
        const leg2 = lastHigh.price - swingLow;
        if (leg1 > 0 && leg2 > 0) {
          const ratio = Math.min(leg1, leg2) / Math.max(leg1, leg2);
          if (ratio > 0.8) return true;
        }
      }
    }
  }
  return false;
}

function detectFailedBreakoutTrap(bars, signalIdx, direction) {
  // Brooks Ch 6 (p.149-162): Breakout test failure / false breakout
  // If the signal bar is a breakout bar that closes weak (not beyond the breakout level)
  // or the prior breakout bar was immediately reversed, entering is a trap
  if (signalIdx < 2) return false;
  const sig = bars[signalIdx];
  const prev = bars[signalIdx - 1];
  const prev2 = bars[Math.max(0, signalIdx - 2)];
  if (!sig || !prev) return false;

  const sigBody = Math.abs(sig.close - sig.open);
  const sigRange = sig.high - sig.low;
  const prevRange = prev.high - prev.low;
  if (sigRange <= 0 || prevRange <= 0) return false;
  const sigBodyRatio = sigBody / sigRange;

  if (direction === 'long') {
    // Long entry trap: prior bar broke below a support (new low) but reversed up weakly
    // Signal bar shows a weak bounce inside the prior bar's range
    const priorMadeNewLow = prev.low < (prev2 ? prev2.low : prev.low);
    const signalIsWeakBounce = sig.high < prev.high && sig.low > prev.low && sigBodyRatio < 0.3;
    return priorMadeNewLow && signalIsWeakBounce;
  } else {
    // Short entry trap: prior bar broke above a resistance (new high) but reversed down weakly
    const priorMadeNewHigh = prev.high > (prev2 ? prev2.high : prev.high);
    const signalIsWeakSelloff = sig.high < prev.high && sig.low > prev.low && sigBodyRatio < 0.3;
    return priorMadeNewHigh && signalIsWeakSelloff;
  }
}

// ===== ANALYZE =====

function analyzeTrade(trade, version, bars) {
  const entryIdx = trade.entryIndex;
  if (entryIdx === undefined || entryIdx < 0 || entryIdx >= bars.length) return null;
  const exitPrice = trade.exitPrice;
  const entryPrice = trade.entryPrice;
  let direction;
  if (entryPrice > exitPrice) direction = 'short';
  else if (entryPrice < exitPrice) direction = 'long';
  else return null;

  const signalIdx = entryIdx - 1;
  if (signalIdx < 0 || signalIdx >= bars.length) return null;

  const issues = [];
  if (detectBarbWire(bars, signalIdx)) issues.push('barb_wire_cluster');
  if (detectSpikeZone(bars, signalIdx, direction)) issues.push('spike_zone_entry');
  if (detectTwoBarReversalFade(bars, signalIdx, direction)) issues.push('two_bar_reversal_fade');
  if (detectInsideBarCluster(bars, signalIdx)) issues.push('inside_bar_cluster');
  if (detectMeasuredMoveTarget(bars, signalIdx, direction)) issues.push('measured_move_target');
  if (detectFailedBreakoutTrap(bars, signalIdx, direction)) issues.push('failed_breakout_trap');

  if (issues.length === 0) return null;
  return { version, direction, entryIdx, pnl: trade.pnlAmount || trade.pnl || 0, issues };
}

// ===== MAIN =====

async function main() {
  console.log('Deep Brooks v2: scanning ALL losing trades for uncovered patterns...\n');
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} result files`);

  const allIssues = {};
  let totalLosers = 0, matched = 0, filesProcessed = 0;

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
      const match = file.match(/live_(\d+)_(.+?)_raw_ticks_(\d{4}-\d{2}-\d{2})/);
      if (!match) continue;
      const threshold = match[1], inst = match[2], date = match[3];
      const candleDir = path.join(CANDLES_DIR, inst, threshold);
      if (!fs.existsSync(candleDir)) continue;
      const candleFiles = fs.readdirSync(candleDir).filter(f => f.includes(date) && f.endsWith('.csv'));
      if (candleFiles.length === 0) continue;
      const csv = fs.readFileSync(path.join(candleDir, candleFiles[0]), 'utf8');
      const bars = parseCSV(csv);
      if (bars.length < 15) continue;

      const strategies = data.strategies || {};
      for (const [stratName, stratData] of Object.entries(strategies)) {
        if (!stratData || !stratData.results) continue;
        for (const tr of (stratData.results.trades || [])) {
          const pnl = tr.pnlAmount || tr.pnl || 0;
          if (pnl >= 0) continue;
          totalLosers++;
          const result = analyzeTrade(tr, stratName.substring(0, 6), bars);
          if (!result) continue;
          matched++;
          for (const iss of result.issues)
            allIssues[iss] = (allIssues[iss] || 0) + 1;
        }
      }
      filesProcessed++;
      if (filesProcessed % 25 === 0)
        console.log(`  progress: ${filesProcessed}/${files.length} files, ${totalLosers} losers`);
    } catch (e) { /* skip corrupt files */ }
    if (totalLosers > 25000) break;
  }

  console.log(`\n=== RESULTS (${filesProcessed} files, ${totalLosers} losers, ${matched} with new patterns) ===\n`);
  const sorted = Object.entries(allIssues).sort((a, b) => b[1] - a[1]);

  for (const [issue, count] of sorted) {
    const pct = ((count / totalLosers) * 100).toFixed(2);
    const pctMatched = ((count / Math.max(1, matched)) * 100).toFixed(1);
    console.log(`  ${issue}: ${count}/${totalLosers} (${pct}% of all losers, ${pctMatched}% of matched)`);
  }

  const report = {
    scanDate: new Date().toISOString(),
    totalLosersExamined: totalLosers,
    tradesWithNewPatterns: matched,
    newPatternCounts: allIssues,
    sortedPatterns: sorted.map(([issue, count]) => ({
      pattern: issue, count,
      pctOfAllLosers: ((count / totalLosers) * 100).toFixed(1),
      pctOfMatched: ((count / Math.max(1, matched)) * 100).toFixed(1)
    }))
  };
  fs.writeFileSync(path.join(__dirname, '..', 'deep-brooks-analysis.json'), JSON.stringify(report, null, 2));
  console.log(`\nReport saved to deep-brooks-analysis.json`);

  const top3 = sorted.slice(0, 3);
  console.log(`\n===== TOP 3 NEW BROOKS VIOLATIONS =====`);
  top3.forEach(([issue, count], idx) => {
    console.log(`  #${idx+1}: ${issue} — ${count} trades (${((count/totalLosers)*100).toFixed(1)}% of all losers)`);
  });
}

main().catch(console.error);