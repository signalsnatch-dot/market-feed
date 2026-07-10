#!/usr/bin/env node

/**
 * selectDailyThresholds.js — Daily P-Index Ranking Engine
 * 
 * VERSION: 1.0.0
 * 
 * Runs after generateReport.js completes the compact summary markdown.
 * Parses Section A (Best Version+Threshold Per Instrument) from the
 * compact summary, maps each threshold value to its p-index position
 * within the build-version-config static_thresholds array, scores
 * each p‑index across win rate, avg return, and total trades, and writes
 * daily-threshold-ranking.json.
 *
 * ALSO parses individual version backtest result JSONL files
 * (@version-backtest-results/) and /backtest-results/
 * to build per‑instrument per‑p‑index confidence‑level profiles
 * for signal quality (average confidence, confidence75, winRateWConf75,
 * etc.).  These profiles are written into daily-threshold-ranking.json
 * alongside the compact‑summary‑derived scores.
 *
 * Usage:
 *   node scripts/selectDailyThresholds.js [--compact <path>] [--config <path>]
 *
 * Defaults:
 *   compact:  most recent version-backtest-report/live_compact_summary_*.md
 *   config:   build-version-config.json
 *
 * Output:
 *   daily-threshold-ranking.json  (always in CWD)
 *
 * The output JSON is consumed by:
 *   - upstoxMarketFeed.js (selects top‑pIdx per instrument for live feed)
 *   - scripts/verifyDailyThresholds.js (10 AM verification pass)
 *
 * SCORING FORMULA:
 *   For each instrument p-index, we collect all rows from Section A.
 *   If multiple rows exist for the same p-index (from different versions),
 *   we take the BEST winRate row as the primary score.
 *
 *   composite = (winRatePct × 0.45) + (avgReturnPct × 0.35) + (tradesNorm × 0.20)
 *
 *   where:
 *     winRatePct    = winRate directly from the table (0–100)
 *     avgReturnPct  = Avg Return column from table (0–100+ range)
 *     tradesNorm    = normalized to 0–100 scale across all p‑indices
 *                     for that instrument (min→0, max→100)
 *
 *   Confidence‑level data (from backtest JSONL) is stored separately and
 *   NOT incorporated into the composite score.  It is available for
 *   the verification script and human review.
 *
 * SECTION A FORMAT (stable across July 8–9, 2026):
 *
 *   ## Section A: Best Version+Threshold Per Instrument (Top 3 by Win Rate)
 *   | Instrument | Rank | Version | Threshold | Win Rate | Avg Return | Total Return | MAFE | MAE | Trades |
 *   | PNB Future | #1 | V11: Double Traps (Calibrated) | 47 | 100.0% | +0.15% | +0.59% | 158% | 1% | 4 |
 *
 *   Columns (0-indexed after split):
 *     [0] Instrument, [1] Rank, [2] Version, [3] Threshold, [4] Win Rate,
 *     [5] Avg Return, [6] Total Return, [7] MAFE, [8] MAE, [9] Trades
 *
 *   The threshold column contains the raw threshold value (e.g., 47, 725, 36434).
 *   We map this → position in static_thresholds array → p-index.
 *
 * INSTRUMENT NAME MATCHING:
 *   Config uses names like "PNB July Future", "Infosys July Future",
 *   "HDFC Bank Cash Equity".  Section A uses shorter names like
 *   "PNB Future", "Infosys Future", "HDFC Bank".
 *
 *   Matching strategy:
 *     1. Exact case-insensitive match on config name
 *     2. Config name starts with Section-A name (e.g. "PNB Future" ⊂ "PNB July Future")
 *     3. Section-A name + " July Future" matches config name
 *     4. Section-A name + " Cash Equity" matches config name
 */

const fs = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────
const CWD = process.cwd();
const DEFAULT_CONFIG = path.join(CWD, 'build-version-config.json');
const DEFAULT_COMPACT_PATTERN = /live_compact_summary_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.md$/;
const VERSION_RESULTS_DIR = path.join(CWD, 'version-backtest-results');
const BACKTEST_RESULTS_DIR = path.join(CWD, 'backtest-results');
const OUTPUT_FILE = path.join(CWD, 'daily-threshold-ranking.json');

// Scoring weights
const WEIGHT_WIN_RATE = 0.45;
const WEIGHT_SCORE = 0.35;   // score = Avg Return %
const WEIGHT_SIGNALS = 0.20;  // signals = Trades count
const CONFIDENCE_PERCENTILE = 0.75;

// Section A header marker
const SECTION_A_HEADER = '## Section A: Best Version+Threshold Per Instrument';

// ─── Name Match Helpers ─────────────────────────────────────────────────────

/**
 * Build a lookup from compact-summary instrument name → config entry.
 *
 * Config names are like "PNB July Future", "HDFC Bank Cash Equity".
 * Section A names are like "PNB Future", "HDFC Bank".
 *
 * Matching rules (tried in order):
 *   1. Exact match (case-insensitive) on config name
 *   2. Config name starts with section name (e.g. section="PNB Future" matches config="PNB July Future")
 *   3. Section name + " July Future" matches config name exactly
 *   4. Section name + " Cash Equity" matches config name exactly
 *
 * Returns: Map<sectionName_lowercase → configEntry>
 */
function buildNameLookup(configEntries) {
  const lookup = new Map();

  for (const entry of configEntries) {
    const cfgName = entry.name;
    const cfgNameLower = cfgName.toLowerCase();

    // Strategy 1 & 2: exact match or config starts with a potential compact name
    // For each config name, we register the config name itself, plus
    // shorter versions by removing " July Future" / " Cash Equity"
    lookup.set(cfgNameLower, entry);

    // Generate compact-style names from config
    // e.g. "PNB July Future" → "PNB Future"
    // e.g. "HDFC Bank Cash Equity" → "HDFC Bank"
    let shortName = cfgNameLower;
    shortName = shortName.replace(/\s+july\s+future$/, ' future');
    shortName = shortName.replace(/\s+cash\s+equity$/, '');
    if (shortName !== cfgNameLower) {
      // Don't overwrite if already exists (multiple instruments may map to same short name)
      if (!lookup.has(shortName)) {
        lookup.set(shortName, entry);
      }
    }
  }

  return lookup;
}

/**
 * Resolve a Section A instrument name to a config entry.
 * Returns the config entry or null.
 *
 * Priority rules when multiple config entries match the same section name:
 *   1. If sectionName contains "cash" → prefer Cash Equity variant
 *   2. Otherwise → prefer Future/Non-Equity variant (July Future, Mini, Micro, etc.)
 *   3. If still tied, prefer shorter config name (closer match)
 */
function resolveInstrument(sectionName, configList, nameLookup) {
  const lower = sectionName.toLowerCase().trim();

  // Direct lookup
  if (nameLookup.has(lower)) {
    const entry = nameLookup.get(lower);
    const entryNameLower = entry.name.toLowerCase();
    // Section A naming convention:
    //   "TCS", "Axis Bank", "HDFC Bank" (no "Future")  → Cash Equity
    //   "TCS Future", "PNB Future" (has "Future")       → Future variant
    const sectionHasFuture = lower.includes('future');

    if (sectionHasFuture && entryNameLower.includes('cash equity')) {
      // Section says "Future" but direct lookup hit Cash Equity → wrong.
      // Try to find Future variant instead.
      const futureNameExact = lower + ' july future';
      for (const e of configList) {
        if (e.name.toLowerCase() === futureNameExact) return e;
      }
      const futureNameShort = lower + ' future';
      for (const e of configList) {
        if (e.name.toLowerCase() === futureNameShort) return e;
      }
    } else if (!sectionHasFuture && entryNameLower.includes('future')) {
      // Section says plain name (e.g., "TCS", "Reliance Industries")
      // but lookup returned a Future variant → try to find Cash Equity.
      const cashName = lower + ' cash equity';
      for (const e of configList) {
        if (e.name.toLowerCase() === cashName) return e;
      }
    }
    return entry;
  }

  // Collect ALL candidate matches (prefix, suffix, base-match)
  const candidates = [];

  // Try prefix matching: config name starts with section name
  // Also try: section name + " July Future", " Future", " Cash Equity", " (Cash)" etc.
  for (const entry of configList) {
    const cfgLower = entry.name.toLowerCase();
    if (cfgLower.startsWith(lower)) {
      candidates.push({ entry, priority: cfgLower === lower ? 100 : 50, source: 'prefix' });
    }
  }

  // Try adding " July Future" suffix
  const withJuly = lower + ' july future';
  for (const entry of configList) {
    if (entry.name.toLowerCase() === withJuly) {
      candidates.push({ entry, priority: 90, source: 'suffix+july' });
    }
  }

  // Try adding " Future" suffix (for MCX instruments)
  const withFuture = lower + ' future';
  for (const entry of configList) {
    if (entry.name.toLowerCase() === withFuture) {
      candidates.push({ entry, priority: 85, source: 'suffix+future' });
    }
  }

  // Try adding " Cash Equity" suffix
  const withCash = lower + ' cash equity';
  for (const entry of configList) {
    if (entry.name.toLowerCase() === withCash) {
      candidates.push({ entry, priority: 80, source: 'suffix+cash' });
    }
  }

  // Try adding " (Cash)" suffix (special case from Section A)
  const withCashParen = lower + ' (cash)';
  for (const entry of configList) {
    if (entry.name.toLowerCase() === withCashParen) {
      candidates.push({ entry, priority: 80, source: 'suffix+cashparen' });
    }
  }

  // Try: config name without " July Future" or " Cash Equity" equals section name
  for (const entry of configList) {
    let cfgBase = entry.name.toLowerCase();
    cfgBase = cfgBase.replace(/\s+july\s+future$/, '');
    cfgBase = cfgBase.replace(/\s+cash\s+equity$/, '');
    cfgBase = cfgBase.replace(/\s+future$/, '');
    if (cfgBase.trim() === lower) {
      candidates.push({ entry, priority: 70, source: 'base-match' });
    }
  }

  // Special case: Section A has names with parenthetical suffixes like
  // "Tata Motors (Cash)" which should match "Tata Motors Cash Equity",
  // and "Infosys (INFY)" which should match "Infosys Cash Equity".
  // Strip parenthetical suffix and try matching.
  const parenMatch = lower.match(/^(.+?)\s*\([^)]+\)$/);
  if (parenMatch) {
    const baseName = parenMatch[1].trim();
    // Content inside parens can indicate type: (Cash) → Cash Equity
    const parenContent = lower.match(/\(([^)]+)\)/)?.[1]?.toLowerCase() || '';

    // Try prefix matching with the base name
    for (const entry of configList) {
      const cfgLower = entry.name.toLowerCase();
      if (cfgLower.startsWith(baseName)) {
        candidates.push({ entry, priority: 55, source: 'paren-base-prefix' });
      }
    }
    // Also try suffix match: baseName + " July Future" / baseName + " Cash Equity"
    const cashSuffix = baseName + ' cash equity';
    const julySuffix = baseName + ' july future';
    for (const entry of configList) {
      const cfgLower = entry.name.toLowerCase();
      if (cfgLower === cashSuffix) {
        candidates.push({ entry, priority: 75, source: 'paren+cash-suffix' });
      }
      if (cfgLower === julySuffix) {
        candidates.push({ entry, priority: 75, source: 'paren+july-suffix' });
      }
    }

    // Boost by content: if paren says "cash", boost Cash Equity
    if (parenContent.includes('cash')) {
      for (const c of candidates) {
        if (c.source === 'paren+cash-suffix' && c.entry.name.toLowerCase().includes('cash equity')) {
          c.priority += 10;
        }
      }
    }
  }

  // Special case: "Reliance Industries" — the config uses "Reliance" not "Reliance Industries"
  // Try matching by removing common suffixes like " Industries", " Ltd", " IND"
  const cleanedName = lower
    .replace(/\s+industries$/, '')
    .replace(/\s+ltd\.?$/, '')
    .replace(/\s+ind$/, '')
    .trim();
  if (cleanedName !== lower) {
    for (const entry of configList) {
      const cfgLower = entry.name.toLowerCase();
      if (cfgLower.startsWith(cleanedName)) {
        candidates.push({ entry, priority: 45, source: 'cleaned-prefix' });
      }
    }
    // Also try cleaned + " Cash Equity" / " July Future"
    for (const entry of configList) {
      const cfgLower = entry.name.toLowerCase();
      if (cfgLower === cleanedName + ' cash equity' ||
          cfgLower === cleanedName + ' july future') {
        candidates.push({ entry, priority: 65, source: 'cleaned-suffix' });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Apply type preference based on Section A naming convention:
  //
  //   Section A name              → Preferred config variant
  //   ─────────────────────────────────────────────────────
  //   "TCS", "Axis Bank", "HDFC Bank"      → Cash Equity  (plain = Cash)
  //   "Reliance Industries"                 → Cash Equity
  //   "Infosys (INFY)"                      → Cash Equity
  //   "Tata Motors (Cash)"                  → Cash Equity
  //   "TCS Future", "Axis Bank Future"      → July Future  (name + "Future" = Future)
  //   "PNB Future", "Nifty 50 Future"       → July Future
  //   "Copper Future", "Gold Mini Future"   → MCX exact match
  //
  const sectionMentionsFuture = lower.includes('future');
  const sectionMentionsCash = lower.includes('cash') || lower.includes('equity');

  if (sectionMentionsFuture) {
    // Section name explicitly has "Future" → boost July Future / Future variants
    for (const c of candidates) {
      const name = c.entry.name.toLowerCase();
      if (name.includes('july future') || name.includes('future')) {
        c.priority += 20;
      }
      if (name.includes('cash equity')) {
        c.priority -= 30; // strong penalty
      }
    }
  } else {
    // Section name does NOT mention "Future" → this is Cash Equity
    // (Plain names like "TCS", "Axis Bank", "HDFC Bank", "Reliance Industries",
    //  "Infosys (INFY)", "Tata Motors (Cash)" are all Cash Equity entries)
    for (const c of candidates) {
      const name = c.entry.name.toLowerCase();
      if (name.includes('cash equity')) {
        c.priority += 25;
      }
      if (name.includes('july future') || name.includes('future')) {
        c.priority -= 20;
      }
    }
  }

  // Sort by priority descending, then by name length (shorter = closer match)
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Tiebreaker: shorter config name = probably better match
    const aLen = a.entry.name.length;
    const bLen = b.entry.name.length;
    if (aLen !== bLen) return aLen - bLen;
    // Prefer exact suffix match over prefix-only match
    const aExact = a.source.startsWith('suffix') ? 1 : 0;
    const bExact = b.source.startsWith('suffix') ? 1 : 0;
    return bExact - aExact;
  });

  return candidates[0].entry;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Extract numeric threshold value. Handles formats like:
 *   "47", "725", "36434", "T725" (T prefix is optional)
 */
function extractThresholdValue(raw) {
  if (!raw) return null;
  const stripped = raw.replace(/^T/, ''); // remove optional "T" prefix
  const num = parseInt(stripped, 10);
  return isNaN(num) ? null : num;
}

/**
 * Map a threshold value to its p-index within static_thresholds.
 * Returns -1 if not found.
 */
function thresholdToPIndex(thresholdValue, staticThresholds) {
  return staticThresholds.indexOf(thresholdValue);
}

/**
 * Parse Section A from the compact summary markdown.
 *
 * Column layout (10 columns after pipe-split):
 *   [0] Instrument, [1] Rank, [2] Version, [3] Threshold,
 *   [4] Win Rate, [5] Avg Return, [6] Total Return,
 *   [7] MAFE, [8] MAE, [9] Trades
 *
 * Returns an array of rows:
 *   [{ instrument, thresholdValue, winRate, avgReturnPct, trades, version }]
 */
function parseSectionA(content) {
  const rows = [];

  const sectionStart = content.indexOf(SECTION_A_HEADER);
  if (sectionStart === -1) {
    console.error('[selectDailyThresholds] Section A header not found in compact summary');
    return rows;
  }

  // Find the next section header to bound our parse range
  const afterStart = content.indexOf('\n', sectionStart);
  const nextSectionMatch = content.slice(afterStart).match(/\n## Section\s/);
  const sectionEnd = nextSectionMatch
    ? afterStart + nextSectionMatch.index
    : content.length;

  const section = content.slice(sectionStart, sectionEnd);
  const lines = section.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Table header row or separator row triggers table parsing
    if (trimmed.startsWith('| Instrument') || trimmed.startsWith('| :---')) {
      inTable = true;
      continue;
    }

    // Blank line ends the table
    if (inTable && trimmed === '') {
      inTable = false;
      continue;
    }

    if (!inTable || !trimmed.startsWith('|')) continue;

    // Split and clean cells
    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c !== '');
    // Expected: 10 columns (Instrument, Rank, Version, Threshold, Win Rate, Avg Return, Total Return, MAFE, MAE, Trades)
    if (cells.length < 10) continue;

    const instrument = cells[0];      // e.g., "PNB Future"
    const thresholdRaw = cells[3];    // e.g., "47", "36434", "T725"
    const winRateRaw = cells[4];      // e.g., "100.0%"
    const avgReturnRaw = cells[5];    // e.g., "+0.15%", "-0.10%"
    const tradesRaw = cells[9];       // e.g., "4"

    const thresholdValue = extractThresholdValue(thresholdRaw);
    if (thresholdValue === null) {
      console.warn(`[selectDailyThresholds] Could not parse threshold from "${thresholdRaw}" for ${instrument}`);
      continue;
    }

    const winRate = parseFloat(winRateRaw.replace('%', ''));
    const avgReturnPct = parseFloat(avgReturnRaw.replace('%', '').replace('+', ''));
    const trades = parseInt(tradesRaw, 10);

    if (isNaN(winRate) || isNaN(avgReturnPct) || isNaN(trades)) {
      console.warn(`[selectDailyThresholds] Could not parse numeric values for ${instrument} row: ${trimmed}`);
      continue;
    }

    rows.push({
      instrument,
      thresholdValue,
      winRate,
      avgReturnPct,
      trades,
      version: cells[2],
    });
  }

  return rows;
}

/**
 * Aggregate Section A rows into per‑instrument per‑p‑index data.
 *
 * For each (instrument, pIndex), we take the BEST (highest winRate) row.
 *
 * Returns:
 *   - instMap:      Map<instrumentKey, Map<pIndex, aggregate>>
 *   - configByKey:  Map<instrumentKey, configEntry>
 *   - unmatched:    Array of { instrument, thresholdValue } that couldn't be matched
 */
function aggregateSectionA(rows, config) {
  const instMap = new Map(); // instrument_key → Map<pIndex → aggregates>
  const configByKey = new Map();
  const nameLookup = buildNameLookup(config);
  const unmatched = [];

  for (const entry of config) {
    configByKey.set(entry.instrument_key, entry);
  }

  for (const row of rows) {
    const cfgEntry = resolveInstrument(row.instrument, config, nameLookup);
    if (!cfgEntry) {
      unmatched.push({ instrument: row.instrument, thresholdValue: row.thresholdValue });
      continue;
    }

    const pIndex = thresholdToPIndex(row.thresholdValue, cfgEntry.static_thresholds);
    if (pIndex === -1) {
      console.warn(`[selectDailyThresholds] Threshold ${row.thresholdValue} not in static_thresholds for ${cfgEntry.name} (${cfgEntry.instrument_key})`);
      continue;
    }

    row.pIndex = pIndex;
    row.instrumentKey = cfgEntry.instrument_key;

    if (!instMap.has(cfgEntry.instrument_key)) {
      instMap.set(cfgEntry.instrument_key, new Map());
    }
    const pMap = instMap.get(cfgEntry.instrument_key);

    if (!pMap.has(pIndex)) {
      pMap.set(pIndex, {
        winRate: 0,
        avgReturnPct: 0,
        trades: 0,
        count: 0,
        versions: [],
        thresholdValue: row.thresholdValue,
        instrumentName: cfgEntry.name,
      });
    }

    const agg = pMap.get(pIndex);
    agg.count++;
    agg.versions.push(row.version);

    // Take BEST winRate
    if (row.winRate > agg.winRate) {
      agg.winRate = row.winRate;
      agg.avgReturnPct = row.avgReturnPct;
      agg.trades = row.trades;
    }
  }

  return { instMap, configByKey, nameLookup, unmatched };
}

// ─── Confidence Profiles ────────────────────────────────────────────────────

/**
 * Parse backtest JSON/JSONL files for confidence-level data.
 *
 * Scans:
 *   - version-backtest-results/continuous_*.json
 *   - backtest-results/*.jsonl
 *
 * Returns: Map<instrumentKey, Map<pIndex, confidenceProfile>>
 */
function parseConfidenceProfiles(config) {
  const profileMap = new Map();

  const thresholdLookup = new Map();
  for (const entry of config) {
    const tMap = new Map();
    for (let i = 0; i < entry.static_thresholds.length; i++) {
      tMap.set(entry.static_thresholds[i], i);
    }
    thresholdLookup.set(entry.instrument_key, tMap);
  }

  function ingestSignal(instrumentKey, thresholdValue, confidence, won) {
    const tMap = thresholdLookup.get(instrumentKey);
    if (!tMap) return;
    const pIndex = tMap.get(thresholdValue);
    if (pIndex === undefined) return;

    if (!profileMap.has(instrumentKey)) {
      profileMap.set(instrumentKey, new Map());
    }
    const pMap = profileMap.get(instrumentKey);

    if (!pMap.has(pIndex)) {
      pMap.set(pIndex, { confidences: [], wonFlags: [], versionCount: 0 });
    }

    const prof = pMap.get(pIndex);
    prof.confidences.push(confidence);
    prof.wonFlags.push(won);
  }

  function processSignals(signals, instrumentKey, thresholdValue) {
    if (!signals || !Array.isArray(signals)) return;
    for (const sig of signals) {
      const sigThreshold = sig.threshold || thresholdValue;
      const confidence = sig.confidence;
      const won = sig.won === true || sig.won === 'true' || sig.result === 'win';
      if (confidence !== undefined && confidence !== null) {
        ingestSignal(instrumentKey, sigThreshold, confidence, won);
      }
    }
  }

  // Scan version-backtest-results/*.json
  if (fs.existsSync(VERSION_RESULTS_DIR)) {
    const vFiles = fs.readdirSync(VERSION_RESULTS_DIR).filter(f => f.startsWith('continuous_') && f.endsWith('.json'));
    for (const vFile of vFiles) {
      try {
        const filePath = path.join(VERSION_RESULTS_DIR, vFile);
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) continue;

        for (const run of data) {
          const signals = run.signals;
          const cfg = run.config || run.versionConfig || {};
          const instrumentKey = cfg.instrument_key || cfg.instrumentKey;

          // Fallback from filename
          let fallbackKey = null;
          if (!instrumentKey) {
            const parts = vFile.replace('.json', '').split('_');
            if (parts.length >= 5) {
              fallbackKey = `${parts[2]}_FO|${parts[4]}`;
            }
          }

          const key = instrumentKey || fallbackKey;
          const tVal = cfg.threshold || cfg.thresholdValue ||
            (cfg.static_thresholds ? cfg.static_thresholds[0] : null);

          if (key && signals) {
            processSignals(signals, key, tVal);
          }
        }
      } catch (e) {
        if (!e.message.includes('ENOENT')) {
          console.warn(`[selectDailyThresholds] Could not process ${vFile}: ${e.message}`);
        }
      }
    }
  }

  // Scan backtest-results/*.jsonl
  if (fs.existsSync(BACKTEST_RESULTS_DIR)) {
    const bFiles = fs.readdirSync(BACKTEST_RESULTS_DIR).filter(f => f.endsWith('.jsonl'));
    for (const bFile of bFiles) {
      try {
        const filePath = path.join(BACKTEST_RESULTS_DIR, bFile);
        const raw = fs.readFileSync(filePath, 'utf8');
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            const cfg = obj.config || obj.versionConfig || {};
            const instrumentKey = cfg.instrument_key || cfg.instrumentKey;
            const thresholdValue = cfg.threshold || cfg.thresholdValue;
            if (instrumentKey && obj.signals) {
              processSignals(obj.signals, instrumentKey, thresholdValue);
            }
          } catch (_) { /* skip malformed lines */ }
        }
      } catch (e) {
        if (!e.message.includes('ENOENT')) {
          console.warn(`[selectDailyThresholds] Could not process ${bFile}: ${e.message}`);
        }
      }
    }
  }

  // Compute derived statistics
  const result = new Map();
  for (const [instKey, pMap] of profileMap.entries()) {
    const instResult = new Map();
    for (const [pIdx, prof] of pMap.entries()) {
      const confs = prof.confidences;
      const wons = prof.wonFlags;
      if (confs.length === 0) continue;

      const sorted = [...confs].sort((a, b) => a - b);
      const n = sorted.length;
      const pIdx75 = Math.floor(n * CONFIDENCE_PERCENTILE);
      const conf75 = sorted[Math.min(pIdx75, n - 1)];

      const totalWins = wons.filter(w => w).length;
      const totalWinRate = confs.length > 0 ? (totalWins / confs.length) * 100 : 0;

      let highConfSignals = 0;
      let highConfWins = 0;
      for (let i = 0; i < confs.length; i++) {
        if (confs[i] >= conf75) {
          highConfSignals++;
          if (wons[i]) highConfWins++;
        }
      }
      const winRateWConf75 = highConfSignals > 0 ? (highConfWins / highConfSignals) * 100 : 0;

      const avgConfidence = confs.reduce((a, b) => a + b, 0) / confs.length;

      instResult.set(pIdx, {
        cnt: confs.length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        confidence75: conf75,
        winRateWConf75: Math.round(winRateWConf75 * 100) / 100,
        totalWinRate: Math.round(totalWinRate * 100) / 100,
      });
    }
    if (instResult.size > 0) {
      result.set(instKey, instResult);
    }
  }

  return result;
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function normalizeTrades(instMap) {
  for (const [, pMap] of instMap.entries()) {
    const values = Array.from(pMap.values()).map(a => a.trades);
    const min = Math.min(...values);
    const max = Math.max(...values);

    for (const [, agg] of pMap.entries()) {
      if (max === min || max === 0) {
        agg.normalizedTrades = 50;
      } else {
        agg.normalizedTrades = ((agg.trades - min) / (max - min)) * 100;
      }
    }
  }
}

function computeCompositeScores(instMap) {
  for (const [, pMap] of instMap.entries()) {
    for (const [, agg] of pMap.entries()) {
      agg.compositeScore =
        (agg.winRate * WEIGHT_WIN_RATE) +
        (agg.avgReturnPct * WEIGHT_SCORE) +
        (agg.normalizedTrades * WEIGHT_SIGNALS);
      agg.compositeScore = Math.round(agg.compositeScore * 100) / 100;
    }
  }
}

// ─── Build Output ───────────────────────────────────────────────────────────

function buildOutput(instMap, configByKey, confidenceProfiles, unmatched) {
  const ranking = [];

  for (const [instKey, pMap] of instMap.entries()) {
    const cfgEntry = configByKey.get(instKey);
    const confProfile = confidenceProfiles.get(instKey);

    const pEntries = Array.from(pMap.entries()).map(([pIdx, agg]) => ({
      pIndex: pIdx,
      thresholdValue: agg.thresholdValue,
      winRate: agg.winRate,
      avgReturnPct: agg.avgReturnPct,
      trades: agg.trades,
      normalizedTrades: Math.round(agg.normalizedTrades * 100) / 100,
      compositeScore: agg.compositeScore,
      versionCount: agg.count,
      versions: agg.versions,
      confidenceProfile: confProfile ? (confProfile.get(pIdx) || null) : null,
    }));

    pEntries.sort((a, b) => b.compositeScore - a.compositeScore);
    pEntries.forEach((entry, i) => { entry.rank = i + 1; });

    const barEstimates = {};
    if (cfgEntry && cfgEntry.daily_bar_estimates) {
      for (const [thresh, bars] of Object.entries(cfgEntry.daily_bar_estimates)) {
        const pIdx = thresholdToPIndex(parseInt(thresh, 10), cfgEntry.static_thresholds);
        if (pIdx !== -1) barEstimates[pIdx] = bars;
      }
    }

    ranking.push({
      instrument_key: instKey,
      instrument_name: cfgEntry ? cfgEntry.name : instKey,
      static_thresholds: cfgEntry ? cfgEntry.static_thresholds : [],
      daily_bar_estimates: barEstimates,
      recommended_ratios: cfgEntry ? (cfgEntry.recommended_ratios || {}) : {},
      top3: pEntries.slice(0, 3).map(e => ({
        pIndex: e.pIndex,
        thresholdValue: e.thresholdValue,
        compositeScore: e.compositeScore,
        winRate: e.winRate,
        estimatedBarsPerDay: barEstimates[e.pIndex] || null,
      })),
      rankings: pEntries,
      bestPIndex: pEntries.length > 0 ? pEntries[0].pIndex : null,
      bestThreshold: pEntries.length > 0 ? pEntries[0].thresholdValue : null,
      bestCompositeScore: pEntries.length > 0 ? pEntries[0].compositeScore : null,
    });
  }

  ranking.sort((a, b) => a.instrument_key.localeCompare(b.instrument_key));

  return {
    generated_at: new Date().toISOString(),
    generated_at_ist: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Calcutta' }),
    version: '1.0.0',
    scoring_formula: {
      composite: `(winRatePct × ${WEIGHT_WIN_RATE}) + (avgReturnPct × ${WEIGHT_SCORE}) + (normalizedTrades × ${WEIGHT_SIGNALS})`,
      trades_normalization: 'linear min-max per instrument, neutral=50 if single p-index',
      win_rate_selection: 'best winRate across all versions for same (instrument, p-index)',
      confidence_percentile: `${CONFIDENCE_PERCENTILE * 100}th`,
    },
    source: {
      compact_summary: null, // filled below
      version_backtest_results: VERSION_RESULTS_DIR,
      backtest_results: BACKTEST_RESULTS_DIR,
    },
    instruments: ranking,
    unmatched_section_a: unmatched,
    summary: {
      total_instruments: ranking.length,
      instruments_with_data: ranking.filter(r => r.rankings.length > 0).length,
      instruments_without_section_a_match: ranking.filter(r => r.rankings.length === 0).length,
      unmatched_rows: unmatched.length,
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let compactPath = null;
  let configPath = DEFAULT_CONFIG;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--compact' && i + 1 < args.length) {
      compactPath = path.resolve(args[++i]);
    } else if (args[i] === '--config' && i + 1 < args.length) {
      configPath = path.resolve(args[++i]);
    }
  }

  if (!compactPath) {
    const reportsDir = path.join(CWD, 'version-backtest-report');
    if (!fs.existsSync(reportsDir)) {
      console.error('[selectDailyThresholds] version-backtest-report/ directory not found');
      process.exit(1);
    }
    compactPath = findLatestCompact(reportsDir);
    if (!compactPath) {
      console.error('[selectDailyThresholds] No live_compact_summary_*.md found in version-backtest-report/');
      process.exit(1);
    }
  }

  console.log(`[selectDailyThresholds] Compact summary: ${compactPath}`);
  console.log(`[selectDailyThresholds] Build config:    ${configPath}`);

  if (!fs.existsSync(configPath)) {
    console.error(`[selectDailyThresholds] Config not found: ${configPath}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`[selectDailyThresholds] Loaded ${config.length} instruments from config`);

  const compactContent = fs.readFileSync(compactPath, 'utf8');

  // Parse Section A
  const rows = parseSectionA(compactContent);
  console.log(`[selectDailyThresholds] Parsed ${rows.length} rows from Section A`);

  // Aggregate
  const { instMap, configByKey, unmatched } = aggregateSectionA(rows, config);
  console.log(`[selectDailyThresholds] Aggregated into ${instMap.size} instruments`);
  if (unmatched.length > 0) {
    console.warn(`[selectDailyThresholds] ${unmatched.length} rows UNMATCHED to any config instrument:`);
    const unmatchedSummary = new Map();
    for (const u of unmatched) {
      const key = u.instrument;
      unmatchedSummary.set(key, (unmatchedSummary.get(key) || 0) + 1);
    }
    for (const [name, count] of unmatchedSummary.entries()) {
      console.warn(`  - "${name}" × ${count}`);
    }
  }

  // Normalize & score
  normalizeTrades(instMap);
  computeCompositeScores(instMap);

  // Confidence profiles
  console.log(`[selectDailyThresholds] Parsing confidence profiles from backtest results...`);
  const confidenceProfiles = parseConfidenceProfiles(config);
  let totalConfEntries = 0;
  for (const [, pMap] of confidenceProfiles.entries()) {
    totalConfEntries += pMap.size;
  }
  console.log(`[selectDailyThresholds] Confidence profiles: ${confidenceProfiles.size} instruments, ${totalConfEntries} p-index entries`);

  // Build & write
  const output = buildOutput(instMap, configByKey, confidenceProfiles, unmatched);
  output.source.compact_summary = compactPath;

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`[selectDailyThresholds] Written: ${OUTPUT_FILE}`);
  console.log(`[selectDailyThresholds] Instruments: ${output.summary.total_instruments}, with data: ${output.summary.instruments_with_data}, missing: ${output.summary.instruments_without_section_a_match}`);

  // Summary
  console.log('\n── Top P‑Index per Instrument (by composite score) ──');
  for (const inst of output.instruments) {
    if (inst.bestPIndex !== null) {
      const bars = inst.daily_bar_estimates[inst.bestPIndex] || '?';
      console.log(`  ${inst.instrument_name.padEnd(35)} p=${inst.bestPIndex} (T${inst.bestThreshold}) score=${inst.bestCompositeScore.toFixed(2)} bars/day≈${bars}`);
    }
  }
}

function findLatestCompact(dir) {
  const files = fs.readdirSync(dir).filter(f => DEFAULT_COMPACT_PATTERN.test(f));
  if (files.length === 0) return null;
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

main();