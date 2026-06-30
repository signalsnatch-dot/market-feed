const fs = require('fs');
const path = require('path');

// --- User Configurations ---
const DATA_URL = 'http://13.201.36.159:8000/candles_data/signals_today_2026-06-30.json'; 
const OUTPUT_DIR = './live-performance-report';

const startTime = '15:45'; // Session Start (HH:MM in 24h IST format)
const endTime = '23:55';   // Session End (HH:MM in 24h IST format). Set to null to use current time.

// Matches any V1 to V43 strategy
const versionRegex =  /^V([1-9]|[1-4]\d|50):/;

const confidenceVersions = [
    'V3: High Confidence', 
    'V8: High Confidence (Strict)', 
    'V13: High Confidence (Calibrated)', 
    'V18: High Confidence (Strict-Calibrated)',
    'V21: 65-70% confidence of V3',
    'V22: More than 80% confidence of V3',
    'V23: 65-70% and More than 80% confidence of V3',
    'V24: 65-70% confidence of V8',
    'V25: More than 80% confidence of V8',
    'V26: 65-70% and More than 80% confidence of V8',
    'V27: 65-70% confidence of V13',
    'V28: More than 80% confidence of V13',
    'V29: 65-70% and More than 80% confidence of V13',
    'V30: 65-70% confidence of V18',
    'V31: More than 80% confidence of V18',
    'V32: 65-70% and More than 80% confidence of V18',
    'V35: High Confidence (Structural-Calibrated)',
    'V40: High Confidence (Strict Structural-Calibrated)',
    'V43: 65-70% and More than 80% confidence of V35'
];
const INSTRUMENT_NAMES = {
    // Standard ISINs mapped directly to Stock Names
    'INE002A01018': 'Reliance Industries',
    'INE040A01034': 'HDFC Bank',
    'INE090A01021': 'ICICI Bank',
    'INE062A01020': 'SBI',
    'INE467B01029': 'TCS',
    'INE009A01021': 'Infosys (INFY)',
    'INE154A01025': 'ITC',
    'INE397D01024': 'Bharti Airtel',
    'INE238A01034': 'Axis Bank',
    'INE018A01030': 'L&T',
    'INE081A01020': 'Tata Steel',
    'INE155A01022': 'Tata Motors',
    'INE1TAE01010': 'Tata Motors (Cash)',
    'INE296A01032': 'Bajaj Finance',
    'INE237A01036': 'Kotak Bank',
    'INE044A01036': 'Sun Pharma',
    'INE019A01038': 'JSW Steel',
    'INE522F01014': 'Coal India',
    'INE423A01024': 'Adani Enterprises',
    'INE742F01042': 'Adani Ports',
    'INE038A01020': 'Hindalco',
    'INE437A01024': 'Apollo Hospitals',
    'INE160A01022': 'PNB',
    'INE114A01011': 'SAIL',
    'INE040H01021': 'SUZLON',
    'INE928J01020': 'PAYTM',
    'INE415G01027': 'RVNL',
    'INE053F01010': 'IRFC',
    'INE202E01016': 'IREDA',
    'INE257A01026': 'BHEL',
    'INE129A01025': 'GAIL',
    'INE849A01020': 'TRENT',

    // F&O Segment-Level Numerical Tokens mapped directly to contract names
    '538685': 'Natural Gas Future',
    '538686': 'Natural Gas Mini Future',
    '520702': 'Crude Oil Future',
    '520703': 'Crude Oil Mini Future',
    '464150': 'Silver Future',
    '471726': 'Silver Mini Future',
    '488788': 'Silver Micro Future',
    '568831': 'Copper Future',
    '568836': 'Zinc Future',
    '568833': 'Lead Future',
    '568830': 'Aluminium Future',
    '466583': 'Gold Future',
    '510764': 'Gold Mini Future',
    '552721': 'Gold Petal Future',
    '61093': 'Nifty 50 Future',
    '61088': 'Nifty Bank Future',
    '61091': 'Fin Nifty Future',
    '61092': 'Midcap Nifty Future',
    '61284': 'Reliance Future',
    '61189': 'HDFC Bank Future',
    '61197': 'ICICI Bank Future',
    '61289': 'SBI Future',
    '61304': 'TCS Future',
    '61209': 'Infosys Future',
    '61216': 'ITC Future',
    '61127': 'Bharti Airtel Future',
    '61114': 'Axis Bank Future',
    '61232': 'L&T Future',
    '61303': 'Tata Steel Future',
    '61235': 'Tata Motors Future',
    '61118': 'Bajaj Finance Future',
    '61226': 'Kotak Bank Future',
    '61296': 'Sun Pharma Future',
    '61220': 'JSW Steel Future',
    '61143': 'Coal India Future',
    '61099': 'Adani Enterprises Future',
    '61101': 'Adani Ports Future',
    '61192': 'Hindalco Future',
    '61108': 'Apollo Hospitals Future',
    '61274': 'PNB Future',
    '61286': 'SAIL Future',
    '61298': 'SUZLON Future',
    '61265': 'PAYTM Future',
    '61285': 'RVNL Future',
    '61215': 'IRFC Future',
    '61214': 'IREDA Future',
    '61128': 'BHEL Future',
    '61170': 'GAIL Future',
    '61310': 'TRENT Future',

    // Legacy Support Keys
    '552706': 'Aluminium (MCX)',
    '552709': 'Lead (MCX)',
    '552708': 'Copper (MCX)',
    '552711': 'Zinc (MCX)',
    '464151': 'Silver Mini (MCX)',
    '477177': 'Silver Micro (MCX)',
    '510464': 'Gold Petal (MCX)',
    '62326': 'Bank Nifty',
    '62329': 'Nifty 50',
    '62328': 'Midcap Nifty',
    '62327': 'Fin Nifty'
};

// Strict non-overlapping confidence buckets
const confidenceBuckets = [
    '< 45', '45-49', '50-54', '55-59', '60-64', '65-69', 
    '70-74', '75-79', '80-84', '85-89', '90-94', '95-100'
];

// Refined non-overlapping MAFE buckets extended up to and beyond 200%
const mafeBuckets = [
    '0% - 20%', '21% - 40%', '41% - 60%', '61% - 80%', '81% - 99%', 
    '100% (Hit TP)', '101% - 110%', '111% - 120%', '121% - 130%', 
    '131% - 140%', '141% - 150%', '151% - 160%', '161% - 170%', 
    '171% - 180%', '181% - 190%', '191% - 200%', '> 200%'
];

// Strict non-overlapping MAE buckets
const maeBuckets = [
    '0% - 20%', '21% - 40%', '41% - 60%', '61% - 80%', 
    '81% - 100%', '101% - 115%', '116% - 130%', '> 130%'
];

// Flat Trade Store
const flatTrades = [];

// --- Helper Functions ---

function getFormattedTimestamp() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}`;
}

function getInstrumentDisplayName(rawInstrument) {
    for (const [key, value] of Object.entries(INSTRUMENT_NAMES)) {
        if (rawInstrument.includes(key)) return value;
    }
    return rawInstrument.replace(/_raw_ticks$/, '');
}

function normalizeTimestamp(ts) {
    if (!ts) return null;
    return ts < 99999999999 ? ts * 1000 : ts;
}

function getDateString(timestamp) {
    const ms = normalizeTimestamp(timestamp);
    if (!ms) return 'N/A';
    try {
        return new Date(ms).toISOString().split('T')[0];
    } catch (e) {
        return 'N/A';
    }
}

function getCurrentISTTime() {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    return `${hour}:${minute}`;
}

function timeToMinutes(timeStr) {
    const [hh, mm] = timeStr.split(':').map(Number);
    return hh * 60 + mm;
}

function isTimeInWindow(timestamp, startStr, endStr) {
    const ms = normalizeTimestamp(timestamp);
    if (!ms) return false;
    
    const date = new Date(ms);
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    
    const tradeMinutes = hour * 60 + minute;
    const startMinutes = timeToMinutes(startStr);
    const endMinutes = timeToMinutes(endStr);
    
    return tradeMinutes >= startMinutes && tradeMinutes <= endMinutes;
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

function parseSignalToTrade(signal) {
    const isCompleted = signal.status === 'completed';
    
    let pnlPercentage = signal.pnlPercentage;
    if ((pnlPercentage === undefined || pnlPercentage === null) && isCompleted && signal.entry && signal.exitPrice) {
        const isBuy = signal.type.toUpperCase().includes('BUY');
        const isSell = signal.type.toUpperCase().includes('SELL');
        if (isBuy) {
            pnlPercentage = ((signal.exitPrice - signal.entry) / signal.entry) * 100;
        } else if (isSell) {
            pnlPercentage = ((signal.entry - signal.exitPrice) / signal.entry) * 100;
        }
    }
    pnlPercentage = parseFloat(pnlPercentage) || 0;

    return {
        ...signal,
        pnlPercentage,
        pnlAmount: signal.pnlAmount !== undefined ? parseFloat(signal.pnlAmount) : pnlPercentage,
        maePercentage: signal.maePercentage !== undefined ? parseFloat(signal.maePercentage) : null,
        mafePercentage: signal.mafePercentage !== undefined ? parseFloat(signal.mafePercentage) : null
    };
}

function computeMetrics(tradesList) {
    const totalTrades = tradesList.length;
    if (totalTrades === 0) {
        return { totalTrades: 0, winRate: 0, totalReturn: 0, avgReturn: 0, avgMafe: 0, avgMae: 0 };
    }
    const wins = tradesList.filter(t => t.pnlPercentage > 0).length;
    const winRate = (wins / totalTrades) * 100;
    const totalReturn = tradesList.reduce((sum, t) => sum + (t.pnlPercentage || 0), 0);
    const avgReturn = totalReturn / totalTrades;

    const validMafe = tradesList.filter(t => t.mafePercentage !== undefined && t.mafePercentage !== null);
    const avgMafe = validMafe.length > 0 
        ? validMafe.reduce((sum, t) => sum + parseFloat(t.mafePercentage), 0) / validMafe.length 
        : 0;

    const validMae = tradesList.filter(t => t.maePercentage !== undefined && t.maePercentage !== null);
    const avgMae = validMae.length > 0 
        ? validMae.reduce((sum, t) => sum + parseFloat(t.maePercentage), 0) / validMae.length 
        : 0;

    return { totalTrades, winRate, totalReturn, avgReturn, avgMafe, avgMae };
}

// --- Dynamic Table Builder Functions ---

function buildConfidenceTable(tradesList) {
    let out = `| Confidence Bucket | Number of Trades | Win Rate % | Total Return % | Avg Return per Trade % |\n`;
    out += `| :--- | :---: | :---: | :---: | :---: |\n`;
    confidenceBuckets.forEach(b => {
        const bTrades = tradesList.filter(t => getConfidenceBucket(t.trade.confidence) === b);
        const bm = computeMetrics(bTrades.map(t => t.trade));
        out += `| **${b}** | ${bm.totalTrades} | ${bm.winRate.toFixed(2)}% | ${bm.totalReturn >= 0 ? '+' : ''}${bm.totalReturn.toFixed(2)}% | ${bm.avgReturn >= 0 ? '+' : ''}${bm.avgReturn.toFixed(3)}% |\n`;
    });
    out += `\n`;
    return out;
}

function buildMaeMafeTables(tradesList) {
    let out = `*MAFE Closeness-to-TP Distribution:*\n`;
    out += `| MAFE Bucket | Trade Count | Win Rate % | Avg Return % |\n`;
    out += `| :--- | :---: | :---: | :---: |\n`;
    mafeBuckets.forEach(b => {
        const bucketTrades = tradesList.filter(t => getMafeBucket(t.trade.mafePercentage) === b);
        const m = computeMetrics(bucketTrades.map(t => t.trade));
        out += `| **${b}** | ${m.totalTrades} | ${m.winRate.toFixed(2)}% | ${m.avgReturn >= 0 ? '+' : ''}${m.avgReturn.toFixed(3)}% |\n`;
    });
    out += `\n`;

    out += `*MAE Drawdown Distribution:*\n`;
    out += `| MAE Bucket | Trade Count | Win Rate % | Avg Return % |\n`;
    out += `| :--- | :---: | :---: | :---: |\n`;
    maeBuckets.forEach(b => {
        const bucketTrades = tradesList.filter(t => getMaeBucket(t.trade.maePercentage) === b);
        const m = computeMetrics(bucketTrades.map(t => t.trade));
        out += `| **${b}** | ${m.totalTrades} | ${m.winRate.toFixed(2)}% | ${m.avgReturn >= 0 ? '+' : ''}${m.avgReturn.toFixed(3)}% |\n`;
    });
    out += `\n`;
    return out;
}

function renderPerformanceSummary(trades, title, hasMaeMafe) {
    const m = computeMetrics(trades.map(t => t.trade));
    let out = `#### **${title}**\n`;
    if (m.totalTrades === 0) {
        return out + `* No active trades recorded under this classification during this period.\n\n`;
    }
    out += `*   **Total Trades:** ${m.totalTrades}\n`;
    out += `*   **Win Rate:** ${m.winRate.toFixed(2)}%\n`;
    out += `*   **Cumulative Return:** ${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn.toFixed(2)}%\n`;
    out += `*   **Avg. Trade Return:** ${m.avgReturn >= 0 ? '+' : ''}${m.avgReturn.toFixed(3)}%\n`;
    if (hasMaeMafe) {
        out += `*   **Average MAFE:** ${m.avgMafe.toFixed(2)}%\n`;
        out += `*   **Average MAE:** ${m.avgMae.toFixed(2)}%\n`;
    }
    out += `\n`;
    return out;
}

const getRankingsMarkdown = (trades, label) => {
    if (trades.length === 0) return `*No ${label} trades recorded to build rankings.*\n\n`;
    
    const versions = [...new Set(trades.map(t => t.strategy))];
    const rankings = versions.map(v => {
        const vTrades = trades.filter(t => t.strategy === v);
        const m = computeMetrics(vTrades.map(t => t.trade));
        return { name: v, ...m };
    });

    const top = [...rankings].sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 3);
    const bottom = [...rankings].sort((a, b) => a.totalReturn - b.totalReturn).slice(0, 3);

    let output = `#### **${label} Rankings**\n`;
    output += `##### **Top Strategy Versions (Cumulative Return)**\n`;
    top.forEach((v, index) => {
        output += `${index + 1}. **${v.name}**: Total Return: **${v.totalReturn.toFixed(2)}%** | Win Rate: **${v.winRate.toFixed(2)}%** (${v.totalTrades} Trades)\n`;
    });
    output += `\n##### **Bottom Strategy Versions (Cumulative Return)**\n`;
    bottom.forEach((v, index) => {
        output += `${index + 1}. **${v.name}**: Total Return: **${v.totalReturn.toFixed(2)}%** | Win Rate: **${v.winRate.toFixed(2)}%** (${v.totalTrades} Trades)\n`;
    });
    output += `\n`;
    return output;
};

// --- Main Execution Block ---

async function main() {
    try {
        console.log(`Fetching live trade objects from: ${DATA_URL}`);
        
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP fetch failed with status: ${response.status}`);
        }
        
        let data = await response.json();
        if (!Array.isArray(data)) {
            data = [data];
        }

        const resolvedEndTime = endTime || getCurrentISTTime();
        console.log(`Applying IST session filter: ${startTime} to ${resolvedEndTime}`);

        data.forEach(signal => {
            if (!signal || !signal.version) return;

            // Only process completed trades; skip active, pending, or cancelled signals
            if (signal.status !== 'completed') return;

            const vMatch = signal.version.match(versionRegex);
            if (!vMatch) return;

            // Apply session time window filter aligned to IST
            if (!isTimeInWindow(signal.timestamp, startTime, resolvedEndTime)) {
                return;
            }

            const versionNum = parseInt(vMatch[1], 10);
            const trade = parseSignalToTrade(signal);
            const instrumentName = getInstrumentDisplayName(signal.instrument || signal.name || '');
            const threshold = signal.threshold || signal.volumePerBar || 'N/A';
            const date = getDateString(signal.timestamp);
            const barType = signal.bar_type || 'volume';

            flatTrades.push({
                trade,
                strategy: signal.version,
                versionNum,
                instrument: instrumentName,
                threshold,
                date,
                barType
            });
        });

        if (flatTrades.length === 0) {
            console.log("No valid live signals matching the selected status and session parameters were found.");
            process.exit(0);
        }

        console.log(`Processing ${flatTrades.length} trades within the session window...`);

        // Check if MAE/MAFE metric details are present across any of the trade items
        const hasMaeMafe = flatTrades.some(t => 
            (t.trade.maePercentage !== undefined && t.trade.maePercentage !== null) ||
            (t.trade.mafePercentage !== undefined && t.trade.mafePercentage !== null)
        );

        const uniqueVersions = [...new Set(flatTrades.map(t => t.strategy))].sort((a,b) => {
            const numA = parseInt(a.match(versionRegex)?.[1] || 0, 10);
            const numB = parseInt(b.match(versionRegex)?.[1] || 0, 10);
            return numA - numB;
        });

        const uniqueInstruments = [...new Set(flatTrades.map(t => t.instrument))].sort();
        const uniqueDates = [...new Set(flatTrades.map(t => t.date))].sort();

        // --- Compile Markdown Report Content ---

        let md = `# Portfolio Live Signals Performance Report\n\n`;
        md += `*Report Generated on (Local): ${new Date().toLocaleString()}*\n`;
        md += `*Session Filtering Window (IST):* ${startTime} to ${resolvedEndTime}\n`;
        md += `*Analyzed Period Range:* ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}\n\n`;

        // ============================================================
        // SECTION 1: EXECUTIVE SUMMARY (SPLIT BY BAR TYPE)
        // ============================================================
        md += `## Section 1: Executive Summary\n\n`;

        const volumeTrades = flatTrades.filter(t => t.barType === 'volume');
        const priceTrades = flatTrades.filter(t => t.barType === 'price');

        md += `### **System-Wide Performance Summary**\n\n`;
        md += renderPerformanceSummary(volumeTrades, "Volume-Bar Systems Cumulative Metrics", hasMaeMafe);
        md += renderPerformanceSummary(priceTrades, "Price-Bar Systems Cumulative Metrics", hasMaeMafe);

        md += `### **Strategy Rankings**\n\n`;
        md += getRankingsMarkdown(volumeTrades, "Volume-Bar Systems");
        md += getRankingsMarkdown(priceTrades, "Price-Bar Systems");

        // ============================================================
        // SECTION 2: DETAILED VERSION PERFORMANCE (SPLIT BY BAR TYPE)
        // ============================================================
        md += `## Section 2: Detailed Performance by Strategy Version (V1 to V43)\n\n`;

        uniqueVersions.forEach(v => {
            const vTrades = flatTrades.filter(t => t.strategy === v);
            md += `### **${v} Detailed Breakdown**\n\n`;

            const vVolume = vTrades.filter(t => t.barType === 'volume');
            const vPrice = vTrades.filter(t => t.barType === 'price');

            const renderDetailedBlock = (trades, typeLabel) => {
                const m = computeMetrics(trades.map(t => t.trade));
                let block = `#### **${typeLabel} Analysis**\n`;
                if (m.totalTrades === 0) {
                    return block + `*No ${typeLabel.toLowerCase()} trades completed for this strategy.*\n\n`;
                }
                block += `*   **Cumulative Trades:** ${m.totalTrades}\n`;
                block += `*   **Cumulative Win Rate:** ${m.winRate.toFixed(2)}%\n`;
                block += `*   **Cumulative Total Return:** ${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn.toFixed(2)}%\n`;
                block += `*   **Cumulative Avg. Return per Trade:** ${m.avgReturn >= 0 ? '+' : ''}${m.avgReturn.toFixed(3)}%\n`;
                if (hasMaeMafe) {
                    block += `*   **Cumulative Average MAFE:** ${m.avgMafe.toFixed(2)}%\n`;
                    block += `*   **Cumulative Average MAE:** ${m.avgMae.toFixed(2)}%\n`;
                }
                block += `\n`;

                const pairs = [...new Set(trades.map(t => `${t.instrument} (Threshold ${t.threshold})`))].sort();
                block += `##### **Asset & Threshold Breakdowns:**\n`;
                pairs.forEach(pair => {
                    const pairTrades = trades.filter(t => `${t.instrument} (Threshold ${t.threshold})` === pair);
                    const pm = computeMetrics(pairTrades.map(t => t.trade));

                    block += `*   **${pair}**: ${pm.totalTrades} Trades | Win Rate: ${pm.winRate.toFixed(2)}% | Return: ${pm.totalReturn >= 0 ? '+' : ''}${pm.totalReturn.toFixed(2)}%`;
                    if (hasMaeMafe) {
                        block += ` | MAFE: ${pm.avgMafe.toFixed(1)}% | MAE: ${pm.avgMae.toFixed(1)}%`;
                    }
                    block += `\n`;

                    const pairDates = [...new Set(pairTrades.map(t => t.date))].sort();
                    if (pairDates.length > 1) {
                        pairDates.forEach(d => {
                            const dtTrades = pairTrades.filter(t => t.date === d);
                            const dm = computeMetrics(dtTrades.map(t => t.trade));
                            block += `    *   **${d}**: ${dm.totalTrades} Trades | Win Rate: ${dm.winRate.toFixed(1)}% | Return: ${dm.totalReturn >= 0 ? '+' : ''}${dm.totalReturn.toFixed(2)}%\n`;
                        });
                    }
                });
                block += `\n`;
                return block;
            };

            md += renderDetailedBlock(vVolume, "Volume-Bar");
            md += renderDetailedBlock(vPrice, "Price-Bar");
            md += `---\n\n`;
        });

        // ============================================================
        // SECTION 3: CONFIDENCE DISTRIBUTION (SPLIT BY BAR TYPE)
        // ============================================================
        md += `## Section 3: Confidence Distribution Analysis\n\n`;

        confidenceVersions.forEach(v => {
            const vTrades = flatTrades.filter(t => t.strategy === v);
            if (vTrades.length === 0) return;

            md += `### **${v} Confidence Distributions**\n\n`;
            
            const vVolume = vTrades.filter(t => t.barType === 'volume');
            const vPrice = vTrades.filter(t => t.barType === 'price');

            const renderConfidenceBlock = (trades, label) => {
                let block = `#### **${label} Confidence Spread**\n`;
                if (trades.length === 0) {
                    return block + `*No completed ${label.toLowerCase()} trades found.* \n\n`;
                }
                block += buildConfidenceTable(trades);
                
                const vInsts = [...new Set(trades.map(t => t.instrument))].sort();
                vInsts.forEach(inst => {
                    const instTrades = trades.filter(t => t.instrument === inst);
                    block += `##### **${inst} Confidence Distribution (${label})**\n`;
                    block += buildConfidenceTable(instTrades);
                });
                return block;
            };

            md += renderConfidenceBlock(vVolume, "Volume-Bar");
            md += renderConfidenceBlock(vPrice, "Price-Bar");
            md += `---\n\n`;
        });

        // ============================================================
        // SECTION 4: MAE AND MAFE DISTRIBUTIONS (CONDITIONAL & SPLIT)
        // ============================================================
        if (hasMaeMafe) {
            md += `## Section 4: Lifecycle MAE and MAFE Distribution Analysis\n\n`;

            md += `### **Overall Global Portfolio-Wide Distributions**\n\n`;
            
            md += `#### **Volume-Bar Performance Distributions**\n\n`;
            md += buildMaeMafeTables(volumeTrades);

            md += `#### **Price-Bar Performance Distributions**\n\n`;
            md += buildMaeMafeTables(priceTrades);
            md += `---\n\n`;

            md += `### **MAE/MAFE Distributions By Strategy Version**\n\n`;
            uniqueVersions.forEach(v => {
                const vTrades = flatTrades.filter(t => t.strategy === v);
                md += `### **${v} MAE/MAFE Distributions**\n\n`;

                const vVolume = vTrades.filter(t => t.barType === 'volume');
                const vPrice = vTrades.filter(t => t.barType === 'price');

                if (vVolume.length > 0) {
                    md += `#### **Volume-Bar Cumulative Distributions**\n\n`;
                    md += buildMaeMafeTables(vVolume);
                }
                if (vPrice.length > 0) {
                    md += `#### **Price-Bar Cumulative Distributions**\n\n`;
                    md += buildMaeMafeTables(vPrice);
                }
                md += `---\n\n`;
            });
        }

        // ============================================================
        // SECTION 5: DEEP DIVE BREAKDOWN BY INSTRUMENT & THRESHOLD (SPLIT)
        // ============================================================
        md += `## Section 5: Deep Dive Breakdown by Instrument and Threshold\n\n`;

        uniqueInstruments.forEach(inst => {
            const instTrades = flatTrades.filter(t => t.instrument === inst);
            md += `### **${inst}**\n\n`;

            const thresholds = [...new Set(instTrades.map(t => t.threshold))].sort((a,b) => parseInt(a, 10) - parseInt(b, 10));

            thresholds.forEach(thresh => {
                const thTrades = instTrades.filter(t => t.threshold === thresh);
                
                md += `#### **Threshold Value: ${thresh}**\n\n`;

                const thVolume = thTrades.filter(t => t.barType === 'volume');
                const thPrice = thTrades.filter(t => t.barType === 'price');

                const renderDeepDiveBlock = (trades, label) => {
                    const thm = computeMetrics(trades.map(t => t.trade));
                    let block = `##### **${label} Performance**\n`;
                    if (thm.totalTrades === 0) {
                        return block + `*No completed trades configured with ${label.toLowerCase()} bars under this threshold.*\n\n`;
                    }
                    block += `*   **Cumulative Trades:** ${thm.totalTrades}\n`;
                    block += `*   **Cumulative Win Rate:** ${thm.winRate.toFixed(2)}%\n`;
                    block += `*   **Cumulative Total Return:** ${thm.totalReturn >= 0 ? '+' : ''}${thm.totalReturn.toFixed(2)}%\n`;
                    block += `*   **Cumulative Avg. Return per Trade:** ${thm.avgReturn >= 0 ? '+' : ''}${thm.avgReturn.toFixed(3)}%\n`;
                    if (hasMaeMafe) {
                        block += `*   **Average MAFE:** ${thm.avgMafe.toFixed(2)}%\n`;
                        block += `*   **Average MAE:** ${thm.avgMae.toFixed(2)}%\n`;
                    }
                    block += `\n`;

                    block += `******Strategy Version Breakdown (${label}):******\n`;
                    block += `| Strategy Version | Cumulative Trades | Win Rate % | Total Return % | Avg Return % |`;
                    if (hasMaeMafe) {
                        block += ` Avg MAFE % | Avg MAE % |`;
                    }
                    block += `\n| :--- | :---: | :---: | :---: | :---: |`;
                    if (hasMaeMafe) {
                        block += ` :---: | :---: |`;
                    }
                    block += `\n`;

                    const thVersions = [...new Set(trades.map(t => t.strategy))].sort((a,b) => {
                        const numA = parseInt(a.match(versionRegex)?.[1] || 0, 10);
                        const numB = parseInt(b.match(versionRegex)?.[1] || 0, 10);
                        return numA - numB;
                    });

                    thVersions.forEach(v => {
                        const vThTrades = trades.filter(t => t.strategy === v);
                        const vThm = computeMetrics(vThTrades.map(t => t.trade));
                        
                        let row = `| **${v}** | ${vThm.totalTrades} | ${vThm.winRate.toFixed(2)}% | ${vThm.totalReturn >= 0 ? '+' : ''}${vThm.totalReturn.toFixed(2)}% | ${vThm.avgReturn >= 0 ? '+' : ''}${vThm.avgReturn.toFixed(3)}% |`;
                        if (hasMaeMafe) {
                            row += ` ${vThm.avgMafe.toFixed(1)}% | ${vThm.avgMae.toFixed(1)}% |`;
                        }
                        block += row + `\n`;
                    });
                    block += `\n`;
                    return block;
                };

                md += renderDeepDiveBlock(thVolume, "Volume-Bar");
                md += renderDeepDiveBlock(thPrice, "Price-Bar");
            });
            md += `---\n\n`;
        });

        // --- Write Markdown file out to disk ---

        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        const timestamp = getFormattedTimestamp();
        const targetFile = path.join(OUTPUT_DIR, `live_signals_report_${timestamp}.md`);

        fs.writeFileSync(targetFile, md, 'utf8');
        console.log(`Success! Complete live signals performance analysis compiled inside: '${targetFile}'`);

    } catch (error) {
        console.error("Execution stopped due to error:", error.message);
    }
}

main();