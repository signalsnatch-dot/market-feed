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

const versionRegex = /^(?:ELITE_)?V(\d+[A-Z]?)/;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Helper functions (copied from generateReport.js to keep worker self-contained) ──
const INSTRUMENT_NAMES = {
    // Standard ISINs (Cash Equity — no expiry, unchanged)
    'INE002A01018': 'Reliance Industries', 'INE040A01034': 'HDFC Bank', 'INE090A01021': 'ICICI Bank',
    'INE062A01020': 'SBI', 'INE467B01029': 'TCS', 'INE009A01021': 'Infosys (INFY)',
    'INE154A01025': 'ITC', 'INE397D01024': 'Bharti Airtel', 'INE238A01034': 'Axis Bank',
    'INE018A01030': 'L&T', 'INE081A01020': 'Tata Steel', 'INE1TAE01010': 'Tata Motors (Cash)',
    'INE296A01032': 'Bajaj Finance', 'INE237A01036': 'Kotak Bank', 'INE044A01036': 'Sun Pharma',
    'INE019A01038': 'JSW Steel', 'INE522F01014': 'Coal India', 'INE423A01024': 'Adani Enterprises',
    'INE742F01042': 'Adani Ports', 'INE038A01020': 'Hindalco', 'INE437A01024': 'Apollo Hospitals',
    'INE160A01022': 'PNB', 'INE114A01011': 'SAIL', 'INE040H01021': 'SUZLON',
    'INE928J01020': 'PAYTM', 'INE415G01027': 'RVNL', 'INE053F01010': 'IRFC',
    'INE202E01016': 'IREDA', 'INE257A01026': 'BHEL', 'INE129A01025': 'GAIL',
    'INE849A01020': 'TRENT',

    // ── Updated November/December 2026 MCX Tokens ──
    '574319': 'Natural Gas Nov Future',        // NATURALGAS26NOVFUT
    '574320': 'Natural Gas Mini Nov Future',   // NATGASMINI26NOVFUT
    '573422': 'Crude Oil Nov Future',          // CRUDEOIL26NOVFUT
    '573423': 'Crude Oil Mini Nov Future',     // CRUDEOILM26NOVFUT
    '574826': 'Silver Nov Future',             // SILVER10026NOVFUT
    '483080': 'Silver Mini Nov Future',        // SILVERM26NOVFUT (unchanged)
    '562058': 'Silver Micro Nov Future',       // SILVERMIC26NOVFUT (unchanged)
    '578638': 'Zinc Nov Future',               // ZINC26NOVFUT
    '578635': 'Lead Nov Future',               // LEAD26NOVFUT
    '578633': 'Aluminium Nov Future',          // ALUMINIUM26NOVFUT
    '495213': 'Gold Dec Future',               // GOLD26DECFUT
    '571445': 'Gold Mini Nov Future',          // GOLDM26NOVFUT
    '574841': 'Gold Petal Nov Future',         // GOLDPETAL26NOVFUT
    '578634': 'Copper Nov Future',             // COPPER26NOVFUT (New)
    '582827': 'MCX Bulldex Nov Future',        // MCXBULLDEX26NOVFUT (New)
    '582370': 'MCX Metldex Nov Future',        // MCXMETLDEX26NOVFUT (New)
    '578639': 'Zinc Mini Nov Future',          // ZINCMINI26NOVFUT (New)
    '578632': 'Aluminium Mini Nov Future',     // ALUMINI26NOVFUT (New)
    '578636': 'Lead Mini Nov Future',          // LEADMINI26NOVFUT (New)
    '578640': 'Nickel Nov Future',             // NICKEL26NOVFUT (New)

    // ── Updated November 2026 NSE Index Tokens ──
    '61471': 'Nifty 50 Nov Future',            // NIFTY26NOVFUT
    '61466': 'Nifty Bank Nov Future',          // BANKNIFTY26NOVFUT
    '61469': 'Fin Nifty Nov Future',           // FINNIFTY26NOVFUT
    '61470': 'Midcap Nifty Nov Future',        // MIDCPNIFTY26NOVFUT
    '61473': 'Nifty Next 50 Nov Future',       // NIFTYNXT5026NOVFUT (New)

    // ── Updated November 2026 NSE Stock Tokens ──
    '61697': 'Reliance Nov Future',            // RELIANCE26NOVFUT
    '61582': 'HDFC Bank Nov Future',           // HDFCBANK26NOVFUT
    '61595': 'ICICI Bank Nov Future',          // ICICIBANK26NOVFUT
    '61706': 'SBI Nov Future',                 // SBIN26NOVFUT
    '61724': 'TCS Nov Future',                 // TCS26NOVFUT
    '61608': 'Infosys Nov Future',             // INFY26NOVFUT
    '61615': 'ITC Nov Future',                 // ITC26NOVFUT
    '61515': 'Bharti Airtel Nov Future',       // BHARTIARTL26NOVFUT
    '61504': 'Axis Bank Nov Future',           // AXISBANK26NOVFUT
    '61633': 'L&T Nov Future',                 // LT26NOVFUT
    '61723': 'Tata Steel Nov Future',          // TATASTEEL26NOVFUT
    '61730': 'Tata Motors Nov Future',         // TMPV26NOVFUT
    '61507': 'Bajaj Finance Nov Future',       // BAJFINANCE26NOVFUT
    '61627': 'Kotak Bank Nov Future',          // KOTAKBANK26NOVFUT
    '61713': 'Sun Pharma Nov Future',          // SUNPHARMA26NOVFUT
    '61619': 'JSW Steel Nov Future',           // JSWSTEEL26NOVFUT
    '61540': 'Coal India Nov Future',          // COALINDIA26NOVFUT
    '61478': 'Adani Enterprises Nov Future',   // ADANIENT26NOVFUT
    '61480': 'Adani Ports Nov Future',         // ADANIPORTS26NOVFUT
    '61585': 'Hindalco Nov Future',            // HINDALCO26NOVFUT
    '61487': 'Apollo Hospitals Nov Future',    // APOLLOHOSP26NOVFUT
    '61682': 'PNB Nov Future',                 // PNB26NOVFUT
    '61702': 'SAIL Nov Future',                // SAIL26NOVFUT
    '61715': 'SUZLON Nov Future',              // SUZLON26NOVFUT
    '61674': 'PAYTM Nov Future',               // PAYTM26NOVFUT
    '61698': 'RVNL Nov Future',                // RVNL26NOVFUT
    '61614': 'IRFC Nov Future',                // IRFC26NOVFUT
    '61613': 'IREDA Nov Future',               // IREDA26NOVFUT
    '61516': 'BHEL Nov Future',                // BHEL26NOVFUT
    '61569': 'GAIL Nov Future',                // GAIL26NOVFUT
    '61732': 'TRENT Nov Future',               // TRENT26NOVFUT

    // ── Newly Added NSE Stock Futures (22 additions) ──
    '61591': 'Hindustan Unilever Nov Future',  // HINDUNILVR26NOVFUT
    '61644': 'Maruti Nov Future',              // MARUTI26NOVFUT
    '61637': 'M&M Nov Future',                 // M&M26NOVFUT
    '61729': 'Titan Nov Future',               // TITAN26NOVFUT
    '61722': 'Tata Power Nov Future',          // TATAPOWER26NOVFUT
    '61736': 'UltraTech Cement Nov Future',    // ULTRACEMCO26NOVFUT
    '61580': 'HCL Tech Nov Future',            // HCLTECH26NOVFUT
    '61725': 'Tech Mahindra Nov Future',       // TECHM26NOVFUT
    '61512': 'BEL Nov Future',                 // BEL26NOVFUT
    '61578': 'HAL Nov Future',                 // HAL26NOVFUT
    '61664': 'NTPC Nov Future',                // NTPC26NOVFUT
    '61669': 'ONGC Nov Future',                // ONGC26NOVFUT
    '61690': 'Power Grid Nov Future',          // POWERGRID26NOVFUT
    '61523': 'BPCL Nov Future',                // BPCL26NOVFUT
    '61612': 'IOC Nov Future',                 // IOC26NOVFUT
    '61742': 'Vedanta Nov Future',             // VEDL26NOVFUT
    '61689': 'Polycab Nov Future',             // POLYCAB26NOVFUT
    '61561': 'DLF Nov Future',                 // DLF26NOVFUT
    '61603': 'IndiGo Nov Future',              // INDIGO26NOVFUT
    '61741': 'Varun Beverages Nov Future',     // VBL26NOVFUT
    '61509': 'Bank of Baroda Nov Future',      // BANKBARODA26NOVFUT
    '61564': 'Eicher Motors Nov Future'        // EICHERMOT26NOVFUT
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

function addL2(map, key, isWin, pnl, pnlAmount, mafe, mae, confidence, rrr) {
    if (!map.has(key)) map.set(key, { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0, sumConfidence: 0, sumRRR: 0 });
    const e = map.get(key);
    e.count++;
    if (isWin) e.wins++;
    if (!isNaN(pnl)) e.sumPnl += pnl;
    if (!isNaN(pnlAmount)) e.sumPnlAmount += pnlAmount;
    if (!isNaN(mafe)) e.sumMafe += mafe;
    if (!isNaN(mae)) e.sumMae += mae;
    if (!isNaN(confidence)) e.sumConfidence += confidence;
    if (!isNaN(rrr)) e.sumRRR += rrr;
}

function addL3(map, key, isWin, pnl, pnlAmount, mafe, mae, rrr) {
    if (!map.has(key)) map.set(key, { count: 0, wins: 0, sumPnl: 0, sumPnlAmount: 0, sumMafe: 0, sumMae: 0, sumRRR: 0 });
    const e = map.get(key);
    e.count++;
    if (isWin) e.wins++;
    if (!isNaN(pnl)) e.sumPnl += pnl;
    if (!isNaN(pnlAmount)) e.sumPnlAmount += pnlAmount;
    if (!isNaN(mafe)) e.sumMafe += mafe;
    if (!isNaN(mae)) e.sumMae += mae;
    if (!isNaN(rrr)) e.sumRRR += rrr;
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
// Structure: pIndexLookup["instrumentName|date"] → [{threshold, pIndex}, ...]
// Uses numeric matching with tolerance to handle floating point precision issues
const pIndexLookup = new Map();

/**
 * Resolves a p-index for a given (instrument, date, threshold) tuple using
 * numeric comparison with tolerance. This handles floating point imprecision
 * where the backtester's computed threshold might be 48833.00000000001 while
 * the config stores 48833.
 *
 * @param {string} lookupKey - "instrumentName|date|thresholdVal" key.
 *    If this matches exactly in the Map (for already-normalized thresholds), returns immediately.
 * @param {number} rawThreshold - numeric threshold to fall back to for numeric comparison.
 * @returns {string} p-index ("p1"..."p10") or the raw threshold as string if not found.
 */
function resolvePIndex(lookupKey, rawThreshold) {
    // Try exact match first (works when the threshold value is a clean integer or exact float)
    if (pIndexLookup.has(lookupKey)) {
        return pIndexLookup.get(lookupKey);
    }

    // Parse the key to get instrumentName, date for fallback numeric lookup
    const parts = lookupKey.split('|');
    if (parts.length < 3) return String(rawThreshold);

    // Build the instrument-date key for the numeric lookup table
    const instDateKey = `${parts[0]}|${parts[1]}`;
    const numericEntries = pIndexLookup.get(instDateKey + '|__NUMERIC__');
    if (!numericEntries || !Array.isArray(numericEntries)) return String(rawThreshold);

    // Numeric comparison with tolerance (0.1% relative tolerance)
    const numericThreshold = Number(rawThreshold);
    if (isNaN(numericThreshold)) return String(rawThreshold);

    const tolerance = Math.max(0.001, Math.abs(numericThreshold) * 0.001);
    for (const entry of numericEntries) {
        if (Math.abs(entry.threshold - numericThreshold) < tolerance) {
            return entry.pIndex;
        }
    }

    return String(rawThreshold); // Fallback to raw threshold
}

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
            const instDateKey = `${name}|${isoDate}`;

            if (Array.isArray(pIdxOrThresholds)) {
                // NEW format: date → array of actual threshold values → derive p-index from position
                // Build a numeric lookup table for this instrument-date combo
                const numericEntries = [];
                for (let i = 0; i < pIdxOrThresholds.length; i++) {
                    // Also add exact string key for integer thresholds
                    const thresholdVal = pIdxOrThresholds[i];
                    const exactKey = `${instDateKey}|${thresholdVal}`;
                    pIndexLookup.set(exactKey, `p${i + 1}`);
                    numericEntries.push({ threshold: thresholdVal, pIndex: `p${i + 1}` });
                }
                pIndexLookup.set(`${instDateKey}|__NUMERIC__`, numericEntries);
            } else if (typeof pIdxOrThresholds === 'number' && staticThresholds && Array.isArray(staticThresholds)) {
                // LEGACY format: p-index → look up raw threshold from static_thresholds
                const pIdxNum = pIdxOrThresholds;
                const rawThreshold = staticThresholds[pIdxNum - 1];
                if (rawThreshold !== undefined) {
                    const key = `${instDateKey}|${rawThreshold}`;
                    pIndexLookup.set(key, `p${pIdxNum}`);
                    // Also add numeric fallback
                    pIndexLookup.set(`${instDateKey}|__NUMERIC__`, [{ threshold: rawThreshold, pIndex: `p${pIdxNum}` }]);
                }
            }
        }
    }
} catch (e) {
    // If config not available, p-index will fall back to raw threshold
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
const L_Time = new Map(); // "version|instrument|pIndex|day|hour" -> metrics


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

    // Resolve p-index for this threshold value (with numeric tolerance for floating point)
    const pIdxKey = `${instrumentName}|${date}|${thresholdVal}`;
    const pIndex = resolvePIndex(pIdxKey, thresholdVal);

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
                const mafe = parseFloat(trade.mafePercentage) || 0;
                const mae = parseFloat(trade.maePercentage) || 0;
                const pnl = parseFloat(trade.pnl) || 0;
                const pnlAmount = parseFloat(trade.pnlAmount) || 0;
                const isWin = pnlAmount > 0;
                const rrr = trade.rrr != null ? parseFloat(trade.rrr) : 0;

                // ── NEW: IST TIME & DAY CALCULATION --    
                // ── NEW: IST TIME & DAY CALCULATION ──
                let epoch = trade.entry_time || trade.timestamp || trade.time;
                if (epoch) {
                    // Ensure epoch is a number
                    let timestamp = Number(epoch);
                    // Normalize to milliseconds if in seconds (10 digits)
                    if (timestamp < 10000000000) timestamp *= 1000;
                    
                    const dateObj = new Date(timestamp);
                    // IST = UTC + 5.5 hours
                    const istDate = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));
                    
                    // Use UTC methods on the offset-date to get the correct IST day/hour
                    const day = DAYS[istDate.getUTCDay()];
                    const hour = istDate.getUTCHours();

                    // Key index 0:Version, 1:Instrument, 2:pIndex, 3:Day, 4:Hour
                    const timeKey = [versionName, instrumentName, pIndex, day, hour].join('|');
                    addL2(L_Time, timeKey, isWin, pnl, parseFloat(trade.pnlAmount)||0, parseFloat(trade.mafePercentage)||0, parseFloat(trade.maePercentage)||0, !isNaN(trade.confidence)?trade.confidence:50, parseFloat(trade.rrr)||0);
                }

                // ── EXISTING LOGIC (Preserved) ──
                const confBucket = getConfidenceBucket(conf);
                const mafeBucket = mafe != null ? getMafeBucket(mafe) : null;
                const maeBucket = mae != null ? getMaeBucket(mae) : null;

                if (confBucket) {
                    addL1(L1, [versionName, instrumentName, pIndex, date, confBucket].join('|'), isWin);
                }
                if (mafeBucket) {
                    addL1Bucket(L1_mafe, [versionName, instrumentName, pIndex, date, mafeBucket].join('|'));
                }
                if (maeBucket) {
                    addL1Bucket(L1_mae, [versionName, instrumentName, pIndex, date, maeBucket].join('|'));
                }

                const l2key = [versionName, instrumentName, pIndex, date].join('|');
                addL2(L2, l2key, isWin, pnl, pnlAmount, mafe, mae, !isNaN(conf) ? conf : 50, rrr);

                const l3key = [versionName, instrumentName, pIndex].join('|');
                addL3(L3, l3key, isWin, pnl, pnlAmount, mafe, mae, rrr);

                if (candleBucket) {
                    const l3cKey = [versionName, instrumentName, candleBucket].join('|');
                    addL3(L3_candle, l3cKey, isWin, pnl, pnlAmount, mafe, mae, rrr);
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
    L3_candle: mapToObj(L3_candle),
    L_Time: mapToObj(L_Time), // Add this
    candleCountMap,
    meta: { filesProcessed, totalRows, batchFile }
};

fs.writeFileSync(outputFile, JSON.stringify(output), 'utf8');
console.error(`Worker: wrote ${Object.keys(output.L2).length} L2 combos, ${totalRows} trades to ${path.basename(outputFile)}`);
process.exit(0);
