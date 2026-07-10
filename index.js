// index.js
const UpstoxMarketFeed = require('./upstoxMarketFeed');
const DualCandleBuilder = require('./candleBuilder');
const config = require('./config.json');
const ChartServer = require('./chartServer');

require('dotenv').config();

const express = require('express');
const app = express();

const options = {};
process.env.HOSTNAME && (options.allowedOrigins = [process.env.HOSTNAME]);

const chartServer = new ChartServer(3001, './candles_data', options);
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
    redirectUri: process.env.UPSTOX_REDIRECT_URI,
    analyticsToken: process.env.UPSTOX_ANALYTICS_TOKEN,
    authCode: process.env.UPSTOX_AUTH_CODE,
    instruments: config.instruments.map(i => i.key),
    dataDir: './market_data',
    mode: 'full',
    debug: false
});

// Forward live candle tracking to Server
candleBuilder.on('live_candle_update', (liveCandle) => {
    chartServer.broadcastLiveCandle(
        liveCandle.instrument,
        liveCandle,
        liveCandle.type
    );
});
  
// Forward candle closures to Server
candleBuilder.on('bar_close', (bar) => {
    chartServer.broadcastCandle(bar.instrument, bar, bar.type);
    console.log("🎯 [" + bar.type.toUpperCase() + " BAR] " + bar.name + " #" + bar.barNumber + ": " + bar.priceChangePercent + "% change");
});

// Forward Trade Signals from the DualCandleBuilder straight to Server (Saves & Broadcasts)
candleBuilder.on('trade_signal', (signal) => {
    chartServer.broadcastTradeSignal(signal);
});

// FIX: Add missing forwarder to bridge trade status changes (Pending -> Active -> Completed/Cancelled)
candleBuilder.on('trade_status_update', (update) => {
    chartServer.broadcastTradeStatusUpdate(update);
});
// Real-time progress monitoring
candleBuilder.on('tick_processed', (data) => {
    // Only log occasionally to avoid spam
    if (Math.random() < 0.01) {
        console.log("\n📊 Progress Comparison:");
        console.log("   Price Bar: " + (data.priceBarProgress ? data.priceBarProgress.progress : '0%'));
        console.log("   Volume Bar: " + (data.volumeBarProgress ? data.volumeBarProgress.progress : '0%'));
    }
});

// Helper: get IST hour for market-open staleness check (Phase 2)
function getISTHour() {
    var istMs = Date.now() + (5.5 * 60 * 60 * 1000);
    return new Date(istMs).getUTCHours();
}

// Process ticks from WebSocket with staleness gate (Phase 2)
feed.on('tick', (tickData) => {
    var latency = tickData.latency_ms || (Date.now() - (tickData.exchange_timestamp * 1000));
    if (latency > 1000) {
        console.warn("⚠️ High latency: " + latency + "ms for " + tickData.instrument_key);
    }

    // Phase 2: Staleness gate (gated by delay-management.enabled in config.json)
    try {
        var dmConfig = config['delay-management'];
        if (dmConfig && dmConfig.enabled) {
            var isMarketOpenHour = getISTHour() === 9;
            var maxLatency = isMarketOpenHour
                ? (dmConfig.market_open_max_staleness_ms || 10000)
                : (dmConfig.max_staleness_ms || 30000);
            if (latency > maxLatency) {
                console.warn("⚠️ Stale tick dropped: " + latency + "ms > " + maxLatency + "ms for " + tickData.instrument_key);
                return;
            }
        }
    } catch (e) {
        // config not available, skip staleness check
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

process.on('SIGINT', () => {
    console.log('\n🛑 Graceful shutdown initiated. Saving live tracking states...');
    
    try {
        const finalReport = candleBuilder.saveComparisonReport();
        console.log('Final comparison report saved successfully.');
    } catch (err) {
        console.error('Failed to save comparison report:', err.message);
    }
    
    // Save state layers dynamically to prevent restart gaps
    if (candleBuilder.priceBarBuilder && typeof candleBuilder.priceBarBuilder.saveActiveState === 'function') {
        candleBuilder.priceBarBuilder.saveActiveState();
    }
    if (candleBuilder.volumeBarBuilder && typeof candleBuilder.volumeBarBuilder.saveActiveState === 'function') {
        candleBuilder.volumeBarBuilder.saveActiveState();
    }
    
    feed.stop();
    console.log('Feeder connections disconnected cleanly. Exiting.');
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
    console.log("📡 HTTP server on port " + HTTP_PORT);
});