const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class TickCandleBuilder extends EventEmitter {
    constructor(config) {
        super();
        this.instrumentConfigs = config.instruments;
        this.activeCandles = new Map();
        this.completedCandles = [];
        
        // Separate directories for raw and ticker data
        this.rawDataDir = config.rawDataDir || './raw_ticks_data';
        this.tickerDataDir = config.tickerDataDir || './ticker_candles_data';
        
        // Create directories
        [this.rawDataDir, this.tickerDataDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
        
        this.stats = {
            totalTransactions: 0,
            totalVolume: 0,
            candlesCompleted: 0
        };
    }
    
    /**
     * Process incoming tick - NOW USING TRANSACTION COUNT
     */
    processTick(tickData) {
        const { instrument_key, ltp, last_traded_quantity, exchange_timestamp, timestamp } = tickData;
        
        if (!ltp) return;
        
        const price = parseFloat(ltp);
        const transactionVolume = parseInt(last_traded_quantity); // This is the key!
        const currentTime = parseInt(exchange_timestamp) || timestamp;
        
        // Save raw tick data immediately
        this.saveRawTick(tickData);
        
        // Get or create candle
        let candle = this.getCurrentCandle(instrument_key);
        if (!candle) return;
        
        // Initialize candle on first transaction
        if (candle.transactionCount === 0) {
            candle.open = price;
            candle.high = price;
            candle.low = price;
            candle.startTime = currentTime;
            candle.startTimestamp = new Date(currentTime).toISOString();
        }
        
        // Update candle with this transaction
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
        candle.lastUpdateTime = currentTime;
        candle.lastUpdateTimestamp = new Date(currentTime).toISOString();
        
        // CRITICAL: Count transactions, not price changes
        candle.transactionCount++;
        candle.totalVolume += transactionVolume;
        
        // Calculate VWAP
        candle.vwapSum += price * transactionVolume;
        candle.vwap = candle.vwapSum / candle.totalVolume;
        
        // Store transaction details (optional, for debugging)
        if (this.shouldStoreTransactions(instrument_key)) {
            candle.transactions.push({
                price,
                volume: transactionVolume,
                time: currentTime,
                cumulativeCount: candle.transactionCount
            });
            
            // Keep last 1000 transactions only
            if (candle.transactions.length > 1000) {
                candle.transactions = candle.transactions.slice(-1000);
            }
        }
        
        // Update statistics
        this.stats.totalTransactions++;
        this.stats.totalVolume += transactionVolume;
        
        // Check if candle should close (based on transaction count)
        const targetTransactions = candle.targetTransactions;
        const shouldClose = candle.transactionCount >= targetTransactions;
        
        if (shouldClose) {
            this.closeCandle(instrument_key, candle);
        }
        
        // Emit real-time update (every 10% progress)
        const progress = (candle.transactionCount / targetTransactions) * 100;
        if (Math.floor(progress) % 10 === 0 && progress !== candle.lastEmittedProgress) {
            candle.lastEmittedProgress = progress;
            this.emit('candle_update', {
                instrument_key,
                progress: progress.toFixed(1),
                transactionCount: candle.transactionCount,
                targetTransactions: targetTransactions,
                currentPrice: price,
                volume: candle.totalVolume,
                vwap: candle.vwap
            });
        }
    }
    
    getCurrentCandle(instrumentKey) {
        if (!this.activeCandles.has(instrumentKey)) {
            const config = this.instrumentConfigs.find(c => c.key === instrumentKey);
            if (!config) {
                console.warn(`No config found for ${instrumentKey}`);
                return null;
            }
            
            this.activeCandles.set(instrumentKey, {
                instrument_key: instrumentKey,
                targetTransactions: config.transactionCount, // Changed from tickCount
                name: config.name,
                
                // Candle data
                open: null,
                high: null,
                low: null,
                close: null,
                transactionCount: 0,
                totalVolume: 0,
                vwapSum: 0,
                vwap: 0,
                
                // Timing
                startTime: null,
                startTimestamp: null,
                lastUpdateTime: null,
                lastUpdateTimestamp: null,
                
                // Storage (optional)
                transactions: [],
                lastEmittedProgress: 0
            });
        }
        
        return this.activeCandles.get(instrumentKey);
    }
    
    closeCandle(instrumentKey, candle) {
        const completedCandle = {
            instrument_key: instrumentKey,
            name: candle.name,
            
            // OHLC
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            
            // Volume metrics
            transactionCount: candle.transactionCount,
            totalVolume: candle.totalVolume,
            averageVolumePerTransaction: candle.totalVolume / candle.transactionCount,
            vwap: candle.vwap,
            
            // Timing
            startTime: candle.startTime,
            startTimestamp: candle.startTimestamp,
            endTime: candle.lastUpdateTime,
            endTimestamp: candle.lastUpdateTimestamp,
            durationMs: candle.lastUpdateTime - candle.startTime,
            durationSeconds: ((candle.lastUpdateTime - candle.startTime) / 1000).toFixed(1),
            
            // Range
            priceRange: candle.high - candle.low,
            priceRangePercent: ((candle.high - candle.low) / candle.open * 100).toFixed(2),
            
            // Target
            targetTransactions: candle.targetTransactions,
            
            // Timestamp for sorting
            timestamp: candle.lastUpdateTime
        };
        
        // Store completed candle
        this.completedCandles.push(completedCandle);
        this.stats.candlesCompleted++;
        
        // Save to ticker candles CSV
        this.saveTickerCandle(completedCandle);
        
        // Emit for strategies
        this.emit('candle_close', completedCandle);
        
        // Log progress
        console.log(`\n✅ CANDLE COMPLETED: ${instrumentKey}`);
        console.log(`   Transactions: ${candle.transactionCount} (target: ${candle.targetTransactions})`);
        console.log(`   Volume: ${candle.totalVolume.toLocaleString()} units`);
        console.log(`   OHLC: ${candle.open.toFixed(2)} | ${candle.high.toFixed(2)} | ${candle.low.toFixed(2)} | ${candle.close.toFixed(2)}`);
        console.log(`   Duration: ${completedCandle.durationSeconds}s`);
        console.log(`   VWAP: ${candle.vwap.toFixed(2)}`);
        console.log(`   Stats: Total candles: ${this.stats.candlesCompleted}, Total transactions: ${this.stats.totalTransactions}\n`);
        
        // Reset for next candle (start at last close price)
        this.activeCandles.set(instrumentKey, {
            instrument_key: instrumentKey,
            targetTransactions: candle.targetTransactions,
            name: candle.name,
            
            open: candle.close, // New candle starts at previous close
            high: candle.close,
            low: candle.close,
            close: candle.close,
            transactionCount: 0,
            totalVolume: 0,
            vwapSum: 0,
            vwap: 0,
            
            startTime: Date.now(),
            startTimestamp: new Date().toISOString(),
            lastUpdateTime: null,
            lastUpdateTimestamp: null,
            
            transactions: [],
            lastEmittedProgress: 0
        });
    }
    
    saveRawTick(tickData) {
        const today = new Date().toISOString().split('T')[0];
        const safeKey = tickData.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.rawDataDir, `${safeKey}_raw_ticks_${today}.csv`);
        
        const headers = [
            'timestamp', 'exchange_timestamp', 'instrument_key',
            'ltp', 'last_traded_quantity', 'close_price', 'volume_today'
        ];
        
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
            tickData.last_traded_quantity,
            tickData.close_price || '',
            tickData.volume_today || ''
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
    }
    
    saveTickerCandle(candle) {
        const safeKey = candle.instrument_key.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.tickerDataDir, `${safeKey}_ticker_candles.csv`);
        
        const headers = [
            'timestamp', 'instrument_key', 'name',
            'open', 'high', 'low', 'close',
            'transaction_count', 'total_volume', 'avg_volume_per_tx', 'vwap',
            'start_time', 'end_time', 'duration_seconds',
            'price_range', 'price_range_percent',
            'target_transactions'
        ];
        
        const fileExists = fs.existsSync(filename);
        const writeStream = fs.createWriteStream(filename, { flags: 'a' });
        
        if (!fileExists) {
            writeStream.write(headers.join(',') + '\n');
        }
        
        const row = [
            candle.timestamp,
            candle.instrument_key,
            candle.name || '',
            candle.open.toFixed(2),
            candle.high.toFixed(2),
            candle.low.toFixed(2),
            candle.close.toFixed(2),
            candle.transactionCount,
            candle.totalVolume,
            candle.averageVolumePerTransaction.toFixed(2),
            candle.vwap.toFixed(2),
            candle.startTimestamp,
            candle.endTimestamp,
            candle.durationSeconds,
            candle.priceRange.toFixed(2),
            candle.priceRangePercent,
            candle.targetTransactions
        ].join(',');
        
        writeStream.write(row + '\n');
        writeStream.end();
    }
    
    shouldStoreTransactions(instrumentKey) {
        // Enable for debugging specific instruments
        const debugInstruments = process.env.DEBUG_INSTRUMENTS || '';
        return debugInstruments.includes(instrumentKey);
    }
    
    getStats() {
        const stats = {};
        for (const [key, candle] of this.activeCandles.entries()) {
            const progress = (candle.transactionCount / candle.targetTransactions) * 100;
            stats[key] = {
                name: candle.name,
                transactions: candle.transactionCount,
                target: candle.targetTransactions,
                progress: progress.toFixed(1) + '%',
                volume: candle.totalVolume.toLocaleString(),
                current_price: candle.close,
                duration_seconds: candle.startTime ? ((Date.now() - candle.startTime) / 1000).toFixed(1) : 0,
                vwap: candle.vwap.toFixed(2)
            };
        }
        return stats;
    }
    
    getGlobalStats() {
        return this.stats;
    }
}

module.exports = TickCandleBuilder;
