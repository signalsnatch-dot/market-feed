#!/usr/bin/env node
// reportWorker.js - Processes a batch of backtest result files and outputs pre-aggregated stats.
// Usage: node reportWorker.js <batch.json> <output.json>
//   batch.json  — JSON array of file paths to process
//   output.json — where to write aggregated JSON (file, not stdout — avoids pipe truncation)
//
// Aggregation levels:
//   L1: (version, instrument, threshold, date, confidence_bucket) → count, wins
//   L1_mafe: (version, instrument, threshold, date, mafe_bucket) → count
//   L1_mae: (version, instrument, threshold, date, mae_bucket) → count
//   L2: (version, instrument, threshold, date) → count, wins, sumPnl, sumPnlAmount, sumMafe, sumMae, sumConfidence
//   L3: (version, instrument, threshold) → count, wins, sumPnl, sumPnlAmount, sumMafe, sumMae - for compact summary

const fs = require('fs');
const path = require('path');

const versionRegex = /^V(\d+):/;

// ── Helper functions (copied from generateReport.js to keep worker self-contained) ──

const INSTRUMENT_NAMES = {
    'INE002A01018': 'Reliance Industries', 'INE040A01034': 'HDFC Bank', 'INE090A01021': 'ICICI Bank',
    'INE062A01020': 'SBI', 'INE467B01029': 'TCS', 'INE009A01021': 'Infosys (INFY)',
    'INE154A01025': 'ITC', 'INE397D01024': 'Bharti Airtel', 'INE238A01034': 'Axis Bank',
    'INE018A01030': 'L&T', 'INE081A01020': 'Tata Steel', 'INE155A01022': 'Tata Motors',
    'INE1TAE01010': 'Tata Motors (Cash)', 'INE296A01032': 'Bajaj Finance', 'INE237A01036': 'Kotak Bank',
    'INE044A01036': 'Sun Pharma', 'INE019A01038': 'JSW Steel', 'INE522F01014': 'Coal India',
    'INE423A01024': 'Adani Enterprises', 'INE742F01042': 'Adani Ports', 'INE038A01020': 'Hindalco',
    'INE437A01024': 'Apollo Hospitals', 'INE160A01022': 'PNB', 'INE114A01011': 'SAIL',
    'INE040H01021': 'SUZLON', 'INE928J01020': 'PAYTM', 'INE415G01027': 'RVNL',
    'INE053F01010': 'IRFC', 'INE202E01016': 'IREDA', 'INE257A01026': 'BHEL',
    'INE129A01025': 'GAIL', 'INE849A01020': 'TRENT',
    '538685': 'Natural Gas Future', '538686': 'Natural Gas Mini Future', '520702': 'Crude Oil Future',
    '520703': 'Crude Oil Mini Future', '464150': 'Silver Future', '471726': 'Silver Mini Future',
    '488788': 'Silver Micro Future', '568831': 'Copper Future', '568836': 'Zinc Future',
    '568833': 'Lead Future', '568830': 'Aluminium Future', '466583': 'Gold Future',
    '510764': 'Gold Mini Future', '552721': 'Gold Petal Future',
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

function getConfidenceBucket(val) {
    if (val === null || val === undefined || isNaN(val)) return null;
    if (val < 45) return '< 45';
    if (val >= 45 && val < 50) return '45-49';
    if (val >= 50 && val < 55) return '50-54';
    if (val >= 55 && val < 60) return '55-59';
    if (val >= 60 && val < 65) return '60-64';
    if (val >= 65 && val < 70) return '65-69';
    if (val >= 70 && val < 75) return '70-74';
    if (val >= 75 && val < 80) return '75-79';
    if (val >= 80 && val < 85) return '80-84';
    if (val >= 85 && val < 90) return '85-89';
    if (val >= 90 && val < 95) return '90-94';
    if (val >= 95 && val <= 100) return '95-100';
    return null;
}

function getMafeBucket(val) {
    if (val === null || val === undefined || isNaN(val)) return null;
    if (val >= 0 && val <= 20) return '0% - 20%';
    if (val > 20 && val <= 40) return '21% - 40%';
    if (val > 40 && val <= 60) return '41% - 60%';
    if (val > 60 && val <= 80) return '61% - 80%';
    if (val > 80 && val < 100) return '81% - 99%';
    if (val >= 100 && val <= 100.01) return '100% (Hit TP)';
    if (val > 100.01 && val <= 110) return '101% - 110%';
    if (val > 110 && val <= 120) return '111% - 120%';
    if (val > 120 && val <= 130) return '121% - 130%';
    if (val > 130 && val <= 140) return '131% - 140%';
    if (val > 140 && val <= 150) return '141% - 150%';
    if (val > 150 && val <= 160) return '151% - 160%';
    if (val > 160 && val <= 170) return '161% - 170%';
    if (val > 170 && val <= 180) return '171% - 180%';
    if (val > 180 && val <= 190) return '181% - 190%';
    if (val > 190 && val <= 200) return '191% - 200%';
    if (val > 200) return '> 200%';
    return null;
}

function getMaeBucket(val) {
    if (val === null || val === undefined || isNaN(val)) return null;
    if (val >= 0 && val <= 20) return '0% - 20%';
    if (val > 20 && val <= 40) return '21% - 40%';
    if (val > 40 && val <= 60) return '41% - 60%';
    if (val > 60 && val <= 80) return '61% - 80%';
    if (val > 80 && val <= 100) return '81% - 100%';
    if (val > 100 && val <= 115) return '101% - 115%';
    if (val > 115 && val <= 130) return '116% - 130%';
    if (val > 130) return '> 130%';
    return null;
}

// ── Aggregation helpers ──

function addL1(map, key, isWin) {
    if (!map.has(key)) map.set(key, { count: 0, wins: 0 });
    const e = map.get(key);
    e.count++;
    if (isWin) e.wins++;
}

function addL1Bucket(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function addL2(map, key, isWin, pnl, pnlAmount, mafe, mae, confidence) {
    if (!map.has(key)) map.set(key, { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0, sumConfidence: 0 });
    const e = map.get(key);
    e.count++;
    if (isWin) e.wins++;
    if (!isNaN(pnl)) e.sumPnl += pnl;
    if (!isNaN(pnlAmount)) e.sumPnlAmount += pnlAmount;
    if (!isNaN(mafe)) e.sumMafe += mafe;
    if (!isNaN(mae)) e.sumMae += mae;
    if (!isNaN(confidence)) e.sumConfidence += confidence;
}

function addL3(map, key, isWin, pnl, pnlAmount, mafe, mae) {
    if (!map.has(key)) map.set(key, { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0 });
    const e = map.get(key);
    e.count++;
    if (isWin) e.wins++;
    if (!isNaN(pnl)) e.sumPnl += pnl;
    if (!isNaN(pnlAmount)) e.sumPnlAmount += pnlAmount;
    if (!isNaN(mafe)) e.sumMafe += mafe;
    if (!isNaN(mae)) e.sumMae += mae;
}

function mapToObj(map) {
    const obj = {};
    for (const [k, v] of map) obj[k] = v;
    return obj;
}

// ── Main: process batch of files ──

const batchFile = process.argv[2];
const outputFile = process.argv[3];
if (!batchFile || !outputFile) {
    console.error('Usage: node reportWorker.js <batch.json> <output.json>');
    process.exit(1);
}

const fileList = JSON.parse(fs.readFileSync(batchFile, 'utf8'));

// ── Load build-version-config for p-index mapping ──
const CONFIG_PATH = path.resolve(__dirname, '..', 'build-version-config.json');
const pIndexLookup = new Map(); // "instrumentName|date|thresholdVal" → "p1".."p10"

try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    for (const entry of config) {
        const name = getInstrumentDisplayName(entry.instrument_key.replace('|', '_'));
        const staticThresholds = entry.static_thresholds;
        if (!entry.thresholds || typeof entry.thresholds !== 'object') continue;
        for (const [dateKey, pIdxOrThresholds] of Object.entries(entry.thresholds)) {
            // Convert DD/MM/YY to YYYY-MM-DD for matching
            const parts = dateKey.split('/');
            if (parts.length !== 3) continue;
            const yyyy = '20' + parts[2];
            const isoDate = `${yyyy}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;

            if (Array.isArray(pIdxOrThresholds)) {
                // Older format: array of actual threshold values → derive p-index from position
                for (let i = 0; i < pIdxOrThresholds.length; i++) {
                    const pIndex = `p${i + 1}`;
                    const key = `${name}|${isoDate}|${pIdxOrThresholds[i]}`;
                    pIndexLookup.set(key, pIndex);
                }
            } else if (typeof pIdxOrThresholds === 'number' && staticThresholds && Array.isArray(staticThresholds)) {
                // Newer format: number is the p-index (1-10), look up raw threshold from static_thresholds
                const pIdxNum = pIdxOrThresholds;
                const pIndex = `p${pIdxNum}`;
                const rawThreshold = staticThresholds[pIdxNum - 1];
                if (rawThreshold !== undefined) {
                    const key = `${name}|${isoDate}|${rawThreshold}`;
                    pIndexLookup.set(key, pIndex);
                }
            }
        }
    }
} catch (e) {
    // If config not available, p-index will be null — fallback to raw threshold
}

// Aggregation maps
const L1 = new Map();       // "version|instrument|threshold|date|confbucket" → {count, wins}
const L1_mafe = new Map();  // "version|instrument|threshold|date|mafebucket" → count
const L1_mae = new Map();   // "version|instrument|threshold|date|maebucket" → count
const L2 = new Map();       // "version|instrument|threshold|date" → {...}
const L3 = new Map();       // "version_name|instrument|threshold" → {...} (for compact summary)
const L2_candle = new Map(); // "version|instrument|candleBucket|date" → {...}
const L3_candle = new Map(); // "version_name|instrument|candleBucket" → {...}
const candleCountMap = {};    // "instrumentName|date" → candlesCount (for percentile computation)
const instRawInstrument = {}; // "instrumentName" → rawInstrument key (for mapping back)

let filesProcessed = 0;
let totalRows = 0;

for (const filePath of fileList) {
    if (!fs.existsSync(filePath)) continue;

    const fileName = path.basename(filePath);
    const match = fileName.match(/^(?:continuous|live)_(\d+)_(.+?)\.json$/);
    if (!match) continue;

    const thresholdVal = match[1];
    const rawInstrument = match[2];

    let date = 'unknown';
    const dateMatch = fileName.match(/_(\d{4}-\d{2}-\d{2})\.json$/);
    if (dateMatch) date = dateMatch[1];

    const instrumentName = getInstrumentDisplayName(rawInstrument);

    // Resolve p-index for this threshold value
    const pIdxKey = `${instrumentName}|${date}|${thresholdVal}`;
    const pIndex = pIndexLookup.get(pIdxKey) || thresholdVal; // fallback to raw threshold

    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        if (!data || !data.strategies) continue;
        filesProcessed++;

        const candlesCount = data.candlesCount || 0;

        // Store raw candlesCount for percentile computation (only if > 0)
        if (candlesCount > 0) {
            const instDateKey = `${instrumentName}|${date}`;
            candleCountMap[instDateKey] = candlesCount;
            instRawInstrument[instrumentName] = rawInstrument;
        }

        // Candle bucket: use raw count for precise labeling, or 'unknown'
        const candleBucket = candlesCount > 0 ? String(candlesCount) : null;

        for (const [stratKey, strategyData] of Object.entries(data.strategies)) {
            const vMatch = stratKey.match(versionRegex);
            if (!vMatch) continue;

            const versionName = stratKey;
            if (!strategyData || !Array.isArray(strategyData.results?.trades)) continue;

            for (const trade of strategyData.results.trades) {
                totalRows++;
                const conf = trade.confidence;
                const mafe = trade.mafePercentage;
                const mae = trade.maePercentage;
                const pnl = parseFloat(trade.pnl) || 0;
                const pnlAmount = parseFloat(trade.pnlAmount) || 0;
                const isWin = pnlAmount > 0;

                const confBucket = getConfidenceBucket(conf);
                const mafeBucket = mafe != null ? getMafeBucket(parseFloat(mafe)) : null;
                const maeBucket = mae != null ? getMaeBucket(parseFloat(mae)) : null;

                // L1: confidence distribution
                if (confBucket) {
                    const l1key = [versionName, instrumentName, pIndex, date, confBucket].join('|');
                    addL1(L1, l1key, isWin);
                }

                // L1_mafe
                if (mafeBucket) {
                    const key = [versionName, instrumentName, pIndex, date, mafeBucket].join('|');
                    addL1Bucket(L1_mafe, key);
                }

                // L1_mae
                if (maeBucket) {
                    const key = [versionName, instrumentName, pIndex, date, maeBucket].join('|');
                    addL1Bucket(L1_mae, key);
                }

                // L2: per (version, instrument, pIndex, date)
                const l2key = [versionName, instrumentName, pIndex, date].join('|');
                addL2(L2, l2key, isWin, pnl, pnlAmount, parseFloat(mafe) || 0, parseFloat(mae) || 0, !isNaN(conf) ? conf : 50);

                // L3: per (version_name, instrument, pIndex) — collapsed across dates
                const l3key = [versionName, instrumentName, pIndex].join('|');
                addL3(L3, l3key, isWin, pnl, pnlAmount, parseFloat(mafe) || 0, parseFloat(mae) || 0);

                // L2_candle: per (version, instrument, candleBucket, date)
                if (candleBucket) {
                    const l2cKey = [versionName, instrumentName, candleBucket, date].join('|');
                    addL2(L2_candle, l2cKey, isWin, pnl, pnlAmount, parseFloat(mafe) || 0, parseFloat(mae) || 0, !isNaN(conf) ? conf : 50);
                    // L3_candle: per (version_name, instrument, candleBucket)
                    const l3cKey = [versionName, instrumentName, candleBucket].join('|');
                    addL3(L3_candle, l3cKey, isWin, pnl, pnlAmount, parseFloat(mafe) || 0, parseFloat(mae) || 0);
                }
            }
        }
    } catch (e) {
        console.error(`Worker: failed to parse ${filePath}: ${e.message}`);
    }
}

// Output aggregated JSON to file (never stdout — pipe truncation with large outputs)
const output = {
    L1: mapToObj(L1),
    L1_mafe: mapToObj(L1_mafe),
    L1_mae: mapToObj(L1_mae),
    L2: mapToObj(L2),
    L3: mapToObj(L3),
    L2_candle: mapToObj(L2_candle),
    L3_candle: mapToObj(L3_candle),
    candleCountMap,
    meta: {
        filesProcessed,
        totalRows,
        batchFile
    }
};

fs.writeFileSync(outputFile, JSON.stringify(output), 'utf8');
console.error(`Worker: wrote ${Object.keys(output.L2).length} L2 combos, ${totalRows} trades to ${path.basename(outputFile)}`);
process.exit(0);
