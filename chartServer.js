// chartServer.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { STRATEGIES } = require('./priceActionStrategy');

// Dynamic timezone and trading-session aware date helpers
function getTradingDayIST(ts) {
    if (!ts) return '';
    let ms = typeof ts === 'number' ? ts : Number(ts);
    if (isNaN(ms)) {
        const parsed = Date.parse(ts);
        if (!isNaN(parsed)) ms = parsed;
    }
    if (isNaN(ms) || ms <= 0) return '';
    if (ms < 10000000000) ms *= 1000; // Force seconds to millisecond scaling

    const date = new Date(ms);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    
    const formattedStr = formatter.format(date); 
    const match = formattedStr.match(/^(\d{4}-\d{2}-\d{2}).*?(\d{2}):(\d{2})$/);
    if (!match) return formattedStr.split(',')[0].trim();

    const calendarDateStr = match[1];
    const hour = parseInt(match[2], 10);
    const minute = parseInt(match[3], 10);

    const timeMinutes = hour * 60 + minute;
    const sessionStartMinutes = 9 * 60; // Trading session boundary starts at 09:00 AM IST

    // If trade occurred before 9:00 AM IST, roll back to yesterday's trading day
    if (timeMinutes < sessionStartMinutes) {
        const d = new Date(calendarDateStr + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    }

    return calendarDateStr;
}

function getTodayISTTradingDay() {
    return getTradingDayIST(Date.now());
}

class ChartServer {
    constructor(port = 3001, candlesDataDir = './candles_data', options = {}) {
        this.port = port;
        this.candlesDataDir = path.resolve(candlesDataDir);
        this.allowedOrigins = options.allowedOrigins || ['http://localhost:3000', 'http://localhost:3001'];
        this.requireAuth = options.requireAuth || false;
        this.validTokens = options.validTokens || new Set();
        
        this.validateDataDirectory();
        
        this.app = express();
        this.server = http.createServer(this.app);
        
        this.io = socketIo(this.server, {
            cors: {
                origin: (origin, callback) => {
                    if (!origin) return callback(null, true);
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
        
        // Structured nesting for instant O(1) lookups
        this.recentCandles = { price_bars: {}, volume_bars: {} };
        this.tradeSignals = [];
        this.maxRecentCandlesPerInstrument = 1200; 
        
        this.setupRoutes();
        this.setupSocketEvents();
        this.loadSavedSignals();
        this.loadHistoricalCandles();
        this.generateHistoricalSignals(); 
    }
    
    validateDataDirectory() {
        const resolvedPath = path.resolve(this.candlesDataDir);
        const parentDir = path.resolve('.');
        if (!resolvedPath.startsWith(parentDir)) {
            throw new Error("Security violation: candlesDataDir resolves outside project root");
        }
        if (!fs.existsSync(resolvedPath)) {
            fs.mkdirSync(resolvedPath, { recursive: true });
        }
        try {
            fs.accessSync(resolvedPath, fs.constants.W_OK);
        } catch (err) {
            throw new Error("Data directory not writable: " + resolvedPath);
        }
        this.candlesDataDir = resolvedPath;
    }
    
    validateFilePath(filepath, type) {
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
            throw new Error("Security violation: Unauthorized path: " + filepath);
        }
        return resolvedPath;
    }
    
    extractInstrumentKeyAndThreshold(filename) {
        const match = filename.match(/^(MCX_FO|NSE_FO|NSE_EQ)_([^_]+)_(\d+)_(volume|price)_bars\.csv$/);
        if (match) {
            return {
                instrumentKey: match[1] + '|' + match[2],
                threshold: parseInt(match[3], 10),
                type: match[4]
            };
        }
        const legacyMatch = filename.match(/^(MCX_FO|NSE_FO|NSE_EQ)_([^_]+)/);
        if (legacyMatch) {
            return {
                instrumentKey: legacyMatch[1] + '|' + legacyMatch[2],
                threshold: null,
                type: filename.includes('volume') ? 'volume' : 'price'
            };
        }
        return {
            instrumentKey: filename.replace('_volume_bars.csv', '').replace('_price_bars.csv', ''),
            threshold: null,
            type: filename.includes('volume') ? 'volume' : 'price'
        };
    }
    
    setupRoutes() {
        this.app.use(express.static(path.join(__dirname, 'public')));
        const nodeModulesPath = path.join(__dirname, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
            this.app.use('/node_modules', express.static(nodeModulesPath));
        }
        
        this.app.get('/api/recent/:type', (req, res) => {
            const type = req.params.type;
            if (type !== 'price' && type !== 'volume') {
                return res.status(400).json({ error: 'Invalid type' });
            }

            const storeKey = type + '_bars';
            const { instrument, threshold } = req.query;
            
            if (!instrument || !threshold) {
                return res.json([]);
            }

            const threshNum = parseInt(threshold, 10);
            const instrumentMap = this.recentCandles[storeKey][instrument];
            if (instrumentMap && instrumentMap[threshNum]) {
                return res.json(instrumentMap[threshNum].slice(-50)); // Slices last 50 candles instantly
            }
            
            res.json([]);
        });
        
        this.app.get('/api/instruments', (req, res) => {
            res.json(this.getInstrumentsFromFiles());
        });

        this.app.get('/api/strategies', (req, res) => {
            res.json(Object.keys(STRATEGIES));
        });
        
        this.app.get('/api/signals', (req, res) => {
            this.pruneOldSignals();
            const todaySignals = this.tradeSignals.map(sig => ({
                ...sig,
                name: this.getInstrumentName(sig.instrument)
            }));
            res.json(todaySignals);
        });
        
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: Date.now() });
        });
    }
        
    setupSocketEvents() {
        this.io.use((socket, next) => {
            if (!this.requireAuth) return next();
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
            if (token && this.validTokens.has(token)) {
                next();
            } else {
                next(new Error('Authentication error'));
            }
        });
        
        this.io.on('connection', (socket) => {
            console.log("Client connected: " + socket.id);
            this.pruneOldSignals();
            
            const todaySignals = this.tradeSignals.map(sig => ({
                ...sig,
                name: this.getInstrumentName(sig.instrument)
            }));
            
            socket.emit('historical_candles', {
                instruments: this.getInstrumentsFromFiles(),
                trade_signals: todaySignals,
                strategies: Object.keys(STRATEGIES)
            });
            
            socket.on('subscribe', (data) => {
                const { instrument, type, threshold } = data;
                if (!instrument || !type || (type !== 'volume' && type !== 'price') || !threshold) {
                    socket.emit('error', { message: 'Invalid subscription' });
                    return;
                }
                socket.join(instrument + '_' + type + '_' + threshold);
                console.log("Client subscribed to " + instrument + " " + type + " (Threshold: " + threshold + ")");
            });
            
            socket.on('unsubscribe', (data) => {
                const { instrument, type, threshold } = data;
                if (instrument && type && threshold) {
                    socket.leave(instrument + '_' + type + '_' + threshold);
                }
            });
        });
    }
    
    loadHistoricalCandles() {
        console.log('📂 Loading historical parallel threshold candles...');
        this.recentCandles = { price_bars: {}, volume_bars: {} };
        
        const loadTypeDir = (dirPath, storeKey) => {
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                files.forEach(file => {
                    if (file.endsWith(`_${storeKey}.csv`)) {
                        const filepath = path.join(dirPath, file);
                        try {
                            this.validateFilePath(filepath, storeKey);
                            const info = this.extractInstrumentKeyAndThreshold(file);
                            const instrument = info.instrumentKey;
                            const threshold = info.threshold;
                            
                            const candles = storeKey === 'volume_bars' 
                                ? this.parseVolumeBarCSV(filepath, instrument)
                                : this.parsePriceBarCSV(filepath, instrument);
                                
                            candles.forEach(c => c.threshold = threshold || (storeKey === 'volume_bars' ? c.targetVolume : c.targetTicks));
                            
                            const limitedCandles = candles.slice(-this.maxRecentCandlesPerInstrument);
                            
                            if (!this.recentCandles[storeKey][instrument]) {
                                this.recentCandles[storeKey][instrument] = {};
                            }
                            this.recentCandles[storeKey][instrument][threshold] = limitedCandles.sort((a,b) => a.timestamp - b.timestamp);
                        } catch (err) {
                            console.error(`Error loading ${file}:`, err.message);
                        }
                    }
                });
            }
        };

        loadTypeDir(path.join(this.candlesDataDir, 'volume_bars'), 'volume_bars');
        loadTypeDir(path.join(this.candlesDataDir, 'price_bars'), 'price_bars');
    }

    generateHistoricalSignals() {
        console.log('⚡ Generating signals on history...');
        const seenSignals = new Set();
        
        this.pruneOldSignals();
        const todayTradingDay = getTodayISTTradingDay();

        const filteredSignals = this.tradeSignals.filter(sig => {
            const sigDate = getTradingDayIST(sig.timestamp);
            return sigDate === todayTradingDay;
        });

        filteredSignals.forEach(sig => {
            const key = sig.instrument + '_' + sig.bar_type + '_' + sig.threshold + '_' + sig.barNumber + '_' + sig.type + '_' + sig.version;
            seenSignals.add(key);
        });

        const processStrategyOnHistory = (storeKey, barType) => {
            const store = this.recentCandles[storeKey];
            for (const [instKey, thresholdsMap] of Object.entries(store)) {
                for (const [threshStr, list] of Object.entries(thresholdsMap)) {
                    if (list.length < 32) continue;
                    const threshold = parseInt(threshStr, 10);
                    
                    try {
                        const tickSize = instKey.includes('MCX_FO') ? 0.05 : 0.05;
                        for (const [versionName, strategyFn] of Object.entries(STRATEGIES)) {
                            const signals = strategyFn(list, { tickSize });
                            signals.forEach(sig => {
                                const candle = list[sig.index];
                                if (!candle) return;

                                const candDate = getTradingDayIST(candle.timestamp);
                                if (candDate !== todayTradingDay) return; // Ignore legacy bars

                                let confidence = 50;
                                const confMatch = sig.reason.match(/Conf:\s*(\d+)/i);
                                if (confMatch) confidence = parseInt(confMatch[1]);

                                const signalEvent = {
                                    version: versionName,
                                    instrument: instKey,
                                    name: this.getInstrumentName(instKey),
                                    type: sig.type,
                                    entry: sig.triggerPrice,
                                    sl: sig.stopLoss,
                                    tp: sig.takeProfit,
                                    confidence: confidence,
                                    reason: sig.reason.replace('Conf:', (barType === 'volume' ? 'Volume' : 'Price') + ', Conf:'),
                                    timestamp: candle.timestamp,
                                    barNumber: candle.barNumber,
                                    bar_type: barType,
                                    threshold: threshold,
                                    status: 'cancelled', 
                                    overlapping: false
                                };

                                const uniqueKey = instKey + '_' + barType + '_' + threshold + '_' + candle.barNumber + '_' + sig.type + '_' + versionName;
                                if (!seenSignals.has(uniqueKey)) {
                                    seenSignals.add(uniqueKey);
                                    this.tradeSignals.push(signalEvent);
                                }
                            });
                        }
                    } catch (err) {
                        console.error("Error processing history signals:", err.message);
                    }
                }
            }
        };

        processStrategyOnHistory('volume_bars', 'volume');
        processStrategyOnHistory('price_bars', 'price');
        this.tradeSignals.sort((a, b) => a.timestamp - b.timestamp);

        this.pruneOldSignals();
        this.saveSignalsToDisk();
    }

    pruneOldSignals() {
        const todayTradingDay = getTodayISTTradingDay();
        this.tradeSignals = this.tradeSignals.filter(sig => {
            const sigDate = getTradingDayIST(sig.timestamp);
            return sigDate === todayTradingDay;
        });
    }

    loadSavedSignals() {
        const jsonFile = 'signals_today_' + getTodayISTTradingDay() + '.json';
        const signalsFile = path.join(this.candlesDataDir, jsonFile);
        if (fs.existsSync(signalsFile)) {
            try {
                const fileData = fs.readFileSync(signalsFile, 'utf8');
                const loaded = JSON.parse(fileData);
                
                const todayTradingDay = getTodayISTTradingDay();
                this.tradeSignals = loaded.filter(sig => {
                    const sigDate = getTradingDayIST(sig.timestamp);
                    return sigDate === todayTradingDay;
                });
            } catch (err) {
                this.tradeSignals = [];
            }
        }
    }

    saveSignalsToDisk() {
        try {
            const todayTradingDay = getTodayISTTradingDay();
            const jsonFile = 'signals_today_' + todayTradingDay + '.json';
            const signalsFile = path.join(this.candlesDataDir, jsonFile);
            
            const signalMap = new Map();
            const filteredSignals = this.tradeSignals.filter(sig => {
                const sigDate = getTradingDayIST(sig.timestamp);
                return sigDate === todayTradingDay;
            });
            
            for (const signal of filteredSignals) {
                const key = signal.timestamp + '_' + signal.instrument + '_' + signal.threshold + '_' + signal.version;
                signalMap.set(key, signal);
            }
            
            const allSignals = Array.from(signalMap.values());
            const tempFile = signalsFile + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(allSignals, null, 2), 'utf8');
            fs.renameSync(tempFile, signalsFile);
        } catch (err) {
            console.error('❌ Save signals failed:', err.message);
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
            const startTimeIdx = headers.indexOf('start_time');
            const endTimeIdx = headers.indexOf('end_time');
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const values = this.parseCSVLine(line);
                if (values.length < 10) continue;
                
                let timestamp = parseInt(values[timestampIdx]);
                const istTimestamp = this.convertToIST(timestamp);
                
                candles.push({
                    timestamp: istTimestamp,
                    instrument: instrumentKey,
                    instrument_key: instrumentKey,
                    type: 'volume',
                    barNumber: parseInt(values[barNumberIdx]) || i,
                    open: parseFloat(values[openIdx]),
                    high: parseFloat(values[highIdx]),
                    low: parseFloat(values[lowIdx]),
                    close: parseFloat(values[closeIdx]),
                    volume: parseFloat(values[volumeIdx]) || 0,
                    transactions: parseInt(values[transactionsIdx]) || 0,
                    priceChanges: parseInt(values[priceChangesIdx]) || 0,
                    startTime: values[startTimeIdx] || '',
                    endTime: values[endTimeIdx] || ''
                });
            }
        } catch (error) {}
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
            const volumeIdx = headers.indexOf('volume');
            const startTimeIdx = headers.indexOf('start_time');
            const endTimeIdx = headers.indexOf('end_time');
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const values = this.parseCSVLine(line);
                if (values.length < 8) continue;
                
                let timestamp = parseInt(values[timestampIdx]);
                const istTimestamp = this.convertToIST(timestamp);
                
                candles.push({
                    timestamp: istTimestamp,
                    instrument: instrumentKey,
                    instrument_key: instrumentKey,
                    type: 'price',
                    barNumber: parseInt(values[barNumberIdx]) || i,
                    open: parseFloat(values[openIdx]),
                    high: parseFloat(values[highIdx]),
                    low: parseFloat(values[lowIdx]),
                    close: parseFloat(values[closeIdx]),
                    ticks: parseInt(values[ticksIdx]) || 0,
                    volume: parseFloat(values[volumeIdx]) || 0,
                    startTime: values[startTimeIdx] || '',
                    endTime: values[endTimeIdx] || ''
                });
            }
        } catch (error) {}
        return candles;
    }
    
    convertToIST(timestamp) {
        let msTimestamp = timestamp;
        if (timestamp < 10000000000) {
            msTimestamp = timestamp * 1000;
        }
        return msTimestamp; // Clean UTC Epoch milliseconds
    }
    
    parseCSVLine(line) {
        const result = [];
        let inQuotes = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else current += char;
        }
        result.push(current);
        return result;
    }
    
    getInstrumentName(key) {
        try {
            const configPath = path.resolve(__dirname, 'config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                const inst = config.instruments?.find(i => 
                    i.key === key || 
                    i.key.includes(key) || 
                    key.includes(i.key)
                );
                if (inst && inst.name) {
                    return inst.name;
                }
            }
        } catch (e) {}

        const names = {
            'MCX_FO|538685': 'Natural Gas Future',
            'NSE_FO|62329': 'Nifty 50 Future',
            'NSE_FO|62326': 'Nifty Bank Future'
        };
        const id = key.includes('|') ? key.split('|')[1] : key;
        const normalizedId = id.replace(/_raw_ticks$/, '');
        return names[key] || normalizedId;
    }
    
    getInstrumentsFromFiles() {
        const instrumentsMap = new Map();
        const todayTradingDay = getTodayISTTradingDay();
        
        const scanStore = (storeKey, type) => {
            const store = this.recentCandles[storeKey];
            for (const [instrumentKey, thresholdsMap] of Object.entries(store)) {
                for (const [threshold, candles] of Object.entries(thresholdsMap)) {
                    // FIX: Filter thresholds lists so that only those with active data today are displayed
                    const hasTodayData = candles.some(c => getTradingDayIST(c.timestamp) === todayTradingDay);
                    
                    if (hasTodayData) {
                        if (!instrumentsMap.has(instrumentKey)) {
                            instrumentsMap.set(instrumentKey, {
                                key: instrumentKey,
                                name: this.getInstrumentName(instrumentKey),
                                exchange: instrumentKey.split('|')[0],
                                symbol: instrumentKey.split('|')[1],
                                volumeThresholds: new Set(),
                                priceThresholds: new Set()
                            });
                        }
                        
                        const inst = instrumentsMap.get(instrumentKey);
                        if (type === 'volume') {
                            inst.volumeThresholds.add(parseInt(threshold, 10));
                        } else {
                            inst.priceThresholds.add(parseInt(threshold, 10));
                        }
                    }
                }
            }
        };

        scanStore('volume_bars', 'volume');
        scanStore('price_bars', 'price');
        
        return Array.from(instrumentsMap.values()).map(inst => ({
            ...inst,
            volumeThresholds: Array.from(inst.volumeThresholds).sort((a,b) => a-b),
            priceThresholds: Array.from(inst.priceThresholds).sort((a,b) => a-b)
        }));
    }
    
    broadcastCandle(instrumentKey, candle, type) {
        const threshold = type === 'volume' ? candle.targetVolume : candle.targetTicks;
        const candleData = {
            ...candle,
            type: type,
            threshold: threshold,
            instrument: instrumentKey,
            instrument_key: instrumentKey,
            broadcast_time: Date.now()
        };
        
        const storeKey = type + '_bars';
        if (!this.recentCandles[storeKey][instrumentKey]) {
            this.recentCandles[storeKey][instrumentKey] = {};
        }
        if (!this.recentCandles[storeKey][instrumentKey][threshold]) {
            this.recentCandles[storeKey][instrumentKey][threshold] = [];
        }

        const targetArray = this.recentCandles[storeKey][instrumentKey][threshold];
        targetArray.push(candleData);
        
        if (targetArray.length > this.maxRecentCandlesPerInstrument) {
            targetArray.shift();
        }
        
        this.recentCandles[storeKey][instrumentKey][threshold] = targetArray.sort((a,b) => a.timestamp - b.timestamp);
        
        this.io.to(instrumentKey + '_' + type + '_' + threshold).emit(instrumentKey + '_' + type + '_' + threshold + '_candle', candleData);
        this.io.emit('candle_update', candleData);
    }
    
    broadcastLiveCandle(instrumentKey, liveCandle, type) {
        const threshold = type === 'volume' ? liveCandle.targetVolume : liveCandle.targetTicks;
        const candleData = {
            ...liveCandle,
            instrument: instrumentKey,
            instrument_key: instrumentKey,
            type: type,
            threshold: threshold,
            broadcast_time: Date.now()
        };
        
        this.io.to(instrumentKey + '_' + type + '_' + threshold).emit(instrumentKey + '_' + type + '_' + threshold + '_live_candle', candleData);
        this.io.emit('live_candle_update', candleData);
    }

    broadcastTradeSignal(signalData) {
        const todayTradingDay = getTodayISTTradingDay();
        const sigDate = getTradingDayIST(signalData.timestamp);
        if (sigDate !== todayTradingDay) return; 

        const isDuplicate = this.tradeSignals.some(sig => 
            sig.instrument === signalData.instrument &&
            sig.bar_type === signalData.bar_type &&
            String(sig.threshold) === String(signalData.threshold) &&
            sig.barNumber === signalData.barNumber &&
            sig.type === signalData.type &&
            sig.version === signalData.version
        );
        
        if (isDuplicate) return;

        signalData.name = this.getInstrumentName(signalData.instrument);
        signalData.status = signalData.status || 'pending';
        this.tradeSignals.push(signalData);
        
        if (this.tradeSignals.length > 2000) {
            this.tradeSignals.shift();
        }
        
        this.saveSignalsToDisk();
        this.io.emit('trade_signal', signalData);
        console.log("🚀 Broadcasted: " + signalData.version + " | " + signalData.instrument + " | Thresh: " + signalData.threshold + " | Bar #" + signalData.barNumber);
    }

    broadcastTradeStatusUpdate(updateData) {
        const matchIndex = this.tradeSignals.findIndex(sig => 
            sig.instrument === updateData.instrument &&
            sig.bar_type === updateData.bar_type &&
            String(sig.threshold) === String(updateData.threshold) &&
            sig.barNumber === updateData.barNumber &&
            sig.type === updateData.type &&
            sig.version === updateData.version
        );

        if (matchIndex !== -1) {
            this.tradeSignals[matchIndex].status = updateData.status;
            if (updateData.exitReason) {
                this.tradeSignals[matchIndex].exitReason = updateData.exitReason;
                this.tradeSignals[matchIndex].exitPrice = updateData.exitPrice;
            }
            
            this.saveSignalsToDisk();
            
            const enrichedUpdate = {
                ...this.tradeSignals[matchIndex],
                name: this.getInstrumentName(this.tradeSignals[matchIndex].instrument)
            };
            this.io.emit('trade_status_update', enrichedUpdate);
        } else {
            const enrichedUpdate = {
                ...updateData,
                name: this.getInstrumentName(updateData.instrument)
            };
            this.io.emit('trade_status_update', enrichedUpdate);
        }
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log("📊 Chart server on port " + this.port);
        });
    }
}

module.exports = ChartServer;