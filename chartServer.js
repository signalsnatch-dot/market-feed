// chartServer.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

class ChartServer {
    constructor(port = 3001, candlesDataDir = './candles_data', options = {}) {
        this.port = port;
        this.candlesDataDir = path.resolve(candlesDataDir);
        this.allowedOrigins = options.allowedOrigins || ['http://localhost:3000', 'http://localhost:3001'];
        this.requireAuth = options.requireAuth || false;
        this.validTokens = options.validTokens || new Set(); // For auth if enabled
        
        // Validate candlesDataDir path to prevent directory traversal
        this.validateDataDirectory();
        
        this.app = express();
        this.server = http.createServer(this.app);
        
        // Configure Socket.IO with strict CORS
        this.io = socketIo(this.server, {
            cors: {
                origin: (origin, callback) => {
                    // Allow requests with no origin (like mobile apps or curl)
                    if (!origin) return callback(null, true);
                    
                    // Check if origin is allowed
                    if (this.allowedOrigins.includes(origin)) {
                        callback(null, true);
                    } else {
                        callback(new Error('CORS not allowed'));
                    }
                },
                methods: ['GET', 'POST'],
                credentials: true,
                allowedHeaders: ['Authorization', 'Content-Type']
            },
            transports: ['websocket', 'polling'],
            pingTimeout: 60000,
            pingInterval: 25000
        });
        
        this.recentCandles = { price_bars: [], volume_bars: [] };
        this.tradeSignals = [];
        this.maxRecentCandlesPerInstrument = 1200; // Increased to support 1200 candles on chart
        
        this.setupRoutes();
        this.setupSocketEvents();
        this.loadSavedSignals(); // Load saved trade signals on startup
        this.loadHistoricalCandles();
    }
    
    validateDataDirectory() {
        // Resolve and validate the data directory path
        const resolvedPath = path.resolve(this.candlesDataDir);
        const parentDir = path.resolve('.');
        
        // Ensure the directory is within the project root (prevent directory traversal)
        if (!resolvedPath.startsWith(parentDir)) {
            throw new Error(`Security violation: candlesDataDir "${this.candlesDataDir}" resolves outside project root`);
        }
        
        // Check if directory exists, create if not
        if (!fs.existsSync(resolvedPath)) {
            fs.mkdirSync(resolvedPath, { recursive: true });
            console.log(`Created data directory: ${resolvedPath}`);
        }
        
        // Verify we can write to the directory
        try {
            fs.accessSync(resolvedPath, fs.constants.W_OK);
        } catch (err) {
            console.error(`Cannot write to data directory: ${resolvedPath}`);
            throw new Error(`Data directory not writable: ${resolvedPath}`);
        }
        
        console.log(`✅ Data directory validated: ${resolvedPath}`);
        this.candlesDataDir = resolvedPath;
    }
    
    validateFilePath(filepath, type) {
        // Ensure the filepath is within the allowed subdirectories
        const resolvedPath = path.resolve(filepath);
        const allowedDirs = [
            path.join(this.candlesDataDir, 'volume_bars'),
            path.join(this.candlesDataDir, 'price_bars'),
            path.join(__dirname, 'public')
        ];
        
        const isAllowed = allowedDirs.some(allowedDir => 
            resolvedPath.startsWith(path.resolve(allowedDir))
        );
        
        if (!isAllowed) {
            throw new Error(`Security violation: Attempted access to unauthorized path: ${filepath}`);
        }
        
        return resolvedPath;
    }
    
    setupRoutes() {
        // Serve static files
        this.app.use(express.static(path.join(__dirname, 'public')));
        
        // Serve node_modules for local library access (optional)
        const nodeModulesPath = path.join(__dirname, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
            this.app.use('/node_modules', express.static(nodeModulesPath));
        }
        
        // API endpoint to get recent candles
        this.app.get('/api/recent/:type', (req, res) => {
            const type = req.params.type;
            
            if (type === 'price' || type === 'volume') {
                const storeKey = `${type}_bars`;
                const candles = this.recentCandles[storeKey];
                
                // Group candles by instrument to make sure we return full requested history up to 1200 for all
                const candlesByInstrument = {};
                for (const c of candles) {
                    const key = c.instrument || c.instrument_key;
                    if (!candlesByInstrument[key]) {
                        candlesByInstrument[key] = [];
                    }
                    candlesByInstrument[key].push(c);
                }
                
                const responseCandles = [];
                for (const key of Object.keys(candlesByInstrument)) {
                    responseCandles.push(...candlesByInstrument[key].slice(-this.maxRecentCandlesPerInstrument));
                }
                
                // Sort chronologically before returning
                responseCandles.sort((a, b) => a.timestamp - b.timestamp);
                res.json(responseCandles);
            } else {
                res.status(400).json({ error: 'Invalid type. Use "price" or "volume"' });
            }
        });
        
        // API endpoint to get instruments list
        this.app.get('/api/instruments', (req, res) => {
            const instruments = this.getInstrumentsFromFiles();
            res.json(instruments);
        });
        
        // API endpoint for historical candles
        this.app.get('/api/historical/:instrument/:type', (req, res) => {
            const { instrument, type } = req.params;
            const limit = parseInt(req.query.limit) || this.maxRecentCandlesPerInstrument;
            
            if (type !== 'price' && type !== 'volume') {
                return res.status(400).json({ error: 'Invalid type' });
            }
            
            const candles = this.recentCandles[`${type}_bars`].filter(
                c => (c.instrument === instrument || c.instrument_key === instrument)
            );
            res.json(candles.slice(-limit));
        });

        // API endpoint to retrieve saved trade signals
        this.app.get('/api/signals', (req, res) => {
            res.json(this.tradeSignals);
        });
        
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: Date.now() });
        });
        
        // 404 handler for undefined routes (MUST be last)
        this.app.use((req, res) => {
            res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
        });
    }
        
    setupSocketEvents() {
        // Authentication middleware for socket connections
        this.io.use((socket, next) => {
            if (!this.requireAuth) {
                return next();
            }
            
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
            if (token && this.validTokens.has(token)) {
                next();
            } else {
                next(new Error('Authentication error'));
            }
        });
        
        this.io.on('connection', (socket) => {
            console.log(`Client connected: ${socket.id} from ${socket.handshake.address}`);
            
            // Send historical data and active trade signals
            socket.emit('historical_candles', {
                volume_bars: this.recentCandles.volume_bars,
                price_bars: this.recentCandles.price_bars,
                instruments: this.getInstrumentsFromFiles(),
                trade_signals: this.tradeSignals // Client now populates complete historical list instantly
            });
            
            socket.on('subscribe', (data) => {
                const { instrument, type } = data;
                // Validate instrument format
                if (!instrument || !type || (type !== 'volume' && type !== 'price')) {
                    socket.emit('error', { message: 'Invalid subscription' });
                    return;
                }
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
    
    loadHistoricalCandles() {
        console.log('📂 Loading historical candles...');
        
        this.recentCandles = { price_bars: [], volume_bars: [] };
        
        // Load volume bars with path validation
        const volumeDir = path.join(this.candlesDataDir, 'volume_bars');
        if (fs.existsSync(volumeDir)) {
            const files = fs.readdirSync(volumeDir);
            
            files.forEach(file => {
                if (file.endsWith('_volume_bars.csv')) {
                    const filepath = path.join(volumeDir, file);
                    try {
                        this.validateFilePath(filepath, 'volume_bars');
                        const instrumentKey = this.extractInstrumentKey(file);
                        const candles = this.parseVolumeBarCSV(filepath, instrumentKey);
                        // Limit to maximum configured depth per instrument to avoid memory exhaustion
                        const limitedCandles = candles.slice(-this.maxRecentCandlesPerInstrument);
                        this.recentCandles.volume_bars.push(...limitedCandles);
                    } catch (err) {
                        console.error(`Security error loading ${file}:`, err.message);
                    }
                }
            });
        }
        
        // Load price bars with path validation
        const priceDir = path.join(this.candlesDataDir, 'price_bars');
        if (fs.existsSync(priceDir)) {
            const files = fs.readdirSync(priceDir);
            
            files.forEach(file => {
                if (file.endsWith('_price_bars.csv')) {
                    const filepath = path.join(priceDir, file);
                    try {
                        this.validateFilePath(filepath, 'price_bars');
                        const instrumentKey = this.extractInstrumentKey(file);
                        const candles = this.parsePriceBarCSV(filepath, instrumentKey);
                        // Limit to maximum configured depth per instrument
                        const limitedCandles = candles.slice(-this.maxRecentCandlesPerInstrument);
                        this.recentCandles.price_bars.push(...limitedCandles);
                    } catch (err) {
                        console.error(`Security error loading ${file}:`, err.message);
                    }
                }
            });
        }
        
        // Sort
        this.recentCandles.volume_bars.sort((a, b) => a.timestamp - b.timestamp);
        this.recentCandles.price_bars.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`✅ Loaded ${this.recentCandles.volume_bars.length} volume bars`);
        console.log(`✅ Loaded ${this.recentCandles.price_bars.length} price bars`);
    }

    loadSavedSignals() {
        const jsonFile = 'signals_today_' + new Date().toISOString().split('T')[0] + '.json';
        const signalsFile = path.join(this.candlesDataDir, jsonFile);
        if (fs.existsSync(signalsFile)) {
            try {
                const fileData = fs.readFileSync(signalsFile, 'utf8');
                this.tradeSignals = JSON.parse(fileData);
                console.log(`✅ Loaded ${this.tradeSignals.length} persisted trade signals from disk`);
            } catch (err) {
                console.warn('⚠️ No signal file found or file corrupted, starting fresh.', err.message);
                this.tradeSignals = [];
            }
        }
    }

    saveSignalsToDisk() {
        try {
            const jsonFile = 'signals_today_' + new Date().toISOString().split('T')[0] + '.json';
            const signalsFile = path.join(this.candlesDataDir, jsonFile);
            fs.writeFileSync(signalsFile, JSON.stringify(this.tradeSignals, null, 2), 'utf8');
        } catch (err) {
            console.error('❌ Failed to write trade signals to disk:', err.message);
        }
    }
    
    parseVolumeBarCSV(filepath, instrumentKey) {
        const candles = [];
        
        try {
            const content = fs.readFileSync(filepath, 'utf8');
            const lines = content.split('\n');
            
            if (lines.length < 2) return candles;
            
            const headers = lines[0].trim().split(',');
            
            const timestampIdx = headers.indexOf('timestamp');
            const barNumberIdx = headers.indexOf('bar_number');
            const openIdx = headers.indexOf('open');
            const highIdx = headers.indexOf('high');
            const lowIdx = headers.indexOf('low');
            const closeIdx = headers.indexOf('close');
            const volumeIdx = headers.indexOf('volume');
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
                
                let timestamp = parseInt(values[timestampIdx]);
                if (isNaN(timestamp)) {
                    const endTimeStr = values[endTimeIdx];
                    if (endTimeStr) {
                        timestamp = new Date(endTimeStr).getTime();
                    }
                }
                
                const istTimestamp = this.convertToIST(timestamp);
                
                const open = parseFloat(values[openIdx]);
                const high = parseFloat(values[highIdx]);
                const low = parseFloat(values[lowIdx]);
                const close = parseFloat(values[closeIdx]);
                
                if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;
                
                candles.push({
                    timestamp: istTimestamp,
                    original_timestamp: timestamp,
                    instrument: instrumentKey,
                    instrument_key: instrumentKey,
                    type: 'volume',
                    barNumber: parseInt(values[barNumberIdx]) || i,
                    open: open,
                    high: high,
                    low: low,
                    close: close,
                    volume: parseFloat(values[volumeIdx]) || 0,
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
            
            const headers = lines[0].trim().split(',');
            
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
                
                const istTimestamp = this.convertToIST(timestamp);
                
                const open = parseFloat(values[openIdx]);
                const high = parseFloat(values[highIdx]);
                const low = parseFloat(values[lowIdx]);
                const close = parseFloat(values[closeIdx]);
                
                if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;
                
                candles.push({
                    timestamp: istTimestamp,
                    original_timestamp: timestamp,
                    instrument: instrumentKey,
                    instrument_key: instrumentKey,
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
    
    convertToIST(timestamp) {
        const IST_OFFSET = 5.5 * 60 * 60 * 1000;
        let msTimestamp = timestamp;
        if (timestamp < 10000000000) {
            msTimestamp = timestamp * 1000;
        }
        return msTimestamp + IST_OFFSET;
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
        const match = filename.match(/^(MCX_FO|NSE_FO|NSE_EQ)_([^_]+)/);
        if (match) {
            return `${match[1]}|${match[2]}`;
        }
        return filename.replace('_volume_bars.csv', '').replace('_price_bars.csv', '');
    }
    
    getInstrumentName(key) {
        const names = {
            'MCX_FO|504265': 'Natural Gas Future',
            'NSE_FO|62329': 'Nifty 50 Future',
            'NSE_FO|62326': 'Nifty Bank Future',
            'MCX_FO|487465': 'Natural Gas Future',
            'NSE_FO|45450': 'Nifty 50 Future',
            'NSE_FO|66688': 'Nifty Bank Future'
        };
        return names[key] || key.split('|')[1];
    }
    
    getInstrumentsFromFiles() {
        const instruments = [];
        const seen = new Set();
        
        [...this.recentCandles.volume_bars, ...this.recentCandles.price_bars].forEach(candle => {
            const key = candle.instrument || candle.instrument_key;
            if (key && !seen.has(key)) {
                seen.add(key);
                instruments.push({
                    key: key,
                    name: this.getInstrumentName(key),
                    exchange: key.split('|')[0],
                    symbol: key.split('|')[1]
                });
            }
        });
        
        return instruments;
    }
    
    broadcastCandle(instrumentKey, candle, type) {
        const candleData = {
            ...candle,
            type: type,
            instrument: instrumentKey,
            instrument_key: instrumentKey,
            broadcast_time: Date.now()
        };
        
        const storeKey = `${type}_bars`;
        this.recentCandles[storeKey].push(candleData);
        
        // Group by instrument to slice each instrument dataset up to 1200 candles safely
        const candlesByInstrument = {};
        for (const c of this.recentCandles[storeKey]) {
            const key = c.instrument || c.instrument_key;
            if (!candlesByInstrument[key]) {
                candlesByInstrument[key] = [];
            }
            candlesByInstrument[key].push(c);
        }
        
        // Re-flatten limited bars
        const updatedCandles = [];
        for (const key of Object.keys(candlesByInstrument)) {
            updatedCandles.push(...candlesByInstrument[key].slice(-this.maxRecentCandlesPerInstrument));
        }
        
        // Sort chronologically
        this.recentCandles[storeKey] = updatedCandles.sort((a, b) => a.timestamp - b.timestamp);
        
        this.io.to(`${instrumentKey}_${type}`).emit(`${instrumentKey}_${type}_candle`, candleData);
        this.io.emit('candle_update', candleData);
    }
    
    broadcastLiveCandle(instrumentKey, liveCandle, type) {
        const candleData = {
            ...liveCandle,
            instrument: instrumentKey,
            instrument_key: instrumentKey,
            type: type,
            broadcast_time: Date.now()
        };
        
        this.io.to(`${instrumentKey}_${type}`).emit(`${instrumentKey}_${type}_live_candle`, candleData);
        this.io.emit('live_candle_update', candleData);
    }

    broadcastTradeSignal(signalData) {
        this.tradeSignals.push(signalData);
        
        // Cache maximum of 200 historical signals in-memory
        if (this.tradeSignals.length > 200) {
            this.tradeSignals.shift();
        }
        
        this.saveSignalsToDisk(); // Save updated cache to disk
        this.io.emit('trade_signal', signalData);
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`📊 Secure chart server running on port ${this.port}`);
            console.log(`   CORS allowed origins: ${this.allowedOrigins.join(', ')}`);
            console.log(`   Data directory: ${this.candlesDataDir}`);
            console.log(`   Volume bars loaded: ${this.recentCandles.volume_bars.length}`);
            console.log(`   Price bars loaded: ${this.recentCandles.price_bars.length}`);
        });
    }
}

module.exports = ChartServer;