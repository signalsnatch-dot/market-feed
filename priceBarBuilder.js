const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class PriceBarBuilder extends EventEmitter {
    constructor(config) {
        super();
        this.instrumentConfigs = config.instruments;
        this.activeBars = new Map();
        this.completedBars = [];
        
        // Directories
        this.dataDir = config.dataDir || './candles_data/price_bars';
        this.rawDataDir = config.rawDataDir || './raw_ticks_data';
        
        // Create directories
        [this.dataDir, this.rawDataDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
        
        // Statistics
        this.stats = {
            totalTicks: 0,
            totalVolume: 0,
            totalBars: 0,
            barsByInstrument: new Map()
        };
        
        // Initialize bars
        this.initializeBars();
    }
    
    initializeBars() {
        for (const instrument of this.instrumentConfigs) {
            this.activeBars.set(instrument.key, {
                instrument_key: instrument.key,
                name: instrument.name,
                targetTicks: instrument.priceBarTicks || 500,  // Original logic: count price changes
                
                // Current bar data
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
                
                // History
                bars: [],
                barNumber: 0,
                lastEmittedProgress: 0
            });
            
            this.stats.barsByInstrument.set(instrument.key, 0);
            
            console.log(`📊 [PRICE BAR] ${instrument.name}:`);
            console.log(`   Target: ${instrument.priceBarTicks || 500} price changes per bar`);
            console.log(`   Logic: Each price change = 1 tick\n`);
        }
    }
    
    processTick(tickData) {
        const { instrument_key, ltp, last_traded_quantity, exchange_timestamp, timestamp } = tickData;
        
        if (!ltp) return;
        
        const price = parseFloat(ltp);
        const volume = parseInt(last_traded_quantity) || 0;

        const exchangeTimeMs = Number(exchange_timestamp);
        const receiveTimeMs = parseInt(timestamp);
       
        // Use exchange time for candle logic (source of truth)
        const currentTime = exchangeTimeMs || receiveTimeMs;
       
        // Store both timestamps for debugging
        const exchangeTimeISO = exchangeTimeMs ? new Date(exchangeTimeMs).toISOString() : null;
        const receiveTimeISO = new Date(receiveTimeMs).toISOString();
        
        // Save raw tick
        this.saveRawTick({
           ...tickData, 
           exchange_time_iso: exchangeTimeISO,
           receive_time_iso: receiveTimeISO,
           latency_ms: receiveTimeMs - exchangeTimeMs
       });
        
        // Get bar
        let bar = this.activeBars.get(instrument_key);
        if (!bar) return;
        
        // Track last price to detect changes (original logic)
        const lastPrice = bar.close;
        
        // Initialize bar on first tick
        if (bar.open === null) {
            bar.open = price;
            bar.high = price;
            bar.low = price;
            bar.startTime = currentTime;
            bar.startTimestamp = exchangeTimeISO || receiveTimeISO;
            
            console.log(`\n🕯️ [PRICE BAR] New bar #${bar.barNumber} for ${bar.name}`);
            console.log(`   Start time (exchange): ${bar.startTimestamp}`);
            console.log(`   Target: ${bar.targetTicks} price changes\n`);
        }
        
        // Update bar always (for OHLC)
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.close = price;
        bar.lastUpdateTime = currentTime;
        bar.lastUpdateTimestamp = exchangeTimeISO || receiveTimeISO;

        bar.volume += volume;
        bar.transactions++;
        
        // CRITICAL: Only increment tick count if price changed (original logic)
        if (lastPrice !== null && price !== lastPrice) {
            bar.currentTicks++;
        } else if (lastPrice === null) {
            bar.currentTicks = 1; // First tick counts
        }
        
        // Update global stats
        this.stats.totalTicks++;
        this.stats.totalVolume += volume;

        if (bar.open !== null && this.emit) {
            const liveCandle = {
                instrument_key: instrument_key,
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
        
        
        // Calculate progress
        const progress = (bar.currentTicks / bar.targetTicks) * 100;
        
        // Emit progress
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
        
        // Check if bar should close (based on price changes)
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
            
            // OHLC
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            
            // Metrics
            ticks: bar.currentTicks,
            targetTicks: bar.targetTicks,
            volume: bar.volume,
            transactions: bar.transactions,
            avgTradeSize: bar.volume / bar.transactions,
            
            // Timing
            startTime: bar.startTimestamp || new Date(bar.startTime).toISOString(),
            endTime: new Date(bar.lastUpdateTime).toISOString(),
            durationMs: bar.lastUpdateTime - bar.startTime,
            durationSeconds: ((bar.lastUpdateTime - bar.startTime) / 1000).toFixed(1),
            
            // Price movement
            priceChange: (bar.close - bar.open).toFixed(2),
            priceChangePercent: (((bar.close - bar.open) / bar.open) * 100).toFixed(2),
            priceRange: (bar.high - bar.low).toFixed(2),
            priceRangePercent: (((bar.high - bar.low) / bar.open) * 100).toFixed(2),
            
            timestamp: bar.lastUpdateTime
        };
        
        // Store
        bar.bars.push(completedBar);
        this.completedBars.push(completedBar);
        this.stats.totalBars++;
        this.stats.barsByInstrument.set(instrumentKey, (this.stats.barsByInstrument.get(instrumentKey) || 0) + 1);
        
        // Save to CSV
        this.saveBarToCSV(completedBar);
        
        // Emit
        this.emit('bar_close', completedBar);
        
        // Log
        console.log(`\n✅ [PRICE BAR] COMPLETED: ${bar.name} - Bar #${bar.barNumber}`);
        console.log(`   Ticks: ${bar.currentTicks} / ${bar.targetTicks} (price changes)`);
        console.log(`   OHLC: ${bar.open.toFixed(2)} | ${bar.high.toFixed(2)} | ${bar.low.toFixed(2)} | ${bar.close.toFixed(2)}`);
        console.log(`   Change: ${completedBar.priceChange} (${completedBar.priceChangePercent}%)`);
        console.log(`   Volume: ${bar.volume.toLocaleString()} units`);
        console.log(`   Duration: ${completedBar.durationSeconds}s\n`);
        
        // Reset bar
        this.activeBars.set(instrumentKey, {
            ...bar,
            currentTicks: 0,
            open: bar.close,
            high: bar.close,
            low: bar.close,
            close: bar.close,
            lastUpdateTime: null,
            volume: 0,
            transactions: 0,
            lastEmittedProgress: 0
        });
    }
    
    saveRawTick(tickData) {
        const today = new Date().toISOString().split('T')[0];
        const safeKey = tickData.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.rawDataDir, `${safeKey}_raw_ticks_${today}.csv`);
        
        const headers = [
           'receive_timestamp', 'receive_time_iso',
           'exchange_timestamp', 'exchange_time_iso',
           'latency_ms',
           'instrument_key', 'ltp', 'last_traded_quantity'
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
            tickData.ltp,
            tickData.last_traded_quantity || 0
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
            bar.timestamp, bar.barNumber, bar.instrument_key, bar.name,
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
