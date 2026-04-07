const EventEmitter = require('events');
const PriceBarBuilder = require('./priceBarBuilder');
const VolumeBarBuilder = require('./volumeBarBuilder');

class DualCandleBuilder extends EventEmitter {
    constructor(config) {
        super();
        
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
        
        this.priceBuilder.on('live_candle_update', (candle) => {
            this.emit('live_candle_update', candle);
        });
        
        this.volumeBuilder.on('live_candle_update', (candle) => {
            this.emit('live_candle_update', candle);
        });
        // Track statistics for comparison
        this.comparisonStats = new Map();
        
        // Initialize stats for each instrument
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
    
    /**
     * Process incoming tick through both builders
     */
    processTick(tickData) {
        const { instrument_key, last_traded_quantity } = tickData;
        
        // Update global stats
        const stats = this.comparisonStats.get(instrument_key);
        if (stats) {
            stats.totalTicks++;
            stats.totalVolume += parseInt(last_traded_quantity) || 0;
            this.comparisonStats.set(instrument_key, stats);
        }
        
        // Process through both builders
        this.priceBuilder.processTick(tickData);
        this.volumeBuilder.processTick(tickData);
        
        // Emit combined update for real-time monitoring
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
