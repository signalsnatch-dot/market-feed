// candleBuilderOffline.js
const fs = require('fs');
const path = require('path');

// Configuration
const INPUT_DIR = './extracted';
const OUTPUT_DIR = './candles';
const CONFIG_FILE = './build-version-config.json';

function getLotMultiplier(instrumentKey) {
    if (!instrumentKey) return 1;

    // Standard local MCX multipliers
    const MCX_MULTIPLIERS = {
        '538685': 1250, '538686': 250, '520702': 100, '520703': 10,
        '464150': 30, '471726': 5, '488788': 1, '568831': 2500,
        '568836': 5000, '568833': 5000, '568830': 5000, '466583': 100,
        '510764': 10, '552721': 1, '552706': 5000, '552709': 5000,
        '552708': 2500, '552711': 5000, '464151': 5, '477177': 1, '510464': 1
    };

    try {
        const configPath = path.resolve(__dirname, 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const inst = config.instruments?.find(i => i.key === instrumentKey);
            if (inst && inst.lotSize !== undefined) {
                return inst.lotSize;
            }
        }
    } catch (e) {}

    try {
        const buildConfigPath = path.resolve(__dirname, CONFIG_FILE);
        if (fs.existsSync(buildConfigPath)) {
            const config = JSON.parse(fs.readFileSync(buildConfigPath, 'utf8'));
            const inst = config.find(i => i.instrument_key === instrumentKey || i.key === instrumentKey);
            if (inst && inst.lotSize !== undefined) {
                return inst.lotSize;
            }
        }
    } catch (e) {}

    const id = instrumentKey.includes('|') ? instrumentKey.split('|')[1] : instrumentKey;
    if (MCX_MULTIPLIERS[id] !== undefined) {
        return MCX_MULTIPLIERS[id];
    }
    
    // Check master index multipliers if NSE token
    const indexMultipliers = { '61093': 75, '61088': 30, '61091': 40, '61092': 120 };
    if (indexMultipliers[id] !== undefined) {
        return indexMultipliers[id];
    }
    return 1;
}
// Parse command line arguments for candle mode
const args = process.argv.slice(2);
const CANDLE_MODE = args.includes('--continuous') ? 'continuous' : 'discrete';

console.log(`📊 Candle mode: ${CANDLE_MODE}`);

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Parse a CSV line into an object, handling potential BOM and trimming.
 */
function parseCSVLine(line, headers) {
    const values = line.split(',');
    if (values.length !== headers.length) return null;
    const row = {};
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].trim();
        row[header] = values[i].trim();
    }
    return row;
}

/**
 * Validate a tick row.
 */
function isValidTick(row) {
    if (!row) return false;
    const required = ['instrument_key', 'ltp', 'last_traded_quantity', 'exchange_timestamp'];
    for (const field of required) {
        if (!row[field] || row[field] === '') return false;
    }
    if (!row.instrument_key.includes('|')) return false;
    const ltp = parseFloat(row.ltp);
    const volume = parseInt(row.last_traded_quantity, 10);
    if (isNaN(ltp) || isNaN(volume)) return false;
    return true;
}

/**
 * Read a single CSV file, sort chronologically, and calculate volume deltas dynamically.
 */
function readTicksFromFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const rawTicks = [];
    
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i], headers);
        if (!isValidTick(row)) continue;
        
        rawTicks.push({
            instrument_key: row.instrument_key,
            ltp: parseFloat(row.ltp),
            last_traded_quantity: parseInt(row.last_traded_quantity, 10),
            // Parse volume_today if it exists in the headers, default to null
            volume_today: row.volume_today !== undefined ? parseInt(row.volume_today, 10) : null,
            timestamp: parseInt(row.exchange_timestamp, 10),
            exchange_time_iso: row.exchange_time_iso
        });
    }
    
    // Sort chronologically before computing volume changes
    rawTicks.sort((a, b) => a.timestamp - b.timestamp);
    
    const processedTicks = [];
    let lastVolToday = null;

    for (const t of rawTicks) {
        const lotMultiplier = getLotMultiplier(t.instrument_key);
        let volume = (t.last_traded_quantity || 0) / lotMultiplier; // Convert fallback LTQ unit quantity to lots

        if (t.volume_today !== null && !isNaN(t.volume_today) && t.volume_today > 0) {
            if (lastVolToday !== null) {
                if (t.volume_today >= lastVolToday) {
                    volume = t.volume_today - lastVolToday; // Delta of volume_today is already in lots
                } else {
                    volume = (t.last_traded_quantity || 0) / lotMultiplier;
                }
            } else {
                volume = (t.last_traded_quantity || 0) / lotMultiplier;
            }
            lastVolToday = t.volume_today;
        }

        processedTicks.push({
            instrument_key: t.instrument_key,
            ltp: t.ltp,
            volume: volume,
            timestamp: t.timestamp,
            exchange_time_iso: t.exchange_time_iso
        });
    }

    return processedTicks;
}

/**
 * Generate volume candles with CONTINUOUS volume spread.
 * 
 * Rules:
 * 1. When volume reaches EXACTLY the threshold:
 *    - Candle closes
 *    - New candle starts with null OHLC and waits for next tick
 * 
 * 2. When volume EXCEEDS the threshold:
 *    - Candle closes with the volume needed to reach threshold
 *    - New candle starts with previous candle's close as OHLC
 *    - Excess volume is carried over to the new candle
 *    - If excess volume >= threshold, create multiple candles with same OHLC
 * 
 * 3. All candles (except the last) have exactly the threshold volume
 */
function generateVolumeCandlesContinuous(ticks, threshold, instrumentKey, instrumentName) {
    const candles = [];
    let currentCandle = null;
    let waitingForNextTick = false;  // True when we need to wait for next tick (exact match)

    for (const tick of ticks) {
        // If we're waiting for the next tick, reset the flag and start with this tick
        if (waitingForNextTick) {
            waitingForNextTick = false;
            // Continue to process this tick
        }

        // Initialize new candle if needed
        if (currentCandle === null) {
            currentCandle = {
                instrument_key: instrumentKey,
                name: instrumentName,
                open: null,
                high: null,
                low: null,
                close: null,
                volume: 0,
                target_volume: threshold,
                start_time: null,
                end_time: null,
                start_timestamp: null,
                end_timestamp: null,
                transactions: 0,
                price_changes: 0
            };
        }

        // Process this tick's volume
        let tickVolume = tick.volume;
        let isFirstTransaction = currentCandle.transactions === 0 || currentCandle.open === null;

        while (tickVolume > 0) {
            // If candle has no data yet, initialize with this tick
            if (isFirstTransaction || currentCandle.open === null) {
                currentCandle.open = tick.ltp;
                currentCandle.high = tick.ltp;
                currentCandle.low = tick.ltp;
                currentCandle.close = tick.ltp;
                currentCandle.start_time = tick.exchange_time_iso;
                currentCandle.start_timestamp = tick.timestamp;
                isFirstTransaction = false;
            }

            // Calculate how much volume we need to reach threshold
            const needed = threshold - currentCandle.volume;
            let volumeToAdd = 0;
            let exceededThreshold = false;
            let remainingVolume = 0;

            if (tickVolume <= needed) {
                // Case 1: Tick volume fits within the candle
                volumeToAdd = tickVolume;
                tickVolume = 0;
            } else {
                // Case 2: Tick volume exceeds needed
                volumeToAdd = needed;
                remainingVolume = tickVolume - needed;
                tickVolume = 0;
                exceededThreshold = true;
            }

            // Update candle with the tick data
            if (currentCandle.transactions > 0 && currentCandle.open !== null) {
                if (tick.ltp !== currentCandle.close) {
                    currentCandle.price_changes++;
                }
                currentCandle.high = Math.max(currentCandle.high, tick.ltp);
                currentCandle.low = Math.min(currentCandle.low, tick.ltp);
                currentCandle.close = tick.ltp;
            }

            currentCandle.volume += volumeToAdd;
            currentCandle.end_time = tick.exchange_time_iso;
            currentCandle.end_timestamp = tick.timestamp;
            currentCandle.transactions++;

            // Check if candle is complete
            if (currentCandle.volume >= threshold) {
                // Close the candle
                candles.push({ ...currentCandle });

                if (exceededThreshold) {
                    // Case: Volume EXCEEDED threshold
                    // New candle starts with previous close as OHLC
                    const prevClose = currentCandle.close;
                    
                    // Create new candle with previous close as OHLC
                    currentCandle = {
                        instrument_key: instrumentKey,
                        name: instrumentName,
                        open: prevClose,
                        high: prevClose,
                        low: prevClose,
                        close: prevClose,
                        volume: 0,
                        target_volume: threshold,
                        start_time: currentCandle.end_time,
                        end_time: currentCandle.end_time,
                        start_timestamp: currentCandle.end_timestamp,
                        end_timestamp: currentCandle.end_timestamp,
                        transactions: 0,
                        price_changes: 0
                    };

                    // Now process the remaining volume with the same tick data
                    // The remaining volume becomes the new tickVolume for the loop
                    tickVolume = remainingVolume;
                    
                    // Continue the loop to process remaining volume into the new candle
                    // The while loop will handle this with the same tick data
                    // We need to set isFirstTransaction to true for the new candle
                    isFirstTransaction = true;
                    
                    // Note: We don't break here - we continue the while loop to process remainingVolume
                    
                } else {
                    // Case: Volume reached EXACTLY threshold
                    // New candle should wait for next tick (null OHLC)
                    waitingForNextTick = true;
                    currentCandle = null;
                    break;  // Exit while loop, move to next tick
                }
            } else {
                // Candle not complete yet
                break;  // Exit while loop, move to next tick
            }
        }

        // If waitingForNextTick is true, we need to skip to the next tick
        // The current tick has already been fully processed
        if (waitingForNextTick) {
            // Reset the flag - the next iteration will handle the next tick
            // The tick was fully consumed in the exact match
            continue;
        }
    }

    // If there's any remaining volume in the current candle, save it as a final candle
    if (currentCandle !== null && currentCandle.volume > 0 && currentCandle.open !== null) {
        candles.push({ ...currentCandle });
    }

    return candles;
}

/**
 * Generate volume candles with DISCRETE volume accumulation.
 * 
 * Rules:
 * 1. When volume reaches EXACTLY the threshold:
 *    - Candle closes
 *    - New candle starts with null OHLC and waits for next tick
 * 
 * 2. When volume EXCEEDS the threshold:
 *    - Candle closes (with volume > threshold)
 *    - Excess volume is DISCARDED
 *    - New candle starts with previous candle's close as OHLC
 *    - Volume starts at 0 and waits for next tick to add volume
 * 
 * 3. Candles can have volume >= threshold (excess is kept, not carried over)
 */
function generateVolumeCandlesDiscrete(ticks, threshold, instrumentKey, instrumentName) {
    const candles = [];
    let currentCandle = null;
    let waitingForNextTick = false;  // True when we need to wait for next tick (exact match or exceeded)

    for (const tick of ticks) {
        // If we're waiting for the next tick, reset the flag
        if (waitingForNextTick) {
            waitingForNextTick = false;
            // Continue to process this tick
        }

        // Initialize new candle if needed
        if (currentCandle === null) {
            currentCandle = {
                instrument_key: instrumentKey,
                name: instrumentName,
                open: null,
                high: null,
                low: null,
                close: null,
                volume: 0,
                target_volume: threshold,
                start_time: null,
                end_time: null,
                start_timestamp: null,
                end_timestamp: null,
                transactions: 0,
                price_changes: 0
            };
        }

        // If candle has no data yet, initialize with this tick
        if (currentCandle.open === null) {
            currentCandle.open = tick.ltp;
            currentCandle.high = tick.ltp;
            currentCandle.low = tick.ltp;
            currentCandle.close = tick.ltp;
            currentCandle.start_time = tick.exchange_time_iso;
            currentCandle.start_timestamp = tick.timestamp;
        } else {
            // Update price stats
            if (tick.ltp !== currentCandle.close) {
                currentCandle.price_changes++;
            }
            currentCandle.high = Math.max(currentCandle.high, tick.ltp);
            currentCandle.low = Math.min(currentCandle.low, tick.ltp);
            currentCandle.close = tick.ltp;
        }

        // Add volume
        currentCandle.volume += tick.volume;
        currentCandle.end_time = tick.exchange_time_iso;
        currentCandle.end_timestamp = tick.timestamp;
        currentCandle.transactions++;

        // Check if threshold is met or exceeded
        if (currentCandle.volume >= threshold) {
            // Close the candle (keep the excess volume - it's part of this candle)
            candles.push({ ...currentCandle });
            
            // Start new candle with previous close as OHLC
            const prevClose = currentCandle.close;
            currentCandle = {
                instrument_key: instrumentKey,
                name: instrumentName,
                open: prevClose,
                high: prevClose,
                low: prevClose,
                close: prevClose,
                volume: 0,
                target_volume: threshold,
                start_time: currentCandle.end_time,
                end_time: currentCandle.end_time,
                start_timestamp: currentCandle.end_timestamp,
                end_timestamp: currentCandle.end_timestamp,
                transactions: 0,
                price_changes: 0
            };
            
            // Wait for next tick to add volume (excess volume is discarded)
            waitingForNextTick = true;
        }
    }

    // If there's any remaining volume in the current candle, save it as a final candle
    if (currentCandle !== null && currentCandle.volume > 0 && currentCandle.open !== null) {
        candles.push({ ...currentCandle });
    }

    return candles;
}

/**
 * Generate volume candles using the selected mode.
 */
function generateVolumeCandles(ticks, threshold, instrumentKey, instrumentName, mode) {
    if (mode === 'continuous') {
        return generateVolumeCandlesContinuous(ticks, threshold, instrumentKey, instrumentName);
    } else {
        return generateVolumeCandlesDiscrete(ticks, threshold, instrumentKey, instrumentName);
    }
}

/**
 * Save candles to CSV file with exact required format.
 */
function saveCandlesToCSV(candles, instrument, threshold, sourceFileName, mode) {
    const safeInstrument = instrument.replace(/[\\/:*?"<>|]/g, '_');
    const modeDir = mode === 'continuous' ? 'continuous' : 'discrete';
    const instrumentDir = path.join(OUTPUT_DIR, safeInstrument, modeDir);
    const thresholdDir = path.join(instrumentDir, threshold.toString());
    if (!fs.existsSync(thresholdDir)) {
        fs.mkdirSync(thresholdDir, { recursive: true });
    }

    const baseName = path.basename(sourceFileName, path.extname(sourceFileName));
    const outFileName = `${baseName}_candles.csv`;
    const filePath = path.join(thresholdDir, outFileName);

    const headers = [
        'timestamp', 'bar_number', 'instrument_key', 'name',
        'open', 'high', 'low', 'close',
        'volume', 'target_volume', 'transactions', 'price_changes',
        'avg_trade_size', 'price_change', 'price_change_percent',
        'price_range', 'price_range_percent', 'volume_efficiency',
        'start_time', 'end_time', 'duration_seconds'
    ];

    const writeStream = fs.createWriteStream(filePath);
    writeStream.write(headers.join(',') + '\n');

    candles.forEach((candle, idx) => {
        const barNumber = idx + 1;
        const durationSec = ((candle.end_timestamp - candle.start_timestamp) / 1000).toFixed(1);
        const priceChange = candle.close - candle.open;
        const priceChangePercent = ((priceChange / candle.open) * 100).toFixed(2);
        const priceRange = candle.high - candle.low;
        const priceRangePercent = ((priceRange / candle.open) * 100).toFixed(2);
        const avgTradeSize = (candle.volume / candle.transactions).toFixed(2);
        const volumeEfficiency = (candle.volume / candle.target_volume).toFixed(2);

        const row = [
            candle.end_timestamp,
            barNumber,
            candle.instrument_key,
            candle.name,
            candle.open.toFixed(4),
            candle.high.toFixed(4),
            candle.low.toFixed(4),
            candle.close.toFixed(4),
            candle.volume,
            candle.target_volume,
            candle.transactions,
            candle.price_changes,
            avgTradeSize,
            priceChange.toFixed(4),
            priceChangePercent,
            priceRange.toFixed(4),
            priceRangePercent,
            volumeEfficiency,
            candle.start_time,
            candle.end_time,
            durationSec
        ].join(',');

        writeStream.write(row + '\n');
    });

    writeStream.end();
    console.log(`  -> Saved ${candles.length} candles for ${instrument} (threshold ${threshold}, mode: ${mode}) from ${baseName}`);
}

/**
 * Generate a summary CSV across all processed files.
 */
function saveSummary(allResults) {
    const summaryPath = path.join(OUTPUT_DIR, 'summary.csv');
    const headers = ['source_file', 'instrument_key', 'mode', 'threshold', 'total_candles', 'total_volume', 'avg_volume_per_candle', 'total_transactions', 'avg_duration_seconds'];
    const writeStream = fs.createWriteStream(summaryPath);
    writeStream.write(headers.join(',') + '\n');

    for (const [sourceFile, instruments] of allResults.entries()) {
        for (const [instrument, modes] of instruments.entries()) {
            for (const [mode, thresholds] of modes.entries()) {
                for (const [threshold, candles] of thresholds.entries()) {
                    const totalVolume = candles.reduce((sum, c) => sum + c.volume, 0);
                    const totalTransactions = candles.reduce((sum, c) => sum + c.transactions, 0);
                    const avgDuration = candles.reduce((sum, c) => sum + (c.end_timestamp - c.start_timestamp), 0) / candles.length / 1000;
                    const row = [
                        sourceFile,
                        instrument,
                        mode,
                        threshold,
                        candles.length,
                        totalVolume,
                        (totalVolume / candles.length).toFixed(2),
                        totalTransactions,
                        avgDuration.toFixed(2)
                    ].join(',');
                    writeStream.write(row + '\n');
                }
            }
        }
    }
    writeStream.end();
    console.log(`\n✅ Summary saved to ${summaryPath}`);
}

/**
 * Main function.
 */
async function main() {
    if (!fs.existsSync(CONFIG_FILE)) {
        console.error(`❌ Configuration file not found: ${CONFIG_FILE}`);
        process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    const instrumentConfig = new Map();
    for (const item of config) {
        if (!item.instrument_key || (!item.thresholds && !item.static_thresholds)) {
            console.warn(`⚠️ Skipping invalid config entry: missing key or thresholds.`);
            continue;
        }
        instrumentConfig.set(item.instrument_key, {
            name: item.name || item.instrument_key,
            thresholds: item.thresholds,
            static_thresholds: item.static_thresholds || []
        });
    }

    const files = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    if (files.length === 0) {
        console.log(`❌ No CSV files found in ${INPUT_DIR}`);
        return;
    }

    console.log(`📂 Found ${files.length} file(s) in ${INPUT_DIR}`);
    console.log('📋 Using configuration from', CONFIG_FILE);
    console.log(`📊 Candle mode: ${CANDLE_MODE}`);

    const allResults = new Map();

    for (const file of files) {
        const filePath = path.join(INPUT_DIR, file);
        console.log(`\n📄 Processing ${file}...`);
        const ticks = readTicksFromFile(filePath);
        if (ticks.length === 0) {
            console.log(`   No valid ticks found. Skipping.`);
            continue;
        }

        const instrument = ticks[0].instrument_key;
        const configEntry = instrumentConfig.get(instrument);
        if (!configEntry) {
            console.log(`   ⚠️ No thresholds defined for ${instrument} in config. Skipping.`);
            continue;
        }

        // Format chronological date of tick file for threshold map lookups
        let dateKey = null;
        if (ticks.length > 0) {
            let ts = ticks[0].timestamp;
            if (ts < 10000000000) ts *= 1000; // Convert seconds to ms
            const d = new Date(ts);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = String(d.getFullYear()).slice(-2);
            dateKey = `${day}/${month}/${year}`;
        }

        console.log(`   Instrument: ${instrument} | Session Date: ${dateKey || 'Unknown'} (${ticks.length} ticks)`);

        let thresholdsToProcess = [];

        // 1. Process Date-Mapped dynamic thresholds
        if (configEntry.thresholds && typeof configEntry.thresholds === 'object' && !Array.isArray(configEntry.thresholds)) {
            if (dateKey && configEntry.thresholds[dateKey] !== undefined) {
                const dynamicThreshold = configEntry.thresholds[dateKey];
                thresholdsToProcess.push(dynamicThreshold);
                console.log(`   -> Found dynamic 10-day rolling threshold for ${dateKey}: ${dynamicThreshold}`);
            }
        } else if (Array.isArray(configEntry.thresholds)) {
            thresholdsToProcess = [...configEntry.thresholds];
        }

        // 2. Process Static / Fallback thresholds to verify alternative builds
        if (Array.isArray(configEntry.static_thresholds)) {
            for (const val of configEntry.static_thresholds) {
                if (!thresholdsToProcess.includes(val)) {
                    thresholdsToProcess.push(val);
                }
            }
        }

        if (thresholdsToProcess.length === 0) {
            console.warn(`   ⚠️ No thresholds to process for this file.`);
            continue;
        }

        const fileResults = new Map();
        const instrumentModes = new Map();
        const modeThresholds = new Map();

        for (const threshold of thresholdsToProcess) {
            console.log(`      Threshold ${threshold.toLocaleString()} (mode: ${CANDLE_MODE})...`);
            const candles = generateVolumeCandles(ticks, threshold, instrument, configEntry.name, CANDLE_MODE);
            if (candles.length === 0) {
                console.log(`         No candles generated.`);
                continue;
            }
            saveCandlesToCSV(candles, instrument, threshold, file, CANDLE_MODE);
            modeThresholds.set(threshold, candles);
        }

        if (modeThresholds.size > 0) {
            instrumentModes.set(CANDLE_MODE, modeThresholds);
            fileResults.set(instrument, instrumentModes);
            allResults.set(file, fileResults);
        }
    }

    if (allResults.size === 0) {
        console.log('\n❌ No candles generated for any instrument. Check configuration and data.');
        return;
    }

    saveSummary(allResults);
    console.log('\n🎉 All done!');
}

main().catch(console.error);