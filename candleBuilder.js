const EventEmitter = require('events');
const PriceBarBuilder = require('./priceBarBuilder');
const VolumeBarBuilder = require('./volumeBarBuilder');
const { STRATEGIES } = require('./priceActionStrategy');

class DualCandleBuilder extends EventEmitter {
    constructor(config) {
        super();
        
        this.pendingOrders = new Map(); // key: `${instrument}_${bar_type}_${threshold}_${version}`
        this.activeTrades = new Map();  // key: `${instrument}_${bar_type}_${threshold}_${version}`
        this.lastCompletedTimes = new Map(); // key: `${instrument}_${bar_type}_${threshold}_${version}` -> timestamp (ms)
        
        this.priceBuilder = new PriceBarBuilder({
            instruments: config.instruments,
            dataDir: config.candlesDataDir || './candles_data/price_bars',
            rawDataDir: config.rawDataDir || './raw_ticks_data'
        });
        
        this.volumeBuilder = new VolumeBarBuilder({
            instruments: config.instruments,
            dataDir: config.candlesDataDir || './candles_data/volume_bars',
            rawDataDir: config.rawDataDir || './raw_ticks_data'
        });
        
        this.priceBuilder.on('bar_close', (bar) => {
            const stats = this.comparisonStats.get(bar.instrument_key);
            if (stats) stats.priceBarsCompleted++;
            this.emit('bar_close', {
                ...bar,
                instrument: bar.instrument_key,
                type: 'price'
            });
        });
        
        this.volumeBuilder.on('bar_close', (bar) => {
            const stats = this.comparisonStats.get(bar.instrument_key);
            if (stats) stats.volumeBarsCompleted++;
            this.emit('bar_close', {
                ...bar,
                instrument: bar.instrument_key,
                type: 'volume'
            });
        });

        this.priceBuilder.on('live_candle_update', (candle) => {
            this.emit('live_candle_update', {
                ...candle,
                instrument: candle.instrument_key || candle.instrument
            });
        });
        
        this.volumeBuilder.on('live_candle_update', (candle) => {
            this.emit('live_candle_update', {
                ...candle,
                instrument: candle.instrument_key || candle.instrument
            });
        });

        this.volumeBuilder.on('trade_signal', (signal) => {
            this.processIncomingSignal(signal, 'volume');
        });

        this.priceBuilder.on('trade_signal', (signal) => {
            this.processIncomingSignal(signal, 'price');
        });

        this.setupStateTracking();

        this.comparisonStats = new Map();
        config.instruments.forEach(instr => {
            this.comparisonStats.set(instr.key, {
                instrument: instr.name,
                totalTicks: 0,
                totalVolume: 0,
                priceBarsCompleted: 0,
                volumeBarsCompleted: 0,
                startTime: Date.now()
            });
        });
    }

    processIncomingSignal(signal, barType) {
        const threshold = signal.threshold;
        const key = `${signal.instrument}_${barType}_${threshold}_${signal.version}`;
        const currentTime = signal.timestamp || Date.now();

        const hasActive = this.activeTrades.has(key);
        const hasPending = this.pendingOrders.has(key);

        // Cool-down check: prevent identical intra-version re-execution within 45 seconds of completion
        const lastCompletedTime = this.lastCompletedTimes.get(key) || 0;
        const isCooldownActive = lastCompletedTime > 0 && (currentTime - lastCompletedTime < 45000);

        const isOverlapping = hasActive || hasPending || isCooldownActive;

        const trackedSignal = {
            ...signal,
            overlapping: isOverlapping,
            status: isOverlapping ? 'cancelled' : 'pending',
            exitReason: isOverlapping ? 'overlapping' : null
        };

        if (!isOverlapping) {
            this.pendingOrders.set(key, {
                ...trackedSignal,
                expiryBarNumber: signal.barNumber + 1
            });
        }

        this.emit('trade_signal', trackedSignal);
    }

    setupStateTracking() {
        this.on('bar_close', (bar) => {
            const threshold = bar.targetVolume || bar.targetTicks;
            
            for (const versionName of Object.keys(STRATEGIES)) {
                const key = `${bar.instrument}_${bar.type}_${threshold}_${versionName}`;

                // 1. Evaluate Pending Activation
                if (this.pendingOrders.has(key)) {
                    const pending = this.pendingOrders.get(key);
                    let triggered = false;

                    if (pending.type === 'BUY_STOP') {
                        if (bar.high >= pending.entry) triggered = true;
                    } else if (pending.type === 'SELL_STOP') {
                        if (bar.low <= pending.entry) triggered = true;
                    }

                    if (triggered) {
                        let fillPrice = pending.entry;
                        if (pending.type === 'BUY_STOP' && bar.open > pending.entry) {
                            fillPrice = bar.open;
                        } else if (pending.type === 'SELL_STOP' && bar.open < pending.entry) {
                            fillPrice = bar.open;
                        }

                        let finalTP = pending.tp;
                        if (fillPrice !== pending.entry) {
                            const risk = Math.abs(fillPrice - pending.sl);
                            finalTP = pending.type === 'BUY_STOP'
                                ? fillPrice + risk * (pending.rewardRatio || 1.5)
                                : fillPrice - risk * (pending.rewardRatio || 1.5);
                        }

                        const activeTrade = {
                            version: versionName,
                            instrument: pending.instrument,
                            name: pending.name,
                            bar_type: pending.bar_type,
                            threshold: threshold,
                            barNumber: pending.barNumber,
                            type: pending.type,
                            entry: fillPrice, 
                            sl: pending.sl,
                            tp: finalTP, 
                            direction: pending.type === 'BUY_STOP' ? 'long' : 'short',
                            timestamp: bar.timestamp,
                            status: 'active'
                        };

                        this.activeTrades.set(key, activeTrade);
                        this.pendingOrders.delete(key);

                        this.emit('trade_status_update', activeTrade);
                    }
                }

                // 2. Evaluate Active Exits (with Gap-Opening Slippage Checks)
                if (this.activeTrades.has(key)) {
                    const trade = this.activeTrades.get(key);
                    let exitPrice = null;
                    let exitReason = null;

                    if (trade.direction === 'long') {
                        const stoppedOut = bar.low <= trade.sl;
                        const tpReached = bar.high >= trade.tp;

                        if (stoppedOut && tpReached) {
                            exitPrice = bar.open < trade.sl ? bar.open : trade.sl;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = bar.open < trade.sl ? bar.open : trade.sl;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = bar.open > trade.tp ? bar.open : trade.tp;
                            exitReason = 'take_profit';
                        }
                    } else {
                        const stoppedOut = bar.high >= trade.sl;
                        const tpReached = bar.low <= trade.tp;

                        if (stoppedOut && tpReached) {
                            exitPrice = bar.open > trade.sl ? bar.open : trade.sl;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = bar.open > trade.sl ? bar.open : trade.sl;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = bar.open < trade.tp ? bar.open : trade.tp;
                            exitReason = 'take_profit';
                        }
                    }

                    if (exitPrice !== null) {
                        const exitType = trade.direction === 'long'
                            ? (exitReason === 'stop_loss' ? 'SELL_STOP' : 'SELL_LIMIT')
                            : (exitReason === 'stop_loss' ? 'BUY_STOP' : 'BUY_LIMIT');

                        const statusUpdate = {
                            version: versionName,
                            instrument: trade.instrument,
                            bar_type: trade.bar_type,
                            threshold: threshold,
                            barNumber: trade.barNumber,
                            type: trade.type, 
                            exitType: exitType, 
                            exitReason: exitReason,
                            exitPrice: exitPrice,
                            timestamp: bar.timestamp,
                            status: 'completed'
                        };

                        this.activeTrades.delete(key);
                        this.lastCompletedTimes.set(key, bar.timestamp || Date.now()); // Set completed cooldown baseline
                        this.emit('trade_status_update', statusUpdate);
                    }
                }

                // 3. Evaluate Expirations
                if (this.pendingOrders.has(key)) {
                    const pending = this.pendingOrders.get(key);
                    if (bar.barNumber >= pending.expiryBarNumber) {
                        const expiredSignal = {
                            version: versionName,
                            instrument: pending.instrument,
                            bar_type: pending.bar_type,
                            threshold: threshold,
                            barNumber: pending.barNumber,
                            type: pending.type,
                            status: 'cancelled',
                            timestamp: bar.timestamp
                        };

                        this.pendingOrders.delete(key);
                        this.lastCompletedTimes.set(key, bar.timestamp || Date.now()); // Set cancelled cooldown baseline
                        this.emit('trade_status_update', expiredSignal);
                    }
                }
            }
        });
    }
    
    processTick(tickData) {
        const { instrument_key, last_traded_quantity } = tickData;
        
        const stats = this.comparisonStats.get(instrument_key);
        if (stats) {
            stats.totalTicks++;
            stats.totalVolume += parseInt(last_traded_quantity) || 0;
        }
        
        this.priceBuilder.processTick(tickData);
        this.volumeBuilder.processTick(tickData);
        
        this.emit('tick_processed', {
            ...tickData,
            priceBarProgress: this.priceBuilder.getProgress(instrument_key),
            volumeBarProgress: this.volumeBuilder.getProgress(instrument_key)
        });
    }
    
    getComparisonStats() {
        const stats = [];
        for (const [key, data] of this.comparisonStats.entries()) {
            const priceProgress = this.priceBuilder.getProgress(key);
            const volumeProgress = this.volumeBuilder.getProgress(key);
            
            stats.push({
                instrument: data.instrument,
                totalTicks: data.totalTicks,
                totalVolume: data.totalVolume.toLocaleString(),
                priceBars: data.priceBarsCompleted,
                volumeBars: data.volumeBarsCompleted,
                priceProgress: priceProgress?.progress || '0%',
                volumeProgress: volumeProgress?.progress || '0%',
                currentPrice: priceProgress?.currentPrice || volumeProgress?.currentPrice || 'N/A'
            });
        }
        return stats;
    }
    
    async getDetailedComparison() {
        const priceStats = this.priceBuilder.getGlobalStats();
        const volumeStats = this.volumeBuilder.getGlobalStats();
        
        return {
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - this.comparisonStats.values().next().value?.startTime) / 1000),
            priceBuilder: priceStats,
            volumeBuilder: volumeStats,
            comparison: {
                barsRatio: priceStats.totalBars / volumeStats.totalBars,
                volumePerBar: {
                    price: priceStats.totalVolume / priceStats.totalBars,
                    volume: volumeStats.totalVolume / volumeStats.totalBars
                }
            }
        };
    }
    
    saveComparisonReport() {
        const reportDir = './candles_data/comparison';
        const fs = require('fs');
        const path = require('path');
        
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }
        
        const report = {
            timestamp: Date.now(),
            date: new Date().toISOString(),
            stats: this.getComparisonStats(),
            detailed: this.getDetailedComparison()
        };
        
        const filename = path.join(reportDir, `comparison_${new Date().toISOString().split('T')[0]}.json`);
        fs.writeFileSync(filename, JSON.stringify(report, null, 2));
        
        return report;
    }
}

module.exports = DualCandleBuilder;