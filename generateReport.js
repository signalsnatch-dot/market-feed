const fs = require('fs');
const path = require('path');

const RESULTS_DIR = './version-backtest-results';
const OUTPUT_DIR = './version-backtest-report';

// Matches any V1 to V32 strategy
const versionRegex = /^V([1-9]|[1-2]\d|3[0-2]):/;

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
    'V32: 65-70% and More than 80% confidence of V18'
];

const INSTRUMENT_NAMES = {
    'INE009A01021': 'Infosys (INFY)',
    'INE397D01024': 'Bharti Airtel',
    'INE238A01034': 'Axis Bank',
    'INE437A01024': 'Apollo Hospitals',
    'INE038A01020': 'Hindalco',
    'INE155A01022': 'Tata Motors',
    'INE019A01038': 'JSW Steel',
    'INE522F01014': 'Coal India',
    'INE002A01018': 'Reliance Industries',
    'INE154A01025': 'ITC',
    'INE296A01032': 'Bajaj Finance',
    'INE018A01030': 'L&T',
    'INE423A01024': 'Adani Enterprises',
    'INE040A01034': 'HDFC Bank',
    'INE081A01020': 'Tata Steel',
    'INE090A01021': 'ICICI Bank',
    'INE044A01036': 'Sun Pharma',
    'INE467B01029': 'TCS',
    'INE062A01020': 'SBI',
    'INE742F01042': 'Adani Ports',
    '552706': 'Aluminium (MCX)',
    '552709': 'Lead (MCX)',
    '552708': 'Copper (MCX)',
    '552711': 'Zinc (MCX)',
    '464150': 'Silver (MCX)',
    '477177': 'Silver Micro (MCX)',
    '464151': 'Silver Mini (MCX)',
    '510464': 'Gold Petal (MCX)',
    '504265': 'Natural Gas (MCX)',
    '510764': 'Gold Mini (MCX)',
    '466583': 'Gold (MCX)',
    '62326': 'Bank Nifty',
    '62329': 'Nifty 50',
    '62328': 'Midcap Nifty',
    '62327': 'Fin Nifty'
};

const confidenceBuckets = [
    '< 45', '45-50', '50-55', '55-60', '60-65', '65-70', 
    '70-75', '75-80', '80-85', '85-90', '90-95', '95-100'
];

const mafeBuckets = [
    '0% - 20%', '21% - 40%', '41% - 60%', '61% - 80%', 
    '81% - 99%', '100% (Hit TP)', '101% - 150%', '151% - 200%', '> 200%'
];

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
    if (val >= 45 && val < 50) return '45-50';
    if (val >= 50 && val < 55) return '50-55';
    if (val >= 55 && val < 60) return '55-60';
    if (val >= 60 && val < 65) return '60-65';
    if (val >= 65 && val < 70) return '65-70';
    if (val >= 70 && val < 75) return '70-75';
    if (val >= 75 && val < 80) return '75-80';
    if (val >= 80 && val < 85) return '80-85';
    if (val >= 85 && val < 90) return '85-90';
    if (val >= 90 && val < 95) return '90-95';
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
    if (val > 100.01 && val <= 150) return '101% - 150%';
    if (val > 150 && val <= 200) return '151% - 200%';
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
    const totalReturn = tradesList.reduce((sum, t) => sum + (parseFloat(t.pnlPercentage) || 0), 0);
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
    // Parse format: continuous_<thresholdValue>_<instrument>_<date>.json
    const match = file.match(/^continuous_(\d+)_(.+?)_(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) return;

    const threshold = match[1];
    const rawInstrument = match[2];
    const date = match[3];
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
md += `## Section 2: Detailed Performance by Strategy Version (V1 to V32)\n\n`;

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
    const vTrades = flatTrades.filter(t => t.strategy === v);
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
    });
    md += `---\n\n`;
});

// --- Write Markdown file out to disk ---

try {
    // Generate directories recursively if needed
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    
    // Construct unique filename: backtest_analysis_report_<YYYY-MM-DD_HH-mm>.md
    const timestamp = getFormattedTimestamp();
    const targetFile = path.join(OUTPUT_DIR, `backtest_analysis_report_${timestamp}.md`);
    
    fs.writeFileSync(targetFile, md, 'utf8');
    console.log(`Success! Complete portfolio-wide multi-day analysis written to '${targetFile}'`);
} catch (e) {
    console.error(`Failed to write markdown output:`, e);
}