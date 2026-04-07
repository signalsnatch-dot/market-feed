const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class VolumeBarBuilder extends EventEmitter {
    constructor(config) {
        super();
        this.instrumentConfigs = config.instruments;
        this.activeBars = new Map();
        this.completedBars = [];
        
        // Directories
        this.dataDir = config.dataDir || './candles_data/volume_bars';
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
                targetVolume: instrument.volumePerBar,  // NASDAQ logic: target volume
                
                // Current bar data
                currentVolume: 0,
                open: null,
                high: null,
                low: null,
                close: null,
                startTime: null,
                startTimestamp: null,
                lastUpdateTime: null,
                transactions: 0,
                priceChanges: 0,  // Track for comparison
                
                // History
                bars: [],
                barNumber: 0,
                lastEmittedProgress: 0
            });
            
            this.stats.barsByInstrument.set(instrument.key, 0);
            
            console.log(`📊 [VOLUME BAR] ${instrument.name}:`);
            console.log(`   Target: ${instrument.volumePerBar.toLocaleString()} units per bar`);
            console.log(`   Logic: Each transaction contributes its quantity to volume total`);
            console.log(`   Expected bars/day: ~${Math.floor(10000000 / instrument.volumePerBar)} (based on 1Cr volume)\n`);
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
        
        // Save raw tick (shared with price builder)
        this.saveRawTick({
           ...tickData,
           exchange_time_iso: exchangeTimeISO,
           receive_time_iso: receiveTimeISO,
           latency_ms: receiveTimeMs - exchangeTimeMs
       });
        
        // Get bar
        let bar = this.activeBars.get(instrument_key);
        if (!bar) return;
        
        // Track price change for comparison
        const lastPrice = bar.close;
        
        // Initialize bar on first tick
        if (bar.open === null) {
            bar.open = price;
            bar.high = price;
            bar.low = price;
            bar.startTime = currentTime;
            bar.startTimestamp = exchangeTimeISO || receiveTimeISO;
            
            console.log(`\n🕯️ [VOLUME BAR] New bar #${bar.barNumber} for ${bar.name}`);
            console.log(`   Starting price: ${price}`);
            console.log(`   Start time (exchange): ${bar.startTimestamp}`);
            console.log(`   Target volume: ${bar.targetVolume.toLocaleString()} units\n`);
        }
        
        // Update bar
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.close = price;
        bar.lastUpdateTime = currentTime;
        bar.lastUpdateTimestamp = exchangeTimeISO || receiveTimeISO;    
        
        // CRITICAL: Volume bar logic - add ALL volume, not just price changes
        bar.currentVolume += volume;
        bar.transactions++;
        
        // Track price changes for comparison
        if (lastPrice !== null && price !== lastPrice) {
            bar.priceChanges++;
        }
        
        // Update global stats
        this.stats.totalTicks++;
        this.stats.totalVolume += volume;

        if (bar.open !== null && this.emit) {
            const liveCandle = {
                instrument_key: instrument_key,
                type: 'volume',
                is_live: true,
                barNumber: bar.barNumber,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.currentVolume,
                targetVolume: bar.targetVolume,
                transactions: bar.transactions,
                priceChanges: bar.priceChanges,
                startTime: bar.startTimestamp,
                timestamp: currentTime,
                progress: (bar.currentVolume / bar.targetVolume) * 100
            };
            
            this.emit('live_candle_update', liveCandle);
        }
        
        // Calculate progress
        const progress = (bar.currentVolume / bar.targetVolume) * 100;
        
        // Emit progress
        if (Math.floor(progress) % 10 === 0 && progress !== bar.lastEmittedProgress) {
            bar.lastEmittedProgress = progress;
            this.emit('bar_update', {
                type: 'volume_bar',
                instrument_key: bar.instrument_key,
                name: bar.name,
                barNumber: bar.barNumber,
                progress: progress.toFixed(1),
                currentVolume: bar.currentVolume.toLocaleString(),
                targetVolume: bar.targetVolume.toLocaleString(),
                transactions: bar.transactions,
                priceChanges: bar.priceChanges,
                currentPrice: price
            });
        }
        
        // Check if bar should close (based on volume)
        if (bar.currentVolume >= bar.targetVolume) {
            this.closeBar(instrument_key, bar);
        }
    }
    
    closeBar(instrumentKey, bar) {
        const completedBar = {
            type: 'volume_bar',
            instrument_key: instrumentKey,
            name: bar.name,
            barNumber: this.stats.barsByInstrument.get(instrumentKey) + 1,
            
            // OHLC
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            
            // Volume metrics
            volume: bar.currentVolume,
            targetVolume: bar.targetVolume,
            transactions: bar.transactions,
            priceChanges: bar.priceChanges,
            avgTradeSize: bar.currentVolume / bar.transactions,
            
            // Timing
            startTime: bar.startTimestamp || new Date(bar.startTime).toISOString(),
            endTime: bar.lastUpdateTimestamp || new Date(bar.lastUpdateTime).toISOString(),
            durationMs: bar.lastUpdateTime - bar.startTime,
            durationSeconds: ((bar.lastUpdateTime - bar.startTime) / 1000).toFixed(1),
            
            // Price movement
            priceChange: (bar.close - bar.open).toFixed(2),
            priceChangePercent: (((bar.close - bar.open) / bar.open) * 100).toFixed(2),
            priceRange: (bar.high - bar.low).toFixed(2),
            priceRangePercent: (((bar.high - bar.low) / bar.open) * 100).toFixed(2),
            
            // Efficiency metric
            volumeEfficiency: bar.currentVolume / bar.targetVolume,
            
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
        console.log(`\n✅ [VOLUME BAR] COMPLETED: ${bar.name} - Bar #${bar.barNumber}`);
        console.log(`   Volume: ${bar.currentVolume.toLocaleString()} / ${bar.targetVolume.toLocaleString()} units`);
        console.log(`   Transactions: ${bar.transactions} | Price changes: ${bar.priceChanges}`);
        console.log(`   OHLC: ${bar.open.toFixed(2)} | ${bar.high.toFixed(2)} | ${bar.low.toFixed(2)} | ${bar.close.toFixed(2)}`);
        console.log(`   Change: ${completedBar.priceChange} (${completedBar.priceChangePercent}%)`);
        console.log(`   Duration: ${completedBar.durationSeconds}s`);
        console.log(`   Avg trade size: ${Math.round(bar.currentVolume / bar.transactions).toLocaleString()} units\n`);
        
        // Reset bar (start at last close)
        this.activeBars.set(instrumentKey, {
            ...bar,
            currentVolume: 0,
            open: bar.close,
            high: bar.close,
            low: bar.close,
            close: bar.close,
            lastUpdateTime: null,
            lastUpdateTimestamp: null,
            transactions: 0,
            priceChanges: 0,
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
            tickData.instrument_key,
            tickData.ltp,
            tickData.last_traded_quantity || 0
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
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
