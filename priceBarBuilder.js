// priceBarBuilder.js
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { STRATEGIES } = require('./priceActionStrategy');

class PriceBarBuilder extends EventEmitter {
    constructor(config) {
        super();
        this.instrumentConfigs = config.instruments;
        this.activeBars = new Map();
        this.completedBars = [];
        this.lastExchangeVolumeToday = new Map();
        this.tickSizeMap = new Map();
        
        this.dataDir = config.directories?.candlesDataDir || './candles_data/price_bars';
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
                targetTicks: instrument.priceBarTicks || 500,  
                currentTicks: 0,
                open: null,
                high: null,
                low: null,
                close: null,
                startTime: null,
                startTimestamp: null,
                lastUpdateTime: null,
                volume: 0,
                transactions: 0,
                bars: [],
                barNumber: 0,
                lastEmittedProgress: 0,
                lastSignalBarNumbers: {} 
            });
            
            this.stats.barsByInstrument.set(instrument.key, 0);
            this.tickSizeMap.set(instrument.key, instrument.tickSize !== undefined ? instrument.tickSize : 0.05);
            
            console.log(`📊 [PRICE BAR] ${instrument.name}:`);
            console.log(`   Target: ${instrument.priceBarTicks || 500} price changes per bar`);
        }
    }

    loadHistoryFromCSV() {
        console.log('📂 Pre-populating price bar histories from CSV files...');
        for (const [key, bar] of this.activeBars.entries()) {
            const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
            const filepath = path.join(this.dataDir, `${safeKey}_price_bars.csv`);
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
                    const ticksIdx = headers.indexOf('ticks');
                    const targetTicksIdx = headers.indexOf('target_ticks');
                    const volumeIdx = headers.indexOf('volume');
                    const transactionsIdx = headers.indexOf('transactions');
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
                            type: 'price_bar',
                            instrument_key: key,
                            name: bar.name,
                            barNumber: parseInt(values[barNumberIdx]) || i,
                            open: parseFloat(values[openIdx]),
                            high: parseFloat(values[highIdx]),
                            low: parseFloat(values[lowIdx]),
                            close: parseFloat(values[closeIdx]),
                            ticks: parseInt(values[ticksIdx]) || 0,
                            targetTicks: parseInt(values[targetTicksIdx] || bar.targetTicks),
                            volume: parseFloat(values[volumeIdx]),
                            transactions: parseInt(values[transactionsIdx]) || 0,
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
        const stateFile = path.join(this.dataDir, 'active_price_bars_state.json');
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
            console.error(`❌ [PRICE BAR] State save failed:`, err.message);
        }
    }

    loadActiveState() {
        const stateFile = path.join(this.dataDir, 'active_price_bars_state.json');
        if (fs.existsSync(stateFile)) {
            try {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                const today = new Date().toISOString().split('T')[0];
                
                if (state.date === today) {
                    if (Array.isArray(state.activeBars)) {
                        state.activeBars.forEach(([key, activeState]) => {
                            const existingBar = this.activeBars.get(key);
                            if (existingBar) {
                                Object.assign(existingBar, activeState);
                            }
                        });
                    }
                    if (Array.isArray(state.lastExchangeVolumeToday)) {
                        this.lastExchangeVolumeToday = new Map(state.lastExchangeVolumeToday);
                    }
                    console.log(`✅ [PRICE BAR] Restored active candle progress and cumulative baselines.`);
                } else {
                    fs.unlinkSync(stateFile);
                }
            } catch (err) {
                console.error(`❌ [PRICE BAR] State recovery failed:`, err.message);
            }
        }
    }

    processTick(tickData) {
        const { instrument_key, ltp, last_traded_quantity, volume_today, exchange_timestamp, timestamp } = tickData;
        
        if (!ltp) return;
        
        const price = parseFloat(ltp);
        
        let tickVolume = 0;
        const currentVolToday = parseInt(volume_today, 10);

        if (!isNaN(currentVolToday) && currentVolToday > 0) {
            const prevVolToday = this.lastExchangeVolumeToday.get(instrument_key);
            
            if (prevVolToday !== undefined && prevVolToday !== null) {
                if (currentVolToday >= prevVolToday) {
                    tickVolume = currentVolToday - prevVolToday;
                } else {
                    tickVolume = parseInt(last_traded_quantity, 10) || 0;
                }
            } else {
                tickVolume = parseInt(last_traded_quantity, 10) || 0;
            }
            this.lastExchangeVolumeToday.set(instrument_key, currentVolToday);
        } else {
            tickVolume = parseInt(last_traded_quantity, 10) || 0;
        }

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
        
        this.saveRawTick({
           ...tickData, 
           exchange_time_iso: exchangeTimeISO,
           receive_time_iso: receiveTimeISO,
           latency_ms: receiveTimeMs - exchangeTimeMs
        });
        
        let bar = this.activeBars.get(instrument_key);
        if (!bar) return;
        
        const lastPrice = bar.close;
        
        if (bar.open === null) {
            bar.barNumber = this.stats.barsByInstrument.get(instrument_key) + 1;
            bar.open = price;
            bar.high = price;
            bar.low = price;
            bar.startTime = currentTime;
            bar.startTimestamp = exchangeTimeISO || receiveTimeISO;
            
            console.log(`\n🕯️ [PRICE BAR] New bar #${bar.barNumber} for ${bar.name}`);
            console.log(`   Start time (exchange): ${bar.startTimestamp}`);
            console.log(`   Target: ${bar.targetTicks} price changes\n`);
        }
        
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.close = price;
        bar.lastUpdateTime = currentTime;
        bar.lastUpdateTimestamp = exchangeTimeISO || receiveTimeISO;

        bar.volume += tickVolume;
        bar.transactions++;
        
        if (lastPrice !== null && price !== lastPrice) {
            bar.currentTicks++;
        } else if (lastPrice === null) {
            bar.currentTicks = 1; 
        }
        
        this.stats.totalTicks++;
        this.stats.totalVolume += tickVolume;

        if (bar.open !== null && this.emit) {
            const liveCandle = {
                instrument: instrument_key,
                type: 'price',
                is_live: true,
                barNumber: bar.barNumber,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                currentTicks: bar.currentTicks,
                targetTicks: bar.targetTicks,
                volume: bar.volume,
                transactions: bar.transactions,
                startTime: bar.startTimestamp,
                timestamp: currentTime,
                progress: (bar.currentTicks / bar.targetTicks) * 100
            };
            
            this.emit('live_candle_update', liveCandle);
        }
        
        const progress = (bar.currentTicks / bar.targetTicks) * 100;
        
        if (Math.floor(progress) % 10 === 0 && progress !== bar.lastEmittedProgress) {
            bar.lastEmittedProgress = progress;
            this.emit('bar_update', {
                type: 'price_bar',
                instrument_key: bar.instrument_key,
                name: bar.name,
                barNumber: bar.barNumber,
                progress: progress.toFixed(1),
                currentTicks: bar.currentTicks,
                targetTicks: bar.targetTicks,
                currentPrice: price,
                volume: bar.volume.toLocaleString()
            });
        }
        
        if (bar.currentTicks >= bar.targetTicks) {
            this.closeBar(instrument_key, bar);
        }
    }
    
    closeBar(instrumentKey, bar) {
        const completedBar = {
            type: 'price_bar',
            instrument_key: instrumentKey,
            name: bar.name,
            barNumber: this.stats.barsByInstrument.get(instrumentKey) + 1,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            ticks: bar.currentTicks,
            targetTicks: bar.targetTicks,
            volume: bar.volume,
            transactions: bar.transactions,
            avgTradeSize: bar.volume / bar.transactions,
            startTime: bar.startTimestamp || new Date(bar.startTime).toISOString(),
            endTime: new Date(bar.lastUpdateTime).toISOString(),
            durationMs: bar.lastUpdateTime - bar.startTime,
            durationSeconds: ((bar.lastUpdateTime - bar.startTime) / 1000).toFixed(1),
            priceChange: (bar.close - bar.open).toFixed(2),
            priceChangePercent: (((bar.close - bar.open) / bar.open) * 100).toFixed(2),
            priceRange: (bar.high - bar.low).toFixed(2),
            priceRangePercent: (((bar.high - bar.low) / bar.open) * 100).toFixed(2),
            timestamp: bar.lastUpdateTime
        };
        
        bar.bars.push(completedBar);
        this.completedBars.push(completedBar);
        this.stats.totalBars++;
        this.stats.barsByInstrument.set(instrumentKey, (this.stats.barsByInstrument.get(instrumentKey) || 0) + 1);
        
        this.saveBarToCSV(completedBar);
        this.saveActiveState();
        this.emit('bar_close', completedBar);
        
        console.log(`\n✅ [PRICE BAR] COMPLETED: ${bar.name} - Bar #${bar.barNumber}`);
        console.log(`   Ticks: ${bar.currentTicks} / ${bar.targetTicks} (price changes)`);
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
                                    reason: latestSignal.reason.replace('Conf:', 'Price, Conf:'),
                                    timestamp: completedBar.timestamp,
                                    barNumber: bar.barNumber,
                                    bar_type: 'price' 
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
        
        const isExactClose = bar.currentTicks === bar.targetTicks;
        const ohlcReset = isExactClose ? null : bar.close;
        
        this.activeBars.set(instrumentKey, {
            instrument_key: bar.instrument_key,
            name: bar.name,
            targetTicks: bar.targetTicks,
            currentTicks: 0,
            open: ohlcReset,
            high: ohlcReset,
            low: ohlcReset,
            close: ohlcReset,
            startTime: null,
            startTimestamp: null,
            lastUpdateTime: null,
            lastUpdateTimestamp: null,
            volume: 0,
            transactions: 0,
            bars: bar.bars,
            barNumber: this.stats.barsByInstrument.get(instrumentKey) + 1,
            lastEmittedProgress: 0,
            lastSignalBarNumbers: bar.lastSignalBarNumbers
        });
    }
    
    saveRawTick(tickData) {
        const today = new Date().toISOString().split('T')[0];
        const safeKey = tickData.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.rawDataDir, `${safeKey}_raw_ticks_${today}.csv`);
        
        // Added 'volume_today' to track accurate real-time volume in raw tick traces
        const headers = [
           'receive_timestamp', 'receive_time_iso',
           'exchange_timestamp', 'exchange_time_iso',
           'latency_ms',
           'instrument_key', 'ltp', 'last_traded_quantity',
           'volume_today'
        ];
        const fileExists = fs.existsSync(filename);
        const writeStream = fs.createWriteStream(filename, { flags: 'a' });
        
        if (!fileExists) {
            writeStream.write(headers.join(',') + '\n');
        }
        
        const row = [
            tickData.timestamp,
            tickData.receive_time_iso,
            tickData.exchange_timestamp,
            tickData.exchange_time_iso,
            tickData.latency_ms || 0,
            tickData.instrument_key,
            tickData.ltp,
            tickData.last_traded_quantity || 0,
            tickData.volume_today || 0 // Log cumulative volume today (vtt)
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
    }
    
    saveBarToCSV(bar) {
        const safeKey = bar.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.dataDir, `${safeKey}_price_bars.csv`);
        
        const headers = [
            'timestamp', 'bar_number', 'instrument_key', 'name',
            'open', 'high', 'low', 'close',
            'ticks', 'target_ticks', 'volume', 'transactions', 'avg_trade_size',
            'price_change', 'price_change_percent', 'price_range', 'price_range_percent',
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
            bar.ticks, bar.targetTicks, bar.volume, bar.transactions, bar.avgTradeSize.toFixed(2),
            bar.priceChange, bar.priceChangePercent, bar.priceRange, bar.priceRangePercent,
            bar.startTime, bar.endTime, bar.durationSeconds
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
    }
    
    getProgress(instrumentKey) {
        const bar = this.activeBars.get(instrumentKey);
        if (!bar || bar.open === null) return null;
        
        return {
            currentTicks: bar.currentTicks,
            targetTicks: bar.targetTicks,
            progress: ((bar.currentTicks / bar.targetTicks) * 100).toFixed(1) + '%',
            currentPrice: bar.close,
            volume: bar.volume
        };
    }
    
    getGlobalStats() {
        return {
            totalTicks: this.stats.totalTicks,
            totalVolume: this.stats.totalVolume,
            totalBars: this.stats.totalBars,
            barsByInstrument: Object.fromEntries(this.stats.barsByInstrument)
        };
    }
}

module.exports = PriceBarBuilder;