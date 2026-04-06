const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class FixedVolumeBarBuilder extends EventEmitter {
    constructor(config) {
        super();
        this.instrumentConfigs = config.instruments; // Array of { key, volumePerBar, name }
        this.activeBars = new Map();
        this.completedBars = [];
        
        // Directories
        this.rawDataDir = config.rawDataDir || './raw_ticks_data';
        this.volumeBarDir = config.volumeBarDir || './volume_bars_data';
        
        // Create directories
        [this.rawDataDir, this.volumeBarDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
        
        // Statistics
        this.stats = {
            totalVolume: 0,
            totalTransactions: 0,
            barsCompleted: 0
        };
        
        // Initialize bars for each instrument
        this.initializeBars();
    }
    
    initializeBars() {
        for (const instrument of this.instrumentConfigs) {
            this.activeBars.set(instrument.key, {
                instrument_key: instrument.key,
                name: instrument.name,
                targetVolume: instrument.volumePerBar,
                
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
                totalVolumeInBar: 0,
                
                // History
                bars: [],
                barNumber: 0,
                
                // Progress tracking
                lastEmittedProgress: 0
            });
            
            console.log(`📊 Initialized ${instrument.name}:`);
            console.log(`   Target Volume per Bar: ${instrument.volumePerBar.toLocaleString()} units`);
            console.log(`   Expected bars per day: ~${Math.floor(10000000 / instrument.volumePerBar)} (based on 1Cr volume)\n`);
        }
    }
    
    processTick(tickData) {
        const { instrument_key, ltp, last_traded_quantity, exchange_timestamp, timestamp } = tickData;
        
        if (!ltp || !last_traded_quantity) return;
        
        const price = parseFloat(ltp);
        const volume = parseInt(last_traded_quantity);
        const currentTime = parseInt(exchange_timestamp) || timestamp;
        
        // Save raw tick immediately
        this.saveRawTick(tickData);
        
        // Get the bar for this instrument
        let bar = this.activeBars.get(instrument_key);
        if (!bar) {
            console.warn(`No configuration found for ${instrument_key}`);
            return;
        }
        
        // Initialize bar on first tick
        if (bar.open === null) {
            bar.open = price;
            bar.high = price;
            bar.low = price;
            bar.startTime = currentTime;
            bar.startTimestamp = new Date(currentTime).toISOString();
            bar.barNumber++;
            
            console.log(`\n🕯️ New bar started for ${bar.name}: Bar #${bar.barNumber}`);
            console.log(`   Starting price: ${price}`);
            console.log(`   Target volume: ${bar.targetVolume.toLocaleString()} units\n`);
        }
        
        // Update bar
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.close = price;
        bar.lastUpdateTime = currentTime;
        bar.currentVolume += volume;
        bar.totalVolumeInBar += volume;
        bar.transactions++;
        
        // Update global stats
        this.stats.totalVolume += volume;
        this.stats.totalTransactions++;
        
        // Calculate progress
        const progress = (bar.currentVolume / bar.targetVolume) * 100;
        
        // Emit progress at 10% intervals
        if (Math.floor(progress) % 10 === 0 && progress !== bar.lastEmittedProgress) {
            bar.lastEmittedProgress = progress;
            this.emit('bar_update', {
                instrument_key: bar.instrument_key,
                name: bar.name,
                barNumber: bar.barNumber,
                progress: progress.toFixed(1),
                currentVolume: bar.currentVolume.toLocaleString(),
                targetVolume: bar.targetVolume.toLocaleString(),
                transactions: bar.transactions,
                currentPrice: price,
                remainingVolume: (bar.targetVolume - bar.currentVolume).toLocaleString()
            });
        }
        
        // Check if bar should close
        if (bar.currentVolume >= bar.targetVolume) {
            this.closeBar(instrument_key, bar);
        }
    }
    
    closeBar(instrumentKey, bar) {
        const completedBar = {
            // Identification
            instrument_key: instrumentKey,
            name: bar.name,
            barNumber: bar.barNumber,
            
            // OHLC
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            
            // Volume metrics
            volume: bar.currentVolume,
            targetVolume: bar.targetVolume,
            transactions: bar.transactions,
            avgTransactionSize: bar.currentVolume / bar.transactions,
            
            // Timing
            startTime: bar.startTimestamp,
            endTime: new Date(bar.lastUpdateTime).toISOString(),
            durationMs: bar.lastUpdateTime - bar.startTime,
            durationSeconds: ((bar.lastUpdateTime - bar.startTime) / 1000).toFixed(1),
            
            // Price movement
            priceChange: (bar.close - bar.open).toFixed(2),
            priceChangePercent: (((bar.close - bar.open) / bar.open) * 100).toFixed(2),
            priceRange: (bar.high - bar.low).toFixed(2),
            priceRangePercent: (((bar.high - bar.low) / bar.open) * 100).toFixed(2),
            
            // Timestamp for sorting
            timestamp: bar.lastUpdateTime
        };
        
        // Store completed bar
        bar.bars.push(completedBar);
        this.completedBars.push(completedBar);
        this.stats.barsCompleted++;
        
        // Save to CSV
        this.saveVolumeBar(completedBar);
        
        // Emit for trading strategies
        this.emit('bar_close', completedBar);
        
        // Log completion
        console.log(`\n✅ VOLUME BAR COMPLETED: ${bar.name} - Bar #${bar.barNumber}`);
        console.log(`   Volume: ${bar.currentVolume.toLocaleString()} / ${bar.targetVolume.toLocaleString()} units`);
        console.log(`   OHLC: ${bar.open.toFixed(2)} | ${bar.high.toFixed(2)} | ${bar.low.toFixed(2)} | ${bar.close.toFixed(2)}`);
        console.log(`   Change: ${completedBar.priceChange} (${completedBar.priceChangePercent}%)`);
        console.log(`   Range: ${completedBar.priceRange} (${completedBar.priceRangePercent}%)`);
        console.log(`   Transactions: ${bar.transactions} | Duration: ${completedBar.durationSeconds}s`);
        console.log(`   Avg Trade Size: ${Math.round(bar.currentVolume / bar.transactions).toLocaleString()} units`);
        console.log(`   Total bars today: ${bar.bars.length}\n`);
        
        // Reset bar for next candle
        this.activeBars.set(instrumentKey, {
            ...bar,
            currentVolume: 0,
            open: bar.close, // New bar starts at previous close
            high: bar.close,
            low: bar.close,
            close: bar.close,
            startTime: null,
            startTimestamp: null,
            lastUpdateTime: null,
            transactions: 0,
            totalVolumeInBar: 0,
            lastEmittedProgress: 0
        });
    }
    
    saveRawTick(tickData) {
        const today = new Date().toISOString().split('T')[0];
        const safeKey = tickData.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.rawDataDir, `${safeKey}_raw_ticks_${today}.csv`);
        
        const headers = ['timestamp', 'exchange_timestamp', 'instrument_key', 'ltp', 'last_traded_quantity'];
        const fileExists = fs.existsSync(filename);
        const writeStream = fs.createWriteStream(filename, { flags: 'a' });
        
        if (!fileExists) {
            writeStream.write(headers.join(',') + '\n');
        }
        
        const row = [
            tickData.timestamp,
            tickData.exchange_timestamp,
            tickData.instrument_key,
            tickData.ltp,
            tickData.last_traded_quantity
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
    }
    
    saveVolumeBar(bar) {
        const safeKey = bar.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.volumeBarDir, `${safeKey}_volume_bars.csv`);
        
        const headers = [
            'timestamp', 'bar_number', 'instrument_key', 'name',
            'open', 'high', 'low', 'close',
            'volume', 'target_volume', 'transactions', 'avg_transaction_size',
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
            bar.volume, bar.targetVolume, bar.transactions, bar.avgTransactionSize.toFixed(2),
            bar.priceChange, bar.priceChangePercent, bar.priceRange, bar.priceRangePercent,
            bar.startTime, bar.endTime, bar.durationSeconds
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
    }
    
    getStats() {
        const stats = {};
        for (const [key, bar] of this.activeBars.entries()) {
            if (bar.open !== null) {
                const progress = (bar.currentVolume / bar.targetVolume) * 100;
                stats[key] = {
                    name: bar.name,
                    barNumber: bar.barNumber,
                    volume: bar.currentVolume.toLocaleString(),
                    target: bar.targetVolume.toLocaleString(),
                    progress: progress.toFixed(1) + '%',
                    transactions: bar.transactions,
                    current_price: bar.close,
                    duration_seconds: bar.startTime ? ((Date.now() - bar.startTime) / 1000).toFixed(1) : 0,
                    remaining_volume: (bar.targetVolume - bar.currentVolume).toLocaleString()
                };
            }
        }
        return stats;
    }
    
    getGlobalStats() {
        return this.stats;
    }
}

module.exports = FixedVolumeBarBuilder;
