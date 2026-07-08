// candleBuilderOffline.js - Processes ticks in streaming fashion without accumulating data in memory
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const INPUT_DIR = './extracted';
const OUTPUT_DIR = './candles';
const CONFIG_FILE = './build-version-config.json';

const MCX_MULTIPLIERS = {
    '538685': 1250, '538686': 250, '520702': 100, '520703': 10,
    '464150': 30, '471726': 5, '488788': 1, '568831': 2500,
    '568836': 5000, '568833': 5000, '568830': 5000, '466583': 100,
    '510764': 10, '552721': 1, '552706': 5000, '552709': 5000,
    '552708': 2500, '552711': 5000, '464151': 5, '477177': 1, '510464': 1
};
const INDEX_MULTIPLIERS = { '61093': 75, '61088': 30, '61091': 40, '61092': 120 };

function getLotMultiplier(instKey) {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'config.json'), 'utf8'));
        const i = cfg.instruments?.find(x => x.key === instKey);
        if (i && i.lotSize !== undefined) return i.lotSize;
    } catch (e) {}
    try {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, CONFIG_FILE), 'utf8'));
        const i = cfg.find(x => x.instrument_key === instKey);
        if (i && i.lotSize !== undefined) return i.lotSize;
    } catch (e) {}
    const id = instKey.includes('|') ? instKey.split('|')[1] : instKey;
    return MCX_MULTIPLIERS[id] ?? INDEX_MULTIPLIERS[id] ?? 1;
}

const CANDLE_MODE = process.argv.includes('--continuous') ? 'continuous' : 'discrete';
console.log(`📊 Candle mode: ${CANDLE_MODE}`);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function formatRow(c, bn) {
    const ds = ((c.end_timestamp - c.start_timestamp) / 1000).toFixed(1);
    const pc = c.close - c.open;
    const pcp = ((pc / c.open) * 100).toFixed(2);
    const pr = c.high - c.low;
    const prp = ((pr / c.open) * 100).toFixed(2);
    const ats = (c.volume / c.transactions).toFixed(2);
    const ve = (c.volume / c.target_volume).toFixed(2);
    return [c.end_timestamp, bn, c.instrument_key, c.name,
        c.open.toFixed(4), c.high.toFixed(4), c.low.toFixed(4), c.close.toFixed(4),
        c.volume, c.target_volume, c.transactions, c.price_changes,
        ats, pc.toFixed(4), pcp, pr.toFixed(4), prp, ve,
        c.start_time || '', c.end_time || '', ds].join(',') + '\n';
}

/**
 * Process a single file by reading it line-by-line with readline.
 * Each line is parsed and applied to ALL thresholds immediately.
 * Completed candles are written to disk with fs.appendFileSync.
 * 
 * Memory: only ~10 candle state objects per threshold. No ticks array, no lines array.
 */
async function processFileStream(file, thresholds, inst, name, mode, summaryPath) {
    const fp = path.join(INPUT_DIR, file);
    const safe = inst.replace(/[\\/:*?"<>|]/g, '_');
    const md = mode === 'continuous' ? 'continuous' : 'discrete';
    const bname = path.basename(file, path.extname(file));

    // Create per-threshold state
    const states = thresholds.map(t => {
        const dir = path.join(OUTPUT_DIR, safe, md, String(t));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const csvPath = path.join(dir, `${bname}_candles.csv`);
        fs.writeFileSync(csvPath, 'timestamp,bar_number,instrument_key,name,open,high,low,close,volume,target_volume,transactions,price_changes,avg_trade_size,price_change,price_change_percent,price_range,price_range_percent,volume_efficiency,start_time,end_time,duration_seconds\n');
        return {
            t, csvPath, count: 0, bn: 0,
            candle: null, waiting: false
        };
    });

    const isCont = mode === 'continuous';
    let lastVol = null;
    let headersFound = null;
    let idxInst = -1, idxLtp = -1, idxLtq = -1, idxExt = -1, idxExIso = -1, idxVolToday = -1;

    const rl = readline.createInterface({
        input: fs.createReadStream(fp, { encoding: 'utf8' }),
        crlfDelay: Infinity
    });

    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (!line) continue;

        if (headersFound === null) {
            // BOM check
            const hLine = line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line;
            const h = hLine.split(',').map(x => x.trim());
            idxInst = h.indexOf('instrument_key');
            idxLtp = h.indexOf('ltp');
            idxLtq = h.indexOf('last_traded_quantity');
            idxExt = h.indexOf('exchange_timestamp');
            idxExIso = h.indexOf('exchange_time_iso');
            idxVolToday = h.indexOf('volume_today');
            headersFound = true;
            continue;
        }

        const parts = line.split(',');
        if (parts.length < Math.max(idxInst, idxLtp, idxLtq, idxExt, idxExIso) + 1) continue;
        if (!parts[idxInst].includes('|')) continue;

        const ltp = parseFloat(parts[idxLtp]);
        const ltq = parseInt(parts[idxLtq], 10);
        const ext = parseInt(parts[idxExt], 10);
        if (isNaN(ltp) || isNaN(ltq) || isNaN(ext)) continue;

        const lotMul = getLotMultiplier(parts[idxInst]);
        let vol = ltq / lotMul;
        const exIso = idxExIso !== -1 ? parts[idxExIso] : '';

        if (idxVolToday !== -1 && parts[idxVolToday].trim() !== '') {
            const vt = parseInt(parts[idxVolToday], 10);
            if (!isNaN(vt) && vt > 0) {
                if (lastVol !== null && vt >= lastVol) vol = vt - lastVol;
                lastVol = vt;
            }
        }

        if (vol <= 0) continue;

        for (const s of states) {
            if (s.waiting) s.waiting = false;

            if (s.candle === null) {
                s.candle = {
                    instrument_key: inst, name, open: null, high: null, low: null, close: null,
                    volume: 0, target_volume: s.t, start_time: null, end_time: null,
                    start_timestamp: null, end_timestamp: null, transactions: 0, price_changes: 0
                };
            }

            let tv = vol;
            if (isCont) {
                let wl = false;
                while (tv > 0) {
                    if (s.candle.open === null) {
                        s.candle.open = s.candle.high = s.candle.low = s.candle.close = ltp;
                        s.candle.start_time = exIso;
                        s.candle.start_timestamp = ext;
                    }
                    const need = s.t - s.candle.volume;
                    let add, exc, rem;
                    if (tv <= need) { add = tv; tv = 0; exc = false; }
                    else { add = need; rem = tv - need; tv = 0; exc = true; }

                    if (s.candle.transactions > 0) {
                        if (ltp !== s.candle.close) s.candle.price_changes++;
                        if (ltp > s.candle.high) s.candle.high = ltp;
                        if (ltp < s.candle.low) s.candle.low = ltp;
                        s.candle.close = ltp;
                    }
                    s.candle.volume += add;
                    s.candle.end_time = exIso;
                    s.candle.end_timestamp = ext;
                    s.candle.transactions++;

                    if (s.candle.volume >= s.t) {
                        s.bn++;
                        fs.appendFileSync(s.csvPath, formatRow(s.candle, s.bn));
                        s.count++;
                        if (exc) {
                            const pc = s.candle.close;
                            s.candle = {
                                instrument_key: inst, name,
                                open: pc, high: pc, low: pc, close: pc,
                                volume: 0, target_volume: s.t,
                                start_time: s.candle.end_time, end_time: s.candle.end_time,
                                start_timestamp: s.candle.end_timestamp, end_timestamp: s.candle.end_timestamp,
                                transactions: 0, price_changes: 0
                            };
                            tv = rem;
                        } else {
                            s.waiting = true; s.candle = null; wl = true; break;
                        }
                    } else break;
                }
                if (wl) continue;
            } else {
                if (s.candle.open === null) {
                    s.candle.open = s.candle.high = s.candle.low = s.candle.close = ltp;
                    s.candle.start_time = exIso;
                    s.candle.start_timestamp = ext;
                } else {
                    if (ltp !== s.candle.close) s.candle.price_changes++;
                    if (ltp > s.candle.high) s.candle.high = ltp;
                    if (ltp < s.candle.low) s.candle.low = ltp;
                    s.candle.close = ltp;
                }
                s.candle.volume += tv;
                s.candle.end_time = exIso;
                s.candle.end_timestamp = ext;
                s.candle.transactions++;

                if (s.candle.volume >= s.t) {
                    s.bn++;
                    fs.appendFileSync(s.csvPath, formatRow(s.candle, s.bn));
                    s.count++;
                    const pc = s.candle.close;
                    s.candle = {
                        instrument_key: inst, name,
                        open: pc, high: pc, low: pc, close: pc,
                        volume: 0, target_volume: s.t,
                        start_time: s.candle.end_time, end_time: s.candle.end_time,
                        start_timestamp: s.candle.end_timestamp, end_timestamp: s.candle.end_timestamp,
                        transactions: 0, price_changes: 0
                    };
                    s.waiting = true;
                }
            }
        }
    }

    // Flush final candles
    for (const s of states) {
        if (s.candle && s.candle.volume > 0 && s.candle.open !== null) {
            s.bn++;
            fs.appendFileSync(s.csvPath, formatRow(s.candle, s.bn));
            s.count++;
        }
        if (s.count > 0) {
            console.log(`  -> Saved ${s.count} candles (threshold ${s.t})`);
            fs.appendFileSync(summaryPath, [file, inst, mode, s.t, s.count, 0, '0.00', 0, '0.00'].join(',') + '\n');
        }
    }
}

function peekInstrument(file) {
    const fp = path.join(INPUT_DIR, file);
    const peekFd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(65536);
    const bytesRead = fs.readSync(peekFd, buf, 0, 65536, 0);
    fs.closeSync(peekFd);
    const peekStr = buf.toString('utf8', 0, bytesRead);
    const newlineIdx = peekStr.indexOf('\n');
    if (newlineIdx === -1) return null;
    const hdrsLine = peekStr.charCodeAt(0) === 0xFEFF ? peekStr.slice(1, newlineIdx) : peekStr.slice(0, newlineIdx);
    const rest = peekStr.slice(newlineIdx + 1);
    const secondNewline = rest.indexOf('\n');
    const firstDataLine = (secondNewline !== -1 ? rest.slice(0, secondNewline) : rest).trim();
    if (!hdrsLine || !firstDataLine) return null;
    const hdrs = hdrsLine.split(',').map(h => h.trim());
    const dataParts = firstDataLine.split(',');
    const idxInst = hdrs.indexOf('instrument_key');
    const idxExt = hdrs.indexOf('exchange_timestamp');
    if (idxInst === -1 || dataParts.length <= idxInst) return null;
    return { inst: dataParts[idxInst], ext: idxExt !== -1 && dataParts.length > idxExt ? parseInt(dataParts[idxExt], 10) : null, hdrsLine };
}

async function main() {
    if (!fs.existsSync(CONFIG_FILE)) { console.error('❌ Config not found'); process.exit(1); }
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    const instCfg = new Map();
    for (const item of config) {
        if (!item.instrument_key || (!item.thresholds && !item.static_thresholds)) continue;
        instCfg.set(item.instrument_key, {
            name: item.name || item.instrument_key,
            thresholds: item.thresholds,
            static_thresholds: item.static_thresholds || []
        });
    }

    const files = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    if (!files.length) { console.log('❌ No CSV files'); return; }
    console.log(`📂 Found ${files.length} file(s)`);
    console.log(`📊 Candle mode: ${CANDLE_MODE}`);

    // Peek all files to determine instrument + thresholds ahead of time
    const fileTasks = [];
    for (const file of files) {
        const peek = peekInstrument(file);
        if (!peek) continue;
        const cfg = instCfg.get(peek.inst);
        if (!cfg) { console.log(`   ⚠️ No config for ${peek.inst}`); continue; }
        let dateKey = null;
        if (peek.ext !== null && !isNaN(peek.ext)) {
            let ts = peek.ext;
            if (ts < 10000000000) ts *= 1000;
            const d = new Date(ts);
            dateKey = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`;
        }
        let thresholds = [];
        if (cfg.thresholds && typeof cfg.thresholds === 'object' && !Array.isArray(cfg.thresholds)) {
            if (dateKey && cfg.thresholds[dateKey] !== undefined) thresholds.push(cfg.thresholds[dateKey]);
        } else if (Array.isArray(cfg.thresholds)) {
            thresholds = [...cfg.thresholds];
        }
        if (Array.isArray(cfg.static_thresholds)) {
            for (const v of cfg.static_thresholds) {
                if (!thresholds.includes(v)) thresholds.push(v);
            }
        }
        if (!thresholds.length) { console.warn(`   ⚠️ No thresholds for ${peek.inst}`); continue; }
        fileTasks.push({ file, inst: peek.inst, name: cfg.name, thresholds, dateKey });
    }

    if (!fileTasks.length) { console.log('❌ No files to process.'); return; }
    console.log(`📋 Queued ${fileTasks.length} instruments\n`);

    // Collect summary data in memory to avoid concurrent appendFileSync to summary.csv
    const summaryRows = [];
    const summaryPath = path.join(OUTPUT_DIR, 'summary.csv');
    fs.writeFileSync(summaryPath, 'source_file,instrument_key,mode,threshold,total_candles,total_volume,avg_volume_per_candle,total_transactions,avg_duration_seconds\n');

    const CONCURRENCY = 8;
    let processed = 0;
    const total = fileTasks.length;

    async function processOneTask(task) {
        console.log(`📄 ${task.file}  (${task.inst} | ${task.dateKey || '??'})  [thresholds: ${task.thresholds.join(', ')}]`);
        const counter = { count: 0 };
        // Create a per-file summary path that processFileStream can write to
        const localSummary = task.file + '.tmp';
        fs.writeFileSync(localSummary, '');
        await processFileStream(task.file, task.thresholds, task.inst, task.name, CANDLE_MODE, localSummary);
        // Read back local summary and collect rows
        const content = fs.readFileSync(localSummary, 'utf8').trim();
        fs.unlinkSync(localSummary);
        if (content) {
            for (const row of content.split('\n')) {
                if (row.trim()) summaryRows.push(row);
            }
        }
        processed++;
        console.log(`   ✅ ${task.file} [${processed}/${total}]`);
    }

    // Parallel worker pool - processes up to CONCURRENCY files at a time
    const workers = [];
    let taskIdx = 0;
    async function worker() {
        while (taskIdx < fileTasks.length) {
            const task = fileTasks[taskIdx++];
            await processOneTask(task);
        }
    }
    for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    // Write all summary rows at once (serialized)
    if (summaryRows.length) {
        fs.appendFileSync(summaryPath, summaryRows.join('\n') + '\n');
    }

    if (!processed) { console.log('\n❌ No candles generated.'); return; }
    console.log(`\n✅ Done! ${processed} files processed in parallel (concurrency=${CONCURRENCY}).`);
}

main();