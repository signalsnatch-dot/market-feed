/**
 * analyzeLosersV2.js - Analyze 100+ losing trades from live-backtest-results
 * Parses all strategies per file, infers direction from entry/exit prices,
 * matches OHLC candles, identifies top issues in losers.
 */
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'live-backtest-results');
const CANDLES_DIR = path.join(__dirname, '..', 'candles', 'live');

// ===== HELPERS =====

function classifyBar(bar, medianBody, dojiRatio) {
  const body = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;
  if (range <= 0) return 'doji';
  const bodyRatio = body / range;
  if (bodyRatio < (dojiRatio || 0.15) || body === 0) return 'doji';
  if (medianBody > 0 && body > medianBody * 2.5) return 'exhaustion';
  const isBull = bar.close > bar.open;
  if (isBull && bar.low === bar.open && bar.high === bar.close) return 'shaved_bull';
  if (!isBull && bar.high === bar.open && bar.low === bar.close) return 'shaved_bear';
  if (isBull) {
    const lt = bar.open - bar.low, ut = bar.high - bar.close;
    if (lt > range * 0.25 && ut < range * 0.15) return 'reversal_bull';
  } else {
    const ut = bar.high - bar.open, lt = bar.close - bar.low;
    if (ut > range * 0.25 && lt < range * 0.15) return 'reversal_bear';
  }
  return isBull ? 'trend_bull' : 'trend_bear';
}

function medianBody(bars, lookback) {
  const bodies = [];
  const start = Math.max(0, bars.length - lookback);
  for (let i = start; i < bars.length; i++) {
    bodies.push(Math.abs(bars[i].close - bars[i].open));
  }
  if (bodies.length === 0) return 0;
  bodies.sort((a, b) => a - b);
  const mid = Math.floor(bodies.length / 2);
  return bodies.length % 2 ? bodies[mid] : (bodies[mid - 1] + bodies[mid]) / 2;
}

// ===== OHLC ANALYSIS =====

function analyzeLosingTradeOnOHLC(trade, version, bars) {
  const entryIdx = trade.entryIndex;
  if (entryIdx === undefined || entryIdx < 0 || entryIdx >= bars.length) return null;

  // Infer direction: short if entry > exit, long if entry < exit
  const exitIdx = trade.exitIndex;
  const exitPrice = trade.exitPrice;
  const entryPrice = trade.entryPrice;
  let direction;
  if (entryPrice > exitPrice) direction = 'short';
  else if (entryPrice < exitPrice) direction = 'long';
  else return null; // flat

  const signalBarIdx = entryIdx - 1; // signal bar = bar before entry
  if (signalBarIdx < 0 || signalBarIdx >= bars.length) return null;

  const entryBar = bars[entryIdx];
  const signalBar = bars[signalBarIdx];

  if (!entryBar || !signalBar) return null;

  const lookbackBars = bars.slice(0, entryIdx + 1);
  const medBody = medianBody(lookbackBars, 10);
  const dojiThreshold = 0.15;

  const sigType = classifyBar(signalBar, medBody, dojiThreshold);

  const sigBody = Math.abs(signalBar.close - signalBar.open);
  const sigRange = signalBar.high - signalBar.low;
  const entryBody = Math.abs(entryBar.close - entryBar.open);
  const entryRange = entryBar.high - entryBar.low;

  const sigBodyRatio = sigRange > 0 ? sigBody / sigRange : 0;
  const entryBodyRatio = entryRange > 0 ? entryBody / entryRange : 0;

  const issues = [];

  // 1. Signal bar is doji
  if (sigType === 'doji') issues.push('signal_doji');

  // 2. Signal bar is exhaustion/climax
  if (sigType === 'exhaustion') issues.push('signal_exhaustion');

  // 3. Signal bar body is very small (<25% range)
  if (sigBodyRatio < 0.25 && sigType !== 'doji') issues.push('signal_small_body');

  // 4. Entry bar direction vs signal direction
  const entryIsBull = entryBar.close > entryBar.open;
  const entryIsBear = entryBar.close < entryBar.open;
  if (direction === 'long' && entryIsBear) issues.push('entry_bar_bearish_for_long');
  if (direction === 'short' && entryIsBull) issues.push('entry_bar_bullish_for_short');

  // 5. Signal bar wick analysis
  if (direction === 'long') {
    const upperWick = signalBar.high - Math.max(signalBar.open, signalBar.close);
    const lowerWick = Math.min(signalBar.open, signalBar.close) - signalBar.low;
    if (upperWick > lowerWick * 2 && upperWick > sigRange * 0.3)
      issues.push('signal_upper_wick_dominance');
  } else {
    const lowerWick = Math.min(signalBar.open, signalBar.close) - signalBar.low;
    const upperWick = signalBar.high - Math.max(signalBar.open, signalBar.close);
    if (lowerWick > upperWick * 2 && lowerWick > sigRange * 0.3)
      issues.push('signal_lower_wick_dominance');
  }

  // 6. Signal bar close position
  if (direction === 'long') {
    const closeNearHigh = signalBar.high - signalBar.close < sigRange * 0.35;
    if (!closeNearHigh) issues.push('signal_close_not_near_high');
  } else {
    const closeNearLow = signalBar.close - signalBar.low < sigRange * 0.35;
    if (!closeNearLow) issues.push('signal_close_not_near_low');
  }

  // 7. Micro trend (last 3 bars + signal bar) direction
  if (signalBarIdx >= 3) {
    const microBars = bars.slice(signalBarIdx - 2, signalBarIdx + 1); // 3 bars: -2, -1, 0(signal)
    let bullBars = 0, bearBars = 0;
    for (const mb of microBars) {
      if (mb.close > mb.open) bullBars++;
      else if (mb.close < mb.open) bearBars++;
    }
    if (direction === 'long' && bearBars >= 3) issues.push('micro_3bar_bearish');
    if (direction === 'short' && bullBars >= 3) issues.push('micro_3bar_bullish');
  }

  // 8. Entry bar = large counter-body
  if (direction === 'long' && entryIsBear && entryBodyRatio > 0.6)
    issues.push('entry_bar_strong_bearish');
  if (direction === 'short' && entryIsBull && entryBodyRatio > 0.6)
    issues.push('entry_bar_strong_bullish');

  // 9. Signal bar is OUTSIDE the previous bar
  if (signalBarIdx > 0) {
    const prevBar = bars[signalBarIdx - 1];
    const isOutside = signalBar.high > prevBar.high && signalBar.low < prevBar.low;
    if (isOutside) issues.push('signal_outside_bar');
  }

  // 10. Gap from previous close
  if (signalBarIdx > 0) {
    const prevClose = bars[signalBarIdx - 1].close;
    if (direction === 'long' && signalBar.low > prevClose * 1.01) issues.push('gap_up_long');
    if (direction === 'short' && signalBar.high < prevClose * 0.99) issues.push('gap_down_short');
  }

  // 11. Multi-bar signal: if last 2 bars are both doji/small before entry → indecision
  if (signalBarIdx >= 2) {
    const prevBar = bars[signalBarIdx - 1];
    const prevType = classifyBar(prevBar, medBody, dojiThreshold);
    const prevPrevBar = bars[signalBarIdx - 2];
    const prevPrevType = classifyBar(prevPrevBar, medBody, dojiThreshold);
    if (sigType === 'doji' && prevType === 'doji' && prevPrevType === 'doji')
      issues.push('triple_doji');
  }

  return {
    instrument: trade.instrument || 'unknown',
    version,
    direction,
    entryIdx,
    pnl: trade.pnlAmount || trade.pnl || 0,
    exitReason: trade.exitReason || 'unknown',
    signalBarIdx,
    sigType,
    sigBodyRatio: sigBodyRatio.toFixed(2),
    issues,
    ohlcSnippet: bars.slice(Math.max(0, signalBarIdx - 2), entryIdx + 2).map(b => ({
      o: b.open, h: b.high, l: b.low, c: b.close, dir: b.close > b.open ? 'B' : 'R'
    }))
  };
}

// ===== CSV PARSER =====

function parseCSV(content) {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const openIdx = header.indexOf('open');
  const highIdx = header.indexOf('high');
  const lowIdx = header.indexOf('low');
  const closeIdx = header.indexOf('close');
  const tsIdx = header.findIndex(h => h.includes('time'));
  if (openIdx < 0 || highIdx < 0 || lowIdx < 0 || closeIdx < 0) return [];

  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    bars.push({
      open: parseFloat(cols[openIdx]),
      high: parseFloat(cols[highIdx]),
      low: parseFloat(cols[lowIdx]),
      close: parseFloat(cols[closeIdx]),
      timestamp: tsIdx >= 0 ? cols[tsIdx] : ''
    });
  }
  return bars;
}

// ===== MAIN =====

async function main() {
  console.log('Loading result files...');
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Total files: ${files.length}`);

  // Collect losing trades with context
  const allLosers = [];

  for (const file of files) {
    if (allLosers.length >= 5000) break; // Enough sample pool for 2000-trade analysis
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
      const strategies = data.strategies || {};
      for (const [stratName, stratData] of Object.entries(strategies)) {
        if (!stratData || !stratData.results) continue;
        const trades = stratData.results.trades || [];
        for (const tr of trades) {
          const pnl = tr.pnlAmount || tr.pnl || 0;
          if (pnl < 0) {
            allLosers.push({ file, trade: tr, version: stratName.substring(0, 6) });
          }
        }
      }
    } catch (e) { /* skip */ }
  }

  console.log(`Total losing trades collected: ${allLosers.length}`);

  // Random sample 100
  const shuffled = allLosers.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, 2000);
  console.log(`Sampled ${sample.length} losing trades for OHLC analysis\n`);

  // Process trades with OHLC
  const issueCounts = {};
  const analyzed = [];
  let candlesLoaded = 0;

  for (const { file, trade, version } of sample) {
    // Extract instrument, threshold, date from filename
    const match = file.match(/live_(\d+)_(.+?)_raw_ticks_(\d{4}-\d{2}-\d{2})/);
    if (!match) continue;
    const threshold = match[1];
    const inst = match[2];
    const date = match[3];

    const candleDir = path.join(CANDLES_DIR, inst, threshold);
    if (!fs.existsSync(candleDir)) continue;

    const candleFiles = fs.readdirSync(candleDir).filter(f => f.includes(date) && f.endsWith('.csv'));
    if (candleFiles.length === 0) continue;

    try {
      const csv = fs.readFileSync(path.join(candleDir, candleFiles[0]), 'utf8');
      const bars = parseCSV(csv);
      if (bars.length < 5) continue;
      candlesLoaded++;

      const anal = analyzeLosingTradeOnOHLC(trade, version, bars);
      if (!anal) continue;
      analyzed.push(anal);

      for (const iss of anal.issues) {
        issueCounts[iss] = (issueCounts[iss] || 0) + 1;
      }
    } catch (e) { /* skip */ }
  }

  console.log(`Candles matched: ${candlesLoaded}`);
  console.log(`Successfully analyzed: ${analyzed.length} losing trades\n`);

  // ==== Sort & report ====
  const sortedIssues = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]);
  console.log('===== TOP ISSUES AMONG LOSERS =====');
  for (const [issue, count] of sortedIssues) {
    const pct = ((count / analyzed.length) * 100).toFixed(1);
    console.log(`  ${issue}: ${count} of ${analyzed.length} (${pct}%)`);
  }

  // ===== Save report =====
  const report = {
    totalAnalyzed: analyzed.length,
    sampledFrom: allLosers.length,
    issueCounts,
    sortedIssues: sortedIssues.map(([issue, count]) => ({
      issue, count, pct: ((count / analyzed.length) * 100).toFixed(1)
    })),
    topIssues3: sortedIssues.slice(0, 3).map(([issue, count]) => issue),
    // Show 15 sample trades matching top issues
    samplesByIssue: {}
  };

  // Group sample trades by top issues
  for (const anal of analyzed) {
    for (const iss of anal.issues) {
      if (!report.samplesByIssue[iss]) report.samplesByIssue[iss] = [];
      if (report.samplesByIssue[iss].length < 5) {
        report.samplesByIssue[iss].push({
          version: anal.version,
          direction: anal.direction,
          sigType: anal.sigType,
          sigBodyRatio: anal.sigBodyRatio,
          pnl: anal.pnl,
          exitReason: anal.exitReason,
          ohlc: anal.ohlcSnippet
        });
      }
    }
  }

  fs.writeFileSync(
    path.join(__dirname, '..', 'losers-v2-analysis.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(`\nDetailed report saved to losers-v2-analysis.json`);
}

main().catch(console.error);