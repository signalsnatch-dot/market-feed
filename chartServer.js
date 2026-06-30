// chartServer.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { STRATEGIES } = require('./priceActionStrategy');

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
        
        this.recentCandles = { price_bars: [], volume_bars: [] };
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
            throw new Error(`Data directory not writable: ${resolvedPath}`);
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
            throw new Error(`Security violation: Unauthorized path: ${filepath}`);
        }
        
        return resolvedPath;
    }
    
    extractInstrumentKeyAndThreshold(filename) {
        const match = filename.match(/^(MCX_FO|NSE_FO|NSE_EQ)_([^_]+)_(\d+)_(volume|price)_bars\.csv$/);
        if (match) {
            return {
                instrumentKey: `${match[1]}|${match[2]}`,
                threshold: parseInt(match[3], 10),
                type: match[4]
            };
        }
        const legacyMatch = filename.match(/^(MCX_FO|NSE_FO|NSE_EQ)_([^_]+)/);
        if (legacyMatch) {
            return {
                instrumentKey: `${legacyMatch[1]}|${legacyMatch[2]}`,
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
            if (type === 'price' || type === 'volume') {
                const storeKey = `${type}_bars`;
                res.json(this.recentCandles[storeKey]);
            } else {
                res.status(400).json({ error: 'Invalid type' });
            }
        });
        
        this.app.get('/api/instruments', (req, res) => {
            res.json(this.getInstrumentsFromFiles());
        });

        this.app.get('/api/strategies', (req, res) => {
            res.json(Object.keys(STRATEGIES));
        });
        
        this.app.get('/api/signals', (req, res) => {
            const enriched = this.tradeSignals.map(sig => ({
                ...sig,
                name: this.getInstrumentName(sig.instrument)
            }));
            res.json(enriched);
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
            console.log(`Client connected: ${socket.id}`);
            
            const enrichedSignals = this.tradeSignals.map(sig => ({
                ...sig,
                name: this.getInstrumentName(sig.instrument)
            }));
            
            socket.emit('historical_candles', {
                volume_bars: this.recentCandles.volume_bars,
                price_bars: this.recentCandles.price_bars,
                instruments: this.getInstrumentsFromFiles(),
                trade_signals: enrichedSignals,
                strategies: Object.keys(STRATEGIES)
            });
            
            socket.on('subscribe', (data) => {
                const { instrument, type, threshold } = data;
                if (!instrument || !type || (type !== 'volume' && type !== 'price') || !threshold) {
                    socket.emit('error', { message: 'Invalid subscription' });
                    return;
                }
                socket.join(`${instrument}_${type}_${threshold}`);
                console.log(`Client subscribed to ${instrument} ${type} (Threshold: ${threshold})`);
            });
            
            socket.on('unsubscribe', (data) => {
                const { instrument, type, threshold } = data;
                if (instrument && type && threshold) {
                    socket.leave(`${instrument}_${type}_${threshold}`);
                }
            });
        });
    }
    
    loadHistoricalCandles() {
        console.log('📂 Loading historical parallel threshold candles...');
        this.recentCandles = { price_bars: [], volume_bars: [] };
        
        const volumeDir = path.join(this.candlesDataDir, 'volume_bars');
        if (fs.existsSync(volumeDir)) {
            const files = fs.readdirSync(volumeDir);
            files.forEach(file => {
                if (file.endsWith('_volume_bars.csv')) {
                    const filepath = path.join(volumeDir, file);
                    try {
                        this.validateFilePath(filepath, 'volume_bars');
                        const info = this.extractInstrumentKeyAndThreshold(file);
                        const candles = this.parseVolumeBarCSV(filepath, info.instrumentKey);
                        candles.forEach(c => c.threshold = info.threshold || c.targetVolume);
                        const limitedCandles = candles.slice(-this.maxRecentCandlesPerInstrument);
                        this.recentCandles.volume_bars.push(...limitedCandles);
                    } catch (err) {
                        console.error(`Error loading ${file}:`, err.message);
                    }
                }
            });
        }
        
        const priceDir = path.join(this.candlesDataDir, 'price_bars');
        if (fs.existsSync(priceDir)) {
            const files = fs.readdirSync(priceDir);
            files.forEach(file => {
                if (file.endsWith('_price_bars.csv')) {
                    const filepath = path.join(priceDir, file);
                    try {
                        this.validateFilePath(filepath, 'price_bars');
                        const info = this.extractInstrumentKeyAndThreshold(file);
                        const candles = this.parsePriceBarCSV(filepath, info.instrumentKey);
                        candles.forEach(c => c.threshold = info.threshold || c.targetTicks);
                        const limitedCandles = candles.slice(-this.maxRecentCandlesPerInstrument);
                        this.recentCandles.price_bars.push(...limitedCandles);
                    } catch (err) {
                        console.error(`Error loading ${file}:`, err.message);
                    }
                }
            });
        }
        
        this.recentCandles.volume_bars.sort((a, b) => a.timestamp - b.timestamp);
        this.recentCandles.price_bars.sort((a, b) => a.timestamp - b.timestamp);
    }

    generateHistoricalSignals() {
        console.log('⚡ Generating signals on history...');
        const seenSignals = new Set();
        this.tradeSignals.forEach(sig => {
            const key = `${sig.instrument}_${sig.bar_type}_${sig.threshold}_${sig.barNumber}_${sig.type}_${sig.version}`;
            seenSignals.add(key);
        });

        const processStrategyOnHistory = (candles, barType) => {
            const grouped = {};
            candles.forEach(c => {
                const inst = c.instrument || c.instrument_key;
                const thresh = c.threshold || (barType === 'volume' ? c.targetVolume : c.targetTicks);
                const key = `${inst}_${thresh}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(c);
            });

            for (const [groupKey, list] of Object.entries(grouped)) {
                if (list.length < 32) continue;
                const [instKey, threshStr] = groupKey.split('_');
                const threshold = parseInt(threshStr, 10);
                
                try {
                    const tickSize = instKey.includes('MCX_FO') ? 0.05 : 0.05;
                    for (const [versionName, strategyFn] of Object.entries(STRATEGIES)) {
                        const signals = strategyFn(list, { tickSize });
                        signals.forEach(sig => {
                            const candle = list[sig.index];
                            if (!candle) return;

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
                                reason: sig.reason.replace('Conf:', `${barType === 'volume' ? 'Volume' : 'Price'}, Conf:`),
                                timestamp: candle.timestamp,
                                barNumber: candle.barNumber,
                                bar_type: barType,
                                threshold: threshold,
                                status: 'cancelled', 
                                overlapping: false
                            };

                            const uniqueKey = `${instKey}_${barType}_${threshold}_${candle.barNumber}_${sig.type}_${versionName}`;
                            if (!seenSignals.has(uniqueKey)) {
                                seenSignals.add(uniqueKey);
                                this.tradeSignals.push(signalEvent);
                            }
                        });
                    }
                } catch (err) {
                    console.error(`Error processing history signals:`, err.message);
                }
            }
        };

        processStrategyOnHistory(this.recentCandles.volume_bars, 'volume');
        processStrategyOnHistory(this.recentCandles.price_bars, 'price');
        this.tradeSignals.sort((a, b) => a.timestamp - b.timestamp);

        if (this.tradeSignals.length > 2000) {
            this.tradeSignals = this.tradeSignals.slice(-2000);
        }
        this.saveSignalsToDisk();
    }

    loadSavedSignals() {
        const jsonFile = 'signals_today_' + new Date().toISOString().split('T')[0] + '.json';
        const signalsFile = path.join(this.candlesDataDir, jsonFile);
        if (fs.existsSync(signalsFile)) {
            try {
                const fileData = fs.readFileSync(signalsFile, 'utf8');
                this.tradeSignals = JSON.parse(fileData);
            } catch (err) {
                this.tradeSignals = [];
            }
        }
    }

    saveSignalsToDisk() {
        try {
            const localDate = new Date().toLocaleDateString('en-CA');
            const jsonFile = `signals_today_${localDate}.json`;
            const signalsFile = path.join(this.candlesDataDir, jsonFile);
            
            let existingSignals = [];
            if (fs.existsSync(signalsFile)) {
                try {
                    const content = fs.readFileSync(signalsFile, 'utf8');
                    existingSignals = JSON.parse(content);
                } catch (err) {}
            }
            
            const signalMap = new Map();
            for (const signal of existingSignals) {
                const key = `${signal.timestamp}_${signal.instrument}_${signal.threshold}_${signal.version}`;
                signalMap.set(key, signal);
            }
            
            for (const signal of this.tradeSignals) {
                const key = `${signal.timestamp}_${signal.instrument}_${signal.threshold}_${signal.version}`;
                signalMap.set(key, signal);
            }
            
            const allSignals = Array.from(signalMap.values());
            const tempFile = `${signalsFile}.tmp`;
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
        if (!key) return 'N/A';

        // 1. Dynamic Check against config.json
        try {
            const fs = require('fs');
            const path = require('path');
            let configPath = path.resolve(__dirname, 'config.json');
            if (!fs.existsSync(configPath)) {
                configPath = path.resolve(__dirname, '../config.json');
            }
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
        } catch (e) {
            // Log issues quietly and fall back to local database mapping
        }

        // 2. Comprehensive Master Name Fallback Mapping
        const MASTER_FALLBACK_NAMES = {
            '538685': 'Natural Gas Future',
            '538686': 'Natural Gas Mini Future',
            '520702': 'Crude Oil Future',
            '520703': 'Crude Oil Mini Future',
            '464150': 'Silver Future',
            '471726': 'Silver Mini Future',
            '488788': 'Silver Micro Future',
            '568831': 'Copper Future',
            '568836': 'Zinc Future',
            '568833': 'Lead Future',
            '568830': 'Aluminium Future',
            '466583': 'Gold Future',
            '510764': 'Gold Mini Future',
            '552721': 'Gold Petal Future',
            '61093': 'Nifty 50 Future',
            '61088': 'Nifty Bank Future',
            '61091': 'Fin Nifty Future',
            '61092': 'Midcap Nifty Future',
            
            // ISINs/Tokens to cash equity name mapping
            'INE002A01018': 'Reliance Cash Equity',
            'INE040A01034': 'HDFC Bank Cash Equity',
            'INE090A01021': 'ICICI Bank Cash Equity',
            'INE062A01020': 'SBI Cash Equity',
            'INE467B01029': 'TCS Cash Equity',
            'INE009A01021': 'Infosys Cash Equity',
            'INE154A01025': 'ITC Cash Equity',
            'INE397D01024': 'Bharti Airtel Cash Equity',
            'INE238A01034': 'Axis Bank Cash Equity',
            'INE018A01030': 'L&T Cash Equity',
            'INE081A01020': 'Tata Steel Cash Equity',
            'INE1TAE01010': 'Tata Motors Cash Equity',
            'INE296A01032': 'Bajaj Finance Cash Equity',
            'INE237A01036': 'Kotak Bank Cash Equity',
            'INE044A01036': 'Sun Pharma Cash Equity',
            'INE019A01038': 'JSW Steel Cash Equity',
            'INE522F01014': 'Coal India Cash Equity',
            'INE423A01024': 'Adani Enterprises Cash Equity',
            'INE742F01042': 'Adani Ports Cash Equity',
            'INE038A01020': 'Hindalco Cash Equity',
            'INE437A01024': 'Apollo Hospitals Cash Equity',
            'INE160A01022': 'PNB Cash Equity',
            'INE114A01011': 'SAIL Cash Equity',
            'INE040H01021': 'SUZLON Cash Equity',
            'INE928J01020': 'PAYTM Cash Equity',
            'INE415G01027': 'RVNL Cash Equity',
            'INE053F01010': 'IRFC Cash Equity',
            'INE202E01016': 'IREDA Cash Equity',
            'INE257A01026': 'BHEL Cash Equity',
            'INE129A01025': 'GAIL Cash Equity',
            'INE849A01020': 'TRENT Cash Equity'
        };

        const id = key.includes('|') ? key.split('|')[1] : key;
        const normalizedId = id.replace(/_raw_ticks$/, '');
        
        return MASTER_FALLBACK_NAMES[normalizedId] || normalizedId;
    }
    
    getInstrumentsFromFiles() {
        const instrumentsMap = new Map();
        [...this.recentCandles.volume_bars, ...this.recentCandles.price_bars].forEach(candle => {
            const key = candle.instrument || candle.instrument_key;
            if (!key) return;
            
            if (!instrumentsMap.has(key)) {
                instrumentsMap.set(key, {
                    key: key,
                    name: this.getInstrumentName(key),
                    exchange: key.split('|')[0],
                    symbol: key.split('|')[1],
                    volumeThresholds: new Set(),
                    priceThresholds: new Set()
                });
            }
            
            const inst = instrumentsMap.get(key);
            if (candle.type === 'volume' && candle.threshold) {
                inst.volumeThresholds.add(candle.threshold);
            } else if (candle.type === 'price' && candle.threshold) {
                inst.priceThresholds.add(candle.threshold);
            }
        });
        
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
        
        const storeKey = `${type}_bars`;
        this.recentCandles[storeKey].push(candleData);
        
        const candlesByGroup = {};
        for (const c of this.recentCandles[storeKey]) {
            const key = `${c.instrument || c.instrument_key}_${c.threshold}`;
            if (!candlesByGroup[key]) candlesByGroup[key] = [];
            candlesByGroup[key].push(c);
        }
        
        const updatedCandles = [];
        for (const key of Object.keys(candlesByGroup)) {
            updatedCandles.push(...candlesByGroup[key].slice(-this.maxRecentCandlesPerInstrument));
        }
        
        this.recentCandles[storeKey] = updatedCandles.sort((a, b) => a.timestamp - b.timestamp);
        
        this.io.to(`${instrumentKey}_${type}_${threshold}`).emit(`${instrumentKey}_${type}_${threshold}_candle`, candleData);
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
        
        this.io.to(`${instrumentKey}_${type}_${threshold}`).emit(`${instrumentKey}_${type}_${threshold}_live_candle`, candleData);
        this.io.emit('live_candle_update', candleData);
    }

    broadcastTradeSignal(signalData) {
        // Ensure name is dynamically verified on incoming alerts
        signalData.name = this.getInstrumentName(signalData.instrument);
        
        const isDuplicate = this.tradeSignals.some(sig => 
            sig.instrument === signalData.instrument &&
            sig.bar_type === signalData.bar_type &&
            sig.threshold === signalData.threshold &&
            sig.barNumber === signalData.barNumber &&
            sig.type === signalData.type &&
            sig.version === signalData.version
        );
        
        if (isDuplicate) return;

        signalData.status = signalData.status || 'pending';
        this.tradeSignals.push(signalData);
        
        if (this.tradeSignals.length > 2000) {
            this.tradeSignals.shift();
        }
        
        this.saveSignalsToDisk();
        this.io.emit('trade_signal', signalData);
        console.log(`🚀 Broadcasted: ${signalData.version} | ${signalData.instrument} | Thresh: ${signalData.threshold} | Bar #${signalData.barNumber}`);
    }

    broadcastTradeStatusUpdate(updateData) {
        const matchIndex = this.tradeSignals.findIndex(sig => 
            sig.instrument === updateData.instrument &&
            sig.bar_type === updateData.bar_type &&
            sig.threshold === updateData.threshold &&
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
            this.io.emit('trade_status_update', this.tradeSignals[matchIndex]);
        }
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`📊 Chart server on port ${this.port}`);
        });
    }
}

module.exports = ChartServer;