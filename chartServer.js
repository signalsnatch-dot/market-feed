// chartServer.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { STRATEGIES } = require('./priceActionStrategyV2');

// Dynamic timezone and trading-session aware date helpers (Bypasses Intl to prevent platform crashes)
function getTradingDayIST(ts) {
    if (!ts) return '';
    let ms = typeof ts === 'number' ? ts : Number(ts);
    if (isNaN(ms)) {
        const parsed = Date.parse(ts);
        if (!isNaN(parsed)) ms = parsed;
    }
    if (isNaN(ms) || ms <= 0) return '';
    if (ms < 10000000000) ms *= 1000; // Force seconds to millisecond scaling

    // Convert UTC milliseconds to Indian Standard Time (IST) mathematically (+5.5 hours)
    const msIST = ms + (5.5 * 60 * 60 * 1000);
    const dateIST = new Date(msIST);
    
    // Extract standard UTC date/hour components (shifted to represent IST local time)
    const year = dateIST.getUTCFullYear();
    const month = String(dateIST.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateIST.getUTCDate()).padStart(2, '0');
    const hour = dateIST.getUTCHours();
    
    const calendarDateStr = `${year}-${month}-${day}`;
    const sessionStartHour = 9; // Trading session boundary starts at 09:00 AM IST

    // If trade occurred before 9:00 AM IST, roll back to yesterday's trading day
    if (hour < sessionStartHour) {
        const d = new Date(calendarDateStr + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    }

    return calendarDateStr;
}

function getSignalISTDateString(ts) {
    if (!ts) return '';
    let ms = typeof ts === 'number' ? ts : Number(ts);
    if (isNaN(ms)) {
        const parsed = Date.parse(ts);
        if (!isNaN(parsed)) ms = parsed;
    }
    if (isNaN(ms) || ms <= 0) return '';
    if (ms < 10000000000) ms *= 1000;

    // Convert to IST calendar day mathematically (+5.5 hours)
    const dateIST = new Date(ms + (5.5 * 60 * 60 * 1000));
    const year = dateIST.getUTCFullYear();
    const month = String(dateIST.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateIST.getUTCDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

function getTodayISTDateString() {
    return getSignalISTDateString(Date.now());
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
        this.instrumentsData = [];
        this.maxRecentCandlesPerInstrument = 1200; 
        this.maxSignalHistory = 1200;
        this.maxClientSignals = 200;
        this.saveInProgress = false;
        this.lastSignalSave = 0;
        this.signalSaveInterval = 30000; // Save signals to disk every 30 seconds

        // Batching & dedup throttle for WebSocket emissions (1-second windows)
        this.batchedSignals = new Map();    // dedupKey -> signalData
        this.batchedStatusUpdates = new Map(); // dedupKey -> updateData
        this.batchFlushInterval = null;
        
        this.setupRoutes();
        this.setupSocketEvents();
        this.loadSavedSignals();
        this.loadHistoricalCandles();
        this.rebuildInstrumentIndex();
        this.generateHistoricalSignals(); 
        this.startPeriodicSignalSave();
        this.startBatchFlushInterval();
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
            const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 100));
            
            if (!instrument || !threshold) {
                return res.json([]);
            }

            const threshNum = parseInt(threshold, 10);
            const instrumentMap = this.recentCandles[storeKey][instrument];
            if (instrumentMap && instrumentMap[threshNum]) {
                return res.json(instrumentMap[threshNum].slice(-limit));
            }
            
            res.json([]);
        });
        
        this.app.get('/api/instruments', (req, res) => {
            res.json(this.instrumentsData);
        });

        this.app.get('/api/strategies', (req, res) => {
            res.json(Object.keys(STRATEGIES));
        });
        
        this.app.get('/api/signals', (req, res) => {
            const limit = Math.min(500, Math.max(50, parseInt(req.query.limit, 10) || 200));
            const activeOnly = req.query.activeOnly === 'true';
            const version = req.query.version;
            const instrument = req.query.instrument;
            const threshold = req.query.threshold ? parseInt(req.query.threshold, 10) : undefined;
            const todaySignals = this.getRecentSignalsForClient({ limit, activeOnly, version, instrument, threshold });
            res.json(todaySignals);
        });
        
        // ──────────────────────────────────────────────
        // BACKTEST VIEWER API ENDPOINTS
        // ──────────────────────────────────────────────

        this.app.get('/api/backtest/dates', (req, res) => {
            try {
                const baseDir = path.join(__dirname, 'candles', 'live');
                if (!fs.existsSync(baseDir)) {
                    return res.json([]);
                }
                const dateSet = new Set();
                const instruments = fs.readdirSync(baseDir);
                for (const inst of instruments) {
                    const instDir = path.join(baseDir, inst);
                    if (!fs.statSync(instDir).isDirectory()) continue;
                    const thresholds = fs.readdirSync(instDir);
                    for (const thresh of thresholds) {
                        const threshDir = path.join(instDir, thresh);
                        if (!fs.statSync(threshDir).isDirectory()) continue;
                        const files = fs.readdirSync(threshDir);
                        for (const file of files) {
                            if (file.endsWith('_candles.csv')) {
                                const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
                                if (dateMatch) {
                                    const d = dateMatch[1];
                                    // Filter: only 2026+ dates
                                    if (d >= '2026-01-01') {
                                        dateSet.add(d);
                                    }
                                }
                            }
                        }
                    }
                }
                const sorted = Array.from(dateSet).sort();
                // Return only last 2 months of available data
                const twoMonthsAgo = new Date();
                twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
                const cutoff = twoMonthsAgo.toISOString().split('T')[0];
                const filtered = sorted.filter(d => d >= cutoff);
                res.json(filtered.length > 0 ? filtered : sorted.slice(-30));
            } catch (err) {
                console.error('Backtest dates error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/backtest/instruments', (req, res) => {
            try {
                const date = req.query.date;
                if (!date) return res.status(400).json({ error: 'date required' });
                const baseDir = path.join(__dirname, 'candles', 'live');
                if (!fs.existsSync(baseDir)) return res.json([]);
                const result = [];
                const instruments = fs.readdirSync(baseDir);
                for (const inst of instruments) {
                    const instDir = path.join(baseDir, inst);
                    if (!fs.statSync(instDir).isDirectory()) continue;
                    const thresholds = fs.readdirSync(instDir);
                    let found = false;
                    for (const thresh of thresholds) {
                        const threshDir = path.join(instDir, thresh);
                        if (!fs.statSync(threshDir).isDirectory()) continue;
                        const files = fs.readdirSync(threshDir);
                        for (const file of files) {
                            if (file.includes(date) && file.endsWith('_candles.csv')) {
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }
                    if (found) {
                        // Convert MCX_FO_466583 → MCX_FO|466583 (first group before last underscore is exchange)
                        const lastUnderscore = inst.lastIndexOf('_');
                        const exchange = inst.substring(0, lastUnderscore);
                        const symbol = inst.substring(lastUnderscore + 1);
                        const keyWithPipe = exchange + '|' + symbol;
                        const name = this.getInstrumentName(keyWithPipe);
                        result.push({ key: inst, name, displayKey: keyWithPipe });
                    }
                }
                res.json(result.sort((a, b) => a.key.localeCompare(b.key)));
            } catch (err) {
                console.error('Backtest instruments error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/backtest/thresholds', (req, res) => {
            try {
                const { date, instrument } = req.query;
                if (!date || !instrument) return res.status(400).json({ error: 'date and instrument required' });
                const instDir = path.join(__dirname, 'candles', 'live', instrument);
                if (!fs.existsSync(instDir)) return res.json([]);
                const thresholds = [];
                const entries = fs.readdirSync(instDir);
                for (const entry of entries) {
                    const entryPath = path.join(instDir, entry);
                    if (!fs.statSync(entryPath).isDirectory()) continue;
                    const files = fs.readdirSync(entryPath);
                    if (files.some(f => f.includes(date) && f.endsWith('_candles.csv'))) {
                        thresholds.push(parseInt(entry, 10));
                    }
                }
                res.json(thresholds.sort((a, b) => a - b));
            } catch (err) {
                console.error('Backtest thresholds error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/backtest/candles', (req, res) => {
            try {
                const { date, instrument, threshold } = req.query;
                if (!date || !instrument || !threshold) {
                    return res.status(400).json({ error: 'date, instrument, threshold required' });
                }
                const csvDir = path.join(__dirname, 'candles', 'live', instrument, String(threshold));
                if (!fs.existsSync(csvDir)) {
                    return res.status(404).json({ error: 'No data for this combination' });
                }
                const files = fs.readdirSync(csvDir);
                const csvFile = files.find(f => f.includes(date) && f.endsWith('_candles.csv'));
                if (!csvFile) {
                    return res.status(404).json({ error: 'CSV not found' });
                }
                const filepath = path.join(csvDir, csvFile);
                const content = fs.readFileSync(filepath, 'utf8');
                const lines = content.trim().split('\n');
                if (lines.length < 2) {
                    return res.json([]);
                }
                const headers = lines[0].split(',');
                const result = [];
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const vals = line.split(',');
                    const obj = {};
                    headers.forEach((h, idx) => {
                        obj[h.trim()] = vals[idx] ? vals[idx].trim() : '';
                    });
                    result.push(obj);
                }
                res.json(result);
            } catch (err) {
                console.error('Backtest candles error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/backtest/trades', (req, res) => {
            try {
                const { date, instrument, threshold } = req.query;
                if (!date || !instrument || !threshold) {
                    return res.status(400).json({ error: 'date, instrument, threshold required' });
                }
                const instSymbol = instrument.replace(/\|/g, '_');
                const tradesDir = path.join(__dirname, 'live-backtest-results');
                if (!fs.existsSync(tradesDir)) {
                    return res.status(404).json({ error: 'No trades directory' });
                }
                const files = fs.readdirSync(tradesDir);
                const tradeFile = files.find(f => 
                    f.startsWith('live_' + threshold + '_' + instSymbol) && 
                    f.includes(date) && 
                    f.endsWith('.json')
                );
                if (!tradeFile) {
                    return res.json({ strategies: {}, instrument, threshold });
                }
                const filepath = path.join(tradesDir, tradeFile);
                const content = fs.readFileSync(filepath, 'utf8');
                const data = JSON.parse(content);
                res.json(data);
            } catch (err) {
                console.error('Backtest trades error:', err.message);
                res.status(500).json({ error: err.message });
            }
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
            
            socket.emit('historical_candles', {
                instruments: this.instrumentsData,
                trade_signals: this.getRecentSignalsForClient({ limit: this.maxClientSignals }),
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
        console.log('⚡ Starting background signal generation on history (non-blocking)...');
        this.pruneOldSignals();
        
        const todayTradingDay = getTodayISTTradingDay();
        const seenSignals = new Set();
        
        const todaySignals = this.tradeSignals.filter(sig => {
            const sigDate = getTradingDayIST(sig.timestamp);
            return sigDate === todayTradingDay;
        });
        todaySignals.forEach(sig => {
            const key = sig.instrument + '_' + sig.bar_type + '_' + sig.threshold + '_' + sig.barNumber + '_' + sig.type + '_' + sig.version;
            seenSignals.add(key);
        });

        const tasks = [];
        const collectTasks = (storeKey, barType) => {
            const store = this.recentCandles[storeKey];
            for (const [instKey, thresholdsMap] of Object.entries(store)) {
                for (const [threshStr, list] of Object.entries(thresholdsMap)) {
                    if (list.length >= 32) {
                        tasks.push({ barType, instKey, threshStr, list });
                    }
                }
            }
        };

        collectTasks('volume_bars', 'volume');
        collectTasks('price_bars', 'price');

        // Non-blocking Task Runner: processes 1 instrument threshold group per event tick
        const runNextTask = () => {
            if (tasks.length === 0) {
                this.tradeSignals.sort((a, b) => a.timestamp - b.timestamp);
                this.pruneOldSignals();
                this.saveSignalsToDisk();
                console.log('✅ Background historical signal generation completed!');
                return;
            }

            const task = tasks.shift();
            const { instKey, threshStr, list, barType } = task;
            const threshold = parseInt(threshStr, 10);

            try {
                const tickSize = instKey.includes('MCX_FO') ? 0.05 : 0.05;
                for (const [versionName, strategyFn] of Object.entries(STRATEGIES)) {
                    const signals = strategyFn(list, { tickSize });
                    signals.forEach(sig => {
                        const candle = list[sig.index];
                        if (!candle) return;

                        const candDate = getTradingDayIST(candle.timestamp);
                        if (candDate !== todayTradingDay) return; // Clean date-boundary filter

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
                console.error(`Error processing history signals for ${instKey}:`, err.message);
            }

            // Yield control back to Express/Socket.IO immediately
            setImmediate(runNextTask);
        };

        runNextTask();
    }

    pruneOldSignals() {
        const todayTradingDay = getTodayISTTradingDay();
        this.tradeSignals = this.tradeSignals.filter(sig => {
            const sigDate = getTradingDayIST(sig.timestamp);
            return sigDate === todayTradingDay;
        });
        if (this.tradeSignals.length > this.maxSignalHistory) {
            this.tradeSignals = this.tradeSignals.slice(-this.maxSignalHistory);
        }
    }

    getRecentSignalsForClient({ limit = 200, activeOnly = false, version, instrument, threshold } = {}) {
        const todayTradingDay = getTodayISTTradingDay();
        let filtered = this.tradeSignals.filter(sig => {
            const sigDate = getTradingDayIST(sig.timestamp);
            if (sigDate !== todayTradingDay) return false;
            if (activeOnly && sig.status !== 'active') return false;
            return true;
        });

        if (version) {
            filtered = filtered.filter(sig => sig.version === version);
        }
        if (instrument) {
            filtered = filtered.filter(sig => sig.instrument === instrument);
        }
        if (threshold !== undefined) {
            filtered = filtered.filter(sig => parseInt(sig.threshold, 10) === threshold);
        }

        filtered.sort((a, b) => b.timestamp - a.timestamp);
        if (filtered.length > limit) filtered = filtered.slice(0, limit);
        return filtered.map(sig => ({
            ...sig,
            name: this.getInstrumentName(sig.instrument)
        }));
    }

    rebuildInstrumentIndex() {
        this.instrumentsData = this.getInstrumentsFromFiles();
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

    startPeriodicSignalSave() {
        setInterval(() => {
            if (this.saveInProgress) return;
            this.saveInProgress = true;
            try {
                this.saveSignalsToDisk();
            } catch (err) {
                console.error('❌ Periodic save failed:', err.message);
            } finally {
                this.saveInProgress = false;
            }
        }, this.signalSaveInterval);
    }

    saveSignalsToDisk() {
        try {
            const todayTradingDay = getTodayISTTradingDay();
            const jsonFile = 'signals_today_' + todayTradingDay + '.json';
            const signalsFile = path.join(this.candlesDataDir, jsonFile);
            
            // Build dedup key function
            const dedupKey = (sig) =>
                sig.timestamp + '_' + sig.instrument + '_' + sig.bar_type + '_' + sig.threshold + '_' + sig.barNumber + '_' + sig.type + '_' + sig.version;

            const signalMap = new Map();

            // ── Step 1: Load existing signals from disk (if any) ──
            // This is the critical fix: we MERGE with disk, never lose old signals
            if (fs.existsSync(signalsFile)) {
                try {
                    const existingData = fs.readFileSync(signalsFile, 'utf8');
                    const existingSignals = JSON.parse(existingData);
                    for (const sig of existingSignals) {
                        // Only keep today's trading day signals from disk
                        if (getTradingDayIST(sig.timestamp) === todayTradingDay) {
                            signalMap.set(dedupKey(sig), sig);
                        }
                    }
                } catch (readErr) {
                    // If disk file is corrupt, start fresh (but log it)
                    console.error('⚠️ Could not read existing signals file, rebuilding:', readErr.message);
                }
            }

            // ── Step 2: Merge in-memory signals on top (in-memory wins for freshness) ──
            const inMemoryToday = this.tradeSignals.filter(sig => {
                const sigDate = getTradingDayIST(sig.timestamp);
                return sigDate === todayTradingDay;
            });
            for (const signal of inMemoryToday) {
                signalMap.set(dedupKey(signal), signal);
            }

            // ── Step 3: Write merged result atomically ──
            const allSignals = Array.from(signalMap.values());
            allSignals.sort((a, b) => a.timestamp - b.timestamp);
            
            const tempFile = signalsFile + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(allSignals, null, 2), 'utf8');
            fs.renameSync(tempFile, signalsFile);

            // ── Step 4: Refresh in-memory list so it stays consistent with disk ──
            this.tradeSignals = allSignals;
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
        // First check build-version-config.json (most comprehensive)
        try {
            const buildConfigPath = path.resolve(__dirname, 'build-version-config.json');
            if (fs.existsSync(buildConfigPath)) {
                const buildConfig = JSON.parse(fs.readFileSync(buildConfigPath, 'utf8'));
                const inst = buildConfig.find(i => i.instrument_key === key);
                if (inst && inst.name) return inst.name;
            }
        } catch (e) {}

        // Then check config.json
        try {
            const configPath = path.resolve(__dirname, 'config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                const inst = config.instruments?.find(i => 
                    i.key === key || 
                    i.key.includes(key) || 
                    key.includes(i.key)
                );
                if (inst && inst.name) return inst.name;
            }
        } catch (e) {}

        const names = {
            'MCX_FO|538685': 'Natural Gas Future',
            'NSE_FO|62329': 'Nifty 50 Future',
            'NSE_FO|62326': 'Nifty Bank Future'
        };
        if (names[key]) return names[key];

        const id = key.includes('|') ? key.split('|')[1] : key;
        const normalizedId = id.replace(/_raw_ticks$/, '');
        return normalizedId;
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
        
        // Emit to subscribed room only (prevents broadcasting every instrument to all clients)
        this.io.to(instrumentKey + '_' + type + '_' + threshold).emit(instrumentKey + '_' + type + '_' + threshold + '_candle', candleData);
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
    }

    // ──────────────────────────────────────────────
    // Batched WebSocket Emission System (1-second dedup throttle)
    // ──────────────────────────────────────────────

    _makeDedupKey(data) {
        // Unique composite key: instrument + bar_type + threshold + barNumber + type + version
        return data.instrument + '_' + data.bar_type + '_' +
               String(data.threshold) + '_' + data.barNumber + '_' +
               data.type + '_' + data.version;
    }

    startBatchFlushInterval() {
        // Flush accumulated signals/status updates every 1000ms
        this.batchFlushInterval = setInterval(() => {
            this._flushBatchedSignals();
        }, 1000);
    }

    _flushBatchedSignals() {
        // ── Flush trade_signal batch ──
        if (this.batchedSignals.size > 0) {
            const signalsArray = Array.from(this.batchedSignals.values());
            this.batchedSignals.clear();
            // Emit each unique signal individually (preserves existing client event contract)
            // but rate-limited to once per second per unique key
            for (const signal of signalsArray) {
                this.io.emit('trade_signal', signal);
            }
            if (signalsArray.length > 10) {
                console.log(`📡 Batched ${signalsArray.length} trade_signals in 1s window`);
            }
        }

        // ── Flush trade_status_update batch ──
        if (this.batchedStatusUpdates.size > 0) {
            const updatesArray = Array.from(this.batchedStatusUpdates.values());
            this.batchedStatusUpdates.clear();
            for (const update of updatesArray) {
                this.io.emit('trade_status_update', update);
            }
            if (updatesArray.length > 10) {
                console.log(`📡 Batched ${updatesArray.length} trade_status_updates in 1s window`);
            }
        }
    }

    broadcastTradeSignal(signalData) {
        const todayTradingDay = getTodayISTTradingDay();
        const sigDate = getTradingDayIST(signalData.timestamp);
        if (sigDate !== todayTradingDay) return; 

        // ── Duplicate check against already-stored signals ──
        const dedupKey = this._makeDedupKey(signalData);
        const isDuplicate = this.tradeSignals.some(sig => 
            this._makeDedupKey(sig) === dedupKey
        );
        
        if (isDuplicate) return;

        signalData.name = this.getInstrumentName(signalData.instrument);
        signalData.status = signalData.status || 'pending';
        this.tradeSignals.push(signalData);
        
        if (this.tradeSignals.length > 2000) {
            this.tradeSignals.shift();
        }
        
        // ── Batch for 1-second dedup throttle ──
        // Latest value wins within the window (same dedup key overwrites previous)
        this.batchedSignals.set(dedupKey, signalData);
        console.log("🚀 Queued: " + signalData.version + " | " + signalData.instrument + " | Thresh: " + signalData.threshold + " | Bar #" + signalData.barNumber);
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

        const dedupKey = this._makeDedupKey(updateData);

        // ── TERMINAL-STATE GUARD: Skip if already completed/cancelled ──
        if (matchIndex !== -1) {
            const storedStatus = this.tradeSignals[matchIndex].status;
            const incomingStatus = updateData.status;
            // If the stored signal is already in a terminal state, skip re-emission
            // unless the incoming update is a different non-terminal status (shouldn't happen)
            const terminalStates = ['completed', 'cancelled', 'expired'];
            if (terminalStates.includes(storedStatus) && terminalStates.includes(incomingStatus)) {
                // Update stored data silently (no WS emission needed for already-terminal trades)
                if (updateData.exitReason) {
                    this.tradeSignals[matchIndex].exitReason = updateData.exitReason;
                    this.tradeSignals[matchIndex].exitPrice = updateData.exitPrice;
                }
                return; // SILENT: skip batching/broadcast entirely
            }

            // Update stored signal state
            this.tradeSignals[matchIndex].status = updateData.status;
            if (updateData.exitReason) {
                this.tradeSignals[matchIndex].exitReason = updateData.exitReason;
                this.tradeSignals[matchIndex].exitPrice = updateData.exitPrice;
            }
            
            const enrichedUpdate = {
                ...this.tradeSignals[matchIndex],
                name: this.getInstrumentName(this.tradeSignals[matchIndex].instrument)
            };
            // ── Batch for 1-second dedup throttle ──
            this.batchedStatusUpdates.set(dedupKey, enrichedUpdate);
        } else {
            const enrichedUpdate = {
                ...updateData,
                name: this.getInstrumentName(updateData.instrument)
            };
            // ── Batch for 1-second dedup throttle ──
            this.batchedStatusUpdates.set(dedupKey, enrichedUpdate);
        }
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log("📊 Chart server on port " + this.port);
        });
    }
}

module.exports = ChartServer;