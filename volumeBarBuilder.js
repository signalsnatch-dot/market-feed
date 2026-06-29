// volumeBarBuilder.js
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { STRATEGIES } = require('./priceActionStrategy');

const MCX_LOT_MULTIPLIER_MAP = {
    '538685': 1250, // Natural Gas
    '520702': 100,  // Crude Oil
    '464150': 30,   // Silver Standard
    '464151': 5,    // Silver Mini
    '477177': 1,    // Silver Micro
    '552708': 2500, // Copper
    '552711': 5000, // Zinc
    '552709': 5000, // Lead
    '552706': 5000, // Aluminium
    '466583': 100,  // Gold Standard
    '510764': 10,   // Gold Mini
    '510464': 1,    // Gold Petal
    '565898': 50,   // Bulldex
};

function getLotMultiplier(instrumentKey) {
    if (!instrumentKey) return 1;
    if (instrumentKey.includes('MCX_FO')) {
        const id = instrumentKey.split('|')[1];
        if (MCX_LOT_MULTIPLIER_MAP[id] !== undefined) {
            return MCX_LOT_MULTIPLIER_MAP[id];
        }
    }
    return 1;
}

class VolumeBarBuilder extends EventEmitter {
    constructor(config) {
        super();
        this.instrumentConfigs = config.instruments;
        this.activeBars = new Map();
        this.completedBars = [];
        this.lastExchangeVolumeToday = new Map();
        this.tickSizeMap = new Map();
        
        this.dataDir = config.directories?.candlesDataDir || './candles_data/volume_bars';
        this.rawDataDir = config.directories?.rawDataDir || './raw_ticks_data';
        
        [this.dataDir, this.rawDataDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
        
        this.stats = {
            totalTicks: 0,
            totalVolume: 0,
            totalBars: 0,
            barsByInstrument: new Map()
        };
        
        this.initializeBars();
        this.loadHistoryFromCSV();
        this.loadActiveState();
    }
    
    initializeBars() {
        for (const instrument of this.instrumentConfigs) {
            this.activeBars.set(instrument.key, {
                instrument_key: instrument.key,
                name: instrument.name,
                targetVolume: instrument.volumePerBar,  
                currentVolume: 0,
                open: null,
                high: null,
                low: null,
                close: null,
                startTime: null,
                startTimestamp: null,
                lastUpdateTime: null,
                transactions: 0,
                priceChanges: 0,  
                bars: [],
                barNumber: 0,
                lastEmittedProgress: 0,
                lastSignalBarNumbers: {} 
            });
            
            this.stats.barsByInstrument.set(instrument.key, 0);
            this.tickSizeMap.set(instrument.key, instrument.tickSize !== undefined ? instrument.tickSize : 0.05);
            
            console.log(`📊 [VOLUME BAR] ${instrument.name}:`);
            console.log(`   Target: ${instrument.volumePerBar.toLocaleString()} lots/shares per bar`);
        }
    }

    loadHistoryFromCSV() {
        console.log('📂 Pre-populating volume bar histories from CSV files...');
        for (const [key, bar] of this.activeBars.entries()) {
            const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
            const filepath = path.join(this.dataDir, `${safeKey}_volume_bars.csv`);
            if (fs.existsSync(filepath)) {
                try {
                    const content = fs.readFileSync(filepath, 'utf8');
                    const lines = content.split('\n');
                    if (lines.length < 2) continue;
                    
                    const headers = lines[0].replace(/[\r\n]+/g, '').split(',');
                    const barNumberIdx = headers.indexOf('bar_number');
                    const openIdx = headers.indexOf('open');
                    const highIdx = headers.indexOf('high');
                    const lowIdx = headers.indexOf('low');
                    const closeIdx = headers.indexOf('close');
                    const volumeIdx = headers.indexOf('volume');
                    const transactionsIdx = headers.indexOf('transactions');
                    const priceChangesIdx = headers.indexOf('price_changes');
                    const startTimeIdx = headers.indexOf('start_time');
                    const endTimeIdx = headers.indexOf('end_time');
                    const durationIdx = headers.indexOf('duration_seconds');
                    const timestampIdx = headers.indexOf('timestamp');

                    const parsedBars = [];
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].replace(/[\r\n]+/g, '').trim();
                        if (!line) continue;
                        const values = line.split(',');
                        if (values.length < 10) continue;

                        parsedBars.push({
                            type: 'volume_bar',
                            instrument_key: key,
                            name: bar.name,
                            barNumber: parseInt(values[barNumberIdx]) || i,
                            open: parseFloat(values[openIdx]),
                            high: parseFloat(values[highIdx]),
                            low: parseFloat(values[lowIdx]),
                            close: parseFloat(values[closeIdx]),
                            volume: parseFloat(values[volumeIdx]),
                            targetVolume: parseFloat(values[endTimeIdx] ? (values[headers.indexOf('target_volume')] || bar.targetVolume) : bar.targetVolume),
                            transactions: parseInt(values[transactionsIdx]) || 0,
                            priceChanges: parseInt(values[priceChangesIdx]) || 0,
                            startTime: values[startTimeIdx] || '',
                            endTime: values[endTimeIdx] || '',
                            durationSeconds: parseFloat(values[durationIdx]) || 0,
                            timestamp: parseInt(values[timestampIdx]) || Date.now()
                        });
                    }

                    bar.bars = parsedBars.slice(-500);
                    this.stats.barsByInstrument.set(key, parsedBars.length);
                    console.log(`   ✅ Loaded ${bar.bars.length} historical bars for ${bar.name}`);
                } catch (err) {
                    console.error(`Failed to load history for ${bar.name}:`, err.message);
                }
            }
        }
    }
    
    saveActiveState() {
        const stateFile = path.join(this.dataDir, 'active_volume_bars_state.json');
        try {
            const state = {
                date: new Date().toISOString().split('T')[0],
                activeBars: Array.from(this.activeBars.entries()).map(([key, value]) => {
                    const { bars, ...activeState } = value;
                    return [key, activeState];
                }),
                lastExchangeVolumeToday: Array.from(this.lastExchangeVolumeToday.entries())
            };
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
        } catch (err) {
            console.error(`❌ [VOLUME BAR] State save failed:`, err.message);
        }
    }

    loadActiveState() {
        const stateFile = path.join(this.dataDir, 'active_volume_bars_state.json');
        if (fs.existsSync(stateFile)) {
            try {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                const today = new Date().toISOString().split('T')[0];
                
                if (state.date === today) {
                    if (Array.isArray(state.activeBars)) {
                        state.activeBars.forEach(([key, activeState]) => {
                            const existingBar = this.activeBars.get(key);
                            if (existingBar) {
                                // 1. Save the freshly loaded config-derived targetVolume
                                const freshTargetVolume = existingBar.targetVolume;
                                
                                // 2. Restore the active progress parameters
                                Object.assign(existingBar, activeState);
                                
                                // 3. Force re-align to the updated configuration threshold
                                existingBar.targetVolume = freshTargetVolume;
                            }
                        });
                    }
                    if (Array.isArray(state.lastExchangeVolumeToday)) {
                        this.lastExchangeVolumeToday = new Map(state.lastExchangeVolumeToday);
                    }
                    console.log(`✅ [VOLUME BAR] Restored active candle progress and cumulative baselines.`);
                } else {
                    fs.unlinkSync(stateFile);
                }
            } catch (err) {
                console.error(`❌ [VOLUME BAR] State recovery failed:`, err.message);
            }
        }
    }

    processTick(tickData) {
        const { instrument_key, ltp, last_traded_quantity, volume_today, exchange_timestamp, timestamp } = tickData;
        
        if (!ltp) return;
        
        const price = parseFloat(ltp);
        
        let tickVolume = 0;
        const currentVolToday = parseInt(volume_today, 10);
        const lotMultiplier = getLotMultiplier(instrument_key);

        if (!isNaN(currentVolToday) && currentVolToday > 0) {
            const prevVolToday = this.lastExchangeVolumeToday.get(instrument_key);
            
            if (prevVolToday !== undefined && prevVolToday !== null) {
                if (currentVolToday >= prevVolToday) {
                    tickVolume = currentVolToday - prevVolToday; // Delta of volume_today is already in lots
                } else {
                    tickVolume = (parseInt(last_traded_quantity, 10) || 0) / lotMultiplier; // Convert fallback LTQ units to lots
                }
            } else {
                tickVolume = (parseInt(last_traded_quantity, 10) || 0) / lotMultiplier;
            }
            this.lastExchangeVolumeToday.set(instrument_key, currentVolToday);
        } else {
            tickVolume = (parseInt(last_traded_quantity, 10) || 0) / lotMultiplier;
        }

        if (tickVolume <= 0) return;

        let exchangeTimeMs = Number(exchange_timestamp);
        if (isNaN(exchangeTimeMs) || exchangeTimeMs <= 0) {
            exchangeTimeMs = Date.now();
        }
        
        let receiveTimeMs = parseInt(timestamp, 10);
        if (isNaN(receiveTimeMs) || receiveTimeMs <= 0) {
            receiveTimeMs = Date.now();
        }
       
        const currentTime = exchangeTimeMs || receiveTimeMs;
        const exchangeTimeISO = exchangeTimeMs ? new Date(exchangeTimeMs).toISOString() : null;
        const receiveTimeISO = new Date(receiveTimeMs).toISOString();
        
        let bar = this.activeBars.get(instrument_key);
        if (!bar) return;
        
        this.stats.totalTicks++;
        this.stats.totalVolume += tickVolume;

        let isFirstTransaction = bar.transactions === 0 || bar.open === null;

        while (tickVolume > 0) {
            if (isFirstTransaction || bar.open === null) {
                bar.barNumber = this.stats.barsByInstrument.get(instrument_key) + 1;
                bar.open = price;
                bar.high = price;
                bar.low = price;
                bar.close = price;
                bar.startTime = currentTime;
                bar.startTimestamp = exchangeTimeISO || receiveTimeISO;
                bar.transactions = 0;
                bar.priceChanges = 0;
                isFirstTransaction = false;

                console.log(`\n🕯️ [VOLUME BAR] New continuous bar #${bar.barNumber} for ${bar.name}`);
                console.log(`   Starting price: ${price}`);
                console.log(`   Start time (exchange): ${bar.startTimestamp}`);
                console.log(`   Target volume: ${bar.targetVolume.toLocaleString()} lots/shares\n`);
            }

            const needed = bar.targetVolume - bar.currentVolume;
            let volumeToAdd = 0;
            let exceededThreshold = false;
            let remainingVolume = 0;

            if (tickVolume <= needed) {
                volumeToAdd = tickVolume;
                tickVolume = 0;
            } else {
                volumeToAdd = needed;
                remainingVolume = tickVolume - needed;
                tickVolume = 0;
                exceededThreshold = true;
            }

            if (bar.transactions > 0 && bar.open !== null) {
                if (price !== bar.close) {
                    bar.priceChanges++;
                }
                bar.high = Math.max(bar.high, price);
                bar.low = Math.min(bar.low, price);
                bar.close = price;
            }

            bar.currentVolume += volumeToAdd;
            bar.lastUpdateTime = currentTime;
            bar.lastUpdateTimestamp = exchangeTimeISO || receiveTimeISO;
            bar.transactions++;

            if (bar.currentVolume >= bar.targetVolume) {
                const prevClose = bar.close;
                this.closeBar(instrument_key, bar, exceededThreshold ? prevClose : null);

                bar = this.activeBars.get(instrument_key);

                if (exceededThreshold) {
                    tickVolume = remainingVolume;
                    isFirstTransaction = true;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        let finalActiveBar = this.activeBars.get(instrument_key);
        if (finalActiveBar && finalActiveBar.open !== null) {
            if (this.emit) {
                const liveCandle = {
                    instrument: instrument_key,
                    type: 'volume',
                    is_live: true,
                    barNumber: finalActiveBar.barNumber,
                    open: finalActiveBar.open,
                    high: finalActiveBar.high,
                    low: finalActiveBar.low,
                    close: finalActiveBar.close,
                    volume: finalActiveBar.currentVolume,
                    targetVolume: finalActiveBar.targetVolume,
                    transactions: finalActiveBar.transactions,
                    priceChanges: finalActiveBar.priceChanges,
                    startTime: finalActiveBar.startTimestamp,
                    timestamp: currentTime,
                    progress: (finalActiveBar.currentVolume / finalActiveBar.targetVolume) * 100
                };
                
                this.emit('live_candle_update', liveCandle);
            }

            const progress = (finalActiveBar.currentVolume / finalActiveBar.targetVolume) * 100;
            if (Math.floor(progress) % 10 === 0 && progress !== finalActiveBar.lastEmittedProgress) {
                finalActiveBar.lastEmittedProgress = progress;
                this.emit('bar_update', {
                    type: 'volume_bar',
                    instrument_key: finalActiveBar.instrument_key,
                    name: finalActiveBar.name,
                    barNumber: finalActiveBar.barNumber,
                    progress: progress.toFixed(1),
                    currentVolume: finalActiveBar.currentVolume.toLocaleString(),
                    targetVolume: finalActiveBar.targetVolume.toLocaleString(),
                    transactions: finalActiveBar.transactions,
                    priceChanges: finalActiveBar.priceChanges,
                    currentPrice: price
                });
            }
        }
    }
    
    closeBar(instrumentKey, bar, nextOhlc = null) {
        const completedBar = {
            type: 'volume_bar',
            instrument_key: instrumentKey,
            name: bar.name,
            barNumber: this.stats.barsByInstrument.get(instrumentKey) + 1,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.currentVolume,
            targetVolume: bar.targetVolume,
            transactions: bar.transactions,
            priceChanges: bar.priceChanges,
            avgTradeSize: bar.currentVolume / bar.transactions,
            startTime: bar.startTimestamp || new Date(bar.startTime).toISOString(),
            endTime: bar.lastUpdateTimestamp || new Date(bar.lastUpdateTimestamp).toISOString(),
            durationMs: bar.lastUpdateTime - bar.startTime,
            durationSeconds: ((bar.lastUpdateTime - bar.startTime) / 1000).toFixed(1),
            priceChange: (bar.close - bar.open).toFixed(2),
            priceChangePercent: (((bar.close - bar.open) / bar.open) * 100).toFixed(2),
            priceRange: (bar.high - bar.low).toFixed(2),
            priceRangePercent: (((bar.high - bar.low) / bar.open) * 100).toFixed(2),
            volumeEfficiency: bar.currentVolume / bar.targetVolume,
            timestamp: bar.lastUpdateTime
        };
        
        bar.bars.push(completedBar);
        this.completedBars.push(completedBar);
        this.stats.totalBars++;
        this.stats.barsByInstrument.set(instrumentKey, (this.stats.barsByInstrument.get(instrumentKey) || 0) + 1);
        
        this.saveBarToCSV(completedBar);
        this.saveActiveState();
        this.emit('bar_close', completedBar);
        
        console.log(`\n✅ [VOLUME BAR] COMPLETED: ${bar.name} - Bar #${bar.barNumber}`);
        console.log(`   Volume: ${bar.currentVolume.toLocaleString()} / ${bar.targetVolume.toLocaleString()} lots/shares`);
        console.log(`   OHLC: ${bar.open.toFixed(2)} | ${bar.high.toFixed(2)} | ${bar.low.toFixed(2)} | ${bar.close.toFixed(2)}`);
        
        const strategyCandles = bar.bars.map(b => ({
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
            timestamp: b.timestamp
        }));

        if (strategyCandles.length >= 32) {
            try {
                const tickSize = this.tickSizeMap.get(instrumentKey) || 0.05;
                if (!bar.lastSignalBarNumbers) bar.lastSignalBarNumbers = {};
                
                for (const [versionName, strategyFn] of Object.entries(STRATEGIES)) {
                    const signals = strategyFn(strategyCandles, { tickSize });
                    if (signals && signals.length > 0) {
                        const latestSignal = signals[signals.length - 1];
                        if (latestSignal.index === strategyCandles.length - 1) {
                            if (bar.lastSignalBarNumbers[versionName] !== bar.barNumber) {
                                bar.lastSignalBarNumbers[versionName] = bar.barNumber;
                                
                                let confidence = 50;
                                const confMatch = latestSignal.reason.match(/Conf:\s*(\d+)/i);
                                if (confMatch) confidence = parseInt(confMatch[1]);
                                
                                const signalEvent = {
                                    version: versionName, 
                                    instrument: instrumentKey,
                                    name: bar.name,
                                    type: latestSignal.type,
                                    entry: latestSignal.triggerPrice,
                                    sl: latestSignal.stopLoss,
                                    tp: latestSignal.takeProfit,
                                    confidence: confidence,
                                    reason: latestSignal.reason.replace('Conf:', 'Volume, Conf:'),
                                    timestamp: completedBar.timestamp,
                                    barNumber: bar.barNumber,
                                    bar_type: 'volume'
                                };
                                this.emit('trade_signal', signalEvent);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`Error processing signals:`, err.message);
            }
        }
        
        const nextBarNumber = this.stats.barsByInstrument.get(instrumentKey) + 1;
        this.activeBars.set(instrumentKey, {
            instrument_key: bar.instrument_key,
            name: bar.name,
            targetVolume: bar.targetVolume,
            currentVolume: 0,
            open: nextOhlc,
            high: nextOhlc,
            low: nextOhlc,
            close: nextOhlc,
            startTime: nextOhlc !== null ? bar.lastUpdateTime : null,
            startTimestamp: nextOhlc !== null ? bar.lastUpdateTimestamp : null,
            lastUpdateTime: nextOhlc !== null ? bar.lastUpdateTime : null,
            lastUpdateTimestamp: nextOhlc !== null ? bar.lastUpdateTimestamp : null,
            transactions: 0,
            priceChanges: 0,
            bars: bar.bars,
            barNumber: nextBarNumber,
            lastEmittedProgress: 0,
            lastSignalBarNumbers: bar.lastSignalBarNumbers
        });
    }
    
    saveBarToCSV(bar) {
        const safeKey = bar.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.dataDir, `${safeKey}_volume_bars.csv`);
        
        const headers = [
            'timestamp', 'bar_number', 'instrument_key', 'name',
            'open', 'high', 'low', 'close',
            'volume', 'target_volume', 'transactions', 'price_changes', 'avg_trade_size',
            'price_change', 'price_change_percent', 'price_range', 'price_range_percent',
            'volume_efficiency',
            'start_time', 'end_time', 'duration_seconds'
        ];
        
        const fileExists = fs.existsSync(filename);
        const writeStream = fs.createWriteStream(filename, { flags: 'a' });
        
        if (!fileExists) {
            writeStream.write(headers.join(',') + '\n');
        }
        
        const row = [
            bar.timestamp || Date.now(), bar.barNumber, bar.instrument_key, bar.name,
            bar.open, bar.high, bar.low, bar.close,
            bar.volume, bar.targetVolume, bar.transactions, bar.priceChanges, bar.avgTradeSize.toFixed(2),
            bar.priceChange, bar.priceChangePercent, bar.priceRange, bar.priceRangePercent,
            bar.volumeEfficiency.toFixed(2),
            bar.startTime, bar.endTime, bar.durationSeconds
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
    }
    
    getProgress(instrumentKey) {
        const bar = this.activeBars.get(instrumentKey);
        if (!bar || bar.open === null) return null;
        
        return {
            currentVolume: bar.currentVolume,
            targetVolume: bar.targetVolume,
            progress: ((bar.currentVolume / bar.targetVolume) * 100).toFixed(1) + '%',
            currentPrice: bar.close,
            transactions: bar.transactions,
            priceChanges: bar.priceChanges
        };
    }
    
    getGlobalStats() {
        return {
            totalTicks: this.stats.totalTicks,
            totalVolume: this.stats.totalVolume,
            totalBars: this.stats.totalBars,
            barsByInstrument: Object.fromEntries(this.stats.barsByInstrument),
            avgVolumePerBar: this.stats.totalVolume / this.stats.totalBars
        };
    }
}

module.exports = VolumeBarBuilder;