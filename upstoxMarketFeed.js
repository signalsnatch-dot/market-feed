const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const protobuf = require('protobufjs');
require('dotenv').config();


class UpstoxMarketFeed {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.redirectUri = config.redirectUri;
        this.authCode = config.authCode;
        this.instruments = config.instruments || [];
        this.dataDir = config.dataDir || './market_data';
        this.mode = config.mode || 'full';
        this.debug = config.debug || true; // Enable debug logging
        
        this.accessToken = null;
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = Infinity;
        this.reconnectDelay = 1000;
        this.pingInterval = null;
        this.messageQueue = [];
        this.isProcessing = false;
        this.currentWriters = new Map();
        this.stats = {
            messagesReceived: 0,
            messagesProcessed: 0,
            liveFeedMessages: 0,
            errors: 0,
            reconnections: 0,
            lastMessageTime: null
        };
        
        // Track market status
        this.marketStatus = {};
        this.isMarketOpen = false;
        
        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        
        // Create debug log file
        this.debugLogPath = path.join(this.dataDir, 'debug.log');
        
        this.protoRoot = null;
        this.FeedResponse = null;
    }
    
    logDebug(message, data = null) {
        if (!this.debug) return;
        
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}`;
        console.log(logEntry);
        
        if (data) {
            console.log('Data:', JSON.stringify(data, null, 2));
            fs.appendFileSync(this.debugLogPath, `${logEntry}\nData: ${JSON.stringify(data)}\n\n`);
        } else {
            fs.appendFileSync(this.debugLogPath, `${logEntry}\n`);
        }
    }
    
    getOfficialProtobufSchema() {
        return `
        syntax = "proto3";
        package com.upstox.marketdatafeederv3udapi.rpc.proto;
        
        message LTPC {
          double ltp = 1;
          int64 ltt = 2;
          int64 ltq = 3;
          double cp = 4;
        }
        
        message MarketLevel {
          repeated Quote bidAskQuote = 1;
        }
        
        message MarketOHLC {
          repeated OHLC ohlc = 1;
        }
        
        message Quote {
          int64 bidQ = 1;
          double bidP = 2;
          int64 askQ = 3;
          double askP = 4;
        }
        
        message OptionGreeks {
          double delta = 1;
          double theta = 2;
          double gamma = 3;
          double vega = 4;
          double rho = 5;
        }
        
        message OHLC {
          string interval = 1;
          double open = 2;
          double high = 3;
          double low = 4;
          double close = 5;
          int64 vol = 6;
          int64 ts = 7;
        }
        
        enum Type {
          initial_feed = 0;
          live_feed = 1;
          market_info = 2;
        }
        
        message MarketFullFeed {
          LTPC ltpc = 1;
          MarketLevel marketLevel = 2;
          OptionGreeks optionGreeks = 3;
          MarketOHLC marketOHLC = 4;
          double atp = 5;
          int64 vtt = 6;
          double oi = 7;
          double iv = 8;
          double tbq = 9;
          double tsq = 10;
        }
        
        message IndexFullFeed {
          LTPC ltpc = 1;
          MarketOHLC marketOHLC = 2;
        }
        
        message FullFeed {
          oneof FullFeedUnion {
            MarketFullFeed marketFF = 1;
            IndexFullFeed indexFF = 2;
          }
        }
        
        message FirstLevelWithGreeks {
          LTPC ltpc = 1;
          Quote firstDepth = 2;
          OptionGreeks optionGreeks = 3;
          int64 vtt = 4;
          double oi = 5;
          double iv = 6;
        }
        
        message Feed {
          oneof FeedUnion {
            LTPC ltpc = 1;
            FullFeed fullFeed = 2;
            FirstLevelWithGreeks firstLevelWithGreeks = 3;
          }
          RequestMode requestMode = 4;
        }
        
        enum RequestMode {
          ltpc = 0;
          full_d5 = 1;
          option_greeks = 2;
          full_d30 = 3;
        }
        
        enum MarketStatus {
          PRE_OPEN_START = 0;
          PRE_OPEN_END = 1;
          NORMAL_OPEN = 2;
          NORMAL_CLOSE = 3;
          CLOSING_START = 4;
          CLOSING_END = 5;
        }
        
        message MarketInfo {
          map<string, MarketStatus> segmentStatus = 1;
        }
        
        message FeedResponse {
          Type type = 1;
          map<string, Feed> feeds = 2;
          int64 currentTs = 3;
          MarketInfo marketInfo = 4;
        }
        `;
    }
    
    async loadProtobufSchema() {
        try {
            const officialUrl = 'https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto';
            const response = await axios.get(officialUrl, { timeout: 10000 });
            const schemaContent = response.data;
            this.protoRoot = await protobuf.parse(schemaContent).root;
            this.logDebug('Protobuf schema downloaded from official URL');
        } catch (error) {
            this.logDebug('Failed to download from official URL, using embedded schema');
            const schemaContent = this.getOfficialProtobufSchema();
            this.protoRoot = await protobuf.parse(schemaContent).root;
            this.logDebug('Using embedded protobuf schema');
        }
        
        this.FeedResponse = this.protoRoot.lookupType('com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse');
        this.logDebug('Protobuf schema loaded successfully');
    }
    
    async authenticate() {
        try {
            if (this.loadCachedToken()) {
                return this.accessToken;
            }
            
            if (!this.authCode) {
                const state = crypto.randomBytes(16).toString('hex');
                const authUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${this.apiKey}&redirect_uri=${this.redirectUri}&state=${state}`;
                
                console.log('\n=================================');
                console.log('AUTHENTICATION REQUIRED');
                console.log('=================================');
                console.log('Please visit this URL to authorize:');
                console.log(authUrl);
                console.log('\nAfter authorization, copy the "code" parameter from redirect URL');
                console.log('Then restart with: AUTH_CODE=your_code node index.js');
                console.log('=================================\n');
                throw new Error('Authorization code required');
            }
            
            const params = new URLSearchParams();
            params.append('code', this.authCode);
            params.append('client_id', this.apiKey);
            params.append('client_secret', this.apiSecret);
            params.append('redirect_uri', this.redirectUri);
            params.append('grant_type', 'authorization_code');
            
            const tokenResponse = await axios.post('https://api.upstox.com/v2/login/authorization/token', 
                params.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    }
                }
            );
            
            this.accessToken = tokenResponse.data.access_token;
            this.logDebug('Access token obtained successfully');
            
            const tokenFile = path.join(this.dataDir, '.token_cache');
            fs.writeFileSync(tokenFile, JSON.stringify({
                token: this.accessToken,
                expiry: Date.now() + (24 * 60 * 60 * 1000)
            }));
            
            return this.accessToken;
            
        } catch (error) {
            console.error('Authentication failed:', error.response?.data || error.message);
            throw error;
        }
    }
    
    loadCachedToken() {
        try {
            const tokenFile = path.join(this.dataDir, '.token_cache');
            if (fs.existsSync(tokenFile)) {
                const cached = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
                if (cached.expiry > Date.now()) {
                    this.accessToken = cached.token;
                    this.logDebug('Loaded cached access token');
                    return true;
                }
            }
        } catch (error) {
            console.warn('Failed to load cached token:', error.message);
        }
        return false;
    }
    
    async validateInstrumentKeys() {
        // Common instrument key formats
        const validFormats = {
            'NSE_INDEX': ['Nifty 50', 'Nifty Bank', 'Nifty IT', 'Nifty Pharma'],
            'NSE_EQ': ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'ITC', 'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'KOTAKBANK'],
            'NSE_FO': ['45450', '45455', '45460'], // Example futures symbols
            'MCX_FO': ['539585'] // Gold futures etc.
        };
        
        this.logDebug('Validating instrument keys...');
        
        for (const instrument of this.instruments) {
            const [exchange, symbol] = instrument.split('|');
            
            if (!exchange || !symbol) {
                console.warn(`⚠️ Invalid instrument format: ${instrument} (expected EXCHANGE|SYMBOL)`);
                continue;
            }
            
            // Check if format is valid
            if (validFormats[exchange]) {
                this.logDebug(`✓ Valid format: ${instrument}`);
            } else {
                console.warn(`⚠️ Unknown exchange: ${exchange} for ${instrument}`);
            }
        }
        
        // For testing during market hours, try with a known active symbol
        const testInstruments = [
            'NSE_INDEX|Nifty 50',  // Index (always has data during market hours)
            'NSE_EQ|RELIANCE'      // Highly liquid stock
        ];
        
        console.log('\n📊 Instrument Validation:');
        console.log(`   You subscribed to: ${this.instruments.join(', ')}`);
        console.log(`   For testing during market hours, use: ${testInstruments.join(', ')}`);
        console.log('');
    }
    
    getCSVWriter(instrumentKey) {
        if (!this.currentWriters.has(instrumentKey)) {
            this.createNewCSVFile(instrumentKey);
        }
        return this.currentWriters.get(instrumentKey);
    }
    
    createNewCSVFile(instrumentKey) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeKey = instrumentKey.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${safeKey}_${timestamp}.csv`;
        const filepath = path.join(this.dataDir, filename);
        
        const headers = [
            'timestamp', 'exchange_timestamp', 'instrument_key',
            'ltp', 'last_traded_time', 'last_traded_quantity', 'close_price',
            'best_bid_price', 'best_bid_quantity', 'best_ask_price', 'best_ask_quantity',
            'total_buy_quantity', 'total_sell_quantity', 'volume_today',
            'open_interest', 'average_traded_price', 'iv', 'request_mode'
        ];
        
        if (this.mode === 'full' || this.mode === 'full_d30') {
            headers.push('delta', 'theta', 'gamma', 'vega', 'rho');
        }
        
        const writeStream = fs.createWriteStream(filepath);
        writeStream.write(headers.join(',') + '\n');
        
        this.currentWriters.set(instrumentKey, {
            stream: writeStream,
            filepath: filepath,
            rows: 0,
            headers: headers
        });
        
        console.log(`✅ Created CSV file for ${instrumentKey}: ${filename}`);
    }
    
    async writeToCSV(data) {
        const writer = this.getCSVWriter(data.instrument_key);
        
        const row = writer.headers.map(header => {
            let value = data[header];
            
            if (header === 'best_bid_price') value = data.best_bid?.price || '';
            if (header === 'best_bid_quantity') value = data.best_bid?.quantity || '';
            if (header === 'best_ask_price') value = data.best_ask?.price || '';
            if (header === 'best_ask_quantity') value = data.best_ask?.quantity || '';
            
            if (typeof value === 'string' && value.includes(',')) {
                value = `"${value.replace(/"/g, '""')}"`;
            }
            return value !== undefined && value !== null ? value : '';
        }).join(',');
        
        writer.stream.write(row + '\n');
        writer.rows++;
        
        if (writer.rows >= 1000000) {
            writer.stream.end();
            this.currentWriters.delete(data.instrument_key);
            this.createNewCSVFile(data.instrument_key);
        }
    }
    
    async connectWebSocket() {
        if (!this.accessToken) {
            await this.authenticate();
        }
        
        const wsUrl = 'wss://api.upstox.com/v3/feed/market-data-feed';
        
        console.log('\n🔌 Connecting to WebSocket...');
        
        this.ws = new WebSocket(wsUrl, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Accept': '*/*'
            },
            followRedirects: true,
            handshakeTimeout: 10000
        });
        
        this.ws.on('open', () => {
            console.log('✅ WebSocket connected successfully');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.subscribeInstruments();
            this.startHeartbeat();
        });
        
        this.ws.on('message', async (data) => {
            this.stats.messagesReceived++;
            this.stats.lastMessageTime = Date.now();
            await this.handleMessage(data);
        });
        
        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });
        
        this.ws.on('close', (code, reason) => {
            console.log(`⚠️ WebSocket disconnected: ${code} - ${reason}`);
            this.isConnected = false;
            this.scheduleReconnect();
        });
    }
    
    subscribeInstruments() {
        if (!this.instruments.length) {
            console.warn('⚠️ No instruments to subscribe');
            return;
        }
        
        const modeMap = {
            'ltpc': 'ltpc',
            'full': 'full_d5',
            'full_d30': 'full_d30',
            'option_greeks': 'option_greeks'
        };
        
        const requestMode = modeMap[this.mode] || 'full_d5';
        
        const subscribeMsg = {
            guid: crypto.randomBytes(8).toString('hex'),
            method: 'sub',
            data: {
                mode: requestMode,
                instrumentKeys: this.instruments
            }
        };
        
        const binaryData = Buffer.from(JSON.stringify(subscribeMsg));
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(binaryData);
            console.log(`\n📡 Subscribed to ${this.instruments.length} instruments:`);
            this.instruments.forEach(inst => console.log(`   - ${inst}`));
            console.log(`   Mode: ${this.mode} (${requestMode})\n`);
        }
    }
    
    async handleMessage(data) {
        try {
            const decoded = this.FeedResponse.decode(data);
            const response = this.FeedResponse.toObject(decoded, {
                longs: Number,
                enums: String,
                defaults: true
            });
            
            this.stats.messagesProcessed++;
            
            if (response.type === 'market_info' && response.marketInfo) {
                this.marketStatus = response.marketInfo.segmentStatus;
                
                // Check if any equity/fo segment is open
                const openSegments = [];
                for (const [segment, status] of Object.entries(this.marketStatus)) {
                    if (status === 'NORMAL_OPEN') {
                        openSegments.push(segment);
                    }
                }
                
                this.isMarketOpen = openSegments.length > 0;
                
                console.log('\n📊 Market Status Update:');
                console.log(`   Time: ${new Date(response.currentTs).toISOString()}`);
                console.log(`   Open Segments: ${openSegments.join(', ') || 'None'}`);
                console.log(`   Market ${this.isMarketOpen ? '🟢 OPEN' : '🔴 CLOSED'}\n`);
                
                if (!this.isMarketOpen) {
                    console.log('💡 Tip: Markets are currently closed. Live data will appear when markets open.');
                    console.log('   Equity: 9:15 AM - 3:30 PM IST');
                    console.log('   Commodity: 9:00 AM - 11:30 PM IST\n');
                }
                
                await this.writeToCSV({
                    timestamp: Date.now(),
                    exchange_timestamp: response.currentTs,
                    instrument_key: 'GLOBAL',
                    type: 'market_info',
                    market_open: this.isMarketOpen,
                    open_segments: openSegments.join(',')
                });
            }
            else if (response.type === 'live_feed' && response.feeds) {
                this.stats.liveFeedMessages++;
                
                if (Object.keys(response.feeds).length === 0) {
                    this.logDebug('Received live_feed with no feeds data');
                } else {
                    this.logDebug(`Received live_feed with ${Object.keys(response.feeds).length} instruments`);
                }
                
                await this.processLiveFeed(response);
            }
            
        } catch (error) {
            this.stats.errors++;
            console.error('❌ Error processing message:', error.message);
            
            const debugFile = path.join(this.dataDir, 'debug_raw_messages.bin');
            fs.appendFileSync(debugFile, data);
        }
    }
    
    async processLiveFeed(response) {
        const exchangeTs = response.currentTs;
        const receiveTs = Date.now();
        
        const feedCount = Object.keys(response.feeds).length;
        
        if (feedCount === 0) {
            // No data for subscribed instruments - possible reasons:
            // 1. Markets are closed
            // 2. Instrument keys are invalid
            // 3. No trades happening
            if (this.stats.liveFeedMessages % 10 === 0) { // Log every 10th empty message
                console.log(`⏳ No tick data received (${this.stats.liveFeedMessages} empty live_feed messages so far)`);
                console.log(`   Possible reasons: Markets closed, invalid symbols, or no trades\n`);
            }
            return;
        }
        
        console.log(`📈 Received ${feedCount} instrument updates at ${new Date(receiveTs).toISOString()}`);
        
        for (const [instrumentKey, feedData] of Object.entries(response.feeds)) {
            try {
                const record = {
                    timestamp: receiveTs,
                    exchange_timestamp: exchangeTs,
                    instrument_key: instrumentKey,
                    request_mode: feedData.requestMode || this.mode
                };
                
                let hasData = false;
                
                if (feedData.ltpc) {
                    record.ltp = feedData.ltpc.ltp;
                    record.last_traded_time = feedData.ltpc.ltt;
                    record.last_traded_quantity = feedData.ltpc.ltq;
                    record.close_price = feedData.ltpc.cp;
                    hasData = true;
                }
                else if (feedData.fullFeed) {
                    const fullFeed = feedData.fullFeed;
                    
                    if (fullFeed.marketFF) {
                        const market = fullFeed.marketFF;
                        
                        if (market.ltpc) {
                            record.ltp = market.ltpc.ltp;
                            record.last_traded_time = market.ltpc.ltt;
                            record.last_traded_quantity = market.ltpc.ltq;
                            record.close_price = market.ltpc.cp;
                            hasData = true;
                        }
                        
                        if (market.marketLevel?.bidAskQuote?.length > 0) {
                            const best = market.marketLevel.bidAskQuote[0];
                            record.best_bid = { price: best.bidP, quantity: best.bidQ };
                            record.best_ask = { price: best.askP, quantity: best.askQ };
                        }
                        
                        record.total_buy_quantity = market.tbq;
                        record.total_sell_quantity = market.tsq;
                        record.volume_today = market.vtt;
                        record.open_interest = market.oi;
                        record.average_traded_price = market.atp;
                        record.iv = market.iv;
                        
                        if (market.optionGreeks) {
                            record.delta = market.optionGreeks.delta;
                            record.theta = market.optionGreeks.theta;
                            record.gamma = market.optionGreeks.gamma;
                            record.vega = market.optionGreeks.vega;
                            record.rho = market.optionGreeks.rho;
                        }
                    }
                    else if (fullFeed.indexFF && fullFeed.indexFF.ltpc) {
                        record.ltp = fullFeed.indexFF.ltpc.ltp;
                        record.last_traded_time = fullFeed.indexFF.ltpc.ltt;
                        record.close_price = fullFeed.indexFF.ltpc.cp;
                        hasData = true;
                    }
                }
                else if (feedData.firstLevelWithGreeks) {
                    const firstLevel = feedData.firstLevelWithGreeks;
                    
                    if (firstLevel.ltpc) {
                        record.ltp = firstLevel.ltpc.ltp;
                        record.last_traded_time = firstLevel.ltpc.ltt;
                        record.last_traded_quantity = firstLevel.ltpc.ltq;
                        record.close_price = firstLevel.ltpc.cp;
                        hasData = true;
                    }
                    
                    if (firstLevel.firstDepth) {
                        record.best_bid = { price: firstLevel.firstDepth.bidP, quantity: firstLevel.firstDepth.bidQ };
                        record.best_ask = { price: firstLevel.firstDepth.askP, quantity: firstLevel.firstDepth.askQ };
                    }
                    
                    if (firstLevel.optionGreeks) {
                        record.delta = firstLevel.optionGreeks.delta;
                        record.theta = firstLevel.optionGreeks.theta;
                        record.gamma = firstLevel.optionGreeks.gamma;
                        record.vega = firstLevel.optionGreeks.vega;
                        record.rho = firstLevel.optionGreeks.rho;
                    }
                    
                    record.volume_today = firstLevel.vtt;
                    record.open_interest = firstLevel.oi;
                    record.iv = firstLevel.iv;
                }
                
                if (hasData) {
                    await this.writeToCSV(record);
                    this.emit('tick', record);
                    console.log(`   ✓ ${instrumentKey}: LTP = ₹${record.ltp}`);
                }
                
            } catch (error) {
                console.error(`❌ Error processing ${instrumentKey}:`, error.message);
            }
        }
        
        console.log(''); // Empty line for readability
    }
    
    startHeartbeat() {
        this.pingInterval = setInterval(() => {
            if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000);
    }
    
    scheduleReconnect() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        
        const delay = Math.min(30000, this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts));
        this.reconnectAttempts++;
        this.stats.reconnections++;
        
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        this.reconnectTimeout = setTimeout(async () => {
            await this.connectWebSocket();
        }, delay);
    }
    
    async start() {
        console.log('\n🚀 Starting Upstox Market Feed...\n');
        await this.validateInstrumentKeys();
        await this.loadProtobufSchema();
        await this.connectWebSocket();
        
        // Stats reporting every 30 seconds
        setInterval(() => {
            const timeSinceLastMsg = this.stats.lastMessageTime 
                ? Math.round((Date.now() - this.stats.lastMessageTime) / 1000)
                : 'N/A';
            
            console.log(`\n📊 Stats: Msgs: ${this.stats.messagesReceived}, Live: ${this.stats.liveFeedMessages}, Errors: ${this.stats.errors}, Last msg: ${timeSinceLastMsg}s ago\n`);
        }, 30000);
    }
    
    stop() {
        console.log('\n🛑 Shutting down...');
        if (this.pingInterval) clearInterval(this.pingInterval);
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        
        if (this.ws) {
            this.ws.close();
        }
        
        for (const writer of this.currentWriters.values()) {
            writer.stream.end();
        }
        
        this.emit('shutdown');
    }
}

const EventEmitter = require('events');
Object.assign(UpstoxMarketFeed.prototype, EventEmitter.prototype);

module.exports = UpstoxMarketFeed;
