// updateConfigVolumes.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const CONFIG_FILE = './config.json'; // The first configuration file for live trading

// MCX lot size multiplier map
const MCX_LOT_MULTIPLIER_MAP = {
    '538685': 1250, // Natural Gas
    '520702': 100,  // Crude Oil
    '464150': 30,   // Silver Standard
    '464151': 5,    // Silver Mini
    '477177': 1,    // Silver Micro
    '552708': 2500, // Copper
    '552711': 5000, // Zinc
    '552709': 5000, // Lead
    '552706': 5000, // Aluminium
    '466583': 100,  // Gold Standard
    '510764': 10,   // Gold Mini
    '510464': 1,    // Gold Petal
    '565898': 50,   // Bulldex
};

// Segment-aware feed divisor
function getDivisor(instrumentKey) {
    if (!instrumentKey) return 100;
    
    // NSE Equities require a 1000 divisor to scale down 10x and match the real-time tick feed
    if (instrumentKey.includes('NSE_EQ')) {
        return 1000;
    }
    
    // Index futures and commodities are processed closer to 100% efficiency on retail feeds
    return 100; 
}

function getLotMultiplier(instrumentKey) {
    if (!instrumentKey) return 1;
    
    if (instrumentKey.includes('MCX_FO')) {
        const id = instrumentKey.split('|')[1];
        if (MCX_LOT_MULTIPLIER_MAP[id] !== undefined) {
            return MCX_LOT_MULTIPLIER_MAP[id];
        }
    }
    return 1;
}

async function getAccessToken() {
    if (process.env.UPSTOX_ACCESS_TOKEN) {
        return process.env.UPSTOX_ACCESS_TOKEN;
    }

    try {
        const AuthManager = require('./auth-manager');
        const auth = new AuthManager({
            apiKey: process.env.UPSTOX_API_KEY,
            apiSecret: process.env.UPSTOX_API_SECRET,
            redirectUri: process.env.UPSTOX_REDIRECT_URI,
            analyticsToken: process.env.UPSTOX_ANALYTICS_TOKEN,
            authCode: process.env.UPSTOX_AUTH_CODE,
            dataDir: './market_data'
        });
        return await auth.getValidAccessToken();
    } catch (e) {
        console.warn("⚠️ AuthManager load skipped. Proceeding to fallback.");
    }

    throw new Error("Could not retrieve access token. Please set UPSTOX_ACCESS_TOKEN in .env");
}

async function fetchDailyCandles(instrumentKey, accessToken) {
    const toDate = new Date().toISOString().split('T')[0];
    const fromDateObj = new Date();
    fromDateObj.setDate(fromDateObj.getDate() - 45); // Fetching 45 days is plenty for a 10-day trading average
    const fromDate = fromDateObj.toISOString().split('T')[0];

    const encodedKey = encodeURIComponent(instrumentKey);
    const v3Url = `https://api.upstox.com/v3/historical-candle/${encodedKey}/days/1/${toDate}/${fromDate}`;
    const v2Url = `https://api.upstox.com/v2/historical-candle/${encodedKey}/day/${toDate}/${fromDate}`;

    const headers = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
    };

    try {
        const response = await axios.get(v3Url, { headers, timeout: 10000 });
        if (response.data && response.data.status === 'success') {
            return response.data.data.candles;
        }
    } catch (err) {
        try {
            const response = await axios.get(v2Url, { headers, timeout: 10000 });
            if (response.data && response.data.status === 'success') {
                return response.data.data.candles;
            }
        } catch (v2Err) {
            throw new Error(`Upstox fetch error: ${v2Err.message}`);
        }
    }
    return [];
}

async function main() {
    const configPath = path.resolve(__dirname, CONFIG_FILE);
    if (!fs.existsSync(configPath)) {
        console.error(`❌ Live config file not found: ${CONFIG_FILE}`);
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (e) {
        console.error(`❌ Authentication error: ${e.message}`);
        process.exit(1);
    }

    console.log(`📡 Connected to Upstox. Processing volume updates for live trading configuration...`);

    for (const inst of config.instruments) {
        console.log(`\n⏳ Updating threshold for ${inst.name} (${inst.key})...`);
        try {
            const candlesRaw = await fetchDailyCandles(inst.key, accessToken);
            if (!candlesRaw || candlesRaw.length === 0) {
                console.warn(`   ⚠️ No history returned for ${inst.name}. Skipping volumePerBar update.`);
                continue;
            }

            // Upstox EOD is returned reverse-chronological (newest first). 
            // We slice the first 10 candles representing the most recent 10 trading days.
            const last10Candles = candlesRaw.slice(0, 10);
            
            const multiplier = getLotMultiplier(inst.key);
            const divisor = getDivisor(inst.key);
            
            const sumVolumeLots = last10Candles.reduce((acc, c) => acc + (Number(c[5]) || 0), 0);
            const avgVolumeLots = sumVolumeLots / last10Candles.length;
            const avgVolumeUnits = avgVolumeLots * multiplier;

            // Compute dynamic 10-day rolling average target threshold
            const targetVolumePerBar = Math.round(avgVolumeUnits / divisor);

            console.log(`   -> Calculated 10-day average volume (lots): ${Math.round(avgVolumeLots).toLocaleString()}`);
            console.log(`   -> Lot multiplier: ${multiplier} | Segment divisor: ${divisor}`);
            console.log(`   -> Previous volumePerBar: ${inst.volumePerBar.toLocaleString()}`);
            console.log(`   -> New volumePerBar: ${targetVolumePerBar.toLocaleString()}`);

            inst.volumePerBar = targetVolumePerBar;
        } catch (error) {
            console.error(`   ❌ Failed to process ${inst.name}:`, error.message);
        }
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
    console.log(`\n🎉 Volume automation process complete. Live config written to ${CONFIG_FILE}`);
}

main().catch(console.error);