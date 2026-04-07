// chartServer.js - Fixed CSV parsing for your actual format
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const IST_OFFSET = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds

class ChartServer {

    constructor(port = 3001, candlesDataDir = './candles_data') {
        this.port = port;
        this.candlesDataDir = candlesDataDir;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: { origin: "*" },
            transports: ['websocket', 'polling']
        });
        
        this.recentCandles = {
            price_bars: [],
            volume_bars: []
        };
        
        this.maxRecentCandles = 1000;
        this.setupRoutes();
        this.setupSocketEvents();
        this.loadHistoricalCandles();
    }
    
    setupRoutes() {
        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
        
        this.app.get('/api/recent/:type', (req, res) => {
            const type = req.params.type;
            const limit = parseInt(req.query.limit) || 500;
            
            if (type === 'price' || type === 'volume') {
                const candles = this.recentCandles[`${type}_bars`];
                res.json(candles.slice(-limit));
            } else {
                res.status(400).json({ error: 'Invalid type' });
            }
        });
        
        this.app.get('/api/instruments', (req, res) => {
            const instruments = this.getInstrumentsFromFiles();
            res.json(instruments);
        });
        
        this.app.get('/api/historical/:instrument/:type', (req, res) => {
            const { instrument, type } = req.params;
            const limit = parseInt(req.query.limit) || 500;
            
            const candles = this.recentCandles[`${type}_bars`].filter(
                c => c.instrument === instrument
            );
            res.json(candles.slice(-limit));
        });
        
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: Date.now() });
        });
    }
    
    loadHistoricalCandles() {
        console.log('📂 Loading historical candles...');
        
        // Clear existing
        this.recentCandles = { price_bars: [], volume_bars: [] };
        
        // Load volume bars
        const volumeDir = path.join(this.candlesDataDir, 'volume_bars');
        if (fs.existsSync(volumeDir)) {
            const files = fs.readdirSync(volumeDir);
            console.log(`Found ${files.length} files in volume_bars/`);
            
            files.forEach(file => {
                if (file.endsWith('_volume_bars.csv')) {
                    const filepath = path.join(volumeDir, file);
                    const instrumentKey = this.extractInstrumentKey(file);
                    console.log(`Parsing ${file} for ${instrumentKey}`);
                    
                    const candles = this.parseVolumeBarCSV(filepath, instrumentKey);
                    console.log(`  Loaded ${candles.length} volume bars`);
                    
                    this.recentCandles.volume_bars.push(...candles);
                }
            });
        }
        
        // Load price bars
        const priceDir = path.join(this.candlesDataDir, 'price_bars');
        if (fs.existsSync(priceDir)) {
            const files = fs.readdirSync(priceDir);
            console.log(`Found ${files.length} files in price_bars/`);
            
            files.forEach(file => {
                if (file.endsWith('_price_bars.csv')) {
                    const filepath = path.join(priceDir, file);
                    const instrumentKey = this.extractInstrumentKey(file);
                    console.log(`Parsing ${file} for ${instrumentKey}`);
                    
                    const candles = this.parsePriceBarCSV(filepath, instrumentKey);
                    console.log(`  Loaded ${candles.length} price bars`);
                    
                    this.recentCandles.price_bars.push(...candles);
                }
            });
        }
        
        // Sort by timestamp
        this.recentCandles.volume_bars.sort((a, b) => a.timestamp - b.timestamp);
        this.recentCandles.price_bars.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`✅ Loaded ${this.recentCandles.volume_bars.length} total volume bars`);
        console.log(`✅ Loaded ${this.recentCandles.price_bars.length} total price bars`);
    }


    convertToIST(timestamp) {
        // timestamp can be in milliseconds or seconds
        let msTimestamp = timestamp;
        if (timestamp < 10000000000) {
            // Looks like seconds, convert to milliseconds
            msTimestamp = timestamp * 1000;
        }
        return msTimestamp + IST_OFFSET;
    }
    
    parseVolumeBarCSV(filepath, instrumentKey) {
        const candles = [];
        
        try {
            const content = fs.readFileSync(filepath, 'utf8');
            const lines = content.split('\n');
            
            if (lines.length < 2) return candles;
            
            const headers = lines[0].split(',');
            
            // Find column indices based on your CSV header
            const timestampIdx = headers.indexOf('timestamp');
            const barNumberIdx = headers.indexOf('bar_number');
            const openIdx = headers.indexOf('open');
            const highIdx = headers.indexOf('high');
            const lowIdx = headers.indexOf('low');
            const closeIdx = headers.indexOf('close');
            const volumeIdx = headers.indexOf('volume');
            const targetVolumeIdx = headers.indexOf('target_volume');
            const transactionsIdx = headers.indexOf('transactions');
            const priceChangesIdx = headers.indexOf('price_changes');
            const changePercentIdx = headers.indexOf('price_change_percent');
            const startTimeIdx = headers.indexOf('start_time');
            const endTimeIdx = headers.indexOf('end_time');
            const durationIdx = headers.indexOf('duration_seconds');
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const values = this.parseCSVLine(line);
                if (values.length < 10) continue;
                
                // Parse timestamp (already in milliseconds)
                let timestamp = parseInt(values[timestampIdx]);
                if (isNaN(timestamp)) {
                    // Try end_time as fallback
                    const endTimeStr = values[endTimeIdx];
                    if (endTimeStr) {
                        timestamp = new Date(endTimeStr).getTime();
                    }
                }
                const istTimestamp = convertToIST(timestamp);

                
                const open = parseFloat(values[openIdx]);
                const high = parseFloat(values[highIdx]);
                const low = parseFloat(values[lowIdx]);
                const close = parseFloat(values[closeIdx]);

                
                if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;
                
                candles.push({
                    timestamp: istTimestamp,  // Store IST timestamp
                    original_timestamp: timestamp,  // Keep original for reference                    instrument: instrumentKey,
                    type: 'volume',
                    barNumber: parseInt(values[barNumberIdx]) || i,
                    open: open,
                    high: high,
                    low: low,
                    close: close,
                    volume: parseFloat(values[volumeIdx]) || 0,
                    targetVolume: parseFloat(values[targetVolumeIdx]) || 0,
                    transactions: parseInt(values[transactionsIdx]) || 0,
                    priceChanges: parseInt(values[priceChangesIdx]) || 0,
                    priceChangePercent: parseFloat(values[changePercentIdx]) || 0,
                    startTime: values[startTimeIdx] || '',
                    endTime: values[endTimeIdx] || '',
                    durationSeconds: parseFloat(values[durationIdx]) || 0
                });
            }
        } catch (error) {
            console.error(`Error parsing ${filepath}:`, error.message);
        }
        
        return candles;
    }
    
    parsePriceBarCSV(filepath, instrumentKey) {
        const candles = [];
        
        try {
            const content = fs.readFileSync(filepath, 'utf8');
            const lines = content.split('\n');
            
            if (lines.length < 2) return candles;
            
            const headers = lines[0].split(',');
            
            const timestampIdx = headers.indexOf('timestamp');
            const barNumberIdx = headers.indexOf('bar_number');
            const openIdx = headers.indexOf('open');
            const highIdx = headers.indexOf('high');
            const lowIdx = headers.indexOf('low');
            const closeIdx = headers.indexOf('close');
            const ticksIdx = headers.indexOf('ticks');
            const targetTicksIdx = headers.indexOf('target_ticks');
            const volumeIdx = headers.indexOf('volume');
            const changePercentIdx = headers.indexOf('price_change_percent');
            const startTimeIdx = headers.indexOf('start_time');
            const endTimeIdx = headers.indexOf('end_time');
            const durationIdx = headers.indexOf('duration_seconds');
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const values = this.parseCSVLine(line);
                if (values.length < 8) continue;
                
                let timestamp = parseInt(values[timestampIdx]);
                if (isNaN(timestamp)) {
                    const endTimeStr = values[endTimeIdx];
                    if (endTimeStr) {
                        timestamp = new Date(endTimeStr).getTime();
                    }
                }
                
                const istTimestamp = convertToIST(timestamp);

                const open = parseFloat(values[openIdx]);
                const high = parseFloat(values[highIdx]);
                const low = parseFloat(values[lowIdx]);
                const close = parseFloat(values[closeIdx]);
                
                if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;
                
                candles.push({
                    timestamp: istTimestamp,  // Store IST timestamp
                    original_timestamp: timestamp,  // Keep original for reference,
                    instrument: instrumentKey,
                    type: 'price',
                    barNumber: parseInt(values[barNumberIdx]) || i,
                    open: open,
                    high: high,
                    low: low,
                    close: close,
                    ticks: parseInt(values[ticksIdx]) || 0,
                    targetTicks: parseInt(values[targetTicksIdx]) || 0,
                    volume: parseFloat(values[volumeIdx]) || 0,
                    priceChangePercent: parseFloat(values[changePercentIdx]) || 0,
                    startTime: values[startTimeIdx] || '',
                    endTime: values[endTimeIdx] || '',
                    durationSeconds: parseFloat(values[durationIdx]) || 0
                });
            }
        } catch (error) {
            console.error(`Error parsing ${filepath}:`, error.message);
        }
        
        return candles;
    }
    
    parseCSVLine(line) {
        const result = [];
        let inQuotes = false;
        let current = '';
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        
        return result;
    }
    
    extractInstrumentKey(filename) {
        // From "MCX_FO_487465_volume_bars.csv" -> "MCX_FO|487465"
        const match = filename.match(/^(MCX_FO|NSE_FO|NSE_EQ)_([^_]+)/);
        if (match) {
            return `${match[1]}|${match[2]}`;
        }
        return filename.replace('_volume_bars.csv', '').replace('_price_bars.csv', '');
    }
    
    getInstrumentName(key) {
        const names = {
            'MCX_FO|487465': 'Natural Gas Future',
            'NSE_FO|45450': 'Nifty 50 Future',
            'NSE_FO|45455': 'Nifty Bank Future'
        };
        return names[key] || key.split('|')[1];
    }
    
    getInstrumentsFromFiles() {
        const instruments = [];
        const seen = new Set();
        
        [...this.recentCandles.volume_bars, ...this.recentCandles.price_bars].forEach(candle => {
            if (!seen.has(candle.instrument)) {
                seen.add(candle.instrument);
                instruments.push({
                    key: candle.instrument,
                    name: this.getInstrumentName(candle.instrument),
                    exchange: candle.instrument.split('|')[0],
                    symbol: candle.instrument.split('|')[1]
                });
            }
        });
        
        return instruments;
    }
    
    setupSocketEvents() {
        this.io.on('connection', (socket) => {
            console.log(`Client connected: ${socket.id}`);
            
            socket.emit('historical_candles', {
                volume_bars: this.recentCandles.volume_bars,
                price_bars: this.recentCandles.price_bars,
                instruments: this.getInstrumentsFromFiles()
            });
            
            socket.on('subscribe', (data) => {
                const { instrument, type } = data;
                socket.join(`${instrument}_${type}`);
                console.log(`Client ${socket.id} subscribed to ${instrument} ${type}`);
            });
            
            socket.on('unsubscribe', (data) => {
                const { instrument, type } = data;
                socket.leave(`${instrument}_${type}`);
            });
            
            socket.on('disconnect', () => {
                console.log(`Client disconnected: ${socket.id}`);
            });
        });
    }

    broadcastLiveCandle(instrumentKey, liveCandle, type) {
        const candleData = {
            ...liveCandle,
            instrument: instrumentKey,
            type: type,
            broadcast_time: Date.now()
        };
        
        // Broadcast to subscribed clients
        this.io.to(`${instrumentKey}_${type}`).emit(`${instrumentKey}_${type}_live_candle`, candleData);
        this.io.emit('live_candle_update', candleData);
    }
    
    broadcastCandle(instrumentKey, candle, type) {
        const candleData = {
            ...candle,
            type: type,
            instrument: instrumentKey,
            broadcast_time: Date.now()
        };
        
        const storeKey = `${type}_bars`;
        this.recentCandles[storeKey].push(candleData);
        
        if (this.recentCandles[storeKey].length > this.maxRecentCandles) {
            this.recentCandles[storeKey] = this.recentCandles[storeKey].slice(-this.maxRecentCandles);
        }
        
        this.io.to(`${instrumentKey}_${type}`).emit(`${instrumentKey}_${type}_candle`, candleData);
        this.io.emit('candle_update', candleData);
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`📊 Chart server running on port ${this.port}`);
            console.log(`   Volume bars loaded: ${this.recentCandles.volume_bars.length}`);
            console.log(`   Price bars loaded: ${this.recentCandles.price_bars.length}`);
        });
    }
}

module.exports = ChartServer;