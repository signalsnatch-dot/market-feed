#!/usr/bin/env node
// scripts/analyzeLatency.js
// Analyzes raw tick CSVs in ./extracted to quantify latency, out-of-order ticks,
// duplicate quotes, and non-monotonic exchange_timestamps.
// For 09:00-10:00 IST, subdivides into 10-minute segments.
//
// Usage: node scripts/analyzeLatency.js [--instrument MCX_FO|538685] [--date 2026-07-08]
//   Without flags: processes ALL files in ./extracted
//   --instrument: filter to one instrument key
//   --date: filter to one date (YYYY-MM-DD)

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const EXTRACTED_DIR = path.resolve(__dirname, '..', 'extracted');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'latency-analysis-report.json');

// ============================================================
// IST TIME UTILITIES (mathematical, no Intl dependency)
// ============================================================
function utcMsToISTHour(ms) {
    const istMs = ms + (5.5 * 60 * 60 * 1000);
    const date = new Date(istMs);
    return date.getUTCHours(); // 0-23 in IST
}

function utcMsToISTMinute(ms) {
    const istMs = ms + (5.5 * 60 * 60 * 1000);
    const date = new Date(istMs);
    return date.getUTCMinutes(); // 0-59 in IST
}

// Returns a string segment key for aggregation.
// For 09:00-10:00 IST: subdivides into 10-minute segments ("09:00-09:10", "09:10-09:20", ...)
// For all other hours: full-hour segments ("10:00-11:00", "11:00-12:00", ...)
function timeSegmentKey(ms) {
    const hour = utcMsToISTHour(ms);
    const minute = utcMsToISTMinute(ms);

    if (hour === 9) {
        const segStart = Math.floor(minute / 10) * 10;
        const segEnd = segStart + 10;
        const endHour = segEnd === 60 ? 10 : 9;
        const endMin = segEnd === 60 ? 0 : segEnd;
        return `09:${String(segStart).padStart(2, '0')}-${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')} IST`;
    }

    const start = String(hour).padStart(2, '0') + ':00';
    const end = String((hour + 1) % 24).padStart(2, '0') + ':00';
    return `${start}-${end} IST`;
}

function formatISTHour(hour) {
    const start = String(hour).padStart(2, '0') + ':00';
    const end = String((hour + 1) % 24).padStart(2, '0') + ':00';
    return `${start}-${end} IST`;
}

function isMarketHoursSegment(segKey) {
    // segKey like "09:00-09:10 IST" or "10:00-11:00 IST"
    const hourStr = segKey.split(':')[0];
    const hour = parseInt(hourStr, 10);
    return hour >= 9 && hour <= 23;
}

// Define the expected order for 09:00-10:00 sub-segments + other hours
const SEGMENT_ORDER_09 = [
    '09:00-09:10 IST', '09:10-09:20 IST', '09:20-09:30 IST',
    '09:30-09:40 IST', '09:40-09:50 IST', '09:50-10:00 IST',
];

function segmentSortKey(segKey) {
    // 09:xx sub-segments get ordered first, then numeric hours 10-23
    if (segKey.startsWith('09:')) {
        const idx = SEGMENT_ORDER_09.indexOf(segKey);
        return idx !== -1 ? idx : 0;
    }
    const hourStr = segKey.split(':')[0];
    const hour = parseInt(hourStr, 10);
    return hour + 100; // offset past 09 sub-segments
}

// ============================================================
// LATENCY BUCKETS (in milliseconds)
// ============================================================
const LATENCY_BUCKETS = [
    { label: '≤100ms', max: 100 },
    { label: '101-500ms', min: 101, max: 500 },
    { label: '501ms-1s', min: 501, max: 1000 },
    { label: '1-3s', min: 1001, max: 3000 },
    { label: '3-5s', min: 3001, max: 5000 },
    { label: '5-10s', min: 5001, max: 10000 },
    { label: '10-20s', min: 10001, max: 20000 },
    { label: '20-30s', min: 20001, max: 30000 },
    { label: '30-45s', min: 30001, max: 45000 },
    { label: '45-60s', min: 45001, max: 60000 },
    { label: '>60s', min: 60001, max: Infinity },
];

function bucketLatency(ms) {
    for (const b of LATENCY_BUCKETS) {
        if (ms <= (b.max || Infinity) && (b.min === undefined || ms >= b.min)) {
            return b.label;
        }
    }
    return '>60s';
}

// ============================================================
// DATA STRUCTURES
// ============================================================

function createSegmentStats() {
    return {
        totalTicks: 0,
        latencyBuckets: {},
        outOfOrderTicks: 0,
        duplicateTicks: 0,
        nonMonotonicExchangeTs: 0,
        outOfOrderLatencyBuckets: {},
        extremeDelays: {
            count: 0,
            examples: [],
        },
    };
}

function initLatencyBucketMap() {
    const map = {};
    for (const b of LATENCY_BUCKETS) {
        map[b.label] = 0;
    }
    return map;
}

function createInstrumentStats() {
    return {
        totalTicks: 0,
        totalFiles: 0,
        latencyBuckets: initLatencyBucketMap(),
        outOfOrderTicks: 0,
        duplicateTicks: 0,
        nonMonotonicExchangeTs: 0,
        outOfOrderLatencyBuckets: initLatencyBucketMap(),
        segments: {},    // segmentKey -> segment stats
        dates: new Set(),
    };
}

const globalStats = {
    totalTicks: 0,
    totalOutOfOrder: 0,
    totalDuplicate: 0,
    totalNonMonotonicExchangeTs: 0,
    totalFiles: 0,
    latencyBuckets: initLatencyBucketMap(),
    outOfOrderLatencyBuckets: initLatencyBucketMap(),
    segments: {},       // segmentKey -> segment stats
    instruments: {},
};

function getOrCreateSegment(segmentsMap, segKey) {
    if (!segmentsMap[segKey]) {
        segmentsMap[segKey] = createSegmentStats();
        segmentsMap[segKey].latencyBuckets = initLatencyBucketMap();
        segmentsMap[segKey].outOfOrderLatencyBuckets = initLatencyBucketMap();
    }
    return segmentsMap[segKey];
}

function getOrCreateInstrument(instKey) {
    if (!globalStats.instruments[instKey]) {
        globalStats.instruments[instKey] = createInstrumentStats();
    }
    return globalStats.instruments[instKey];
}

// ============================================================
// FILE PROCESSING
// ============================================================

async function processFile(filePath, fileName) {
    const instrumentKey = extractInstrumentKey(fileName);
    if (!instrumentKey) {
        console.error(`  ⚠️ Could not extract instrument key from: ${fileName}`);
        return;
    }

    const instStats = getOrCreateInstrument(instrumentKey);
    instStats.totalFiles++;
    globalStats.totalFiles++;

    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
        instStats.dates.add(dateMatch[1]);
    }

    let prevVolumeToday = null;
    let prevLtp = null;
    let prevExchangeTs = null;
    let lineCount = 0;
    let tickCount = 0;
    let headerParsed = false;
    let colIdx = {};

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (!line) continue;
        lineCount++;

        if (!headerParsed) {
            const hLine = line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line;
            const headers = hLine.split(',').map(h => h.trim());
            colIdx = {
                receiveTimestamp: headers.indexOf('receive_timestamp'),
                receiveTimeIso: headers.indexOf('receive_time_iso'),
                exchangeTimestamp: headers.indexOf('exchange_timestamp'),
                exchangeTimeIso: headers.indexOf('exchange_time_iso'),
                latencyMs: headers.indexOf('latency_ms'),
                instrumentKey: headers.indexOf('instrument_key'),
                ltp: headers.indexOf('ltp'),
                lastTradedQty: headers.indexOf('last_traded_quantity'),
                volumeToday: headers.indexOf('volume_today'),
            };
            headerParsed = true;
            continue;
        }

        const parts = line.split(',');
        if (parts.length < 9) continue;

        const receiveTs = parseInt(parts[colIdx.receiveTimestamp], 10);
        const exchangeTs = parseInt(parts[colIdx.exchangeTimestamp], 10);
        const latencyMs = parseInt(parts[colIdx.latencyMs], 10);
        const instKey = parts[colIdx.instrumentKey];
        const ltp = parseFloat(parts[colIdx.ltp]);
        const volumeToday = parseInt(parts[colIdx.volumeToday], 10);

        if (isNaN(receiveTs) || isNaN(exchangeTs) || isNaN(ltp) || isNaN(volumeToday)) continue;
        if (instKey !== instrumentKey) continue;

        tickCount++;

        const segKey = timeSegmentKey(receiveTs);
        const latencyBucket = bucketLatency(latencyMs);

        // ── Global aggregation ──
        globalStats.totalTicks++;
        globalStats.latencyBuckets[latencyBucket]++;

        const gs = getOrCreateSegment(globalStats.segments, segKey);
        gs.totalTicks++;
        gs.latencyBuckets[latencyBucket]++;

        // ── Instrument aggregation ──
        instStats.totalTicks++;
        instStats.latencyBuckets[latencyBucket]++;

        const is = getOrCreateSegment(instStats.segments, segKey);
        is.totalTicks++;
        is.latencyBuckets[latencyBucket]++;

        // ── Out-of-order detection ──
        if (prevVolumeToday !== null) {
            if (volumeToday < prevVolumeToday) {
                globalStats.totalOutOfOrder++;
                instStats.outOfOrderTicks++;
                gs.outOfOrderTicks++;
                gs.outOfOrderLatencyBuckets[latencyBucket]++;
                is.outOfOrderTicks++;
                is.outOfOrderLatencyBuckets[latencyBucket]++;
                globalStats.outOfOrderLatencyBuckets[latencyBucket]++;
                instStats.outOfOrderLatencyBuckets[latencyBucket]++;

                if (latencyMs > 30000 && gs.extremeDelays.examples.length < 5) {
                    gs.extremeDelays.examples.push({
                        receive_ts: receiveTs,
                        exchange_ts: exchangeTs,
                        latency_ms: latencyMs,
                        ltp,
                        volume_today: volumeToday,
                        prev_volume_today: prevVolumeToday,
                        instrument_key: instKey,
                    });
                }
                gs.extremeDelays.count++;
            }

            if (volumeToday === prevVolumeToday && ltp === prevLtp) {
                globalStats.totalDuplicate++;
                instStats.duplicateTicks++;
                gs.duplicateTicks++;
                is.duplicateTicks++;
            }
        }

        if (prevExchangeTs !== null && exchangeTs < prevExchangeTs) {
            globalStats.totalNonMonotonicExchangeTs++;
            instStats.nonMonotonicExchangeTs++;
            gs.nonMonotonicExchangeTs++;
            is.nonMonotonicExchangeTs++;
        }

        prevVolumeToday = volumeToday;
        prevLtp = ltp;
        prevExchangeTs = exchangeTs;
    }

    rl.close();

    console.log(`   ✅ ${fileName}: ${tickCount.toLocaleString()} ticks (${lineCount.toLocaleString()} lines)`);
    if (instStats.outOfOrderTicks > 0) {
        const pct = ((instStats.outOfOrderTicks / tickCount) * 100).toFixed(2);
        console.log(`      ⚠️ Out-of-order: ${instStats.outOfOrderTicks} (${pct}%)`);
    }
}

function extractInstrumentKey(fileName) {
    const match = fileName.match(/^(MCX_FO|NSE_FO|NSE_EQ)_([^_]+(?:_[^_]+)*)_raw_ticks_/);
    if (match) {
        return match[1] + '|' + match[2];
    }
    return null;
}

// ============================================================
// REPORT GENERATION
// ============================================================

function sortedSegmentKeys(segmentsMap) {
    return Object.keys(segmentsMap).sort((a, b) => segmentSortKey(a) - segmentSortKey(b));
}

function buildLatencyTable(statsObj) {
    const table = [];
    const total = statsObj.totalTicks || 0;
    for (const b of LATENCY_BUCKETS) {
        const count = statsObj.latencyBuckets[b.label] || 0;
        table.push({
            bucket: b.label,
            count,
            percent: total > 0 ? ((count / total) * 100).toFixed(2) + '%' : '0.00%',
        });
    }
    return table;
}

function buildSegmentReport(segmentsMap) {
    const keys = sortedSegmentKeys(segmentsMap);
    const report = [];

    for (const segKey of keys) {
        const s = segmentsMap[segKey];
        const total = s.totalTicks;
        if (total === 0) continue;

        report.push({
            time_segment: segKey,
            total_ticks: total,
            latency_distribution: buildLatencyTable(s),
            out_of_order: {
                count: s.outOfOrderTicks,
                percent: ((s.outOfOrderTicks / total) * 100).toFixed(2) + '%',
                latency_of_out_of_order: buildLatencyTable({
                    totalTicks: s.outOfOrderTicks,
                    latencyBuckets: s.outOfOrderLatencyBuckets,
                }),
            },
            duplicate_ticks: {
                count: s.duplicateTicks,
                percent: ((s.duplicateTicks / total) * 100).toFixed(2) + '%',
            },
            non_monotonic_exchange_ts: {
                count: s.nonMonotonicExchangeTs,
                percent: ((s.nonMonotonicExchangeTs / total) * 100).toFixed(2) + '%',
            },
            extreme_delays_gt_30s: {
                count: s.extremeDelays.count,
                examples: s.extremeDelays.examples,
            },
        });
    }
    return report;
}

function buildInstrumentReport(instKey, stats) {
    const total = stats.totalTicks;
    return {
        instrument_key: instKey,
        total_files: stats.totalFiles,
        dates: Array.from(stats.dates).sort(),
        total_ticks: total,
        overall_latency: buildLatencyTable(stats),
        out_of_order: {
            total: stats.outOfOrderTicks,
            percent: ((stats.outOfOrderTicks / total) * 100).toFixed(2) + '%',
            latency_distribution: buildLatencyTable({
                totalTicks: stats.outOfOrderTicks,
                latencyBuckets: stats.outOfOrderLatencyBuckets,
            }),
        },
        duplicate_ticks: {
            total: stats.duplicateTicks,
            percent: ((stats.duplicateTicks / total) * 100).toFixed(2) + '%',
        },
        non_monotonic_exchange_ts: {
            total: stats.nonMonotonicExchangeTs,
            percent: ((stats.nonMonotonicExchangeTs / total) * 100).toFixed(2) + '%',
        },
        time_segment_breakdown: buildSegmentReport(stats.segments),
    };
}

function buildSummaryStats(statsObj) {
    const total = statsObj.totalTicks;
    return {
        total_ticks: total.toLocaleString(),
        total_files: statsObj.totalFiles,
        latency_distribution: buildLatencyTable(statsObj),
        out_of_order: {
            total: statsObj.totalOutOfOrder,
            percent: ((statsObj.totalOutOfOrder / total) * 100).toFixed(2) + '%',
            latency_distribution: buildLatencyTable({
                totalTicks: statsObj.totalOutOfOrder,
                latencyBuckets: statsObj.outOfOrderLatencyBuckets,
            }),
        },
        duplicate_ticks: {
            total: statsObj.totalDuplicate,
            percent: ((statsObj.totalDuplicate / total) * 100).toFixed(2) + '%',
        },
        non_monotonic_exchange_ts: {
            total: statsObj.totalNonMonotonicExchangeTs,
            percent: ((statsObj.totalNonMonotonicExchangeTs / total) * 100).toFixed(2) + '%',
        },
    };
}

function printConsoleReport(report) {
    console.log('\n' + '='.repeat(100));
    console.log('📊 LATENCY ANALYSIS REPORT');
    console.log('='.repeat(100));

    const s = report.summary;
    console.log(`\n📋 OVERALL SUMMARY`);
    console.log(`   Total Ticks: ${s.total_ticks}`);
    console.log(`   Total Files: ${s.total_files}`);
    console.log(`   Out-of-Order Ticks: ${s.out_of_order.total} (${s.out_of_order.percent})`);
    console.log(`   Duplicate Ticks: ${s.duplicate_ticks.total} (${s.duplicate_ticks.percent})`);
    console.log(`   Non-Monotonic Exchange TS: ${s.non_monotonic_exchange_ts.total} (${s.non_monotonic_exchange_ts.percent})`);

    console.log(`\n📈 OVERALL LATENCY DISTRIBUTION`);
    console.log('   ' + '-'.repeat(60));
    console.log(`   ${'Bucket'.padEnd(15)} ${'Count'.padEnd(12)} ${'Percent'}`);
    console.log('   ' + '-'.repeat(60));
    for (const b of s.latency_distribution) {
        console.log(`   ${b.bucket.padEnd(15)} ${String(b.count).padEnd(12)} ${b.percent}`);
    }

    console.log(`\n⚠️  OUT-OF-ORDER TICKS — LATENCY DISTRIBUTION`);
    console.log('   ' + '-'.repeat(60));
    console.log(`   ${'Bucket'.padEnd(15)} ${'Count'.padEnd(12)} ${'Percent of OOO'}`);
    console.log('   ' + '-'.repeat(60));
    for (const b of s.out_of_order.latency_distribution) {
        console.log(`   ${b.bucket.padEnd(15)} ${String(b.count).padEnd(12)} ${b.percent}`);
    }

    console.log(`\n🕐 TIME SEGMENT BREAKDOWN (Global)`);
    console.log(`   (09:00-10:00 IST shown in 10-minute segments)`);
    for (const h of report.time_segments_global) {
        console.log(`\n   ${h.time_segment}: ${h.total_ticks.toLocaleString()} ticks`);
        console.log(`      Out-of-Order: ${h.out_of_order.count} (${h.out_of_order.percent})`);
        console.log(`      Duplicates: ${h.duplicate_ticks.count} (${h.duplicate_ticks.percent})`);

        const topBuckets = h.latency_distribution
            .filter(b => b.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
        if (topBuckets.length > 0) {
            console.log(`      Top latency: ${topBuckets.map(b => `${b.bucket}: ${b.percent}`).join(', ')}`);
        }

        if (h.extreme_delays_gt_30s.count > 0) {
            console.log(`      ⚠️ Extreme delays (>30s): ${h.extreme_delays_gt_30s.count}`);
        }
    }

    console.log(`\n📊 PER-INSTRUMENT SUMMARY`);
    console.log('   ' + '-'.repeat(80));
    const sortedInst = Object.entries(report.instruments)
        .sort((a, b) => b[1].out_of_order.total - a[1].out_of_order.total);

    for (const [key, istats] of sortedInst) {
        const oooPct = istats.out_of_order.percent;
        const marker = istats.out_of_order.total > 0 ? ' ⚠️' : '';
        console.log(`   ${key.padEnd(25)} Ticks: ${String(istats.total_ticks).padStart(8)}  OOO: ${String(istats.out_of_order.total).padStart(6)} (${oooPct})${marker}`);
    }

    console.log('\n' + '='.repeat(100));
    console.log(`📁 Full report saved to: ${OUTPUT_FILE}`);
    console.log('='.repeat(100) + '\n');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    const args = process.argv.slice(2);
    const filterInstrument = getArg(args, '--instrument');
    const filterDate = getArg(args, '--date');

    console.log('🔍 Latency Analysis Tool (09:00-10:00 IST = 10-min segments)');
    console.log(`   Directory: ${EXTRACTED_DIR}`);
    if (filterInstrument) console.log(`   Filter instrument: ${filterInstrument}`);
    if (filterDate) console.log(`   Filter date: ${filterDate}`);
    console.log('');

    if (!fs.existsSync(EXTRACTED_DIR)) {
        console.error(`❌ Directory not found: ${EXTRACTED_DIR}`);
        process.exit(1);
    }

    const allFiles = fs.readdirSync(EXTRACTED_DIR)
        .filter(f => f.endsWith('.csv') && f.includes('_raw_ticks_'))
        .sort();

    let filesToProcess = allFiles;

    if (filterInstrument) {
        const safeKey = filterInstrument.replace(/\|/g, '_');
        filesToProcess = filesToProcess.filter(f => f.startsWith(safeKey));
    }

    if (filterDate) {
        filesToProcess = filesToProcess.filter(f => f.includes(filterDate));
    }

    if (filesToProcess.length === 0) {
        console.log('❌ No matching files found.');
        console.log(`   Available files in ${EXTRACTED_DIR}: ${allFiles.length}`);
        if (allFiles.length > 0) {
            console.log('   Sample files:');
            allFiles.slice(0, 10).forEach(f => console.log(`     - ${f}`));
        }
        process.exit(0);
    }

    console.log(`📂 Processing ${filesToProcess.length} file(s)...\n`);

    for (const file of filesToProcess) {
        const filePath = path.join(EXTRACTED_DIR, file);
        try {
            await processFile(filePath, file);
        } catch (err) {
            console.error(`   ❌ Error processing ${file}: ${err.message}`);
        }
    }

    const instrumentReports = {};
    for (const [instKey, stats] of Object.entries(globalStats.instruments)) {
        instrumentReports[instKey] = buildInstrumentReport(instKey, stats);
    }

    const report = {
        generated_at: new Date().toISOString(),
        source_directory: EXTRACTED_DIR,
        files_processed: filesToProcess.length,
        summary: buildSummaryStats(globalStats),
        time_segments_global: buildSegmentReport(globalStats.segments),
        instruments: instrumentReports,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf8');

    printConsoleReport(report);
}

function getArg(args, flag) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
        return args[idx + 1];
    }
    return null;
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});