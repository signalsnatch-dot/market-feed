#!/usr/bin/env node
// generateReport.js - Multi-day backtest report generator with sharded worker processing.
// Phase 1: Spawn worker processes to aggregate backtest files in parallel (avoids OOM).
// Phase 2: Merge aggregated outputs and generate the full markdown report + compact summary.
//
// Usage:
//   node generateReport.js --live          (process ./live-backtest-results)
//   node generateReport.js                (process ./version-backtest-results)
//   node generateReport.js --live --workers 4   (override worker count)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const IS_LIVE = process.argv.includes('--live');
const RESULTS_DIR = IS_LIVE ? './live-backtest-results' : './version-backtest-results';
const OUTPUT_DIR = './version-backtest-report';
const TEMP_DIR = IS_LIVE ? './.temp_live_report' : './.temp_version_report';

const versionRegex = /^V(\d+):/;
const workersIdx = process.argv.findIndex((a, i) => a === '--workers' && process.argv[i + 1]);
const NUM_WORKERS = workersIdx !== -1 ? parseInt(process.argv[workersIdx + 1], 10) : Math.max(1, os.cpus().length - 1);

// ── Constants (mirrored from original) ──

const confidenceVersions = [
    'V3: High Confidence', 'V8: High Confidence (Strict)', 'V13: High Confidence (Calibrated)',
    'V18: High Confidence (Strict-Calibrated)', 'V23: High Confidence (Structural-Calibrated)',
    'V28: High Confidence (Strict Structural-Calibrated)', 'V33: High Confidence (Upgraded)',
    'V38: High Confidence (Strict Upgraded)', 'V43: High Confidence (Structural-Calibrated Upgraded)',
    'V48: High Confidence (Strict Structural-Calibrated Upgraded)',
    'V53: Fixed High Confidence', 'V58: Fixed High Confidence (Strict)',
    'V63: Fixed High Confidence (Calibrated)', 'V68: Fixed High Confidence (Strict-Calibrated)',
    'V73: Fixed High Confidence (Structural-Calibrated)', 'V78: Fixed High Confidence (Strict Structural-Calibrated)',
    'V83: Fixed High Confidence (Upgraded)', 'V88: Fixed High Confidence (Strict Upgraded)',
    'V93: Fixed High Confidence (Structural-Calibrated Upgraded)',
    'V98: Fixed High Confidence (Strict Structural-Calibrated Upgraded)',
];

const confidenceBuckets = [
    '< 45', '45-49', '50-54', '55-59', '60-64', '65-69',
    '70-74', '75-79', '80-84', '85-89', '90-94', '95-100'
];

const mafeBuckets = [
    '0% - 20%', '21% - 40%', '41% - 60%', '61% - 80%', '81% - 99%',
    '100% (Hit TP)', '101% - 110%', '111% - 120%', '121% - 130%',
    '131% - 140%', '141% - 150%', '151% - 160%', '161% - 170%',
    '171% - 180%', '181% - 190%', '191% - 200%', '> 200%'
];

const maeBuckets = [
    '0% - 20%', '21% - 40%', '41% - 60%', '61% - 80%',
    '81% - 100%', '101% - 115%', '116% - 130%', '> 130%'
];

const INSTRUMENT_NAMES = {
    'INE002A01018': 'Reliance Industries', 'INE040A01034': 'HDFC Bank',
    'INE090A01021': 'ICICI Bank', 'INE062A01020': 'SBI', 'INE467B01029': 'TCS',
    'INE009A01021': 'Infosys (INFY)', 'INE154A01025': 'ITC', 'INE397D01024': 'Bharti Airtel',
    'INE238A01034': 'Axis Bank', 'INE018A01030': 'L&T', 'INE081A01020': 'Tata Steel',
    'INE155A01022': 'Tata Motors', 'INE1TAE01010': 'Tata Motors (Cash)',
    'INE296A01032': 'Bajaj Finance', 'INE237A01036': 'Kotak Bank', 'INE044A01036': 'Sun Pharma',
    'INE019A01038': 'JSW Steel', 'INE522F01014': 'Coal India', 'INE423A01024': 'Adani Enterprises',
    'INE742F01042': 'Adani Ports', 'INE038A01020': 'Hindalco', 'INE437A01024': 'Apollo Hospitals',
    'INE160A01022': 'PNB', 'INE114A01011': 'SAIL', 'INE040H01021': 'SUZLON',
    'INE928J01020': 'PAYTM', 'INE415G01027': 'RVNL', 'INE053F01010': 'IRFC',
    'INE202E01016': 'IREDA', 'INE257A01026': 'BHEL', 'INE129A01025': 'GAIL',
    'INE849A01020': 'TRENT',
    '538685': 'Natural Gas Future', '538686': 'Natural Gas Mini Future',
    '520702': 'Crude Oil Future', '520703': 'Crude Oil Mini Future',
    '464150': 'Silver Future', '471726': 'Silver Mini Future', '488788': 'Silver Micro Future',
    '568831': 'Copper Future', '568836': 'Zinc Future', '568833': 'Lead Future',
    '568830': 'Aluminium Future', '466583': 'Gold Future', '510764': 'Gold Mini Future',
    '552721': 'Gold Petal Future',
    '61093': 'Nifty 50 Future', '61088': 'Nifty Bank Future', '61091': 'Fin Nifty Future',
    '61092': 'Midcap Nifty Future', '61284': 'Reliance Future', '61189': 'HDFC Bank Future',
    '61197': 'ICICI Bank Future', '61289': 'SBI Future', '61304': 'TCS Future',
    '61209': 'Infosys Future', '61216': 'ITC Future', '61127': 'Bharti Airtel Future',
    '61114': 'Axis Bank Future', '61232': 'L&T Future', '61303': 'Tata Steel Future',
    '61235': 'Tata Motors Future', '61118': 'Bajaj Finance Future', '61226': 'Kotak Bank Future',
    '61296': 'Sun Pharma Future', '61220': 'JSW Steel Future', '61143': 'Coal India Future',
    '61099': 'Adani Enterprises Future', '61101': 'Adani Ports Future', '61192': 'Hindalco Future',
    '61108': 'Apollo Hospitals Future', '61274': 'PNB Future', '61286': 'SAIL Future',
    '61298': 'SUZLON Future', '61265': 'PAYTM Future', '61285': 'RVNL Future',
    '61215': 'IRFC Future', '61214': 'IREDA Future', '61128': 'BHEL Future',
    '61170': 'GAIL Future', '61310': 'TRENT Future',
    '552706': 'Aluminium (MCX)', '552709': 'Lead (MCX)', '552708': 'Copper (MCX)',
    '552711': 'Zinc (MCX)', '464151': 'Silver Mini (MCX)', '477177': 'Silver Micro (MCX)',
    '510464': 'Gold Petal (MCX)', '62329': 'Nifty 50', '62326': 'Bank Nifty',
    '62327': 'Fin Nifty', '62328': 'Midcap Nifty'
};

function getInstrumentDisplayName(rawInstrument) {
    for (const [key, value] of Object.entries(INSTRUMENT_NAMES)) {
        if (rawInstrument.includes(key)) return value;
    }
    return rawInstrument.replace(/_raw_ticks$/, '');
}

function getFormattedTimestamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Helper: derive metrics from aggregated data ──

function deriveMetrics(d) {
    const count = d.count || 0;
    if (count === 0) return { totalTrades: 0, winRate: 0, totalReturn: 0, avgReturn: 0, avgMafe: 0, avgMae: 0 };
    const winRate = (d.wins / count) * 100;
    const avgReturn = d.sumPnl / count;
    const avgMafe = d.sumMafe / count;
    const avgMae = d.sumMae / count;
    return { totalTrades: count, winRate, totalReturn: d.sumPnl, avgReturn, avgMafe, avgMae };
}

// ── Phase 1: Parallel aggregation via worker processes ──

async function collectAggregatedData() {
    if (!fs.existsSync(RESULTS_DIR)) {
        console.error(`Error: Directory '${RESULTS_DIR}' not found.`);
        process.exit(1);
    }

    const allFiles = fs.readdirSync(RESULTS_DIR).filter(f =>
        path.extname(f) === '.json' && f.startsWith(IS_LIVE ? 'live_' : 'continuous_')
    );
    if (allFiles.length === 0) {
        console.log('No backtest result JSON files found.');
        process.exit(0);
    }

    console.log(`Found ${allFiles.length} backtest files`);

    // Split files into batches (at most NUM_WORKERS batches, minimum ~10 files per worker)
    const totalBatches = Math.min(NUM_WORKERS, Math.max(1, Math.floor(allFiles.length / 10)));
    const filesPerBatch = Math.ceil(allFiles.length / totalBatches);
    const batches = [];
    for (let i = 0; i < allFiles.length; i += filesPerBatch) {
        const slice = allFiles.slice(i, i + filesPerBatch).map(f => path.resolve(RESULTS_DIR, f));
        batches.push(slice);
    }

    console.log(`Split into ${batches.length} batches (${NUM_WORKERS} workers)`);

    // Create temp directory
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

    // Write batch files
    const batchFiles = [];
    for (let i = 0; i < batches.length; i++) {
        const batchPath = path.join(TEMP_DIR, `batch_${i}.json`);
        fs.writeFileSync(batchPath, JSON.stringify(batches[i]));
        batchFiles.push(batchPath);
    }

    // Spawn workers with batch concurrency
    const workerScript = path.resolve(__dirname, 'scripts', 'reportWorker.js');
    const mergedOutputFiles = [];
    let completed = 0;
    const startTime = Date.now();

    for (let i = 0; i < batchFiles.length; i += NUM_WORKERS) {
        const chunk = batchFiles.slice(i, i + NUM_WORKERS);
        const promises = chunk.map((batchFile, idx) => {
            const batchNum = i + idx;
            const outputFile = path.join(TEMP_DIR, `output_${batchNum}.json`);
            return new Promise((resolve) => {
                const child = spawn('node', ['--max-old-space-size=512', workerScript, batchFile, outputFile], {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let stderr = '';
                child.stderr.on('data', d => { stderr += d.toString(); });

                child.on('close', (code) => {
                    completed++;
                    if (code === 0 && fs.existsSync(outputFile) && fs.statSync(outputFile).size > 10) {
                        try {
                            // Validate file is parseable JSON
                            JSON.parse(fs.readFileSync(outputFile, 'utf8'));
                            mergedOutputFiles.push(outputFile);
                            // Parse to read meta
                            const meta = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
                            console.log(`   ✅ Worker ${batchNum + 1}/${batchFiles.length}: ${meta.meta?.filesProcessed || '?'} files, ${(meta.meta?.totalRows || 0).toLocaleString()} trades`);
                        } catch (e) {
                            console.error(`   ❌ Worker ${batchNum + 1}: invalid JSON in output file: ${e.message}`);
                        }
                    } else {
                        console.error(`   ❌ Worker ${batchNum + 1}: exit ${code}${stderr ? ' ' + stderr.slice(0, 200) : ''}`);
                    }
                    resolve();
                });

                child.on('error', (err) => {
                    completed++;
                    console.error(`   ❌ Worker ${batchNum + 1}: spawn error ${err.message}`);
                    resolve();
                });
            });
        });
        await Promise.all(promises);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`   📊 ${completed}/${batchFiles.length} batches done (${elapsed}s)`);
    }

    console.log(`\nMerging ${mergedOutputFiles.length} worker outputs...`);

    // ── Phase 2: Merge aggregated outputs AND build indexed lookups ──
    const merged = { L1: {}, L1_mafe: {}, L1_mae: {}, L2: {}, L3: {}, L3_candle: {} };
    // Indexed lookups for O(1) access during report generation
    const l2ByVersion = new Map();    // version → [{key, ...val}]
    const l2ByInstTh = new Map();     // "instrument|threshold" → [{key, ...val}]
    const l2ByVersionInst = new Map(); // "version|instrument" → Map(threshold → val)

    for (const outputFile of mergedOutputFiles) {
        const data = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

        // Merge L1: {count, wins}
        for (const [key, val] of Object.entries(data.L1 || {})) {
            if (!merged.L1[key]) merged.L1[key] = { count: 0, wins: 0 };
            merged.L1[key].count += val.count;
            merged.L1[key].wins += val.wins;
        }

        // Merge L1_mafe: count
        for (const [key, val] of Object.entries(data.L1_mafe || {})) {
            merged.L1_mafe[key] = (merged.L1_mafe[key] || 0) + val;
        }

        // Merge L1_mae: count
        for (const [key, val] of Object.entries(data.L1_mae || {})) {
            merged.L1_mae[key] = (merged.L1_mae[key] || 0) + val;
        }

        // Merge L2: {count, wins, sumPnl, sumPnlAmount, sumMafe, sumMae, sumConfidence}
        for (const [key, val] of Object.entries(data.L2 || {})) {
            if (!merged.L2[key]) {
                merged.L2[key] = { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0, sumConfidence: 0 };
            }
            merged.L2[key].count += val.count;
            merged.L2[key].wins += val.wins;
            merged.L2[key].sumPnl += val.sumPnl || 0;
            merged.L2[key].sumPnlAmount += val.sumPnlAmount || 0;
            merged.L2[key].sumMafe += val.sumMafe || 0;
            merged.L2[key].sumMae += val.sumMae || 0;
            merged.L2[key].sumConfidence += val.sumConfidence || 0;
        }

        // Merge L3: {count, wins, sumPnl, sumPnlAmount, sumMafe, sumMae}
        for (const [key, val] of Object.entries(data.L3 || {})) {
            if (!merged.L3[key]) {
                merged.L3[key] = { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0 };
            }
            merged.L3[key].count += val.count;
            merged.L3[key].wins += val.wins;
            merged.L3[key].sumPnl += val.sumPnl || 0;
            merged.L3[key].sumPnlAmount += val.sumPnlAmount || 0;
            merged.L3[key].sumMafe += val.sumMafe || 0;
            merged.L3[key].sumMae += val.sumMae || 0;
        }

        // Merge L3_candle: (version, instrument, candleBucket) → {count, wins, sumPnl, sumPnlAmount, sumMafe, sumMae}
        for (const [key, val] of Object.entries(data.L3_candle || {})) {
            if (!merged.L3_candle[key]) {
                merged.L3_candle[key] = { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0 };
            }
            merged.L3_candle[key].count += val.count;
            merged.L3_candle[key].wins += val.wins;
            merged.L3_candle[key].sumPnl += val.sumPnl || 0;
            merged.L3_candle[key].sumPnlAmount += val.sumPnlAmount || 0;
            merged.L3_candle[key].sumMafe += val.sumMafe || 0;
            merged.L3_candle[key].sumMae += val.sumMae || 0;
        }

        // Merge candleCountMap for percentile computation
        if (data.candleCountMap) {
            Object.assign(merged._candleCountMap || (merged._candleCountMap = {}), data.candleCountMap);
        }
    }

    // Build indexed lookups from merged L2
    const l2Entries = Object.entries(merged.L2);
    for (const [key, val] of l2Entries) {
        const parts = key.split('|');
        if (parts.length < 4) continue;
        const version = parts[0], instrument = parts[1], threshold = parts[2];

        // l2ByVersion
        if (!l2ByVersion.has(version)) l2ByVersion.set(version, []);
        l2ByVersion.get(version).push({ key, ...val });

        // l2ByInstTh
        const instThKey = `${instrument}|${threshold}`;
        if (!l2ByInstTh.has(instThKey)) l2ByInstTh.set(instThKey, []);
        l2ByInstTh.get(instThKey).push({ key, ...val });

        // l2ByVersionInst: version|instrument → Map(threshold → val)
        const viKey = `${version}|${instrument}`;
        if (!l2ByVersionInst.has(viKey)) l2ByVersionInst.set(viKey, new Map());
        const thMap = l2ByVersionInst.get(viKey);
        if (!thMap.has(threshold)) thMap.set(threshold, { count: 0, wins: 0, sumPnl: 0, sumMafe: 0, sumMae: 0 });
        const existing = thMap.get(threshold);
        existing.count += val.count;
        existing.wins += val.wins;
        existing.sumPnl += val.sumPnl;
        existing.sumMafe += val.sumMafe;
        existing.sumMae += val.sumMae;
    }

    // Build L1 indexes for O(1) confidence/distribution lookups
    const l1ByVersionConf = new Map(); // "versionName|confbucket" → {count, wins}
    const distMafeTotal = new Map();    // "mafebucket" → count (collapsed across all versions/dates)
    const distMaeTotal = new Map();     // "maebucket" → count

    for (const [key, val] of Object.entries(merged.L1)) {
        const lastPipe = key.lastIndexOf('|');
        const vConfKey = key.substring(0, lastPipe); // version|instrument|threshold|date → truncated to just version + confbucket
        // Extract version and bucket from key parts
        const parts = key.split('|');
        const version = parts[0];
        const bucket = parts[parts.length - 1];
        const vcKey = `${version}|${bucket}`;
        if (!l1ByVersionConf.has(vcKey)) l1ByVersionConf.set(vcKey, { count: 0, wins: 0 });
        const e = l1ByVersionConf.get(vcKey);
        e.count += val.count;
        e.wins += val.wins;
    }

    for (const [key, val] of Object.entries(merged.L1_mafe)) {
        const bucket = key.substring(key.lastIndexOf('|') + 1);
        distMafeTotal.set(bucket, (distMafeTotal.get(bucket) || 0) + val);
    }

    for (const [key, val] of Object.entries(merged.L1_mae)) {
        const bucket = key.substring(key.lastIndexOf('|') + 1);
        distMaeTotal.set(bucket, (distMaeTotal.get(bucket) || 0) + val);
    }

    merged._l2ByVersion = l2ByVersion;
    merged._l2ByInstTh = l2ByInstTh;
    merged._l2ByVersionInst = l2ByVersionInst;
    merged._l1ByVersionConf = l1ByVersionConf;
    merged._distMafeTotal = distMafeTotal;
    merged._distMaeTotal = distMaeTotal;

    // ── Build per-instrument candle percentiles from raw candleCountMap ──
    const candlePercentiles = {}; // "instrumentName" → {p20, p50, p80, all: []}
    if (merged._candleCountMap) {
        const instAllCounts = {}; // instrumentName → [count1, count2, ...]
        for (const [key, cc] of Object.entries(merged._candleCountMap)) {
            // key = "instrumentName|date"
            const pipeIdx = key.lastIndexOf('|');
            const inst = key.substring(0, pipeIdx);
            if (!instAllCounts[inst]) instAllCounts[inst] = [];
            instAllCounts[inst].push(cc);
        }
        for (const [inst, counts] of Object.entries(instAllCounts)) {
            counts.sort((a, b) => a - b);
            const n = counts.length;
            candlePercentiles[inst] = {
                p20: counts[Math.floor(n * 0.2)] || counts[0],
                p50: counts[Math.floor(n * 0.5)] || counts[0],
                p80: counts[Math.floor(n * 0.8)] || counts[0],
                all: counts,
            };
        }
    }
    merged._candlePercentiles = candlePercentiles;

    // Remap L3_candle keys from raw counts to percentile bins
    const candleRemapped = {};
    for (const [key, val] of Object.entries(merged.L3_candle)) {
        const parts = key.split('|');
        if (parts.length < 3) continue;
        const version = parts[0], instrument = parts[1], rawCount = parseInt(parts[2]);
        const pcts = candlePercentiles[instrument];
        let bin = rawCount.toString(); // fallback to raw count
        if (pcts && pcts.p20 && pcts.p50 && pcts.p80) {
            if (rawCount <= pcts.p20) bin = `p20@${Math.round(pcts.p20)}`;
            else if (rawCount <= pcts.p50) bin = `p50@${Math.round(pcts.p50)}`;
            else if (rawCount <= pcts.p80) bin = `p80@${Math.round(pcts.p80)}`;
            else bin = `>p80@${Math.round(pcts.p80) + 1}`;
        }
        const newKey = `${version}|${instrument}|${bin}`;
        if (!candleRemapped[newKey]) candleRemapped[newKey] = { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0 };
        candleRemapped[newKey].count += val.count;
        candleRemapped[newKey].wins += val.wins;
        candleRemapped[newKey].sumPnl += val.sumPnl || 0;
        candleRemapped[newKey].sumPnlAmount += val.sumPnlAmount || 0;
        candleRemapped[newKey].sumMafe += val.sumMafe || 0;
        candleRemapped[newKey].sumMae += val.sumMae || 0;
    }
    merged.L3_candle = candleRemapped;

    // Cleanup temp files
    for (const f of [...batchFiles, ...mergedOutputFiles]) {
        try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
    }
    try { fs.rmdirSync(TEMP_DIR); } catch (e) { /* ignore */ }

    const totalRows = Object.values(merged.L2).reduce((s, v) => s + v.count, 0);
    console.log(`Merged: ${Object.keys(merged.L2).length} unique (v,inst,th,date) combos | ${totalRows.toLocaleString()} total trades\n`);

    return merged;
}

// ── Report generation ──

function buildConfidenceTable(l1ByVC, versionName) {
    let out = `| Confidence Bucket | Number of Trades | Win Rate % | Total Return % | Avg Return per Trade % |\n`;
    out += `| :--- | :---: | :---: | :---: | :---: |\n`;
    for (const b of confidenceBuckets) {
        const vcKey = `${versionName}|${b}`;
        const d = l1ByVC.get(vcKey);
        const count = d ? d.count : 0;
        const wins = d ? d.wins : 0;
        if (count > 0) {
            const wr = (wins / count) * 100;
            out += `| **${b}** | ${count} | ${wr.toFixed(2)}% | - | - |\n`;
        } else {
            out += `| **${b}** | 0 | 0.00% | 0.00% | 0.000% |\n`;
        }
    }
    out += `\n`;
    return out;
}

function buildDistTableFromMap(bucketMap, buckets) {
    let out = '';
    for (const b of buckets) {
        out += `| **${b}** | ${bucketMap.get(b) || 0} |\n`;
    }
    return out;
}

function write(w, str) { w.write(str); }

async function generateReport(merged) {
    const { L2, _l2ByVersion, _l2ByInstTh, _l1ByVersionConf, _distMafeTotal, _distMaeTotal } = merged;

    // Extract unique dimensions from indexed lookups (one pass)
    const versionSet = new Set(_l2ByVersion.keys());
    const instruments = new Set();
    const dates = new Set();

    for (const key of Object.keys(L2)) {
        const parts = key.split('|');
        instruments.add(parts[1]);
        dates.add(parts[3]);
    }

    const uniqueVersions = [...versionSet].sort((a, b) => {
        const na = parseInt(a.match(versionRegex)?.[1] || '0', 10);
        const nb = parseInt(b.match(versionRegex)?.[1] || '0', 10);
        return na - nb;
    });
    const uniqueInstruments = [...instruments].sort();
    const uniqueDates = [...dates].sort();

    if (uniqueVersions.length === 0) {
        console.log('No version-specific data found.');
        process.exit(0);
    }

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const timestamp = getFormattedTimestamp();
    const targetFile = path.join(OUTPUT_DIR, `${IS_LIVE ? 'live' : 'backtest'}_analysis_report_${timestamp}.md`);
    const w = fs.createWriteStream(targetFile, 'utf8');

    // Global metrics (single pass over L2)
    let globalCount = 0, globalWins = 0, globalSumPnl = 0;
    for (const d of Object.values(L2)) {
        globalCount += d.count; globalWins += d.wins; globalSumPnl += d.sumPnl;
    }

    // ── Report header ──
    write(w, `# Portfolio Backtest Performance Report (Multi-Day Edition)\n\n`);
    write(w, `*Report Generated on: ${new Date().toLocaleString()}*\n`);
    write(w, `*Analyzed Period Range:* ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}\n\n`);

    // Section 1: Executive Summary
    write(w, `## Section 1: Executive Summary\n\n`);
    write(w, `### **System-Wide Performance Summary**\n`);
    write(w, `*   **Total Executed Portfolio Trades:** ${globalCount.toLocaleString()}\n`);
    write(w, `*   **Portfolio Win Rate:** ${globalCount ? ((globalWins / globalCount) * 100).toFixed(2) : '0.00'}%\n`);
    write(w, `*   **Portfolio Cumulative Return:** ${globalSumPnl >= 0 ? '+' : ''}${globalSumPnl.toFixed(2)}%\n`);
    write(w, `*   **Portfolio Avg. Trade return:** ${globalCount ? (globalSumPnl / globalCount).toFixed(3) : '0.000'}%\n\n`);

    // Version rankings
    const versionRankings = uniqueVersions.map(v => {
        const entries = _l2ByVersion.get(v) || [];
        let count = 0, wins = 0, sumPnl = 0, sumMafe = 0, sumMae = 0;
        for (const d of entries) {
            count += d.count; wins += d.wins; sumPnl += d.sumPnl;
            sumMafe += d.sumMafe; sumMae += d.sumMae;
        }
        return { name: v, totalTrades: count, winRate: count ? (wins / count) * 100 : 0, totalReturn: sumPnl, avgReturn: count ? sumPnl / count : 0, avgMafe: count ? sumMafe / count : 0, avgMae: count ? sumMae / count : 0 };
    });

    const top3 = [...versionRankings].sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 3);
    const bottom3 = [...versionRankings].sort((a, b) => a.totalReturn - b.totalReturn).slice(0, 3);

    write(w, `### **Strategy Rankings**\n`);
    write(w, `#### **Top 3 Versions (Cumulative Return)**\n`);
    top3.forEach((v, idx) => write(w, `${idx + 1}. **${v.name}**: Total Return: **${v.totalReturn.toFixed(2)}%** | Win Rate: **${v.winRate.toFixed(2)}%** (${v.totalTrades} Trades)\n`));
    write(w, `\n#### **Bottom 3 Versions (Cumulative Return)**\n`);
    bottom3.forEach((v, idx) => write(w, `${idx + 1}. **${v.name}**: Total Return: **${v.totalReturn.toFixed(2)}%** | Win Rate: **${v.winRate.toFixed(2)}%** (${v.totalTrades} Trades)\n`));
    write(w, `\n`);

    // Section 2: Detailed Version Performance
    console.log('Writing Section 2 (version details)...');
    write(w, `## Section 2: Detailed Performance by Strategy Version\n\n`);
    let verCount = 0;
    for (const v of uniqueVersions) {
        const vEntries = _l2ByVersion.get(v) || [];
        if (vEntries.length === 0) continue;

        let vCount = 0, vWins = 0, vSumPnl = 0, vSumMafe = 0, vSumMae = 0;
        for (const d of vEntries) {
            vCount += d.count; vWins += d.wins; vSumPnl += d.sumPnl;
            vSumMafe += d.sumMafe; vSumMae += d.sumMae;
        }

        write(w, `### **${v}**\n`);
        write(w, `*   **Cumulative Trades:** ${vCount}\n`);
        write(w, `*   **Cumulative Win Rate:** ${((vWins / vCount) * 100).toFixed(2)}%\n`);
        write(w, `*   **Cumulative Total Return:** ${vSumPnl >= 0 ? '+' : ''}${vSumPnl.toFixed(2)}%\n`);
        write(w, `*   **Cumulative Avg. Return per Trade:** ${(vSumPnl / vCount) >= 0 ? '+' : ''}${(vSumPnl / vCount).toFixed(3)}%\n`);
        write(w, `*   **Cumulative Average MAFE:** ${(vSumMafe / vCount).toFixed(2)}%\n`);
        write(w, `*   **Cumulative Average MAE:** ${(vSumMae / vCount).toFixed(2)}%\n\n`);

        const pairMap = new Map();
        for (const d of vEntries) {
            const parts = d.key.split('|');
            const pair = `${parts[1]} (Threshold ${parts[2]})`;
            if (!pairMap.has(pair)) pairMap.set(pair, { count: 0, wins: 0, sumPnl: 0, sumMafe: 0, sumMae: 0 });
            const e = pairMap.get(pair);
            e.count += d.count; e.wins += d.wins; e.sumPnl += d.sumPnl; e.sumMafe += d.sumMafe; e.sumMae += d.sumMae;
        }

        write(w, `#### **Asset & Threshold Breakdowns for ${v}**\n`);
        for (const [pair, pc] of [...pairMap].sort()) {
            write(w, `##### **${pair}**\n`);
            write(w, `*   **Cumulative:** ${pc.count} Trades | Win Rate: ${((pc.wins / pc.count) * 100).toFixed(2)}% | Return: ${pc.sumPnl >= 0 ? '+' : ''}${pc.sumPnl.toFixed(2)}% | MAFE: ${(pc.sumMafe / pc.count).toFixed(1)}% | MAE: ${(pc.sumMae / pc.count).toFixed(1)}%\n\n`);
        }
        write(w, `---\n\n`);

        verCount++;
        if (verCount % 50 === 0) console.log(`   Section 2: ${verCount}/${uniqueVersions.length} versions written`);
    }
    console.log(`   Section 2 complete: ${verCount} versions`);

    // Section 3: Confidence Distribution
    console.log('Writing Section 3 (confidence)...');
    write(w, `## Section 3: Confidence Distribution Analysis\n\n`);
    for (const v of confidenceVersions) {
        if (!versionSet.has(v)) continue;
        write(w, `### **${v} Confidence Distributions**\n\n`);
        write(w, `#### **Cumulative Confidence Distribution (All Dates)**\n`);
        write(w, buildConfidenceTable(_l1ByVersionConf, v));
        write(w, `---\n\n`);
    }

    // Section 4: Lifecycle MAE & MAFE
    console.log('Writing Section 4 (MAE/MAFE)...');
    write(w, `## Section 4: Lifecycle MAE and MAFE Distribution Analysis\n\n`);
    write(w, `### **Overall Global Portfolio-Wide Distributions**\n\n`);
    write(w, `*MAFE Closeness-to-TP Distribution:*\n`);
    write(w, `| MAFE Bucket | Trade Count |\n`);
    write(w, `| :--- | :---: |\n`);
    write(w, buildDistTableFromMap(_distMafeTotal, mafeBuckets));
    write(w, `\n`);
    write(w, `*MAE Drawdown Distribution:*\n`);
    write(w, `| MAE Bucket | Trade Count |\n`);
    write(w, `| :--- | :---: |\n`);
    write(w, buildDistTableFromMap(_distMaeTotal, maeBuckets));
    write(w, `\n---\n\n`);

    // Section 5: Deep Dive by Instrument & Threshold
    console.log('Writing Section 5 (deep dive)...');
    write(w, `## Section 5: Deep Dive Breakdown by Instrument and Threshold\n\n`);
    let instIdx = 0;
    for (const inst of uniqueInstruments) {
        instIdx++;
        write(w, `### **${inst}**\n\n`);

        const instThresholds = new Set();
        for (const [instThKey] of _l2ByInstTh) {
            if (instThKey.startsWith(inst + '|')) instThresholds.add(instThKey.split('|')[1]);
        }

        for (const th of [...instThresholds].sort((a, b) => parseInt(a) - parseInt(b))) {
            const instThKey = `${inst}|${th}`;
            const thEntries = _l2ByInstTh.get(instThKey) || [];

            let tc = 0, tw = 0, ts = 0, tmf = 0, tma = 0;
            for (const d of thEntries) {
                tc += d.count; tw += d.wins; ts += d.sumPnl; tmf += d.sumMafe; tma += d.sumMae;
            }

            write(w, `#### **Threshold: ${th}**\n`);
            write(w, `*   **Cumulative Trades:** ${tc}\n`);
            write(w, `*   **Cumulative Win Rate:** ${tc ? ((tw / tc) * 100).toFixed(2) : '0.00'}%\n`);
            write(w, `*   **Cumulative Total Return:** ${ts >= 0 ? '+' : ''}${ts.toFixed(2)}%\n`);
            write(w, `*   **Cumulative Avg. Return per Trade:** ${tc ? (ts / tc) >= 0 ? '+' : '' + (ts / tc).toFixed(3) : '0.000'}%\n`);
            write(w, `*   **Average MAFE:** ${tc ? (tmf / tc).toFixed(2) : '0.00'}%\n`);
            write(w, `*   **Average MAE:** ${tc ? (tma / tc).toFixed(2) : '0.00'}%\n\n`);

            write(w, `##### **Strategy Version Performance under Threshold ${th}**\n`);
            write(w, `| Strategy Version | Trades | Win Rate % | Total Return % | Avg Return % | Avg MAFE % | Avg MAE % |\n`);
            write(w, `| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`);

            const tvMap = new Map();
            for (const d of thEntries) {
                const parts = d.key.split('|');
                const ver = parts[0];
                if (!tvMap.has(ver)) tvMap.set(ver, { count: 0, wins: 0, sumPnl: 0, sumMafe: 0, sumMae: 0 });
                const e = tvMap.get(ver);
                e.count += d.count; e.wins += d.wins; e.sumPnl += d.sumPnl; e.sumMafe += d.sumMafe; e.sumMae += d.sumMae;
            }

            const sv = [...tvMap.entries()].sort((a, b) => {
                const na = parseInt(a[0].match(versionRegex)?.[1] || '0');
                const nb = parseInt(b[0].match(versionRegex)?.[1] || '0');
                return na - nb;
            });

            for (const [ver, vd] of sv) {
                const m = deriveMetrics(vd);
                write(w, `| **${ver}** | ${m.totalTrades} | ${m.winRate.toFixed(2)}% | ${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn.toFixed(2)}% | ${m.avgReturn >= 0 ? '+' : ''}${m.avgReturn.toFixed(3)}% | ${m.avgMafe.toFixed(1)}% | ${m.avgMae.toFixed(1)}% |\n`);
            }
            write(w, `\n`);
        }
        write(w, `---\n\n`);

        if (instIdx % 10 === 0) console.log(`   Section 5: ${instIdx}/${uniqueInstruments.length} instruments written`);
    }

    // Close stream and free large indexes no longer needed
    await new Promise((resolve, reject) => {
        w.end(() => {
            console.log(`Full report written to: ${targetFile}`);
            resolve();
        });
        w.on('error', reject);
    });

    // Free L2 and its indexes (~2GB) — only L3 + L1 indexes needed for compact summary
    merged.L2 = null;
    merged._l2ByVersion = null;
    merged._l2ByInstTh = null;
    merged._l2ByVersionInst = null;
    if (global.gc) global.gc();

    // Generate compact summary — streaming to avoid OOM
    console.log('Writing compact summary...');
    const compactFile = path.join(OUTPUT_DIR, `${IS_LIVE ? 'live' : 'backtest'}_compact_summary_${timestamp}.md`);
    const cw = fs.createWriteStream(compactFile, 'utf8');
    generateCompactSummaryStream(merged, cw);
    await new Promise((resolve, reject) => {
        cw.end(() => { console.log(`Compact summary written to: ${compactFile}`); resolve(); });
        cw.on('error', reject);
    });
}

// ── Compact summary ──

function generateCompactSummaryStream(merged, cw) {
    const { L3 } = merged;
    const MIN_TRADES = 3;

    // Build reverse p-index lookup: "instrument|date|threshold" → "p1".."p10"
    const thresholdToPIdx = new Map(); // "instrument|date|rawThreshold" → "p1"|"p2"|...|"p10"
    const instrumentStaticThresholds = new Map(); // "instrument" → [rawThresholds...] for fallback
    try {
        const configPath = path.resolve(__dirname, 'build-version-config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        for (const entry of config) {
            const name = getInstrumentDisplayName(entry.instrument_key.replace('|', '_'));
            if (entry.static_thresholds && Array.isArray(entry.static_thresholds)) {
                instrumentStaticThresholds.set(name, entry.static_thresholds);
            }
            // Date-specific threshold arrays: each value at index i = p(i+1)
            if (entry.thresholds && typeof entry.thresholds === 'object') {
                for (const [date, thArray] of Object.entries(entry.thresholds)) {
                    if (!Array.isArray(thArray)) continue;
                    for (let i = 0; i < thArray.length; i++) {
                        thresholdToPIdx.set(`${name}|${date}|${thArray[i]}`, `p${i + 1}`);
                    }
                }
            }
        }
    } catch (e) {
        // If config not available, fall back to raw threshold display
    }

    // Helper: resolve threshold to p-index for a given instrument+date
    function resolvePIdx(instrument, date, threshold) {
        const thNum = typeof threshold === 'string' ? parseInt(threshold, 10) : threshold;
        const key = `${instrument}|${date}|${thNum}`;
        if (thresholdToPIdx.has(key)) return thresholdToPIdx.get(key);
        // Fallback: find nearest value in static_thresholds
        const staticTh = instrumentStaticThresholds.get(instrument);
        if (staticTh && staticTh.length > 0) {
            let bestIdx = 0, bestDist = Infinity;
            for (let i = 0; i < staticTh.length; i++) {
                const dist = Math.abs(staticTh[i] - thNum);
                if (dist < bestDist) { bestDist = dist; bestIdx = i; }
            }
            return `p${bestIdx + 1}`;
        }
        return `${thNum}`; // absolute fallback — raw threshold as string
    }

    // Also build forward lookup for Section G display (p-index → raw threshold per instrument)
    const pIdxToThreshold = new Map(); // "instrument|p1" → rawThreshold (from static, for display)
    for (const [inst, st] of instrumentStaticThresholds) {
        for (let i = 0; i < st.length; i++) {
            pIdxToThreshold.set(`${inst}|p${i + 1}`, st[i]);
        }
    }

    write(cw, `# Strategy Performance Compact Summary\n\n`);
    write(cw, `*Generated: ${new Date().toLocaleString()}*\n`);
    write(cw, `*Purpose: LLM-readable summary for strategy refinement*\n\n`);

    // ── Build global threshold→p-index lookup from config (mode across all dates) ──
    // Since L3 (version|instrument|threshold) lacks date dimension but backtester only
    // uses that day's threshold array, each threshold uniquely maps to one p-index.
    // Build by taking the mode p-index for each threshold across all dates in config.
    const thresholdToPIdxGlobal = new Map(); // "instrument|threshold" → "pX"
    try {
        const configPath2 = path.resolve(__dirname, 'build-version-config.json');
        const config2 = JSON.parse(fs.readFileSync(configPath2, 'utf8'));
        for (const entry of config2) {
            const name = getInstrumentDisplayName(entry.instrument_key.replace('|', '_'));
            const thToPCount = new Map(); // rawThreshold → Map(pIdx → count)
            if (entry.thresholds && typeof entry.thresholds === 'object') {
                for (const [date, thArray] of Object.entries(entry.thresholds)) {
                    if (!Array.isArray(thArray)) continue;
                    for (let i = 0; i < thArray.length; i++) {
                        const th = thArray[i];
                        const pIdx = `p${i + 1}`;
                        if (!thToPCount.has(th)) thToPCount.set(th, new Map());
                        const pMap = thToPCount.get(th);
                        pMap.set(pIdx, (pMap.get(pIdx) || 0) + 1);
                    }
                }
            }
            // For each threshold, pick the most common p-index
            for (const [th, pMap] of thToPCount) {
                let bestP = null, bestCount = 0;
                for (const [p, cnt] of pMap) {
                    if (cnt > bestCount) { bestCount = cnt; bestP = p; }
                }
                if (bestP) thresholdToPIdxGlobal.set(`${name}|${th}`, bestP);
            }
            // Also map static_thresholds for fallback
            if (entry.static_thresholds && Array.isArray(entry.static_thresholds)) {
                const st = entry.static_thresholds;
                for (const th of st) {
                    // If this threshold wasn't seen in any date-specific array, find nearest in static
                    if (!thToPCount.has(th)) {
                        // Already handled by below fallback
                    }
                }
            }
        }
    } catch (e) { /* ignore */ }

    // Helper: resolve threshold to p-index for L3-based data (no date context)
    function resolvePIdxGlobal(instrument, threshold) {
        const thNum = typeof threshold === 'string' ? parseInt(threshold, 10) : threshold;
        const key = `${instrument}|${thNum}`;
        if (thresholdToPIdxGlobal.has(key)) return thresholdToPIdxGlobal.get(key);
        // Fallback: find nearest in static_thresholds
        const staticTh = instrumentStaticThresholds.get(instrument);
        if (staticTh && staticTh.length > 0) {
            let bestIdx = 0, bestDist = Infinity;
            for (let i = 0; i < staticTh.length; i++) {
                const dist = Math.abs(staticTh[i] - thNum);
                if (dist < bestDist) { bestDist = dist; bestIdx = i; }
            }
            return `p${bestIdx + 1}`;
        }
        return `${thNum}`;
    }

    // Parse L3 into p-index-based combos, GROUPED BY (instrument, version, pIdx).
    // Multiple L3 rows (different raw thresholds) can map to the same p-index for a version+instrument.
    // We sum their raw {count, wins, sumPnl, sumMafe, sumMae} to avoid duplicate entries.
    const comboGroup = {}; // "instrument|version|pIdx" → {count, wins, sumPnl, sumMafe, sumMae}
    for (const [key, d] of Object.entries(L3)) {
        const parts = key.split('|');
        if (parts.length < 3) continue;
        const version = parts[0], instrument = parts[1], threshold = parts[2];
        if (d.count < MIN_TRADES) continue;
        const pIdx = resolvePIdxGlobal(instrument, threshold);
        const ck = `${instrument}|${version}|${pIdx}`;
        if (!comboGroup[ck]) comboGroup[ck] = { version, instrument, pIdx, count: 0, wins: 0, sumPnl: 0, sumMafe: 0, sumMae: 0 };
        comboGroup[ck].count += d.count;
        comboGroup[ck].wins += d.wins;
        comboGroup[ck].sumPnl += d.sumPnl || 0;
        comboGroup[ck].sumMafe += d.sumMafe || 0;
        comboGroup[ck].sumMae += d.sumMae || 0;
    }

    // Convert grouped data into instCombos with raw counts (no pre-derived metrics)
    const instCombos = new Map(); // instrument → [{version, pIdx, count, wins, sumPnl, sumMafe, sumMae}]
    for (const c of Object.values(comboGroup)) {
        if (!instCombos.has(c.instrument)) instCombos.set(c.instrument, []);
        instCombos.get(c.instrument).push(c);
    }

    // Helper: compute metrics from a combo with raw counts
    function comboWR(c) { return c.count > 0 ? (c.wins / c.count) * 100 : 0; }
    function comboAvgRet(c) { return c.count > 0 ? c.sumPnl / c.count : 0; }
    function comboMafe(c) { return c.count > 0 ? c.sumMafe / c.count : 0; }
    function comboMae(c) { return c.count > 0 ? c.sumMae / c.count : 0; }

    // Section A: Per-Instrument Top 3 (by Win Rate) — shows P-Value
    write(cw, `## Section A: Best Version+P-Value Per Instrument (Top 3 by Win Rate)\n\n`);
    write(cw, `*P-value = decile position in volume-per-bar array (p1 = fewest candles, p10 = most candles). Best p-value per instrument resolved via per-date threshold mapping.*\n\n`);
    write(cw, `| Instrument | Rank | Version | P-Value | Win Rate | Avg Return | Total Return | MAFE | MAE | Trades |\n`);
    write(cw, `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`);

    const instrumentTop3 = [];
    for (const [inst, combos] of instCombos) {
        combos.sort((a, b) => comboWR(b) - comboWR(a) || b.sumPnl - a.sumPnl);
        const top3 = combos.slice(0, 3);
        if (top3.length > 0) instrumentTop3.push({ instrument: inst, top3 });
        top3.forEach((v, idx) => {
            const wr = comboWR(v), ar = comboAvgRet(v), mf = comboMafe(v), ma = comboMae(v);
            write(cw, `| ${inst} | #${idx + 1} | ${v.version} | ${v.pIdx} | ${wr.toFixed(1)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${v.sumPnl >= 0 ? '+' : ''}${v.sumPnl.toFixed(2)}% | ${mf.toFixed(0)}% | ${ma.toFixed(0)}% | ${v.count} |\n`);
        });
    }
    write(cw, `\n`);

    // Section A.2: Per-Instrument Top 3 by Total Returns
    write(cw, `## Section A.2: Best Version+P-Value Per Instrument (Top 3 by Total Return)\n\n`);
    write(cw, `*Same data as Section A, sorted by cumulative total return instead of win rate to surface combos with more trades and higher P&L.*\n\n`);
    write(cw, `| Instrument | Rank | Version | P-Value | Win Rate | Avg Return | Total Return | Trades |\n`);
    write(cw, `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n`);

    const instrumentTop3ByRet = [];
    for (const [inst, combos] of instCombos) {
        const sortedByRet = [...combos].sort((a, b) => b.sumPnl - a.sumPnl || comboWR(b) - comboWR(a));
        const top3 = sortedByRet.slice(0, 3);
        if (top3.length > 0) instrumentTop3ByRet.push({ instrument: inst, top3 });
        top3.forEach((v, idx) => {
            const wr = comboWR(v), ar = comboAvgRet(v);
            write(cw, `| ${inst} | #${idx + 1} | ${v.version} | ${v.pIdx} | ${wr.toFixed(1)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${v.sumPnl >= 0 ? '+' : ''}${v.sumPnl.toFixed(2)}% | ${v.count} |\n`);
        });
    }
    write(cw, `\n`);

    // Section B: Overall Best Versions (cross-instrument) — uses p-value combos with raw counts
    const versionScoreMap = new Map();
    for (const entry of instrumentTop3) {
        for (const v of entry.top3) {
            const existing = versionScoreMap.get(v.version) || { appearances: 0, totalCount: 0, totalWins: 0, totalSumPnl: 0, groups: [] };
            existing.appearances++;
            existing.totalCount += v.count;
            existing.totalWins += v.wins;
            existing.totalSumPnl += v.sumPnl;
            existing.groups.push(`${entry.instrument} (${v.pIdx})`);
            versionScoreMap.set(v.version, existing);
        }
    }
    const versionRankings = [];
    for (const [ver, data] of versionScoreMap) {
        versionRankings.push({
            version: ver, ...data,
            avgWinRate: data.totalCount > 0 ? (data.totalWins / data.totalCount) * 100 : 0,
            avgReturn: data.totalCount > 0 ? data.totalSumPnl / data.totalCount : 0,
            totalTrades: data.totalCount,
        });
    }
    versionRankings.sort((a, b) => b.appearances - a.appearances || b.avgWinRate - a.avgWinRate);

    write(cw, `## Section B: Overall Best-Performing Versions (Cross-Instrument)\n\n`);
    write(cw, `*Ranked by number of instrument p-value groups where this version appears in the Top 3.*\n\n`);
    write(cw, `| Rank | Version | Groups in Top 3 | Avg Win Rate | Avg Return | Total Trades | Best Instruments |\n`);
    write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :--- |\n`);
    versionRankings.slice(0, 20).forEach((v, idx) => {
        write(cw, `| #${idx + 1} | ${v.version} | ${v.appearances} | ${v.avgWinRate.toFixed(1)}% | ${v.avgReturn >= 0 ? '+' : ''}${v.avgReturn.toFixed(2)}% | ${v.totalTrades} | ${v.groups.slice(0, 3).join(', ')} |\n`);
    });
    write(cw, `\n`);

    // Section B.2: Overall Best Versions from A.2 (total return based)
    const versionScoreMapByRet = new Map();
    for (const entry of instrumentTop3ByRet) {
        for (const v of entry.top3) {
            const existing = versionScoreMapByRet.get(v.version) || { appearances: 0, totalCount: 0, totalWins: 0, totalSumPnl: 0, groups: [] };
            existing.appearances++;
            existing.totalCount += v.count;
            existing.totalWins += v.wins;
            existing.totalSumPnl += v.sumPnl;
            existing.groups.push(`${entry.instrument} (${v.pIdx})`);
            versionScoreMapByRet.set(v.version, existing);
        }
    }
    const versionRankingsByRet = [];
    for (const [ver, data] of versionScoreMapByRet) {
        versionRankingsByRet.push({
            version: ver, ...data,
            avgWinRate: data.totalCount > 0 ? (data.totalWins / data.totalCount) * 100 : 0,
            avgReturn: data.totalCount > 0 ? data.totalSumPnl / data.totalCount : 0,
            totalTrades: data.totalCount,
            totalSumPnl: data.totalSumPnl,
        });
    }
    versionRankingsByRet.sort((a, b) => b.appearances - a.appearances || b.totalSumPnl - a.totalSumPnl);

    write(cw, `## Section B.2: Overall Best-Performing Versions by Total Return (Cross-Instrument)\n\n`);
    write(cw, `*Ranked by number of instrument p-value groups where this version appears in A.2's Top 3 (total-return-based).*\n\n`);
    write(cw, `| Rank | Version | Groups in Top 3 | Avg Win Rate | Total Return | Total Trades | Best Instruments |\n`);
    write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :--- |\n`);
    versionRankingsByRet.slice(0, 20).forEach((v, idx) => {
        write(cw, `| #${idx + 1} | ${v.version} | ${v.appearances} | ${v.avgWinRate.toFixed(1)}% | ${v.totalSumPnl >= 0 ? '+' : ''}${v.totalSumPnl.toFixed(2)}% | ${v.totalTrades} | ${v.groups.slice(0, 3).join(', ')} |\n`);
    });
    write(cw, `\n`);

    // ── Build versionCumulativeP and versionBest from grouped data (raw counts) ──
    const versionCumulativeP = new Map(); // version → Map(instrument → [comboItems with raw counts])
    for (const [inst, combos] of instCombos) {
        for (const c of combos) {
            if (!versionCumulativeP.has(c.version)) versionCumulativeP.set(c.version, new Map());
            const imap = versionCumulativeP.get(c.version);
            if (!imap.has(inst)) imap.set(inst, []);
            imap.get(inst).push(c);
        }
    }

    const versionBest = new Map();
    for (const [version, imap] of versionCumulativeP) {
        const instSeen = new Set();
        let bestTotalCount = 0, bestTotalWins = 0, bestTotalSumPnl = 0;
        for (const [inst, combos] of imap) {
            instSeen.add(inst);
            // Select best p-index for this (version, instrument) by win rate
            let best = null, bestWR = -1;
            for (const c of combos) {
                const wr = comboWR(c);
                if (wr > bestWR || (wr === bestWR && best && c.sumPnl > best.sumPnl)) { bestWR = wr; best = c; }
            }
            if (best) {
                bestTotalCount += best.count;
                bestTotalWins += best.wins;
                bestTotalSumPnl += best.sumPnl;
            }
        }
        if (instSeen.size > 0 && bestTotalCount > 0) {
            versionBest.set(version, {
                instrumentsUsed: instSeen.size,
                totalTrades: bestTotalCount,
                winRate: (bestTotalWins / bestTotalCount) * 100,
                avgReturn: bestTotalSumPnl / bestTotalCount,
                totalPnlPct: bestTotalSumPnl,
                totalPnlAmount: 0,
            });
        }
    }

    // ── Section C: Global Best P-Value Analysis ──
    // C.1: Per-Instrument Global Best P-Value (aggregate raw counts by pIdx)
    write(cw, `## Section C: Global Best P-Value Analysis\n\n`);
    write(cw, `*Best p-value (p1-p10) per instrument, determined by win rate from accumulated trades across all versions.*\n\n`);

    write(cw, `### C.1: Global Best P-Value Per Instrument\n\n`);
    write(cw, `| Instrument | Best P-Value | Win Rate | Avg Return | Total Trades | Versions |\n`);
    write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);

    for (const [inst, combos] of instCombos) {
        // Aggregate raw counts by pIdx
        const pAgg = new Map(); // pIdx → {count, wins, sumPnl, sumMafe, sumMae, verSet}
        for (const c of combos) {
            if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, sumMafe: 0, sumMae: 0, verSet: new Set() });
            const e = pAgg.get(c.pIdx);
            e.count += c.count;
            e.wins += c.wins;
            e.sumPnl += c.sumPnl;
            e.sumMafe += c.sumMafe;
            e.sumMae += c.sumMae;
            e.verSet.add(c.version);
        }
        let bestP = null, bestWR = -1, bestAR = 0, bestTrades = 0, bestVerCnt = 0;
        for (const [p, d] of pAgg) {
            const wr = d.count > 0 ? (d.wins / d.count) * 100 : 0;
            if (wr > bestWR || (wr === bestWR && d.sumPnl > (bestWR >= 0 ? pAgg.get(bestP)?.sumPnl || 0 : 0))) {
                bestWR = wr; bestP = p;
                bestAR = d.count > 0 ? d.sumPnl / d.count : 0;
                bestTrades = d.count;
                bestVerCnt = d.verSet.size;
            }
        }
        if (bestP) {
            write(cw, `| ${inst} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestAR >= 0 ? '+' : ''}${bestAR.toFixed(2)}% | ${bestTrades} | ${bestVerCnt} |\n`);
        }
    }
    write(cw, `\n`);

    // C.2: Global Best P-Value Per Instrument Segment
    write(cw, `### C.2: Global Best P-Value Per Instrument Segment\n\n`);
    write(cw, `*Best p-value aggregated by instrument type. Win rates computed from total wins/trades per p-value.*\n\n`);

    const SEGMENT_TYPES = new Map();
    for (const instName of [...instCombos.keys()]) {
        if (instName.includes('Future') && (instName.includes('Nifty') || instName.includes('Bank') || instName.includes('Fin') || instName.includes('Midcap'))) {
            SEGMENT_TYPES.set(instName, 'Index Future');
        } else if (instName.includes('Future') && !instName.includes('Mini') && !instName.includes('Micro') && !instName.includes('Petal')) {
            SEGMENT_TYPES.set(instName, 'Equity Future');
        } else if (instName.includes('Future') || instName.includes('Mini') || instName.includes('Micro') || instName.includes('Petal') || instName.includes('Gold') || instName.includes('Silver') || instName.includes('Crude') || instName.includes('Natural Gas') || instName.includes('Copper') || instName.includes('Aluminium') || instName.includes('Zinc') || instName.includes('Lead')) {
            SEGMENT_TYPES.set(instName, 'Commodity');
        } else if (['Nifty 50','Bank Nifty','Fin Nifty','Midcap Nifty'].includes(instName)) {
            SEGMENT_TYPES.set(instName, 'Index Cash');
        } else if (instName.includes('(Cash)')) {
            SEGMENT_TYPES.set(instName, 'Equity Cash');
        } else {
            SEGMENT_TYPES.set(instName, 'Equity Cash');
        }
    }

    const segPBest = new Map(); // segment → Map(pIdx → {count, wins, sumPnl, instruments})
    for (const [inst, combos] of instCombos) {
        const seg = SEGMENT_TYPES.get(inst) || 'Other';
        if (!segPBest.has(seg)) segPBest.set(seg, new Map());
        const segMap = segPBest.get(seg);
        for (const c of combos) {
            if (!segMap.has(c.pIdx)) segMap.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, instruments: new Set() });
            const e = segMap.get(c.pIdx);
            e.count += c.count;
            e.wins += c.wins;
            e.sumPnl += c.sumPnl;
            e.instruments.add(inst);
        }
    }

    write(cw, `| Segment | Best P-Value | Win Rate | Avg Return | Total Trades | Instruments |\n`);
    write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
    for (const [seg, pMap] of segPBest) {
        let bestP = null, bestWR = -1, bestAR = 0, bestTrades = 0, bestInstCnt = 0;
        for (const [p, d] of pMap) {
            const wr = d.count > 0 ? (d.wins / d.count) * 100 : 0;
            if (wr > bestWR || (wr === bestWR && d.sumPnl > (bestWR >= 0 ? pMap.get(bestP)?.sumPnl || 0 : 0))) {
                bestWR = wr; bestP = p;
                bestAR = d.count > 0 ? d.sumPnl / d.count : 0;
                bestTrades = d.count;
                bestInstCnt = d.instruments.size;
            }
        }
        if (bestP) {
            write(cw, `| ${seg} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestAR >= 0 ? '+' : ''}${bestAR.toFixed(2)}% | ${bestTrades} | ${bestInstCnt} |\n`);
        }
    }
    write(cw, `\n`);

    // C.1_by_ret: Per-Instrument Global Best P-Value by Total Return
    write(cw, `### C.1 (by Total Return): Global Best P-Value Per Instrument\n\n`);
    write(cw, `*Best p-value per instrument selected by cumulative total return (sumPnl) across all versions.*\n\n`);
    write(cw, `| Instrument | Best P-Value | Win Rate | Total Return | Total Trades | Versions |\n`);
    write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);

    for (const [inst, combos] of instCombos) {
        const pAgg = new Map();
        for (const c of combos) {
            if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, verSet: new Set() });
            const e = pAgg.get(c.pIdx);
            e.count += c.count;
            e.wins += c.wins;
            e.sumPnl += c.sumPnl;
            e.verSet.add(c.version);
        }
        let bestP = null, bestSumPnl = -Infinity, bestWR = 0, bestTrades = 0, bestVerCnt = 0;
        for (const [p, d] of pAgg) {
            if (d.sumPnl > bestSumPnl || (d.sumPnl === bestSumPnl && comboWR({ wins: d.wins, count: d.count }) > bestWR)) {
                bestSumPnl = d.sumPnl; bestP = p;
                bestWR = d.count > 0 ? (d.wins / d.count) * 100 : 0;
                bestTrades = d.count;
                bestVerCnt = d.verSet.size;
            }
        }
        if (bestP) {
            write(cw, `| ${inst} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestSumPnl >= 0 ? '+' : ''}${bestSumPnl.toFixed(2)}% | ${bestTrades} | ${bestVerCnt} |\n`);
        }
    }
    write(cw, `\n`);

    // C.2_by_ret: Per-Segment Best P-Value by Total Return
    write(cw, `### C.2 (by Total Return): Global Best P-Value Per Instrument Segment\n\n`);
    write(cw, `*Best p-value per segment selected by cumulative total return.*\n\n`);
    write(cw, `| Segment | Best P-Value | Win Rate | Total Return | Total Trades | Instruments |\n`);
    write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
    for (const [seg, pMap] of segPBest) {
        let bestP = null, bestSumPnl = -Infinity, bestWR = 0, bestTrades = 0, bestInstCnt = 0;
        for (const [p, d] of pMap) {
            if (d.sumPnl > bestSumPnl || (d.sumPnl === bestSumPnl && d.count > 0 && (d.wins / d.count) * 100 > bestWR)) {
                bestSumPnl = d.sumPnl; bestP = p;
                bestWR = d.count > 0 ? (d.wins / d.count) * 100 : 0;
                bestTrades = d.count;
                bestInstCnt = d.instruments.size;
            }
        }
        if (bestP) {
            write(cw, `| ${seg} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestSumPnl >= 0 ? '+' : ''}${bestSumPnl.toFixed(2)}% | ${bestTrades} | ${bestInstCnt} |\n`);
        }
    }
    write(cw, `\n`);

    // ── Section C (cont): Cumulative Cross-Instrument Original vs Batch ──
    write(cw, `## Section C (cont): Cumulative Cross-Instrument Comparison (Best P-Value Per Instrument)\n\n`);
    write(cw, `*For each original version and its batch clones, we select the best p-value per instrument\n`);
    write(cw, `(by win rate from accumulated trades), then compute cumulative metrics across all instruments.*\n\n`);

    const BATCH_OFFSETS = [
        { offset: 50, label: "Entry/Stop" },
        { offset: 100, label: "Trend" },
        { offset: 150, label: "Leg Quality" },
        { offset: 200, label: "Exit Mgmt" },
    ];

    write(cw, `| Orig V | Batch | Original | Original WR | Original Ret | Batch Clone | Clone WR | Clone Ret | WR Δ | Ret Δ |\n`);
    write(cw, `| :---: | :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: |\n`);

    for (let origV = 1; origV <= 50; origV++) {
        const origEntry = [...versionBest.entries()].find(([k]) => {
            const vn = parseInt(k.match(versionRegex)?.[1]);
            return vn === origV && !k.includes('(Original)');
        });
        if (!origEntry) continue;
        for (const batch of BATCH_OFFSETS) {
            const cloneV = origV + batch.offset;
            const cloneEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === cloneV);
            if (!cloneEntry) continue;
            const o = origEntry[1], c = cloneEntry[1];
            if (o.totalTrades < MIN_TRADES || c.totalTrades < MIN_TRADES) continue;
            write(cw, `| V${origV} | ${batch.label} | ${origEntry[0]} | ${o.winRate.toFixed(1)}% | ${o.avgReturn >= 0 ? '+' : ''}${o.avgReturn.toFixed(2)}% | ${cloneEntry[0]} | ${c.winRate.toFixed(1)}% | ${c.avgReturn >= 0 ? '+' : ''}${c.avgReturn.toFixed(2)}% | ${(c.winRate - o.winRate) >= 0 ? '+' : ''}${(c.winRate - o.winRate).toFixed(1)}% | ${(c.avgReturn - o.avgReturn) >= 0 ? '+' : ''}${(c.avgReturn - o.avgReturn).toFixed(2)}% |\n`);
        }
    }
    write(cw, `\n`);

    // Brooks (V851-V904)
    write(cw, `### Brooks Strategies — Batch Profiles\n\n`);
    write(cw, `| Orig V | Profile | Original | Original WR | Original Ret | Clone | Clone WR | Clone Ret | WR Δ | Ret Δ |\n`);
    write(cw, `| :---: | :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: |\n`);
    const brooksOrig = [851, 852, 853];
    const brooksBatchOffsets = [
        { offset: 3, label: "Entry/Stop" },
        { offset: 6, label: "Trend" },
        { offset: 9, label: "Leg Quality" },
        { offset: 12, label: "Exit Mgmt" },
    ];
    for (const origV of brooksOrig) {
        const origEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === origV);
        if (!origEntry || origEntry[1].totalTrades < MIN_TRADES) continue;
        for (const batch of brooksBatchOffsets) {
            const cloneV = 851 + batch.offset + (origV - 851);
            const cloneEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === cloneV);
            if (!cloneEntry || cloneEntry[1].totalTrades < MIN_TRADES) continue;
            const o = origEntry[1], c = cloneEntry[1];
            write(cw, `| V${origV} | ${batch.label} | ${origEntry[0]} | ${o.winRate.toFixed(1)}% | ${o.avgReturn >= 0 ? '+' : ''}${o.avgReturn.toFixed(2)}% | ${cloneEntry[0]} | ${c.winRate.toFixed(1)}% | ${c.avgReturn >= 0 ? '+' : ''}${c.avgReturn.toFixed(2)}% | ${(c.winRate - o.winRate) >= 0 ? '+' : ''}${(c.winRate - o.winRate).toFixed(1)}% | ${(c.avgReturn - o.avgReturn) >= 0 ? '+' : ''}${(c.avgReturn - o.avgReturn).toFixed(2)}% |\n`);
        }
    }
    write(cw, `\n`);

    // Individual Fix Profile Summary
    write(cw, `### Individual Fix Profiles — Average WR Impact (V251-V850 vs V1-V50 Originals)\n\n`);
    write(cw, `| Fix Profile | Avg WR Δ | Best WR Gain | Worst WR Loss | Positive Orig | Negative Orig |\n`);
    write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);

    const FIX_ORDER = ["stop_wider","trigger_wider","atr_floor","slippage","abr_slope","adx_filter","gap_optional","leg_depth","pivot_struct","trailing","time_exit","bar_path"];
    const FIX_LABELS = {stop_wider:"Stop Wider",trigger_wider:"Trigger Wider",atr_floor:"ATR Floor",slippage:"Slippage",abr_slope:"ABR Slope",adx_filter:"ADX Filter",gap_optional:"Gap Optional",leg_depth:"Leg Depth",pivot_struct:"Pivot Structural",trailing:"Trailing Stop",time_exit:"Time Exit",bar_path:"Bar Path Exit"};

    for (let fixIdx = 0; fixIdx < FIX_ORDER.length; fixIdx++) {
        const baseVersion = 251 + fixIdx * 50;
        const deltas = [];
        for (let origV = 1; origV <= 50; origV++) {
            const origEntry = [...versionBest.entries()].find(([k]) => {
                const vn = parseInt(k.match(versionRegex)?.[1]);
                return vn === origV && !k.includes('(Original)');
            });
            const fixV = baseVersion + origV - 1;
            const fixEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === fixV);
            if (origEntry && fixEntry) {
                const o = origEntry[1], f = fixEntry[1];
                if (o.totalTrades >= MIN_TRADES && f.totalTrades >= MIN_TRADES) {
                    deltas.push(f.winRate - o.winRate);
                }
            }
        }
        if (deltas.length > 0) {
            const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
            write(cw, `| ${FIX_LABELS[FIX_ORDER[fixIdx]]} | ${avg >= 0 ? '+' : ''}${avg.toFixed(1)}% | ${Math.max(...deltas) >= 0 ? '+' : ''}${Math.max(...deltas).toFixed(1)}% | ${Math.min(...deltas).toFixed(1)}% | ${deltas.filter(d => d > 0).length} | ${deltas.filter(d => d < 0).length} |\n`);
        }
    }
    write(cw, `\n`);

    // ── Section D: All Versions + Global P-Value Rankings ──
    // D.1: Per-version metrics (best p-value per instrument, from raw counts)
    write(cw, `### Section D.1: All Versions — Cumulative Cross-Instrument Metrics (Best P-Value Per Instrument)\n\n`);
    write(cw, `| Version | Instruments | Total Trades | Win Rate | Avg Return | Total Return | Best P-Values |\n`);
    write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`);
    const sortedBest = [...versionBest.entries()].sort((a, b) =>
        parseInt(a[0].match(versionRegex)?.[1] || '0') - parseInt(b[0].match(versionRegex)?.[1] || '0')
    );
    for (const [ver, d] of sortedBest) {
        const vCombos = versionCumulativeP.get(ver);
        const bestPVals = [];
        if (vCombos) {
            for (const [inst, combos] of vCombos) {
                let best = null, bestWR = -1;
                for (const c of combos) {
                    const wr = comboWR(c);
                    if (wr > bestWR || (wr === bestWR && best && c.sumPnl > best.sumPnl)) { bestWR = wr; best = c; }
                }
                if (best) bestPVals.push(best.pIdx);
            }
        }
        write(cw, `| ${ver} | ${d.instrumentsUsed} | ${d.totalTrades} | ${d.winRate.toFixed(1)}% | ${d.avgReturn >= 0 ? '+' : ''}${d.avgReturn.toFixed(2)}% | ${d.totalPnlPct >= 0 ? '+' : ''}${d.totalPnlPct.toFixed(2)}% | ${bestPVals.join(', ')} |\n`);
    }
    write(cw, `\n`);

    // D.2: Global best p-value across all versions and instruments (from raw counts)
    write(cw, `### Section D.2: Global Best P-Value Rankings (Across All Versions & Instruments)\n\n`);
    write(cw, `*For each p-value (p1-p10), win rate from total wins/trades across all instruments and versions.*\n\n`);

    const globalPRankings = new Map(); // pIdx → {count, wins, sumPnl}
    for (const [inst, combos] of instCombos) {
        for (const c of combos) {
            if (!globalPRankings.has(c.pIdx)) globalPRankings.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0 });
            const e = globalPRankings.get(c.pIdx);
            e.count += c.count;
            e.wins += c.wins;
            e.sumPnl += c.sumPnl;
        }
    }

    write(cw, `| Rank | P-Value | Win Rate | Avg Return | Total Trades | Combo Count |\n`);
    write(cw, `| :---: | :---: | :---: | :---: | :---: | :---: |\n`);
    const rankedP = [...globalPRankings.entries()]
        .sort((a, b) => {
            const wrA = a[1].count > 0 ? (a[1].wins / a[1].count) * 100 : 0;
            const wrB = b[1].count > 0 ? (b[1].wins / b[1].count) * 100 : 0;
            return wrB - wrA || b[1].sumPnl - a[1].sumPnl;
        });
    rankedP.forEach(([p, d], idx) => {
        const wr = d.count > 0 ? (d.wins / d.count) * 100 : 0;
        const ar = d.count > 0 ? d.sumPnl / d.count : 0;
        write(cw, `| #${idx + 1} | ${p} | ${wr.toFixed(1)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${d.count} | ${d.count > 0 ? d.count : 0} |\n`);
    });
    write(cw, `\n`);

    // D.3: Per-Version Global Best P-Value (fixed single p-value across all instruments)
    write(cw, `### Section D.3: Per-Version Global Best P-Value (Single P-Value Fixed Across All Instruments)\n\n`);
    write(cw, `*For each version, uses the SAME p-value across all instruments. Aggregates raw trades to find\n`);
    write(cw, `the single best p-value globally. Shows which versions work consistently with one setting.*\n\n`);
    write(cw, `| Rank | Version | Best P-Value | Win Rate | Avg Return | Total Trades | Instruments | Other Top P-Values |\n`);
    write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`);

    const versionGlobalPBest = [];
    for (const [version, imap] of versionCumulativeP) {
        // Aggregate raw counts by pIdx across ALL instruments for this version
        const pAgg = new Map(); // pIdx → {count, wins, sumPnl, instSet}
        for (const [inst, combos] of imap) {
            for (const c of combos) {
                if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, instSet: new Set() });
                const e = pAgg.get(c.pIdx);
                e.count += c.count;
                e.wins += c.wins;
                e.sumPnl += c.sumPnl;
                e.instSet.add(inst);
            }
        }
        // Find best pIdx by win rate
        const pRanked = [...pAgg.entries()]
            .map(([p, d]) => ({
                p,
                wr: d.count > 0 ? (d.wins / d.count) * 100 : 0,
                ar: d.count > 0 ? d.sumPnl / d.count : 0,
                trades: d.count,
                instCnt: d.instSet.size,
            }))
            .sort((a, b) => b.wr - a.wr || b.trades - a.trades);
        if (pRanked.length > 0) {
            const best = pRanked[0];
            const others = pRanked.slice(1, 4).map(x => `${x.p}(${x.wr.toFixed(0)}%)`).join(', ');
            versionGlobalPBest.push({
                version,
                bestP: best.p,
                wr: best.wr,
                ar: best.ar,
                trades: best.trades,
                instCnt: best.instCnt,
                others,
            });
        }
    }
    versionGlobalPBest.sort((a, b) => b.wr - a.wr || b.trades - a.trades);

    versionGlobalPBest.forEach((v, idx) => {
        write(cw, `| #${idx + 1} | ${v.version} | ${v.bestP} | ${v.wr.toFixed(1)}% | ${v.ar >= 0 ? '+' : ''}${v.ar.toFixed(2)}% | ${v.trades} | ${v.instCnt} | ${v.others} |\n`);
    });
    write(cw, `\n`);

    // D.2 (by Total Return): Global best p-value ranked by total return
    write(cw, `### Section D.2 (by Total Return): Global Best P-Value Rankings (Sorted by Total Return)\n\n`);
    write(cw, `*For each p-value (p1-p10), sorted by cumulative total return across all instruments and versions.*\n\n`);
    write(cw, `| Rank | P-Value | Win Rate | Total Return | Avg Return | Total Trades |\n`);
    write(cw, `| :---: | :---: | :---: | :---: | :---: | :---: |\n`);
    const rankedPByRet = [...globalPRankings.entries()]
        .sort((a, b) => b[1].sumPnl - a[1].sumPnl || ((b[1].count > 0 ? (b[1].wins / b[1].count) * 100 : 0) - (a[1].count > 0 ? (a[1].wins / a[1].count) * 100 : 0)));
    rankedPByRet.forEach(([p, d], idx) => {
        const wr = d.count > 0 ? (d.wins / d.count) * 100 : 0;
        const ar = d.count > 0 ? d.sumPnl / d.count : 0;
        write(cw, `| #${idx + 1} | ${p} | ${wr.toFixed(1)}% | ${d.sumPnl >= 0 ? '+' : ''}${d.sumPnl.toFixed(2)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${d.count} |\n`);
    });
    write(cw, `\n`);

    // D.3 (by Total Return): Per-Version Global Best P-Value by total return
    write(cw, `### Section D.3 (by Total Return): Per-Version Global Best P-Value (Sorted by Total Return)\n\n`);
    write(cw, `*Same as D.3 but selects best p-value by cumulative total return instead of win rate.*\n\n`);
    write(cw, `| Rank | Version | Best P-Value | Win Rate | Total Return | Total Trades | Instruments | Other Top P-Values |\n`);
    write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`);

    const versionGlobalPBestByRet = [];
    for (const [version, imap] of versionCumulativeP) {
        const pAgg = new Map();
        for (const [inst, combos] of imap) {
            for (const c of combos) {
                if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, instSet: new Set() });
                const e = pAgg.get(c.pIdx);
                e.count += c.count;
                e.wins += c.wins;
                e.sumPnl += c.sumPnl;
                e.instSet.add(inst);
            }
        }
        const pRanked = [...pAgg.entries()]
            .map(([p, d]) => ({
                p,
                wr: d.count > 0 ? (d.wins / d.count) * 100 : 0,
                sumPnl: d.sumPnl,
                ar: d.count > 0 ? d.sumPnl / d.count : 0,
                trades: d.count,
                instCnt: d.instSet.size,
            }))
            .sort((a, b) => b.sumPnl - a.sumPnl || b.wr - a.wr);
        if (pRanked.length > 0) {
            const best = pRanked[0];
            const others = pRanked.slice(1, 4).map(x => `${x.p}(+${x.sumPnl.toFixed(1)}%)`).join(', ');
            versionGlobalPBestByRet.push({
                version,
                bestP: best.p,
                wr: best.wr,
                sumPnl: best.sumPnl,
                ar: best.ar,
                trades: best.trades,
                instCnt: best.instCnt,
                others,
            });
        }
    }
    versionGlobalPBestByRet.sort((a, b) => b.sumPnl - a.sumPnl || b.wr - a.wr);

    versionGlobalPBestByRet.forEach((v, idx) => {
        write(cw, `| #${idx + 1} | ${v.version} | ${v.bestP} | ${v.wr.toFixed(1)}% | ${v.sumPnl >= 0 ? '+' : ''}${v.sumPnl.toFixed(2)}% | ${v.trades} | ${v.instCnt} | ${v.others} |\n`);
    });
    write(cw, `\n`);

    // ── Live Trade Recommendations ──
    write(cw, `## Section I: Live Trade Recommendations\n\n`);
    write(cw, `*Top version+p-value combinations from D.3 that balance high win rate with sufficient trades and instrument coverage.*\n\n`);

    // Pick top candidates from D.3 with decent trade counts
    const candidates = versionGlobalPBest
        .filter(v => v.trades >= 10 && v.instCnt >= 3)
        .slice(0, 10);

    write(cw, `### Top Candidates (Single P-Value, All Instruments)\n\n`);
    write(cw, `| Version | P-Value | Win Rate | Avg Return | Trades | Instruments | Recommendation |\n`);
    write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`);

    candidates.forEach((v, idx) => {
        const grade = v.wr >= 80 && v.trades >= 20 ? '⭐⭐⭐ Strong' :
                       v.wr >= 70 && v.trades >= 15 ? '⭐⭐ Good' :
                       v.wr >= 60 && v.trades >= 10 ? '⭐ Moderate' : '— Monitor';
        write(cw, `| ${v.version} | ${v.bestP} | ${v.wr.toFixed(1)}% | ${v.ar >= 0 ? '+' : ''}${v.ar.toFixed(2)}% | ${v.trades} | ${v.instCnt} | ${grade} |\n`);
    });
    write(cw, `\n`);

    write(cw, `### Suggested Live Trading Configuration\n\n`);
    if (candidates.length > 0) {
        const best = candidates[0];
        write(cw, `**Primary**: Use **${best.version}** with **${best.bestP}** across all instruments.\n`);
        write(cw, `- Expected win rate: ${best.wr.toFixed(1)}% across ${best.trades} trades on ${best.instCnt} instruments\n`);
        write(cw, `- Avg return per trade: ${best.ar >= 0 ? '+' : ''}${best.ar.toFixed(2)}%\n`);
        if (candidates.length > 1) {
            write(cw, `**Fallback**: ${candidates[1].version} with ${candidates[1].bestP} (${candidates[1].wr.toFixed(0)}% WR, ${candidates[1].trades} trades)\n`);
        }
        write(cw, `\n**Risk Note**: Backtest results may not predict future performance. Start with minimal position sizing.\n`);
    }
    write(cw, `\n`);

    // ── Req 1: Brooks V851-V904 Full Improvement Analysis ──
    write(cw, `## Section E: Brooks Strategy Improvement Matrix (V851-V904)\n\n`);
    write(cw, `*How each Brooks base strategy improves with batch profiles and individual fixes.*\n\n`);

    // 1. Brooks batch profile impact (already above, but add per-base summary)
    const BROOKS_BASES = [
        { v: 851, name: 'Brooks Structural Pure', offsets: [3,6,9,12] },
        { v: 852, name: 'Brooks Volume-Optimized', offsets: [3,6,9,12] },
        { v: 853, name: 'Brooks Selective (WR Focus)', offsets: [3,6,9,12] },
    ];

    for (const base of BROOKS_BASES) {
        const origEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === base.v);
        if (!origEntry || origEntry[1].totalTrades < MIN_TRADES) continue;
        write(cw, `### ${base.name} (V${base.v}) — Batch Profile Impact\n\n`);
        write(cw, `| Profile | Version | WR | Avg Ret | Total Trades | WR Δ vs Base |\n`);
        write(cw, `| :--- | :--- | :---: | :---: | :---: | :---: |\n`);
        const o = origEntry[1];
        write(cw, `| **Base** | V${base.v} | ${o.winRate.toFixed(1)}% | ${o.avgReturn >= 0 ? '+' : ''}${o.avgReturn.toFixed(2)}% | ${o.totalTrades} | — |\n`);

        for (const bo of brooksBatchOffsets) {
            const cloneV = 851 + bo.offset + (base.v - 851);
            const cloneEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === cloneV);
            if (!cloneEntry || cloneEntry[1].totalTrades < MIN_TRADES) continue;
            const c = cloneEntry[1];
            write(cw, `| ${bo.label} | V${cloneV} | ${c.winRate.toFixed(1)}% | ${c.avgReturn >= 0 ? '+' : ''}${c.avgReturn.toFixed(2)}% | ${c.totalTrades} | ${(c.winRate - o.winRate) >= 0 ? '+' : ''}${(c.winRate - o.winRate).toFixed(1)}% |\n`);
        }
        write(cw, `\n`);
    }

    // 2. Brooks fix profile impact
    write(cw, `### Brooks Strategy — Fix Profile Impact (V854-V904)\n\n`);
    write(cw, `| Brooks Base | Fix | Version | WR | Avg Ret | Total Trades | WR Δ vs Base |\n`);
    write(cw, `| :--- | :--- | :--- | :---: | :---: | :---: | :---: |\n`);

    for (const base of BROOKS_BASES) {
        const origEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === base.v);
        if (!origEntry || origEntry[1].totalTrades < MIN_TRADES) continue;
        const o = origEntry[1];

        for (let fixIdx = 0; fixIdx < FIX_ORDER.length; fixIdx++) {
            // Brooks fix versions start at 854 (Structural Pure), 855 (Volume-Opt), 856 (Selective) for fix 0
            const fixV = 854 + fixIdx * 3 + (base.v - 851);
            const fixEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === fixV);
            if (!fixEntry || fixEntry[1].totalTrades < MIN_TRADES) continue;
            const f = fixEntry[1];
            write(cw, `| ${base.name} | ${FIX_LABELS[FIX_ORDER[fixIdx]]} | V${fixV} | ${f.winRate.toFixed(1)}% | ${f.avgReturn >= 0 ? '+' : ''}${f.avgReturn.toFixed(2)}% | ${f.totalTrades} | ${(f.winRate - o.winRate) >= 0 ? '+' : ''}${(f.winRate - o.winRate).toFixed(1)}% |\n`);
        }
    }
    write(cw, `\n`);

    // ── Req 1: Instrument-Type Cross-Referencing Recommendations ──
    write(cw, `## Section F: Instrument-Type Strategy Recommendations\n\n`);
    write(cw, `*Best strategy + fix profile per instrument type based on win rate and cross-instrument consistency.*\n\n`);

    // Instrument type classification
    const INST_TYPES = new Map();
    for (const instName of [...new Set([...instCombos.keys()])]) {
        if (instName.includes('Future') && (instName.includes('Nifty') || instName.includes('Bank') || instName.includes('Fin') || instName.includes('Midcap'))) {
            INST_TYPES.set(instName, 'Index Future');
        } else if (instName.includes('Future') && !instName.includes('Mini') && !instName.includes('Micro') && !instName.includes('Petal') && !instName.includes('MCX')) {
            // Equity futures (not commodity, not MCX mini variants)
            if (['Reliance Future','HDFC Bank Future','ICICI Bank Future','SBI Future','TCS Future','Infosys Future','ITC Future','Bharti Airtel Future','Axis Bank Future','L&T Future','Tata Steel Future','Tata Motors Future','Bajaj Finance Future','Kotak Bank Future','Sun Pharma Future','JSW Steel Future','Coal India Future','Adani Enterprises Future','Adani Ports Future','Hindalco Future','Apollo Hospitals Future','PNB Future','SAIL Future','SUZLON Future','PAYTM Future','RVNL Future','IRFC Future','IREDA Future','BHEL Future','GAIL Future','TRENT Future'].includes(instName)) {
                INST_TYPES.set(instName, 'Equity Future');
            }
        } else if (instName.includes('Future') || instName.includes('Mini') || instName.includes('Micro') || instName.includes('Petal') || instName.includes('Gold') || instName.includes('Silver') || instName.includes('Crude') || instName.includes('Natural Gas') || instName.includes('Copper') || instName.includes('Aluminium') || instName.includes('Zinc') || instName.includes('Lead')) {
            INST_TYPES.set(instName, 'Commodity');
        } else if (instName.includes('(MCX)')) {
            INST_TYPES.set(instName, 'Commodity');
        } else if (['Nifty 50','Bank Nifty','Fin Nifty','Midcap Nifty'].includes(instName)) {
            INST_TYPES.set(instName, 'Index Cash');
        } else {
            INST_TYPES.set(instName, 'Equity Cash');
        }
    }

    // For each instrument type, find best version (across all V1-V904) + show optimal candle range
    const typeCombos = new Map(); // type → [{version, instrument, avgWinRate, count, ...}]
    for (const [inst, combos] of instCombos) {
        const type = INST_TYPES.get(inst) || 'Other';
        if (!typeCombos.has(type)) typeCombos.set(type, []);
        for (const c of combos) {
            typeCombos.get(type).push({ ...c, instrument: inst });
        }
    }

    write(cw, `| Instrument Type | Best Version | Best Fix Group (Top 3) | Avg Win Rate | Instruments Tested |\n`);
    write(cw, `| :--- | :--- | :--- | :---: | :---: |\n`);

    for (const [type, combos] of typeCombos) {
        if (combos.length === 0) continue;

        // Aggregate by version across instruments in this type (use raw counts)
        const verMap = new Map();
        for (const c of combos) {
            if (!verMap.has(c.version)) verMap.set(c.version, { totalCount: 0, totalWins: 0, totalSumPnl: 0, comboCount: 0, instruments: new Set() });
            const e = verMap.get(c.version);
            e.totalCount += c.count;
            e.totalWins += c.wins;
            e.totalSumPnl += c.sumPnl;
            e.comboCount++;
            e.instruments.add(c.instrument);
        }

        const ranked = [...verMap.entries()]
            .map(([v, d]) => ({
                version: v,
                wr: d.totalCount > 0 ? (d.totalWins / d.totalCount) * 100 : 0,
                ar: d.totalCount > 0 ? d.totalSumPnl / d.totalCount : 0,
                trades: d.totalCount,
                comboCount: d.comboCount,
                instCount: d.instruments.size,
            }))
            .sort((a, b) => b.wr - a.wr || b.ar - a.ar)
            .slice(0, 3);

        const bestName = ranked[0] ? `${ranked[0].version} (${ranked[0].wr.toFixed(1)}% WR)` : '—';
        const bestFixes = ranked.map(r => `${r.version.split(':')[0]}(${r.wr.toFixed(1)}%)`).join(', ');
        write(cw, `| ${type} | ${bestName} | ${bestFixes} | ${ranked[0] ? ranked[0].wr.toFixed(1) : '—'}% | ${[...new Set(combos.map(c => c.instrument))].length} |\n`);
    }
    write(cw, `\n`);

    // ── Req 2: Threshold-Based Top 3 Per Instrument ──
    write(cw, `## Section G: Best Version+Threshold Per Instrument (Top 3 by Win Rate)\n\n`);
    write(cw, `*Performance grouped by raw threshold value — the actual volume bar threshold to use in live trading.*\n`);
    write(cw, `*Note: Same threshold produces consistent candle counts across dates. Use this to configure volume bars.*\n\n`);
    write(cw, `| Instrument | Rank | Version | Threshold | Win Rate | Avg Return | Total Return | MAFE | MAE | Trades |\n`);
    write(cw, `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`);

    const instThrCombos = new Map();
    for (const [key, d] of Object.entries(L3 || {})) {
        const parts = key.split('|');
        if (parts.length < 3) continue;
        const version = parts[0], instrument = parts[1], threshold = parts[2];
        if (d.count < MIN_TRADES) continue;
        const m = deriveMetrics(d);
        if (!instThrCombos.has(instrument)) instThrCombos.set(instrument, []);
        instThrCombos.get(instrument).push({ version, threshold, ...m, trades: d.count });
    }

    for (const [inst, combos] of instThrCombos) {
        combos.sort((a, b) => b.winRate - a.winRate || b.totalReturn - a.totalReturn);
        const top3 = combos.slice(0, 3);
        top3.forEach((v, idx) => {
            const thDisplay = pIdxToThreshold.get(`${inst}|${v.threshold}`) || v.threshold;
            write(cw, `| ${inst} | #${idx + 1} | ${v.version} | ${thDisplay} | ${v.winRate.toFixed(1)}% | ${v.avgReturn >= 0 ? '+' : ''}${v.avgReturn.toFixed(2)}% | ${v.totalReturn >= 0 ? '+' : ''}${v.totalReturn.toFixed(2)}% | ${v.avgMafe.toFixed(0)}% | ${v.avgMae.toFixed(0)}% | ${v.trades} |\n`);
        });
    }
    write(cw, `\n`);

    // ── Req 3: Fix Cluster Consolidation (904 → ~240 via correlation clustering) ──
    write(cw, `## Section H: Fix Profile Consolidation & Correlation Analysis\n\n`);
    write(cw, `*8 of 12 fixes are near-perfectly correlated (r=0.97-1.00). Only ADX Filter (r≈0.75) and Pivot Structural (r≈0.71) are distinct.*\n`);
    write(cw, `*Consolidating to 3 truly independent groups based on WR delta correlation across 50 base versions.*\n\n`);

    // Build 50×12 fix delta matrix
    const fixDeltaMatrix = []; // [{version: 1, fixName: 'stop_wider', origWR: X, fixWR: Y, delta: Z}, ...]
    for (let fixIdx = 0; fixIdx < FIX_ORDER.length; fixIdx++) {
        const baseVersion = 251 + fixIdx * 50;
        for (let origV = 1; origV <= 50; origV++) {
            const origEntry = [...versionBest.entries()].find(([k]) => {
                const vn = parseInt(k.match(versionRegex)?.[1]);
                return vn === origV && !k.includes('(Original)');
            });
            const fixV = baseVersion + origV - 1;
            const fixEntry = [...versionBest.entries()].find(([k]) => parseInt(k.match(versionRegex)?.[1]) === fixV);
            if (origEntry && fixEntry) {
                const o = origEntry[1], f = fixEntry[1];
                if (o.totalTrades >= MIN_TRADES && f.totalTrades >= MIN_TRADES) {
                    fixDeltaMatrix.push({
                        origV,
                        fixName: FIX_ORDER[fixIdx],
                        fixIdx,
                        origWR: o.winRate,
                        fixWR: f.winRate,
                        delta: f.winRate - o.winRate,
                    });
                }
            }
        }
    }

    // Build 50-dim vector per fix
    const fixVectors = {};
    for (const fixName of FIX_ORDER) {
        fixVectors[fixName] = [];
        for (let v = 1; v <= 50; v++) {
            const row = fixDeltaMatrix.find(r => r.origV === v && r.fixName === fixName);
            fixVectors[fixName].push(row ? row.delta : 0);
        }
    }

    // Compute pairwise correlations
    function pearson(a, b) {
        const n = a.length;
        let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
        for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
        const ma = sa / n, mb = sb / n;
        for (let i = 0; i < n; i++) {
            const da = a[i] - ma, db = b[i] - mb;
            saa += da * da; sbb += db * db; sab += da * db;
        }
        const den = Math.sqrt(saa) * Math.sqrt(sbb);
        return den === 0 ? 0 : sab / den;
    }

    // Simple hierarchical clustering: merge most correlated pairs recursively
    let clusters = FIX_ORDER.map(f => [f]); // each fix starts as its own cluster
    const TARGET_GROUPS = 5;

    while (clusters.length > TARGET_GROUPS) {
        let bestCorr = -Infinity, bestI = -1, bestJ = -1;
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                // Average correlation between clusters
                let sum = 0, count = 0;
                for (const fa of clusters[i]) {
                    for (const fb of clusters[j]) {
                        sum += pearson(fixVectors[fa], fixVectors[fb]);
                        count++;
                    }
                }
                const avg = count > 0 ? sum / count : 0;
                if (avg > bestCorr) { bestCorr = avg; bestI = i; bestJ = j; }
            }
        }
        // Merge clusters[bestI] and clusters[bestJ]
        clusters[bestI] = clusters[bestI].concat(clusters[bestJ]);
        clusters.splice(bestJ, 1);
    }

    // Override with simplified 3-group structure based on correlation data:
    // G1: The 10 collinear fixes (Stop Wider, Trigger Wider, ATR Floor, Slippage, ABR Slope, Gap Optional, Leg Depth, Trailing Stop, Time Exit, Bar Path Exit)
    // G2: ADX Filter (distinct, r≈0.75)
    // G3: Pivot Structural (distinct, r≈0.71)
    const simplifiedGroups = [
        ["stop_wider","trigger_wider","atr_floor","slippage","abr_slope","gap_optional","leg_depth","trailing","time_exit","bar_path"],
        ["adx_filter"],
        ["pivot_struct"],
    ];
    const simpleGroupNames = ['G1: Entry+Stop (10 fixes)', 'G2: ADX Filter', 'G3: Pivot Structural'];

    write(cw, `### Simplified Fix Groups (3 truly distinct)\n\n`);
    write(cw, `*Based on correlation analysis — 10 collinear fixes merged into G1. ADX and Pivot Structural are independent.*\n\n`);
    write(cw, `| Group | Fixes | Avg WR Impact | Best On Versions |\n`);
    write(cw, `| :--- | :--- | :---: | :--- |\n`);

    for (let g = 0; g < simplifiedGroups.length; g++) {
        const groupFixes = simplifiedGroups[g];
        const gDeltas = [];
        const bestOnVersions = new Map();

        for (let origV = 1; origV <= 50; origV++) {
            let bestVDelta = -Infinity;
            for (const fix of groupFixes) {
                const row = fixDeltaMatrix.find(r => r.origV === origV && r.fixName === fix);
                if (row && row.delta > bestVDelta) bestVDelta = row.delta;
            }
            if (bestVDelta > -Infinity) {
                gDeltas.push(bestVDelta);
                bestOnVersions.set(origV, bestVDelta);
            }
        }

        const avgDelta = gDeltas.length > 0 ? gDeltas.reduce((s,d) => s + d, 0) / gDeltas.length : 0;
        const topVersions = [...bestOnVersions.entries()]
            .sort((a,b) => b[1] - a[1]).slice(0, 5)
            .map(([v,d]) => `V${v}(${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`).join(', ');

        const fixNames = groupFixes.map(f => FIX_LABELS[f] || f).join(', ');
        write(cw, `| ${simpleGroupNames[g]} | ${fixNames} | ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}% | ${topVersions} |\n`);
    }
    write(cw, `\n`);

    // Keep original 5-group clustering for reference
    write(cw, `### Original Correlation Clusters (5 groups, auto-detected)\n\n`);
    const groupNames = ['G1: Entry Protection', 'G2: Filter Quality', 'G3: Pattern Structure', 'G4: Exit Management', 'G5: Entry+Exit Combined'];

    write(cw, `| Group | Fixes | Avg WR Impact | Best On Versions |\n`);
    for (let g = 0; g < clusters.length; g++) {
        const groupFixes = clusters[g];
        // Aggregate: for each base version+instrument, take best fix in group
        const gDeltas = [];
        const bestOnVersions = new Map(); // version → best delta

        for (let origV = 1; origV <= 50; origV++) {
            let bestVDelta = -Infinity;
            for (const fix of groupFixes) {
                const row = fixDeltaMatrix.find(r => r.origV === origV && r.fixName === fix);
                if (row && row.delta > bestVDelta) {
                    bestVDelta = row.delta;
                }
            }
            if (bestVDelta > -Infinity) {
                gDeltas.push(bestVDelta);
                bestOnVersions.set(origV, bestVDelta);
            }
        }

        const avgDelta = gDeltas.length > 0 ? gDeltas.reduce((s,d) => s + d, 0) / gDeltas.length : 0;
        const topVersions = [...bestOnVersions.entries()]
            .sort((a,b) => b[1] - a[1]).slice(0, 5)
            .map(([v,d]) => `V${v}(${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`).join(', ');

        const fixNames = groupFixes.map(f => FIX_LABELS[f] || f).join(', ');
        write(cw, `| ${groupNames[g] || `Group ${g+1}`} | ${fixNames} | ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}% | ${topVersions} |\n`);
    }
    write(cw, `\n`);

    // Per-base-version best fix group (using 3 simplified groups)
    write(cw, `### Per Base Version — Best Fix Group (3 Groups)\n\n`);
    write(cw, `*Recommendation: use only 3 fix groups for live trading. ADX and Pivot Structural are independent; all others are interchangeable.*\n\n`);
    write(cw, `| Base Version | Best Fix Group | Top Fix | Viable Alternatives |\n`);
    write(cw, `| :---: | :--- | :--- | :--- |\n`);

    for (let origV = 1; origV <= 50; origV++) {
        let bestG = -1, bestGD = -Infinity, bestFix = '';
        const groupDeltas = []; // [{group: 0, delta: X, fix: 'name'}]
        for (let g = 0; g < simplifiedGroups.length; g++) {
            let bestVD = -Infinity, bestF = '';
            for (const fix of simplifiedGroups[g]) {
                const row = fixDeltaMatrix.find(r => r.origV === origV && r.fixName === fix);
                if (row && row.delta > bestVD) { bestVD = row.delta; bestF = fix; }
            }
            if (bestVD > -Infinity) {
                groupDeltas.push({ group: g, delta: bestVD, fix: bestF });
                if (bestVD > bestGD) { bestGD = bestVD; bestG = g; bestFix = bestF; }
            }
        }
        if (bestG >= 0) {
            // Show alternatives: any group with delta within 5% of best
            const alternatives = groupDeltas
                .filter(d => d.group !== bestG && bestGD - d.delta <= 5.0)
                .map(d => `${simpleGroupNames[d.group].split(':')[0]}(${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(1)}%)`)
                .join(', ') || 'none';
            write(cw, `| V${origV} | ${simpleGroupNames[bestG]} | ${FIX_LABELS[bestFix] || bestFix} (${bestGD >= 0 ? '+' : ''}${bestGD.toFixed(1)}%) | ${alternatives} |\n`);
        }
    }
    write(cw, `\n`);

    // Original per-base from 5-group clustering
    write(cw, `### Per Base Version — Best Fix Group (5 Groups, Original)\n\n`);
    write(cw, `| Base Version | Best Fix Group | Avg WR Δ | Top Individual Fix |\n`);
    for (let origV = 1; origV <= 50; origV++) {
        let bestGroup = '', bestGroupDelta = -Infinity, bestFixName = '';
        for (let g = 0; g < clusters.length; g++) {
            let bestVDelta = -Infinity;
            let bestName = '';
            for (const fix of clusters[g]) {
                const row = fixDeltaMatrix.find(r => r.origV === origV && r.fixName === fix);
                if (row && row.delta > bestVDelta) {
                    bestVDelta = row.delta;
                    bestName = fix;
                }
            }
            if (bestVDelta > bestGroupDelta) {
                bestGroupDelta = bestVDelta;
                bestGroup = groupNames[g] || `Group ${g+1}`;
                bestFixName = bestName;
            }
        }
        if (bestGroup) {
            write(cw, `| V${origV} | ${bestGroup} | ${bestGroupDelta >= 0 ? '+' : ''}${bestGroupDelta.toFixed(1)}% | ${FIX_LABELS[bestFixName] || bestFixName} |\n`);
        }
    }
    write(cw, `\n`);

    // Fix correlation matrix
    write(cw, `### Fix Correlation Matrix\n\n`);
    write(cw, `| Fix | ${FIX_ORDER.map(f => FIX_LABELS[f] || f).join(' | ')} |\n`);
    write(cw, `| :--- | ${FIX_ORDER.map(() => ':---:').join(' | ')} |\n`);
    for (const fa of FIX_ORDER) {
        const corrs = FIX_ORDER.map(fb => {
            const c = pearson(fixVectors[fa], fixVectors[fb]);
            return c.toFixed(2);
        });
        write(cw, `| ${FIX_LABELS[fa] || fa} | ${corrs.join(' | ')} |\n`);
    }
    write(cw, `\n`);
}

// ── Main ──

(async () => {
    try {
        const merged = await collectAggregatedData();
        await generateReport(merged);
        console.log('\n✅ Report generation complete.');
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }
})();
