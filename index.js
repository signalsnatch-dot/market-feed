const UpstoxMarketFeed = require('./upstoxMarketFeed');
const DualCandleBuilder = require('./candleBuilder');
const config = require('./config.json');
const ChartServer = require('./chartServer');

require('dotenv').config();

const express = require('express');
const app = express();

const chartServer = new ChartServer(3001, './candles_data');
chartServer.start();


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

candleBuilder.on('live_candle_update', (liveCandle) => {
    chartServer.broadcastLiveCandle(
        liveCandle.instrument,
        liveCandle,
        liveCandle.type
    );
});
  
candleBuilder.on('bar_close', (bar) => {
    chartServer.broadcastCandle(bar.instrument, bar, bar.type);
    console.log(`🎯 [${bar.type.toUpperCase()} BAR] ${bar.name} #${bar.barNumber}: ${bar.priceChangePercent}% change`);
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


app.get('/api/instruments', (req, res) => {
    res.json(config.instruments.map(i => ({
        key: i.key,
        name: i.name,
        exchange: i.exchange
    })));
});

// Start the HTTP server alongside your existing feed
const HTTP_PORT = 3000;
app.listen(HTTP_PORT, () => {
    console.log(`📡 HTTP server on port ${HTTP_PORT}`);
});