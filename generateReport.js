const fs = require('fs');
const path = require('path');

const RESULTS_DIR = process.argv.includes('--live') ? './live-backtest-results' : './version-backtest-results';
const OUTPUT_DIR = './version-backtest-report';

// Matches any V1 to V106 strategy strictly
const versionRegex = /^V(\d+):/;
const isLive = process.argv.includes('--live');

// All active High Confidence versions (original + fixed) producing confidence metric outputs
const confidenceVersions = [
    // Original High Confidence versions
    'V3: High Confidence',
    'V8: High Confidence (Strict)',
    'V13: High Confidence (Calibrated)',
    'V18: High Confidence (Strict-Calibrated)',
    'V23: High Confidence (Structural-Calibrated)',
    'V28: High Confidence (Strict Structural-Calibrated)',
    'V33: High Confidence (Upgraded)',
    'V38: High Confidence (Strict Upgraded)',
    'V43: High Confidence (Structural-Calibrated Upgraded)',
    'V48: High Confidence (Strict Structural-Calibrated Upgraded)',
    // Fixed High Confidence versions (V2 engine)
    'V53: Fixed High Confidence',
    'V58: Fixed High Confidence (Strict)',
    'V63: Fixed High Confidence (Calibrated)',
    'V68: Fixed High Confidence (Strict-Calibrated)',
    'V73: Fixed High Confidence (Structural-Calibrated)',
    'V78: Fixed High Confidence (Strict Structural-Calibrated)',
    'V83: Fixed High Confidence (Upgraded)',
    'V88: Fixed High Confidence (Strict Upgraded)',
    'V93: Fixed High Confidence (Structural-Calibrated Upgraded)',
    'V98: Fixed High Confidence (Strict Structural-Calibrated Upgraded)',
];

const INSTRUMENT_NAMES = {
    // Standard ISINs
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

    // Standard F&O Segment Tokens
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
    
    // Legacy support keys
    '552706': 'Aluminium (MCX)',
    '552709': 'Lead (MCX)',
    '552708': 'Copper (MCX)',
    '552711': 'Zinc (MCX)',
    '464151': 'Silver Mini (MCX)',
    '477177': 'Silver Micro (MCX)',
    '510464': 'Gold Petal (MCX)',
    '62329': 'Nifty 50',
    '62326': 'Bank Nifty',
    '62327': 'Fin Nifty',
    '62328': 'Midcap Nifty'
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

function computeMetrics(tradesList) {
    const totalTrades = tradesList.length;
    if (totalTrades === 0) {
        return { totalTrades: 0, winRate: 0, totalReturn: 0, avgReturn: 0, avgMafe: 0, avgMae: 0 };
    }
    const wins = tradesList.filter(t => t.pnlAmount > 0).length;
    const winRate = (wins / totalTrades) * 100;
    // Use pnl field (version-backtest-results and live-backtest-results both store trade return % in 'pnl')
    const totalReturn = tradesList.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
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

// --- Directory Parsing Logic ---

if (!fs.existsSync(RESULTS_DIR)) {
    console.error(`Error: Directory '${RESULTS_DIR}' not found. Please ensure it exists.`);
    process.exit(1);
}

const files = fs.readdirSync(RESULTS_DIR).filter(file => path.extname(file) === '.json');

if (files.length === 0) {
    console.log("No valid backtest result JSON files found.");
    process.exit(0);
}

console.log(`Processing ${files.length} backtest files...`);

files.forEach(file => {
    // Parse format: continuous_<thresholdValue>_<instrument>_<date>.json or live_<thresholdValue>_<instrument>_<date>.json
    const match = file.match(/^(?:continuous|live)_(\d+)_(.+?)\.json$/);
    if (!match) return;

    const threshold = match[1];
    const rawInstrument = match[2];
    // Try to extract date from filename or rawInstrument
    let date = 'unknown';
    const dateMatch = file.match(/_(\d{4}-\d{2}-\d{2})\.json$/);
    if (dateMatch) date = dateMatch[1];
    const instrumentName = getInstrumentDisplayName(rawInstrument);

    const filePath = path.join(RESULTS_DIR, file);
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        if (!data || !data.strategies) return;

        Object.keys(data.strategies).forEach(stratKey => {
            const vMatch = stratKey.match(versionRegex);
            if (!vMatch) return; // Skip baseline strategies

            const versionNum = parseInt(vMatch[1], 10);
            const strategyData = data.strategies[stratKey];
            if (!strategyData || !Array.isArray(strategyData.results?.trades)) return;

            strategyData.results.trades.forEach(trade => {
                flatTrades.push({
                    trade,
                    strategy: stratKey,
                    versionNum,
                    instrument: instrumentName,
                    threshold,
                    date
                });
            });
        });
    } catch (e) {
        console.error(`Failed to parse file ${file}:`, e);
    }
});

if (flatTrades.length === 0) {
    console.log("No version-specific trades detected inside backtest output files.");
    process.exit(0);
}

// Generate collections of active elements for looping
const uniqueVersions = [...new Set(flatTrades.map(t => t.strategy))].sort((a,b) => {
    const numA = parseInt(a.match(versionRegex)?.[1] || 0, 10);
    const numB = parseInt(b.match(versionRegex)?.[1] || 0, 10);
    return numA - numB;
});

const uniqueInstruments = [...new Set(flatTrades.map(t => t.instrument))].sort();
const uniqueDates = [...new Set(flatTrades.map(t => t.date))].sort();

// --- Compile Markdown Report Content ---

let md = `# Portfolio Backtest Performance Report (Multi-Day Edition)\n\n`;
md += `*Report Generated on: ${new Date().toLocaleString()}*\n`;
md += `*Analyzed Period Range:* ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}\n\n`;

// ============================================================
// SECTION 1: EXECUTIVE SUMMARY
// ============================================================
md += `## Section 1: Executive Summary\n\n`;

const generalMetrics = computeMetrics(flatTrades.map(t => t.trade));
md += `### **System-Wide Performance Summary**\n`;
md += `*   **Total Executed Portfolio Trades:** ${generalMetrics.totalTrades}\n`;
md += `*   **Portfolio Win Rate:** ${generalMetrics.winRate.toFixed(2)}%\n`;
md += `*   **Portfolio Cumulative Return:** ${generalMetrics.totalReturn >= 0 ? '+' : ''}${generalMetrics.totalReturn.toFixed(2)}%\n`;
md += `*   **Portfolio Avg. Trade return:** ${generalMetrics.avgReturn >= 0 ? '+' : ''}${generalMetrics.avgReturn.toFixed(3)}%\n\n`;

const versionPerformanceRankings = uniqueVersions.map(v => {
    const vTrades = flatTrades.filter(t => t.strategy === v);
    const m = computeMetrics(vTrades.map(t => t.trade));
    return { name: v, ...m };
});

const top3 = [...versionPerformanceRankings].sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 3);
const bottom3 = [...versionPerformanceRankings].sort((a, b) => a.totalReturn - b.totalReturn).slice(0, 3);

md += `### **Strategy Rankings**\n`;
md += `#### **Top 3 Versions (Cumulative Return)**\n`;
top3.forEach((v, index) => {
    md += `${index + 1}. **${v.name}**: Total Return: **${v.totalReturn.toFixed(2)}%** | Win Rate: **${v.winRate.toFixed(2)}%** (${v.totalTrades} Trades)\n`;
});
md += `\n#### **Bottom 3 Versions (Cumulative Return)**\n`;
bottom3.forEach((v, index) => {
    md += `${index + 1}. **${v.name}**: Total Return: **${v.totalReturn.toFixed(2)}%** | Win Rate: **${v.winRate.toFixed(2)}%** (${v.totalTrades} Trades)\n`;
});
md += `\n`;

// ============================================================
// SECTION 2: DETAILED VERSION PERFORMANCE WITH DAILY BREAKDOWNS
// ============================================================
md += `## Section 2: Detailed Performance by Strategy Version (V1 to V106)\n\n`;

uniqueVersions.forEach(v => {
    const vTrades = flatTrades.filter(t => t.strategy === v);
    const m = computeMetrics(vTrades.map(t => t.trade));

    md += `### **${v}**\n`;
    md += `*   **Cumulative Trades:** ${m.totalTrades}\n`;
    md += `*   **Cumulative Win Rate:** ${m.winRate.toFixed(2)}%\n`;
    md += `*   **Cumulative Total Return:** ${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn.toFixed(2)}%\n`;
    md += `*   **Cumulative Avg. Return per Trade:** ${m.avgReturn >= 0 ? '+' : ''}${m.avgReturn.toFixed(3)}%\n`;
    md += `*   **Cumulative Average MAFE:** ${m.avgMafe.toFixed(2)}%\n`;
    md += `*   **Cumulative Average MAE:** ${m.avgMae.toFixed(2)}%\n\n`;

    // Dynamic Instrument-Threshold breakdown for this version across dates
    const pairs = [...new Set(vTrades.map(t => `${t.instrument} (Threshold ${t.threshold})`))].sort();
    
    md += `#### **Asset & Threshold Breakdowns for ${v}**\n`;
    pairs.forEach(pair => {
        const pairTrades = vTrades.filter(t => `${t.instrument} (Threshold ${t.threshold})` === pair);
        const pm = computeMetrics(pairTrades.map(t => t.trade));

        md += `##### **${pair}**\n`;
        md += `*   **Cumulative:** ${pm.totalTrades} Trades | Win Rate: ${pm.winRate.toFixed(2)}% | Return: ${pm.totalReturn >= 0 ? '+' : ''}${pm.totalReturn.toFixed(2)}% | MAFE: ${pm.avgMafe.toFixed(1)}% | MAE: ${pm.avgMae.toFixed(1)}%\n`;

        const pairDates = [...new Set(pairTrades.map(t => t.date))].sort();
        if (pairDates.length > 1) {
            md += `*   **Breakdown by Date:**\n`;
            pairDates.forEach(d => {
                const dtTrades = pairTrades.filter(t => t.date === d);
                const dm = computeMetrics(dtTrades.map(t => t.trade));
                md += `    *   **${d}**: ${dm.totalTrades} Trades | Win Rate: ${dm.winRate.toFixed(1)}% | Return: ${dm.totalReturn >= 0 ? '+' : ''}${dm.totalReturn.toFixed(2)}%\n`;
            });
        }
        md += `\n`;
    });
    md += `---\n\n`;
});

// ============================================================
// SECTION 3: CONFIDENCE DISTRIBUTION (SPLIT BY VERSION & DATE)
// ============================================================
md += `## Section 3: Confidence Distribution Analysis\n\n`;

confidenceVersions.forEach(v => {
    const vTrades = flatTrades.filter(t => t.strategy === v);
    if (vTrades.length === 0) return;

    md += `### **${v} Confidence Distributions**\n\n`;
    
    // Overall Cumulative (All Dates)
    md += `#### **Cumulative Confidence Distribution (All Dates)**\n`;
    md += buildConfidenceTable(vTrades);
    md += `\n`;

    // Separate Daily breakdowns if multiple dates exist
    const vDates = [...new Set(vTrades.map(t => t.date))].sort();
    if (vDates.length > 1) {
        vDates.forEach(d => {
            md += `#### **Confidence Distribution for Date: ${d}**\n`;
            const dtTrades = vTrades.filter(t => t.date === d);
            md += buildConfidenceTable(dtTrades);
            md += `\n`;
        });
    }

    // Asset-specific breakdowns
    const vInsts = [...new Set(vTrades.map(t => t.instrument))].sort();
    vInsts.forEach(inst => {
        md += `#### **${inst} Confidence Distribution**\n`;
        
        const instVTrades = vTrades.filter(t => t.instrument === inst);
        md += `##### **Cumulative (${inst})**\n`;
        md += buildConfidenceTable(instVTrades);

        const instDates = [...new Set(instVTrades.map(t => t.date))].sort();
        if (instDates.length > 1) {
            instDates.forEach(d => {
                md += `##### **Breakdown for ${inst} on Date: ${d}**\n`;
                const instDtTrades = instVTrades.filter(t => t.date === d);
                md += buildConfidenceTable(instDtTrades);
            });
        }
        md += `\n`;
    });
    md += `---\n\n`;
});

// ============================================================
// SECTION 4: MAE AND MAFE DISTRIBUTIONS BY VERSION & INSTRUMENT (SPLIT BY DATE)
// ============================================================
md += `## Section 4: Lifecycle MAE and MAFE Distribution Analysis\n\n`;

// Portfolio-wide distributions
md += `### **Overall Global Portfolio-Wide Distributions**\n\n`;
md += `#### **Cumulative Portfolio MAE/MAFE (All Dates)**\n\n`;
md += buildMaeMafeTables(flatTrades);

if (uniqueDates.length > 1) {
    uniqueDates.forEach(d => {
        md += `#### **Portfolio MAE/MAFE Distribution for Date: ${d}**\n\n`;
        const dtTrades = flatTrades.filter(t => t.date === d);
        md += buildMaeMafeTables(dtTrades);
    });
}
md += `---\n\n`;

// Version-specific distributions (including daily split)
md += `### **MAE/MAFE Distributions By Strategy Version**\n\n`;
uniqueVersions.forEach(v => {
    const vTrades = flatTrades.filter(t => t.versionNum === v);
    md += `### **${v} MAE/MAFE Distributions**\n\n`;
    
    md += `#### **Cumulative (All Dates)**\n\n`;
    md += buildMaeMafeTables(vTrades);

    const vDates = [...new Set(vTrades.map(t => t.date))].sort();
    if (vDates.length > 1) {
        vDates.forEach(d => {
            md += `#### **Distribution for Date: ${d}**\n\n`;
            const dtTrades = vTrades.filter(t => t.date === d);
            md += buildMaeMafeTables(dtTrades);
        });
    }
    md += `---\n\n`;
});

// Instrument-specific distributions (including daily split)
md += `### **MAE/MAFE Distributions By Instrument**\n\n`;
uniqueInstruments.forEach(inst => {
    const instTrades = flatTrades.filter(t => t.instrument === inst);
    md += `### **${inst} MAE/MAFE Distributions**\n\n`;
    
    md += `#### **Cumulative (All Dates)**\n\n`;
    md += buildMaeMafeTables(instTrades);

    const instDates = [...new Set(instTrades.map(t => t.date))].sort();
    if (instDates.length > 1) {
        instDates.forEach(d => {
            md += `#### **Distribution for Date: ${d}**\n\n`;
            const dtTrades = instTrades.filter(t => t.date === d);
            md += buildMaeMafeTables(dtTrades);
        });
    }
    md += `---\n\n`;
});

// ============================================================
// SECTION 5: DEEP DIVE BREAKDOWN BY INSTRUMENT & THRESHOLD (WITH DAILY SPLIT)
// ============================================================
md += `## Section 5: Deep Dive Breakdown by Instrument and Threshold\n\n`;

uniqueInstruments.forEach(inst => {
    const instTrades = flatTrades.filter(t => t.instrument === inst);
    md += `### **${inst}**\n\n`;

    const thresholds = [...new Set(instTrades.map(t => t.threshold))].sort((a,b) => parseInt(a, 10) - parseInt(b, 10));

    thresholds.forEach(thresh => {
        const thTrades = instTrades.filter(t => t.threshold === thresh);
        const thm = computeMetrics(thTrades.map(t => t.trade));

        md += `#### **Threshold: ${thresh}**\n`;
        md += `*   **Cumulative Trades (This Threshold):** ${thm.totalTrades}\n`;
        md += `*   **Cumulative Win Rate:** ${thm.winRate.toFixed(2)}%\n`;
        md += `*   **Cumulative Total Return:** ${thm.totalReturn >= 0 ? '+' : ''}${thm.totalReturn.toFixed(2)}%\n`;
        md += `*   **Cumulative Avg. Return per Trade:** ${thm.avgReturn >= 0 ? '+' : ''}${thm.avgReturn.toFixed(3)}%\n`;
        md += `*   **Average MAFE:** ${thm.avgMafe.toFixed(2)}%\n`;
        md += `*   **Average MAE:** ${thm.avgMae.toFixed(2)}%\n\n`;

        // If there are multiple dates for this threshold, show cumulative daily breakdown
        const thDates = [...new Set(thTrades.map(t => t.date))].sort();
        if (thDates.length > 1) {
            md += `##### **Daily Performance Breakdown (Threshold ${thresh})**\n`;
            md += `| Date | Trades | Win Rate % | Total Return % | Avg Return % | Avg MAFE % | Avg MAE % |\n`;
            md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
            thDates.forEach(d => {
                const dtTrades = thTrades.filter(t => t.date === d);
                const dm = computeMetrics(dtTrades.map(t => t.trade));
                md += `| **${d}** | ${dm.totalTrades} | ${dm.winRate.toFixed(2)}% | ${dm.totalReturn >= 0 ? '+' : ''}${dm.totalReturn.toFixed(2)}% | ${dm.avgReturn >= 0 ? '+' : ''}${dm.avgReturn.toFixed(3)}% | ${dm.avgMafe.toFixed(1)}% | ${dm.avgMae.toFixed(1)}% |\n`;
            });
            md += `\n`;
        }

        // List version specific performance for this threshold (combining dates first)
        md += `##### **Strategy Version Performance under Threshold ${thresh}**\n`;
        md += `| Strategy Version | Cumulative Trades | Win Rate % | Total Return % | Avg Return % | Avg MAFE % | Avg MAE % |\n`;
        md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

        const thVersions = [...new Set(thTrades.map(t => t.strategy))].sort((a,b) => {
            const numA = parseInt(a.match(versionRegex)?.[1] || 0, 10);
            const numB = parseInt(b.match(versionRegex)?.[1] || 0, 10);
            return numA - numB;
        });

        thVersions.forEach(v => {
            const vThTrades = thTrades.filter(t => t.strategy === v);
            const vThm = computeMetrics(vThTrades.map(t => t.trade));
            md += `| **${v}** | ${vThm.totalTrades} | ${vThm.winRate.toFixed(2)}% | ${vThm.totalReturn >= 0 ? '+' : ''}${vThm.totalReturn.toFixed(2)}% | ${vThm.avgReturn >= 0 ? '+' : ''}${vThm.avgReturn.toFixed(3)}% | ${vThm.avgMafe.toFixed(1)}% | ${vThm.avgMae.toFixed(1)}% |\n`;
        });
        md += `\n`;

        // --- NEW GRANULAR NESTED BREAKDOWN: Instrument -> Threshold -> Date -> All Strategy Versions ---
        md += `##### **Daily Strategy Version Performance Breakdown under Threshold ${thresh}**\n\n`;
        thDates.forEach(d => {
            const dtTrades = thTrades.filter(t => t.date === d);
            
            md += `###### **Date: ${d}**\n`;
            md += `| Strategy Version | Trades | Win Rate % | Total Return % | Avg Return % | Avg MAFE % | Avg MAE % |\n`;
            md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

            const dtVersions = [...new Set(dtTrades.map(t => t.strategy))].sort((a,b) => {
                const numA = parseInt(a.match(versionRegex)?.[1] || 0, 10);
                const numB = parseInt(b.match(versionRegex)?.[1] || 0, 10);
                return numA - numB;
            });

            dtVersions.forEach(v => {
                const vDtTrades = dtTrades.filter(t => t.strategy === v);
                const vDtm = computeMetrics(vDtTrades.map(t => t.trade));
                md += `| **${v}** | ${vDtm.totalTrades} | ${vDtm.winRate.toFixed(2)}% | ${vDtm.totalReturn >= 0 ? '+' : ''}${vDtm.totalReturn.toFixed(2)}% | ${vDtm.avgReturn >= 0 ? '+' : ''}${vDtm.avgReturn.toFixed(3)}% | ${vDtm.avgMafe.toFixed(1)}% | ${vDtm.avgMae.toFixed(1)}% |\n`;
            });
            md += `\n`;
        });
        md += `\n`;
    });
    md += `---\n\n`;
});

// --- Write Markdown file out to disk ---

try {
    // Generate directories recursively if needed
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    
    // Construct unique filename: backtest_analysis_report_<YYYY-MM-DD_HH-mm>.md
    const timestamp = getFormattedTimestamp();
    const targetFile = path.join(OUTPUT_DIR, `${isLive ? 'live' : 'backtest'}_analysis_report_${timestamp}.md`);
    
    fs.writeFileSync(targetFile, md, 'utf8');
    console.log(`Success! Complete${isLive ? ' live backtest' : ''} portfolio-wide multi-day analysis written to '${targetFile}'`);

    // --- Also generate compact LLM-friendly summary ---
    const compactSummary = generateCompactSummary(flatTrades);
    const compactFile = path.join(OUTPUT_DIR, `${isLive ? 'live' : 'backtest'}_compact_summary_${timestamp}.md`);
    fs.writeFileSync(compactFile, compactSummary, 'utf8');
    console.log(`Success! Compact LLM summary written to '${compactFile}'`);
} catch (e) {
    console.error(`Failed to write markdown output:`, e);
}

// ============================================================
// COMPACT SUMMARY GENERATOR (LLM-friendly)
// ============================================================
function generateCompactSummary(allTrades) {
    const MIN_TRADES = 3; // Minimum trades required for a version to be considered

    let md = `# Strategy Performance Compact Summary\n\n`;
    md += `*Generated: ${new Date().toLocaleString()}*\n`;
    md += `*Purpose: LLM-readable summary for strategy refinement*\n\n`;

    // ── Step 1: Per instrument, find best 3 version+threshold combinations by win rate ──
    const instrumentGroups = new Map();
    for (const t of allTrades) {
        if (!instrumentGroups.has(t.instrument)) instrumentGroups.set(t.instrument, []);
        instrumentGroups.get(t.instrument).push(t);
    }

    const perInstrumentTop3 = []; // { instrument, top3: [{version, threshold, ...metrics}] }

    for (const [instrument, trades] of instrumentGroups) {
        // Group by version+threshold combination within this instrument
        const comboMap = new Map(); // "version|threshold" → trades
        for (const t of trades) {
            const comboKey = `${t.strategy}|${t.threshold}`;
            if (!comboMap.has(comboKey)) comboMap.set(comboKey, []);
            comboMap.get(comboKey).push(t.trade);
        }

        const comboMetrics = [];
        for (const [comboKey, comboTrades] of comboMap) {
            if (comboTrades.length < MIN_TRADES) continue;
            const [version, threshold] = comboKey.split('|');
            const m = computeMetrics(comboTrades);
            comboMetrics.push({ version, threshold, ...m, trades: comboTrades.length });
        }

        // Sort by win rate descending, then total return descending
        comboMetrics.sort((a, b) => b.winRate - a.winRate || b.totalReturn - a.totalReturn);
        const top3 = comboMetrics.slice(0, 3);

        if (top3.length > 0) {
            perInstrumentTop3.push({ instrument, top3 });
        }
    }

    // ── Section A: Per-Instrument Top 3 Version+Threshold Combinations ──
    md += `## Section A: Best Version+Threshold Per Instrument (Top 3 by Win Rate)\n\n`;
    md += `| Instrument | Rank | Version | Threshold | Win Rate | Avg Return | Total Return | MAFE | MAE | Trades |\n`;
    md += `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const entry of perInstrumentTop3) {
        entry.top3.forEach((v, idx) => {
            md += `| ${entry.instrument} | #${idx + 1} | ${v.version} | ${v.threshold} | ${v.winRate.toFixed(1)}% | ${v.avgReturn >= 0 ? '+' : ''}${v.avgReturn.toFixed(2)}% | ${v.totalReturn >= 0 ? '+' : ''}${v.totalReturn.toFixed(2)}% | ${v.avgMafe.toFixed(0)}% | ${v.avgMae.toFixed(0)}% | ${v.trades} |\n`;
        });
    }
    md += `\n`;

    // ── Step 2: Cross-reference — which version appears most in top3? ──
    const versionScoreMap = new Map();
    for (const entry of perInstrumentTop3) {
        for (const v of entry.top3) {
            const existing = versionScoreMap.get(v.version) || { appearances: 0, totalWinRate: 0, totalReturn: 0, totalTrades: 0, groups: [] };
            existing.appearances++;
            existing.totalWinRate += v.winRate;
            existing.totalReturn += v.totalReturn;
            existing.totalTrades += v.trades;
            existing.groups.push(`${entry.instrument} (T${v.threshold})`);
            versionScoreMap.set(v.version, existing);
        }
    }

    const versionRankings = [];
    for (const [ver, data] of versionScoreMap) {
        versionRankings.push({
            version: ver,
            appearances: data.appearances,
            avgWinRate: data.totalWinRate / data.appearances,
            avgReturn: data.totalReturn / data.appearances,
            totalTrades: data.totalTrades,
            groups: data.groups,
        });
    }
    versionRankings.sort((a, b) => b.appearances - a.appearances || b.avgWinRate - a.avgWinRate);

    // ── Section B: Overall Best Versions ──
    md += `## Section B: Overall Best-Performing Versions (Cross-Instrument)\n\n`;
    md += `*Ranked by number of instrument-threshold groups where this version appears in the Top 3.*\n\n`;
    md += `| Rank | Version | Groups in Top 3 | Avg Win Rate | Avg Return | Total Trades | Best Instruments |\n`;
    md += `| :---: | :--- | :---: | :---: | :---: | :---: | :--- |\n`;

    versionRankings.slice(0, 20).forEach((v, idx) => {
        const bestGroups = v.groups.slice(0, 3).map(g => g.split(' | ')[0]).join(', ');
        md += `| #${idx + 1} | ${v.version} | ${v.appearances} | ${v.avgWinRate.toFixed(1)}% | ${v.avgReturn >= 0 ? '+' : ''}${v.avgReturn.toFixed(2)}% | ${v.totalTrades} | ${bestGroups}... |\n`;
    });
    md += `\n`;

    // ── Section C: Cumulative Cross-Instrument Original vs Batch Comparison ──
    // For each original V1–V50 and its batch clones (V51+, V101+, V151+, V201+, V251+),
    // compute the BEST threshold per instrument, then aggregate cumulative metrics.
    md += `## Section C: Cumulative Cross-Instrument Comparison (Best Threshold Per Instrument)\n\n`;
    md += `*For each original version and its batch clones, we select the best threshold per instrument\n`;
    md += `(by win rate), then compute cumulative metrics across all instruments.*\n\n`;

    // Step 1: For each version, find best threshold per instrument
    // Map: version → Map(instrument → bestCombo)
    const versionBestMap = new Map();
    for (const t of allTrades) {
        const vNum = parseInt(t.strategy.match(/^V(\d+):/)?.[1] || '0', 10);
        if (vNum === 0) continue;

        const verKey = t.strategy; // full version name
        if (!versionBestMap.has(verKey)) versionBestMap.set(verKey, new Map());
        const instMap = versionBestMap.get(verKey);

        const comboKey = `${t.threshold}`;
        if (!instMap.has(t.instrument)) instMap.set(t.instrument, {});
        if (!instMap.get(t.instrument)[comboKey]) instMap.get(t.instrument)[comboKey] = [];
        instMap.get(t.instrument)[comboKey].push(t.trade);
    }

    // Step 2: For each version+instrument, pick the best threshold (by win rate, min 3 trades)
    // Map: version → { totalTrades, totalWins, totalPnlAmount, totalPnlPct, count }
    const versionCumulative = new Map();

    for (const [verKey, instMap] of versionBestMap) {
        const vNum = parseInt(verKey.match(/^V(\d+):/)?.[1] || '0', 10);
        let cumTrades = 0, cumWins = 0, cumPnlAmount = 0, cumPnlPct = 0;
        let instrumentsUsed = 0;

        for (const [instrument, thresholdMap] of instMap) {
            let bestCombo = null;
            let bestWinRate = -1;

            for (const [threshold, trades] of Object.entries(thresholdMap)) {
                if (trades.length < MIN_TRADES) continue;
                const wins = trades.filter(t => t.pnlAmount > 0).length;
                const wr = (wins / trades.length) * 100;
                if (wr > bestWinRate || (wr === bestWinRate && bestCombo && trades.length > bestCombo.trades.length)) {
                    bestWinRate = wr;
                    bestCombo = { threshold, trades, wins, wr };
                }
            }

            if (bestCombo) {
                cumTrades += bestCombo.trades.length;
                cumWins += bestCombo.wins;
                cumPnlAmount += bestCombo.trades.reduce((s, t) => s + (t.pnlAmount || 0), 0);
                // Accumulate per-trade PnL% for averaging
                for (const tr of bestCombo.trades) {
                    cumPnlPct += (tr.pnl || 0);
                }
                instrumentsUsed++;
            }
        }

        if (instrumentsUsed > 0 && cumTrades > 0) {
            versionCumulative.set(verKey, {
                vNum,
                verKey,
                instrumentsUsed,
                totalTrades: cumTrades,
                winRate: (cumWins / cumTrades) * 100,
                avgReturn: cumPnlPct / cumTrades, // per-trade average
                totalPnlPct: cumPnlPct,
                totalPnlAmount: cumPnlAmount,
            });
        }
    }

    // Step 3: Pair originals (V1–V50) with their batch clones and compare
    // Batch mapping: Vn original → Vn offset per batch
    // V51–V100: entry_stop (offset 50)
    // V101–V150: trend (offset 100)
    // V151–V200: leg_quality (offset 150)
    // V201–V250: exit_mgmt (offset 200)
    const BATCH_OFFSETS = [
        { offset: 50, label: "Entry/Stop" },
        { offset: 100, label: "Trend" },
        { offset: 150, label: "Leg Quality" },
        { offset: 200, label: "Exit Mgmt" },
    ];

    md += `| Orig V | Batch | Original | Original WR | Original Ret | Batch Clone | Clone WR | Clone Ret | WR Δ | Ret Δ |\n`;
    md += `| :---: | :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: |\n`;

    for (let origV = 1; origV <= 50; origV++) {
        const origEntry = [...versionCumulative.values()].find(
            v => v.vNum === origV && v.verKey.includes(`V${origV}:`) && !v.verKey.includes('(Original)')
        );
        if (!origEntry) continue;

        for (const batch of BATCH_OFFSETS) {
            const cloneV = origV + batch.offset;
            const cloneEntry = [...versionCumulative.values()].find(
                v => v.vNum === cloneV
            );
            if (!cloneEntry) continue;

            const wrDelta = cloneEntry.winRate - origEntry.winRate;
            const retDelta = cloneEntry.avgReturn - origEntry.avgReturn;

            // Only show if both have meaningful data
            if (origEntry.totalTrades >= MIN_TRADES && cloneEntry.totalTrades >= MIN_TRADES) {
                md += `| V${origV} | ${batch.label} | ${origEntry.verKey} | ${origEntry.winRate.toFixed(1)}% | ${origEntry.avgReturn >= 0 ? '+' : ''}${origEntry.avgReturn.toFixed(2)}% | ${cloneEntry.verKey} | ${cloneEntry.winRate.toFixed(1)}% | ${cloneEntry.avgReturn >= 0 ? '+' : ''}${cloneEntry.avgReturn.toFixed(2)}% | ${wrDelta >= 0 ? '+' : ''}${wrDelta.toFixed(1)}% | ${retDelta >= 0 ? '+' : ''}${retDelta.toFixed(2)}% |\n`;
            }
        }
    }
    md += `\n`;

    // Step 4: Brooks comparison — V851-V904 batch profiles
    md += `### Brooks Strategies — Batch Profiles\n\n`;
    md += `| Orig V | Profile | Original | Original WR | Original Ret | Clone | Clone WR | Clone Ret | WR Δ | Ret Δ |\n`;
    md += `| :---: | :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: |\n`;

    const brooksOrig = [851, 852, 853];
    const brooksBatchOffsets = [
        { offset: 3, label: "Entry/Stop" },
        { offset: 6, label: "Trend" },
        { offset: 9, label: "Leg Quality" },
        { offset: 12, label: "Exit Mgmt" },
    ];
    for (const origV of brooksOrig) {
        const origEntry = [...versionCumulative.values()].find(v => v.vNum === origV);
        if (!origEntry || origEntry.totalTrades < MIN_TRADES) continue;
        for (const batch of brooksBatchOffsets) {
            const cloneV = 851 + 3 + batch.offset + (origV - 851);
            const cloneEntry = [...versionCumulative.values()].find(v => v.vNum === cloneV);
            if (!cloneEntry || cloneEntry.totalTrades < MIN_TRADES) continue;
            const wrDelta = cloneEntry.winRate - origEntry.winRate;
            const retDelta = cloneEntry.avgReturn - origEntry.avgReturn;
            md += `| V${origV} | ${batch.label} | ${origEntry.verKey} | ${origEntry.winRate.toFixed(1)}% | ${origEntry.avgReturn >= 0 ? '+' : ''}${origEntry.avgReturn.toFixed(2)}% | ${cloneEntry.verKey} | ${cloneEntry.winRate.toFixed(1)}% | ${cloneEntry.avgReturn >= 0 ? '+' : ''}${cloneEntry.avgReturn.toFixed(2)}% | ${wrDelta >= 0 ? '+' : ''}${wrDelta.toFixed(1)}% | ${retDelta >= 0 ? '+' : ''}${retDelta.toFixed(2)}% |\n`;
        }
    }
    md += `\n`;

    // Step 5: Individual fix profile summary — avg WR impact per fix
    md += `### Individual Fix Profiles — Average WR Impact (V251-V850 vs V1-V50 Originals)\n\n`;
    md += `| Fix Profile | Avg WR Δ | Best WR Gain | Worst WR Loss | Positive Orig | Negative Orig |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

    const FIX_ORDER = ["stop_wider","trigger_wider","atr_floor","slippage","abr_slope","adx_filter","gap_optional","leg_depth","pivot_struct","trailing","time_exit","bar_path"];
    const FIX_LABELS = {stop_wider:"Stop Wider",trigger_wider:"Trigger Wider",atr_floor:"ATR Floor",slippage:"Slippage",abr_slope:"ABR Slope",adx_filter:"ADX Filter",gap_optional:"Gap Optional",leg_depth:"Leg Depth",pivot_struct:"Pivot Structural",trailing:"Trailing Stop",time_exit:"Time Exit",bar_path:"Bar Path Exit"};

    const fixStats = {};
    for (let fixIdx = 0; fixIdx < FIX_ORDER.length; fixIdx++) {
        const fixKey = FIX_ORDER[fixIdx];
        const baseVersion = 251 + fixIdx * 50;
        const deltas = [];
        for (let origV = 1; origV <= 50; origV++) {
            const origEntry = [...versionCumulative.values()].find(v => v.vNum === origV && v.verKey.includes(`V${origV}:`) && !v.verKey.includes('(Original)'));
            const fixV = baseVersion + origV - 1;
            const fixEntry = [...versionCumulative.values()].find(v => v.vNum === fixV);
            if (origEntry && fixEntry && origEntry.totalTrades >= MIN_TRADES && fixEntry.totalTrades >= MIN_TRADES) {
                deltas.push(fixEntry.winRate - origEntry.winRate);
            }
        }
        if (deltas.length > 0) {
            const avg = deltas.reduce((s,d)=>s+d,0)/deltas.length;
            const best = Math.max(...deltas);
            const worst = Math.min(...deltas);
            const positive = deltas.filter(d=>d>0).length;
            const negative = deltas.filter(d=>d<0).length;
            fixStats[fixKey] = {avg, best, worst, positive, negative, label: FIX_LABELS[fixKey]};
        }
    }
    const sortedFixes = Object.entries(fixStats).sort((a,b) => b[1].avg - a[1].avg);
    for (const [key, s] of sortedFixes) {
        md += `| ${s.label} | ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(1)}% | ${s.best >= 0 ? '+' : ''}${s.best.toFixed(1)}% | ${s.worst.toFixed(1)}% | ${s.positive} | ${s.negative} |\n`;
    }
    md += `\n`;

    return md;
}
