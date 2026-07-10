#!/usr/bin/env node
// generateLiveTradeReportV2.js - Single-day live signals performance report (V2).
// Mirrors generateReport.js compact summary sections adapted for live trading signals.
//
// Usage: node generateLiveTradeReportV2.js [date_override]
//   date_override: optional, format DD/MM/YY (e.g., 10/07/26). Defaults to today's date.

const fs = require('fs');
const path = require('path');

// --- Configuration ---
const OUTPUT_DIR = './live-performance-report';

// Get date: from CLI arg, or from environment, or today's IST
const args = process.argv.slice(2);
let reportDate = args[0] || getTodayIST();

function getTodayIST() {
    const now = new Date();
    const opts = { timeZone: 'Asia/Kolkata', year: '2-digit', month: '2-digit', day: '2-digit' };
    const fmt = new Intl.DateTimeFormat('en-GB', opts);
    return fmt.format(now); // DD/MM/YY
}
console.log(`Report date: ${reportDate}`);

// Build the signals URL from the report date
// Convert DD/MM/YY → YYYY-MM-DD for the URL
const dateParts = reportDate.split('/');
const urlDate = `20${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
const DATA_URL = `http://13.201.36.159:8000/candles_data/signals_today_${urlDate}.json`;

const startTime = '09:00';
const endTime = '23:35';

const versionRegex = /^V(\d+):/;
const MIN_TRADES = 1; // For live reports, show even single trades

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

function write(w, str) { w.write(str); }

function computeMetricsRaw(arr) {
    const totalTrades = arr.length;
    if (totalTrades === 0) return { totalTrades: 0, winRate: 0, totalReturn: 0, avgReturn: 0, avgMafe: 0, avgMae: 0 };
    const wins = arr.filter(t => t.pnlPercentage > 0).length;
    const winRate = (wins / totalTrades) * 100;
    const totalReturn = arr.reduce((s, t) => s + (t.pnlPercentage || 0), 0);
    const avgReturn = totalReturn / totalTrades;
    const validMafe = arr.filter(t => t.mafePercentage != null);
    const avgMafe = validMafe.length > 0 ? validMafe.reduce((s, t) => s + t.mafePercentage, 0) / validMafe.length : 0;
    const validMae = arr.filter(t => t.maePercentage != null);
    const avgMae = validMae.length > 0 ? validMae.reduce((s, t) => s + t.maePercentage, 0) / validMae.length : 0;
    return { totalTrades, winRate, totalReturn, avgReturn, avgMafe, avgMae };
}

function comboWR(c) { return c.count > 0 ? (c.wins / c.count) * 100 : 0; }

// ── Main ──
async function main() {
    try {
        console.log(`Fetching live trade objects from: ${DATA_URL}`);
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`HTTP fetch failed: ${response.status}`);
        let data = await response.json();
        if (!Array.isArray(data)) data = [data];

        const resolvedEndTime = endTime;
        console.log(`Applying IST session filter: ${startTime} to ${resolvedEndTime}`);

        // Build p-index lookup from build-version-config.json for today's date
        const thresholdDateMap = new Map(); // "instrument|date|threshold" → "pX"
        const instrumentStaticThresholds = new Map(); // "instrument" → [static_thresholds]
        try {
            const configPath = path.resolve(__dirname, 'build-version-config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            for (const entry of config) {
                const name = getInstrumentDisplayName(entry.instrument_key.replace('|', '_'));
                if (entry.static_thresholds && Array.isArray(entry.static_thresholds)) {
                    instrumentStaticThresholds.set(name, entry.static_thresholds);
                }
                if (entry.thresholds && typeof entry.thresholds === 'object') {
                    for (const [date, thArray] of Object.entries(entry.thresholds)) {
                        if (!Array.isArray(thArray)) continue;
                        for (let i = 0; i < thArray.length; i++) {
                            thresholdDateMap.set(`${name}|${date}|${thArray[i]}`, `p${i + 1}`);
                        }
                    }
                }
            }
        } catch (e) { /* ignore */ }

        function resolvePIdx(instrument, threshold) {
            const thNum = typeof threshold === 'string' ? parseInt(threshold, 10) : threshold;
            // Try date-specific first
            const key = `${instrument}|${reportDate}|${thNum}`;
            if (thresholdDateMap.has(key)) return thresholdDateMap.get(key);
            // Fallback: nearest in static_thresholds
            const staticTh = instrumentStaticThresholds.get(instrument);
            if (staticTh && staticTh.length > 0) {
                let bestIdx = 0, bestDist = Infinity;
                for (let i = 0; i < staticTh.length; i++) {
                    const dist = Math.abs(staticTh[i] - thNum);
                    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                }
                return `p${bestIdx + 1}`;
            }
            return `${thNum}`; // absolute fallback
        }

        // ── Process signals ──
        const completedTrades = [];
        const pendingSignals = [];

        data.forEach(signal => {
            if (!signal || !signal.version) return;
            const vMatch = signal.version.match(versionRegex);
            if (!vMatch) return;

            const instrumentName = getInstrumentDisplayName(signal.instrument || signal.name || '');
            const threshold = signal.threshold || signal.volumePerBar || 'N/A';
            const barType = signal.bar_type || 'volume';

            const trade = {
                version: signal.version,
                instrument: instrumentName,
                threshold,
                barType,
                pIdx: resolvePIdx(instrumentName, threshold),
                entry: signal.entry,
                exitPrice: signal.exitPrice || null,
                pnlPercentage: signal.pnlPercentage != null ? parseFloat(signal.pnlPercentage) : null,
                maePercentage: signal.maePercentage != null ? parseFloat(signal.maePercentage) : null,
                mafePercentage: signal.mafePercentage != null ? parseFloat(signal.mafePercentage) : null,
                confidence: signal.confidence || null,
                type: signal.type || '',
                status: signal.status || 'pending',
                timestamp: signal.timestamp,
            };

            if (signal.status === 'completed') {
                // Compute pnlPercentage if missing
                if (trade.pnlPercentage == null && trade.entry && trade.exitPrice) {
                    if (trade.type.toUpperCase().includes('BUY')) {
                        trade.pnlPercentage = ((trade.exitPrice - trade.entry) / trade.entry) * 100;
                    } else if (trade.type.toUpperCase().includes('SELL')) {
                        trade.pnlPercentage = ((trade.entry - trade.exitPrice) / trade.entry) * 100;
                    }
                }
                trade.pnlPercentage = parseFloat(trade.pnlPercentage) || 0;
                completedTrades.push(trade);
            } else if (signal.status === 'pending' || signal.status === 'active') {
                pendingSignals.push(trade);
            }
        });

        console.log(`Processed: ${completedTrades.length} completed, ${pendingSignals.length} pending`);

        if (completedTrades.length === 0 && pendingSignals.length === 0) {
            console.log("No signals found.");
            process.exit(0);
        }

        const hasMaeMafe = completedTrades.some(t => t.mafePercentage != null || t.maePercentage != null);

        // ── Build grouped data from completed trades ──
        const comboGroup = {}; // "instrument|version|pIdx" → {count, wins, sumPnl, sumMafe, sumMae}
        for (const t of completedTrades) {
            const ck = `${t.instrument}|${t.version}|${t.pIdx}`;
            if (!comboGroup[ck]) comboGroup[ck] = { version: t.version, instrument: t.instrument, pIdx: t.pIdx, count: 0, wins: 0, sumPnl: 0, sumMafe: 0, sumMae: 0 };
            comboGroup[ck].count++;
            if (t.pnlPercentage > 0) comboGroup[ck].wins++;
            comboGroup[ck].sumPnl += t.pnlPercentage || 0;
            comboGroup[ck].sumMafe += t.mafePercentage || 0;
            comboGroup[ck].sumMae += t.maePercentage || 0;
        }

        const instCombos = new Map(); // instrument → [{version, pIdx, count, wins, sumPnl, sumMafe, sumMae}]
        for (const c of Object.values(comboGroup)) {
            if (c.count < MIN_TRADES) continue;
            if (!instCombos.has(c.instrument)) instCombos.set(c.instrument, []);
            instCombos.get(c.instrument).push(c);
        }

        // ── Generate compact summary ──
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        const timestamp = getFormattedTimestamp();
        const compactFile = path.join(OUTPUT_DIR, `live_compact_summary_v2_${timestamp}.md`);
        const cw = fs.createWriteStream(compactFile, 'utf8');

        write(cw, `# Live Trading Performance Compact Summary (V2)\n\n`);
        write(cw, `*Generated: ${new Date().toLocaleString()}*\n`);
        write(cw, `*Date: ${reportDate} | Session: ${startTime} - ${endTime}*\n`);
        write(cw, `*Completed Trades: ${completedTrades.length} | Pending Signals: ${pendingSignals.length}*\n\n`);

        // ── Section A: Per-Instrument Top 3 by Win Rate ──
        write(cw, `## Section A: Best Version+P-Value Per Instrument (Top 3 by Win Rate)\n\n`);
        write(cw, `| Instrument | Rank | Version | P-Value | Win Rate | Avg Return | Total Return | Trades |\n`);
        write(cw, `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n`);

        const instrumentTop3 = [];
        for (const [inst, combos] of instCombos) {
            combos.sort((a, b) => comboWR(b) - comboWR(a) || b.sumPnl - a.sumPnl);
            const top3 = combos.slice(0, 3);
            if (top3.length > 0) instrumentTop3.push({ instrument: inst, top3 });
            top3.forEach((v, idx) => {
                const wr = comboWR(v), ar = v.count > 0 ? v.sumPnl / v.count : 0;
                write(cw, `| ${inst} | #${idx + 1} | ${v.version} | ${v.pIdx} | ${wr.toFixed(1)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${v.sumPnl >= 0 ? '+' : ''}${v.sumPnl.toFixed(2)}% | ${v.count} |\n`);
            });
        }
        write(cw, `\n`);

        // ── Section A.2: Per-Instrument Top 3 by Total Return ──
        write(cw, `## Section A.2: Best Version+P-Value Per Instrument (Top 3 by Total Return)\n\n`);
        write(cw, `| Instrument | Rank | Version | P-Value | Win Rate | Avg Return | Total Return | Trades |\n`);
        write(cw, `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        const instrumentTop3ByRet = [];
        for (const [inst, combos] of instCombos) {
            const sortedByRet = [...combos].sort((a, b) => b.sumPnl - a.sumPnl || comboWR(b) - comboWR(a));
            const top3 = sortedByRet.slice(0, 3);
            if (top3.length > 0) instrumentTop3ByRet.push({ instrument: inst, top3 });
            top3.forEach((v, idx) => {
                const wr = comboWR(v), ar = v.count > 0 ? v.sumPnl / v.count : 0;
                write(cw, `| ${inst} | #${idx + 1} | ${v.version} | ${v.pIdx} | ${wr.toFixed(1)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${v.sumPnl >= 0 ? '+' : ''}${v.sumPnl.toFixed(2)}% | ${v.count} |\n`);
            });
        }
        write(cw, `\n`);

        // ── Section B: Cross-Instrument Version Rankings (from A) ──
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
        const versionRankings = [...versionScoreMap.entries()]
            .map(([ver, data]) => ({
                version: ver, appearances: data.appearances,
                avgWinRate: data.totalCount > 0 ? (data.totalWins / data.totalCount) * 100 : 0,
                avgReturn: data.totalCount > 0 ? data.totalSumPnl / data.totalCount : 0,
                totalTrades: data.totalCount,
                groups: data.groups,
            }))
            .sort((a, b) => b.appearances - a.appearances || b.avgWinRate - a.avgWinRate);

        write(cw, `## Section B: Overall Best-Performing Versions (Cross-Instrument)\n\n`);
        write(cw, `| Rank | Version | Groups in Top 3 | Avg Win Rate | Avg Return | Total Trades | Best Instruments |\n`);
        write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :--- |\n`);
        versionRankings.slice(0, 20).forEach((v, idx) => {
            write(cw, `| #${idx + 1} | ${v.version} | ${v.appearances} | ${v.avgWinRate.toFixed(1)}% | ${v.avgReturn >= 0 ? '+' : ''}${v.avgReturn.toFixed(2)}% | ${v.totalTrades} | ${v.groups.slice(0, 3).join(', ')} |\n`);
        });
        write(cw, `\n`);

        // ── Section B.2: Cross-Instrument Version Rankings (from A.2) ──
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
        const versionRankingsByRet = [...versionScoreMapByRet.entries()]
            .map(([ver, data]) => ({
                version: ver, appearances: data.appearances,
                avgWinRate: data.totalCount > 0 ? (data.totalWins / data.totalCount) * 100 : 0,
                totalTrades: data.totalCount, totalSumPnl: data.totalSumPnl,
                groups: data.groups,
            }))
            .sort((a, b) => b.appearances - a.appearances || b.totalSumPnl - a.totalSumPnl);

        write(cw, `## Section B.2: Overall Best-Performing Versions by Total Return (Cross-Instrument)\n\n`);
        write(cw, `| Rank | Version | Groups in Top 3 | Avg Win Rate | Total Return | Total Trades | Best Instruments |\n`);
        write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :--- |\n`);
        versionRankingsByRet.slice(0, 20).forEach((v, idx) => {
            write(cw, `| #${idx + 1} | ${v.version} | ${v.appearances} | ${v.avgWinRate.toFixed(1)}% | ${v.totalSumPnl >= 0 ? '+' : ''}${v.totalSumPnl.toFixed(2)}% | ${v.totalTrades} | ${v.groups.slice(0, 3).join(', ')} |\n`);
        });
        write(cw, `\n`);

        // ── Build versionCumulativeP and versionBest ──
        const versionCumulativeP = new Map();
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
                let best = null, bestWR = -1;
                for (const c of combos) {
                    const wr = comboWR(c);
                    if (wr > bestWR || (wr === bestWR && best && c.sumPnl > best.sumPnl)) { bestWR = wr; best = c; }
                }
                if (best) {
                    bestTotalCount += best.count; bestTotalWins += best.wins; bestTotalSumPnl += best.sumPnl;
                }
            }
            if (instSeen.size > 0 && bestTotalCount > 0) {
                versionBest.set(version, {
                    instrumentsUsed: instSeen.size, totalTrades: bestTotalCount,
                    winRate: (bestTotalWins / bestTotalCount) * 100,
                    avgReturn: bestTotalSumPnl / bestTotalCount,
                    totalPnlPct: bestTotalSumPnl, totalPnlAmount: 0,
                });
            }
        }

        // ── Section C.1: Per-Instrument Global Best P-Value ──
        write(cw, `## Section C: Global Best P-Value Analysis\n\n`);
        write(cw, `### C.1: Global Best P-Value Per Instrument\n\n`);
        write(cw, `| Instrument | Best P-Value | Win Rate | Total Return | Total Trades | Versions |\n`);
        write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        for (const [inst, combos] of instCombos) {
            const pAgg = new Map();
            for (const c of combos) {
                if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, verSet: new Set() });
                const e = pAgg.get(c.pIdx);
                e.count += c.count; e.wins += c.wins; e.sumPnl += c.sumPnl; e.verSet.add(c.version);
            }
            let bestP = null, bestWR = -1, bestSP = 0, bestTrades = 0, bestVerCnt = 0;
            for (const [p, d] of pAgg) {
                const wr = d.count > 0 ? (d.wins / d.count) * 100 : 0;
                if (wr > bestWR || (wr === bestWR && d.sumPnl > bestSP)) {
                    bestWR = wr; bestP = p; bestSP = d.sumPnl; bestTrades = d.count; bestVerCnt = d.verSet.size;
                }
            }
            if (bestP) write(cw, `| ${inst} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestSP >= 0 ? '+' : ''}${bestSP.toFixed(2)}% | ${bestTrades} | ${bestVerCnt} |\n`);
        }
        write(cw, `\n`);

        // ── C.1 (by Total Return) ──
        write(cw, `### C.1 (by Total Return): Global Best P-Value Per Instrument\n\n`);
        write(cw, `| Instrument | Best P-Value | Win Rate | Total Return | Total Trades | Versions |\n`);
        write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        for (const [inst, combos] of instCombos) {
            const pAgg = new Map();
            for (const c of combos) {
                if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, verSet: new Set() });
                const e = pAgg.get(c.pIdx);
                e.count += c.count; e.wins += c.wins; e.sumPnl += c.sumPnl; e.verSet.add(c.version);
            }
            let bestP = null, bestSP = -Infinity, bestWR = 0, bestTrades = 0, bestVerCnt = 0;
            for (const [p, d] of pAgg) {
                if (d.sumPnl > bestSP || (d.sumPnl === bestSP && (d.wins / d.count) * 100 > bestWR)) {
                    bestSP = d.sumPnl; bestP = p; bestWR = d.count > 0 ? (d.wins / d.count) * 100 : 0;
                    bestTrades = d.count; bestVerCnt = d.verSet.size;
                }
            }
            if (bestP) write(cw, `| ${inst} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestSP >= 0 ? '+' : ''}${bestSP.toFixed(2)}% | ${bestTrades} | ${bestVerCnt} |\n`);
        }
        write(cw, `\n`);

        // ── C.2: Per-Segment Best P-Value ──
        const SEGMENT_TYPES = new Map();
        for (const instName of [...instCombos.keys()]) {
            if (instName.includes('Future') && (instName.includes('Nifty') || instName.includes('Bank') || instName.includes('Fin') || instName.includes('Midcap')))
                SEGMENT_TYPES.set(instName, 'Index Future');
            else if (instName.includes('Future') && !instName.includes('Mini') && !instName.includes('Micro') && !instName.includes('Petal'))
                SEGMENT_TYPES.set(instName, 'Equity Future');
            else if (instName.includes('Future') || instName.includes('Mini') || instName.includes('Micro') || instName.includes('Petal') || instName.includes('Gold') || instName.includes('Silver') || instName.includes('Crude') || instName.includes('Natural Gas') || instName.includes('Copper'))
                SEGMENT_TYPES.set(instName, 'Commodity');
            else if (instName.includes('(Cash)'))
                SEGMENT_TYPES.set(instName, 'Equity Cash');
            else
                SEGMENT_TYPES.set(instName, 'Equity Cash');
        }

        const segPBest = new Map();
        for (const [inst, combos] of instCombos) {
            const seg = SEGMENT_TYPES.get(inst) || 'Other';
            if (!segPBest.has(seg)) segPBest.set(seg, new Map());
            const segMap = segPBest.get(seg);
            for (const c of combos) {
                if (!segMap.has(c.pIdx)) segMap.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, instruments: new Set() });
                const e = segMap.get(c.pIdx);
                e.count += c.count; e.wins += c.wins; e.sumPnl += c.sumPnl; e.instruments.add(inst);
            }
        }

        write(cw, `### C.2: Global Best P-Value Per Instrument Segment\n\n`);
        write(cw, `| Segment | Best P-Value | Win Rate | Total Return | Total Trades | Instruments |\n`);
        write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        for (const [seg, pMap] of segPBest) {
            let bestP = null, bestWR = -1, bestSP = 0, bestTrades = 0, bestIC = 0;
            for (const [p, d] of pMap) {
                const wr = d.count > 0 ? (d.wins / d.count) * 100 : 0;
                if (wr > bestWR || (wr === bestWR && d.sumPnl > bestSP)) { bestWR = wr; bestP = p; bestSP = d.sumPnl; bestTrades = d.count; bestIC = d.instruments.size; }
            }
            if (bestP) write(cw, `| ${seg} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestSP >= 0 ? '+' : ''}${bestSP.toFixed(2)}% | ${bestTrades} | ${bestIC} |\n`);
        }
        write(cw, `\n`);

        write(cw, `### C.2 (by Total Return): Global Best P-Value Per Instrument Segment\n\n`);
        write(cw, `| Segment | Best P-Value | Win Rate | Total Return | Total Trades | Instruments |\n`);
        write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        for (const [seg, pMap] of segPBest) {
            let bestP = null, bestSP = -Infinity, bestWR = 0, bestTrades = 0, bestIC = 0;
            for (const [p, d] of pMap) {
                if (d.sumPnl > bestSP || (d.sumPnl === bestSP && d.count > 0 && (d.wins / d.count) * 100 > bestWR)) {
                    bestSP = d.sumPnl; bestP = p; bestWR = d.count > 0 ? (d.wins / d.count) * 100 : 0;
                    bestTrades = d.count; bestIC = d.instruments.size;
                }
            }
            if (bestP) write(cw, `| ${seg} | ${bestP} | ${bestWR.toFixed(1)}% | ${bestSP >= 0 ? '+' : ''}${bestSP.toFixed(2)}% | ${bestTrades} | ${bestIC} |\n`);
        }
        write(cw, `\n`);

        // ── Section D.1: Per-Version Cumulative ──
        write(cw, `### Section D.1: All Versions — Cumulative Cross-Instrument Metrics\n\n`);
        write(cw, `| Version | Instruments | Total Trades | Win Rate | Avg Return | Total Return |\n`);
        write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        const sortedBest = [...versionBest.entries()].sort((a, b) =>
            parseInt(a[0].match(versionRegex)?.[1] || '0') - parseInt(b[0].match(versionRegex)?.[1] || '0'));
        for (const [ver, d] of sortedBest) {
            write(cw, `| ${ver} | ${d.instrumentsUsed} | ${d.totalTrades} | ${d.winRate.toFixed(1)}% | ${d.avgReturn >= 0 ? '+' : ''}${d.avgReturn.toFixed(2)}% | ${d.totalPnlPct >= 0 ? '+' : ''}${d.totalPnlPct.toFixed(2)}% |\n`);
        }
        write(cw, `\n`);

        // ── Section D.2: Global P-Value Rankings ──
        const globalPRankings = new Map();
        for (const [inst, combos] of instCombos) {
            for (const c of combos) {
                if (!globalPRankings.has(c.pIdx)) globalPRankings.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0 });
                const e = globalPRankings.get(c.pIdx);
                e.count += c.count; e.wins += c.wins; e.sumPnl += c.sumPnl;
            }
        }
        write(cw, `### Section D.2: Global Best P-Value Rankings\n\n`);
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
            write(cw, `| #${idx + 1} | ${p} | ${wr.toFixed(1)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${d.count} | ${d.count} |\n`);
        });
        write(cw, `\n`);

        write(cw, `### Section D.2 (by Total Return): Global Best P-Value Rankings\n\n`);
        write(cw, `| Rank | P-Value | Win Rate | Total Return | Avg Return | Total Trades |\n`);
        write(cw, `| :---: | :---: | :---: | :---: | :---: | :---: |\n`);
        const rankedPByRet = [...globalPRankings.entries()]
            .sort((a, b) => b[1].sumPnl - a[1].sumPnl);
        rankedPByRet.forEach(([p, d], idx) => {
            const wr = d.count > 0 ? (d.wins / d.count) * 100 : 0;
            const ar = d.count > 0 ? d.sumPnl / d.count : 0;
            write(cw, `| #${idx + 1} | ${p} | ${wr.toFixed(1)}% | ${d.sumPnl >= 0 ? '+' : ''}${d.sumPnl.toFixed(2)}% | ${ar >= 0 ? '+' : ''}${ar.toFixed(2)}% | ${d.count} |\n`);
        });
        write(cw, `\n`);

        // ── Section D.3: Per-Version Global Best P-Value ──
        write(cw, `### Section D.3: Per-Version Global Best P-Value (Single P-Value Fixed Across All Instruments)\n\n`);
        write(cw, `| Rank | Version | Best P-Value | Win Rate | Avg Return | Total Trades | Instruments | Other Top P-Values |\n`);
        write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`);
        const versionGlobalPBest = [];
        for (const [version, imap] of versionCumulativeP) {
            const pAgg = new Map();
            for (const [inst, combos] of imap) {
                for (const c of combos) {
                    if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, instSet: new Set() });
                    const e = pAgg.get(c.pIdx);
                    e.count += c.count; e.wins += c.wins; e.sumPnl += c.sumPnl; e.instSet.add(inst);
                }
            }
            const pRanked = [...pAgg.entries()]
                .map(([p, d]) => ({ p, wr: d.count > 0 ? (d.wins / d.count) * 100 : 0, ar: d.count > 0 ? d.sumPnl / d.count : 0, trades: d.count, instCnt: d.instSet.size }))
                .sort((a, b) => b.wr - a.wr || b.trades - a.trades);
            if (pRanked.length > 0) {
                const best = pRanked[0];
                const others = pRanked.slice(1, 4).map(x => `${x.p}(${x.wr.toFixed(0)}%)`).join(', ');
                versionGlobalPBest.push({ version, bestP: best.p, wr: best.wr, ar: best.ar, trades: best.trades, instCnt: best.instCnt, others });
            }
        }
        versionGlobalPBest.sort((a, b) => b.wr - a.wr || b.trades - a.trades);
        versionGlobalPBest.forEach((v, idx) => {
            write(cw, `| #${idx + 1} | ${v.version} | ${v.bestP} | ${v.wr.toFixed(1)}% | ${v.ar >= 0 ? '+' : ''}${v.ar.toFixed(2)}% | ${v.trades} | ${v.instCnt} | ${v.others} |\n`);
        });
        write(cw, `\n`);

        // D.3 (by Total Return)
        write(cw, `### Section D.3 (by Total Return): Per-Version Global Best P-Value\n\n`);
        write(cw, `| Rank | Version | Best P-Value | Win Rate | Total Return | Total Trades | Instruments | Others |\n`);
        write(cw, `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`);
        const versionGlobalPBestByRet = [];
        for (const [version, imap] of versionCumulativeP) {
            const pAgg = new Map();
            for (const [inst, combos] of imap) {
                for (const c of combos) {
                    if (!pAgg.has(c.pIdx)) pAgg.set(c.pIdx, { count: 0, wins: 0, sumPnl: 0, instSet: new Set() });
                    const e = pAgg.get(c.pIdx);
                    e.count += c.count; e.wins += c.wins; e.sumPnl += c.sumPnl; e.instSet.add(inst);
                }
            }
            const pRanked = [...pAgg.entries()]
                .map(([p, d]) => ({ p, wr: d.count > 0 ? (d.wins / d.count) * 100 : 0, sumPnl: d.sumPnl, trades: d.count, instCnt: d.instSet.size }))
                .sort((a, b) => b.sumPnl - a.sumPnl || b.wr - a.wr);
            if (pRanked.length > 0) {
                const best = pRanked[0];
                const others = pRanked.slice(1, 4).map(x => `${x.p}(+${x.sumPnl.toFixed(1)}%)`).join(', ');
                versionGlobalPBestByRet.push({ version, bestP: best.p, wr: best.wr, sumPnl: best.sumPnl, trades: best.trades, instCnt: best.instCnt, others });
            }
        }
        versionGlobalPBestByRet.sort((a, b) => b.sumPnl - a.sumPnl || b.wr - a.wr);
        versionGlobalPBestByRet.forEach((v, idx) => {
            write(cw, `| #${idx + 1} | ${v.version} | ${v.bestP} | ${v.wr.toFixed(1)}% | ${v.sumPnl >= 0 ? '+' : ''}${v.sumPnl.toFixed(2)}% | ${v.trades} | ${v.instCnt} | ${v.others} |\n`);
        });
        write(cw, `\n`);

        // ── Section F: Instrument-Type Recommendations ──
        const INST_TYPES = new Map();
        for (const instName of [...new Set([...instCombos.keys()])]) {
            if (instName.includes('Future') && (instName.includes('Nifty') || instName.includes('Bank') || instName.includes('Fin') || instName.includes('Midcap')))
                INST_TYPES.set(instName, 'Index Future');
            else if (instName.includes('Future') && !instName.includes('Mini') && !instName.includes('Micro') && !instName.includes('Petal') && !instName.includes('MCX'))
                INST_TYPES.set(instName, 'Equity Future');
            else if (instName.includes('Future') || instName.includes('Mini') || instName.includes('Micro') || instName.includes('Petal') || instName.includes('Gold') || instName.includes('Silver') || instName.includes('Crude') || instName.includes('Natural Gas') || instName.includes('Copper'))
                INST_TYPES.set(instName, 'Commodity');
            else if (instName.includes('(Cash)'))
                INST_TYPES.set(instName, 'Equity Cash');
            else
                INST_TYPES.set(instName, 'Equity Cash');
        }
        const typeCombos = new Map();
        for (const [inst, combos] of instCombos) {
            const type = INST_TYPES.get(inst) || 'Other';
            if (!typeCombos.has(type)) typeCombos.set(type, []);
            for (const c of combos) typeCombos.get(type).push({ ...c, instrument: inst });
        }
        write(cw, `## Section F: Instrument-Type Strategy Recommendations\n\n`);
        write(cw, `| Instrument Type | Best Version | Best Fix Group (Top 3) | Avg Win Rate | Instruments |\n`);
        write(cw, `| :--- | :--- | :--- | :---: | :---: |\n`);
        for (const [type, combos] of typeCombos) {
            const verMap = new Map();
            for (const c of combos) {
                if (!verMap.has(c.version)) verMap.set(c.version, { totalCount: 0, totalWins: 0, totalSumPnl: 0, comboCount: 0, instruments: new Set() });
                const e = verMap.get(c.version);
                e.totalCount += c.count; e.totalWins += c.wins; e.totalSumPnl += c.sumPnl; e.comboCount++; e.instruments.add(c.instrument);
            }
            const ranked = [...verMap.entries()]
                .map(([v, d]) => ({ version: v, wr: d.totalCount > 0 ? (d.totalWins / d.totalCount) * 100 : 0, instCount: d.instruments.size }))
                .sort((a, b) => b.wr - a.wr)
                .slice(0, 3);
            const bestName = ranked[0] ? `${ranked[0].version} (${ranked[0].wr.toFixed(1)}% WR)` : '—';
            const bestFixes = ranked.map(r => `${r.version.split(':')[0]}(${r.wr.toFixed(1)}%)`).join(', ');
            write(cw, `| ${type} | ${bestName} | ${bestFixes} | ${ranked[0] ? ranked[0].wr.toFixed(1) : '—'}% | ${[...new Set(combos.map(c => c.instrument))].length} |\n`);
        }
        write(cw, `\n`);

        // ── Section G: Best Version+Threshold Per Instrument (raw thresholds) ──
        write(cw, `## Section G: Best Version+Threshold Per Instrument\n\n`);
        write(cw, `| Instrument | Rank | Version | Threshold | Win Rate | Avg Return | Total Return | Trades |\n`);
        write(cw, `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        const instThrCombos = new Map();
        for (const t of completedTrades) {
            const inst = t.instrument;
            if (!instThrCombos.has(inst)) instThrCombos.set(inst, new Map());
            const thMap = instThrCombos.get(inst);
            const ck = `${t.version}|${t.threshold}`;
            if (!thMap.has(ck)) thMap.set(ck, []);
            thMap.get(ck).push(t);
        }
        for (const [inst, thMap] of instThrCombos) {
            const combos = [...thMap.entries()]
                .map(([ck, trades]) => {
                    const [version, threshold] = ck.split('|');
                    const m = computeMetricsRaw(trades);
                    return { version, threshold, wr: m.winRate, ar: m.avgReturn, tr: m.totalReturn, trades: m.totalTrades };
                })
                .sort((a, b) => b.wr - a.wr || b.tr - a.tr)
                .slice(0, 3);
            combos.forEach((v, idx) => {
                write(cw, `| ${inst} | #${idx + 1} | ${v.version} | ${v.threshold} | ${v.wr.toFixed(1)}% | ${v.ar >= 0 ? '+' : ''}${v.ar.toFixed(2)}% | ${v.tr >= 0 ? '+' : ''}${v.tr.toFixed(2)}% | ${v.trades} |\n`);
            });
        }
        write(cw, `\n`);

        // ── Section I: Live Trade Recommendations ──
        write(cw, `## Section I: Live Trade Recommendations\n\n`);
        const candidates = versionGlobalPBest.filter(v => v.trades >= 2 && v.instCnt >= 1).slice(0, 10);
        write(cw, `| Version | P-Value | Win Rate | Avg Return | Trades | Instruments |\n`);
        write(cw, `| :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        candidates.forEach(v => {
            write(cw, `| ${v.version} | ${v.bestP} | ${v.wr.toFixed(1)}% | ${v.ar >= 0 ? '+' : ''}${v.ar.toFixed(2)}% | ${v.trades} | ${v.instCnt} |\n`);
        });
        write(cw, `\n`);

        // ── Section P: Pending Signals ──
        write(cw, `## Section P: Pending/Active Signals Summary\n\n`);
        if (pendingSignals.length === 0) {
            write(cw, `*No pending signals.*\n\n`);
        } else {
            write(cw, `*${pendingSignals.length} signals currently active/pending.*\n\n`);
            write(cw, `| Instrument | Version | Type | Entry | P-Value | Conf |\n`);
            write(cw, `| :--- | :--- | :---: | :---: | :---: | :---: |\n`);
            pendingSignals.slice(0, 50).forEach(s => {
                write(cw, `| ${s.instrument} | ${s.version} | ${s.type} | ${s.entry || 'N/A'} | ${s.pIdx} | ${s.confidence || 'N/A'} |\n`);
            });
            if (pendingSignals.length > 50) write(cw, `| ... | ${pendingSignals.length - 50} more signals | ... | ... | ... | ... |\n`);
        }
        write(cw, `\n`);

        // ── Section: Daily Trade Log ──
        write(cw, `## Daily Trade Log (Completed)\n\n`);
        write(cw, `| # | Instrument | Version | P-Value | Type | Entry | Exit | PnL% |\n`);
        write(cw, `| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |\n`);
        completedTrades.forEach((t, idx) => {
            write(cw, `| ${idx + 1} | ${t.instrument} | ${t.version} | ${t.pIdx} | ${t.type} | ${t.entry || 'N/A'} | ${t.exitPrice || 'N/A'} | ${(t.pnlPercentage || 0) >= 0 ? '+' : ''}${(t.pnlPercentage || 0).toFixed(2)}% |\n`);
        });
        write(cw, `\n`);

        // Close stream
        await new Promise((resolve, reject) => {
            cw.end(() => { console.log(`Compact summary written to: ${compactFile}`); resolve(); });
            cw.on('error', reject);
        });

        console.log('\n✅ Live trade report V2 generation complete.');

    } catch (error) {
        console.error('Fatal error:', error.message);
        process.exit(1);
    }
}

main();