// updateConfigVolumes.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const CONFIG_FILE = './config.json';

// Segment-aware feed divisor
function getDivisor(instrumentKey) {
    if (!instrumentKey) return 100;
    if (instrumentKey.includes('NSE_EQ')) {
        return 1000;
    }
    return 100; 
}

function getLotMultiplierFromConfig(instrumentKey) {
    if (!instrumentKey) return 1;

    const MULTIPLIERS = {
        '538685': 1250, '538686': 250, '520702': 100, '520703': 10,
        '464150': 30, '471726': 5, '488788': 1, '568831': 2500,
        '568836': 5000, '568833': 5000, '568830': 5000, '466583': 100,
        '510764': 10, '552721': 1, '61093': 75, '61088': 30,
        '61091': 40, '61092': 120, '61284': 500, '61189': 650,
        '61197': 700, '61289': 750, '61304': 225, '61209': 400,
        '61216': 1725, '61127': 475, '61114': 625, '61232': 175,
        '61303': 2750, '61235': 300, '61118': 750, '61226': 2000,
        '61296': 350, '61220': 675, '61143': 1350, '61099': 309,
        '61101': 475, '61192': 700, '61108': 125, '61274': 8000,
        '61286': 4700, '61298': 12700, '61265': 725, '61285': 1925,
        '61215': 5425, '61214': 4525, '61128': 2625, '61170': 3550,
        '61310': 225
    };

    try {
        const configPath = path.resolve(__dirname, CONFIG_FILE);
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const inst = config.instruments?.find(i => i.key === instrumentKey);
            if (inst && inst.lotSize !== undefined) {
                return inst.lotSize;
            }
        }
    } catch (e) {}

    const id = instrumentKey.includes('|') ? instrumentKey.split('|')[1] : instrumentKey;
    return MULTIPLIERS[id] || 1;
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
    fromDateObj.setDate(fromDateObj.getDate() - 45);
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

            const last10Candles = candlesRaw.slice(0, 10);
            const divisor = getDivisor(inst.key);
            
            // Normalize daily API volumes (shares/units) into lots using your config-defined lotSize
            const lotMultiplier = getLotMultiplierFromConfig(inst.key);
            const sumVolumeLots = last10Candles.reduce((acc, c) => acc + ((Number(c[5]) || 0) / lotMultiplier), 0);
            const avgVolumeLots = sumVolumeLots / last10Candles.length;

            // Compute dynamic 10-day rolling average target threshold (represented in lots, or shares for NSE EQ)
            const targetVolumePerBar = Math.max(1, Math.round(avgVolumeLots / divisor));

            console.log(`   -> Calculated 10-day average volume (lots/shares): ${Math.round(avgVolumeLots).toLocaleString()}`);
            console.log(`   -> Segment divisor: ${divisor}`);
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