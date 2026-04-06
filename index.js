const UpstoxMarketFeed = require('./upstoxMarketFeed');
const DualCandleBuilder = require('./candleBuilder');
const config = require('./config.json');

// Initialize dual candle builder
const candleBuilder = new DualCandleBuilder({
    instruments: config.instruments,
    rawDataDir: config.directories.rawDataDir,
    candlesDataDir: config.directories.candlesDataDir
});

// Initialize market feed
const feed = new UpstoxMarketFeed({
    apiKey: process.env.UPSTOX_API_KEY,
    apiSecret: process.env.UPSTOX_API_SECRET,
    redirectUri: process.env.REDIRECT_URI,
    authCode: process.env.AUTH_CODE,
    instruments: config.instruments.map(i => i.key),
    dataDir: './market_data',
    mode: 'ltpc',
    debug: false
});

// Listen to both bar types
candleBuilder.priceBuilder.on('bar_close', (bar) => {
    console.log(`🎯 [PRICE BAR] ${bar.name} #${bar.barNumber}: ${bar.priceChangePercent}% change`);
});

candleBuilder.volumeBuilder.on('bar_close', (bar) => {
    console.log(`🎯 [VOLUME BAR] ${bar.name} #${bar.barNumber}: ${bar.priceChangePercent}% change`);
});

// Real-time progress monitoring
candleBuilder.on('tick_processed', (data) => {
    // Only log occasionally to avoid spam
    if (Math.random() < 0.01) {
        console.log(`\n📊 Progress Comparison:`);
        console.log(`   Price Bar: ${data.priceBarProgress?.progress || '0%'}`);
        console.log(`   Volume Bar: ${data.volumeBarProgress?.progress || '0%'}`);
    }
});

// Process ticks from WebSocket
feed.on('tick', (tickData) => {
    const latency = tickData.latency_ms || (Date.now() - (tickData.exchange_timestamp * 1000));
    if (latency > 1000) {
        console.warn(`⚠️ High latency: ${latency}ms for ${tickData.instrument_key}`);
    }

    candleBuilder.processTick(tickData);
});

// Print comparison stats every minute
setInterval(() => {
    console.log('\n' + '='.repeat(80));
    console.log('📊 DUAL CANDLE COMPARISON REPORT');
    console.log('='.repeat(80));
    console.table(candleBuilder.getComparisonStats());
    
    // Save report every 5 minutes
    if (Math.floor(Date.now() / 60000) % 5 === 0) {
        candleBuilder.saveComparisonReport();
        console.log('📁 Comparison report saved to candles_data/comparison/');
    }
}, 60000);

// Start the feed
feed.start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    const finalReport = candleBuilder.saveComparisonReport();
    console.log('Final report saved:', finalReport);
    feed.stop();
    process.exit(0);
});
