// fetchRollingThresholds.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const CONFIG_FILE = './build-version-config.json';

// Segment-aware divisor to adjust for feed sampling rates
function getDivisor(instrumentKey) {
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
        const configPath = path.resolve(__dirname, 'config.json');
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

function formatISOToDDMMYY(dateStr) {
    if (!dateStr) return null;
    const standardPart = dateStr.split('T')[0];
    const parts = standardPart.split('-');
    if (parts.length === 3) {
        const year = parts[0].slice(-2);
        const month = parts[1];
        const day = parts[2];
        return `${day}/${month}/${year}`;
    }
    return null;
}

function getFormattedDate(dateValue) {
    if (typeof dateValue === 'string') {
        const formatted = formatISOToDDMMYY(dateValue);
        if (formatted) return formatted;
    }
    const d = new Date(Number(dateValue));
    if (isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
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
    fromDateObj.setDate(fromDateObj.getDate() - 90);
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
    if (!fs.existsSync(CONFIG_FILE)) {
        console.error(`❌ Configuration file not found: ${CONFIG_FILE}`);
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (e) {
        console.error(`❌ Authentication error: ${e.message}`);
        process.exit(1);
    }

    console.log(`📡 Connected to Upstox. Processing ${config.length} instruments...`);

    for (const inst of config) {
        console.log(`\n⏳ Fetching history for ${inst.name} (${inst.instrument_key})...`);
        try {
            const candlesRaw = await fetchDailyCandles(inst.instrument_key, accessToken);
            if (!candlesRaw || candlesRaw.length === 0) {
                console.warn(`   ⚠️ No history returned for ${inst.name}.`);
                continue;
            }

            const divisor = getDivisor(inst.instrument_key);
            console.log(`   -> Parameters applied: Divisor = ${divisor}`);

            const candles = [...candlesRaw].reverse();
            const rollingThresholds = {};
            const lotMultiplier = getLotMultiplierFromConfig(inst.instrument_key);

            for (let i = 10; i < candles.length; i++) {
                const currentDayCandle = candles[i];
                const dateKey = getFormattedDate(currentDayCandle[0]);
                if (!dateKey) continue;

                // Preceding 10 days
                const preceding10 = candles.slice(i - 10, i);
                
                // Convert daily raw volume units to lots using configuration parameters
                const sumVolumeLots = preceding10.reduce((acc, c) => acc + ((Number(c[5]) || 0) / lotMultiplier), 0);
                const avgVolumeLots = sumVolumeLots / 10;

                // Segment-adjusted threshold (stored as lots, or units for equity)
                rollingThresholds[dateKey] = Math.max(1, Math.round(avgVolumeLots / divisor));
            }

            // Keep original thresholds in static array to prevent configuration loss
            if (Array.isArray(inst.thresholds)) {
                inst.static_thresholds = inst.thresholds;
            } else if (!inst.static_thresholds) {
                inst.static_thresholds = [];
            }

            inst.thresholds = rollingThresholds;
            console.log(`   ✅ Logged dynamic lot-based thresholds for ${Object.keys(rollingThresholds).length} sessions.`);
        } catch (error) {
            console.error(`   ❌ Failed to process ${inst.name}:`, error.message);
        }
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4), 'utf8');
    console.log(`\n🎉 Config updated in ${CONFIG_FILE}`);
}

main().catch(console.error);