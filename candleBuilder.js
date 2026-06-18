// candleBuilder.js
const EventEmitter = require('events');
const PriceBarBuilder = require('./priceBarBuilder');
const VolumeBarBuilder = require('./volumeBarBuilder');

class DualCandleBuilder extends EventEmitter {
    constructor(config) {
        super();
        
        this.pendingOrders = new Map(); // key: `${instrument}_${bar_type}` -> pending order
        this.activeTrades = new Map();  // key: `${instrument}_${bar_type}` -> active trade
        
        // Initialize both builders with same config
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
        
        // Forward live updates from both builders and normalize
        this.priceBuilder.on('live_candle_update', (candle) => {
            this.emit('live_candle_update', {
                ...candle,
                instrument: candle.instrument  
            });
        });
        
        this.volumeBuilder.on('live_candle_update', (candle) => {
            this.emit('live_candle_update', {
                ...candle,
                instrument: candle.instrument  
            });
        });
        
        // Forward bar_close events with normalized instrument field
        this.priceBuilder.on('bar_close', (bar) => {
            this.emit('bar_close', {
                ...bar,
                instrument: bar.instrument_key,
                type: 'price'
            });
        });
        
        this.volumeBuilder.on('bar_close', (bar) => {
            this.emit('bar_close', {
                ...bar,
                instrument: bar.instrument_key,
                type: 'volume'
            });
        });

        // Intercept signals to track active statuses and flag overlaps
        this.volumeBuilder.on('trade_signal', (signal) => {
            this.processIncomingSignal(signal, 'volume');
        });

        this.priceBuilder.on('trade_signal', (signal) => {
            this.processIncomingSignal(signal, 'price');
        });

        // Setup real-time order execution & tracking state machine
        this.setupStateTracking();

        // Track statistics for comparison
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
        const key = `${signal.instrument}_${barType}`;
        const hasActive = this.activeTrades.has(key);

        const trackedSignal = {
            ...signal,
            overlapping: hasActive,
            status: 'pending' // Initial status
        };

        // Cache as pending order with 1-bar expiration rule
        this.pendingOrders.set(key, {
            ...trackedSignal,
            expiryBarNumber: signal.barNumber + 1
        });

        this.emit('trade_signal', trackedSignal);
    }

    setupStateTracking() {
        this.on('bar_close', (bar) => {
            const key = `${bar.instrument}_${bar.type}`;

            // 1. Evaluate SL/TP Exits for Active Trades
            if (this.activeTrades.has(key)) {
                const trade = this.activeTrades.get(key);
                let exitPrice = null;
                let exitReason = null;

                if (trade.direction === 'long') {
                    const stoppedOut = bar.low <= trade.sl;
                    const tpReached = bar.high >= trade.tp;

                    if (stoppedOut && tpReached) {
                        exitPrice = trade.sl;
                        exitReason = 'stop_loss';
                    } else if (stoppedOut) {
                        exitPrice = trade.sl;
                        exitReason = 'stop_loss';
                    } else if (tpReached) {
                        exitPrice = trade.tp;
                        exitReason = 'take_profit';
                    }
                } else {
                    const stoppedOut = bar.high >= trade.sl;
                    const tpReached = bar.low <= trade.tp;

                    if (stoppedOut && tpReached) {
                        exitPrice = trade.sl;
                        exitReason = 'stop_loss';
                    } else if (stoppedOut) {
                        exitPrice = trade.sl;
                        exitReason = 'stop_loss';
                    } else if (tpReached) {
                        exitPrice = trade.tp;
                        exitReason = 'take_profit';
                    }
                }

                if (exitPrice !== null) {
                    const statusUpdate = {
                        instrument: trade.instrument,
                        bar_type: trade.bar_type,
                        barNumber: trade.barNumber,
                        type: trade.type,
                        exitReason: exitReason,
                        exitPrice: exitPrice,
                        timestamp: bar.timestamp,
                        status: 'completed'
                    };

                    this.activeTrades.delete(key);
                    this.emit('trade_status_update', statusUpdate);
                }
            }

            // 2. Evaluate Triggers and Expirations for Pending Orders
            if (this.pendingOrders.has(key)) {
                const pending = this.pendingOrders.get(key);
                let triggered = false;
                let entryPrice = 0;

                if (pending.type === 'BUY_STOP') {
                    if (bar.high >= pending.entry) {
                        triggered = true;
                        entryPrice = Math.max(bar.open, pending.entry);
                    }
                } else {
                    if (bar.low <= pending.entry) {
                        triggered = true;
                        entryPrice = Math.min(bar.open, pending.entry);
                    }
                }

                if (triggered) {
                    const activeTrade = {
                        instrument: pending.instrument,
                        name: pending.name,
                        bar_type: pending.bar_type,
                        barNumber: pending.barNumber,
                        type: pending.type,
                        entry: entryPrice,
                        sl: pending.sl,
                        tp: pending.tp,
                        direction: pending.type === 'BUY_STOP' ? 'long' : 'short',
                        timestamp: bar.timestamp,
                        status: 'active'
                    };

                    this.activeTrades.set(key, activeTrade);
                    this.pendingOrders.delete(key);
                    
                    this.emit('trade_status_update', activeTrade);

                    // Check if the order was triggered and stopped out inside the same bar
                    let exitPrice = null;
                    let exitReason = null;

                    if (activeTrade.direction === 'long') {
                        const stoppedOut = bar.low <= activeTrade.sl;
                        const tpReached = bar.high >= activeTrade.tp;

                        if (stoppedOut && tpReached) {
                            exitPrice = activeTrade.sl;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = activeTrade.sl;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = activeTrade.tp;
                            exitReason = 'take_profit';
                        }
                    } else {
                        const stoppedOut = bar.high >= activeTrade.sl;
                        const tpReached = bar.low <= activeTrade.tp;

                        if (stoppedOut && tpReached) {
                            exitPrice = activeTrade.sl;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = activeTrade.sl;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = activeTrade.tp;
                            exitReason = 'take_profit';
                        }
                    }

                    if (exitPrice !== null) {
                        const statusUpdate = {
                            instrument: activeTrade.instrument,
                            bar_type: activeTrade.bar_type,
                            barNumber: activeTrade.barNumber,
                            type: activeTrade.type,
                            exitReason: exitReason,
                            exitPrice: exitPrice,
                            timestamp: bar.timestamp,
                            status: 'completed'
                        };

                        this.activeTrades.delete(key);
                        this.emit('trade_status_update', statusUpdate);
                    }
                } else if (bar.barNumber >= pending.expiryBarNumber) {
                    // Pending order failed to trigger on the next completed candle -> Expired
                    const expiredSignal = {
                        instrument: pending.instrument,
                        bar_type: pending.bar_type,
                        barNumber: pending.barNumber,
                        type: pending.type,
                        status: 'cancelled',
                        timestamp: bar.timestamp
                    };

                    this.pendingOrders.delete(key);
                    this.emit('trade_status_update', expiredSignal);
                }
            }
        });
    }
    
    /**
     * Process incoming tick through both builders
     */
    processTick(tickData) {
        const { instrument_key, last_traded_quantity } = tickData;
        
        const stats = this.comparisonStats.get(instrument_key);
        if (stats) {
            stats.totalTicks++;
            stats.totalVolume += parseInt(last_traded_quantity) || 0;
            this.comparisonStats.set(instrument_key, stats);
        }
        
        this.priceBuilder.processTick(tickData);
        this.volumeBuilder.processTick(tickData);
        
        this.emit('tick_processed', {
            ...tickData,
            priceBarProgress: this.priceBuilder.getProgress(instrument_key),
            volumeBarProgress: this.volumeBuilder.getProgress(instrument_key)
        });
    }
    
    /**
     * Get comparison statistics
     */
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
    
    /**
     * Get detailed comparison
     */
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
    
    /**
     * Save comparison report
     */
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