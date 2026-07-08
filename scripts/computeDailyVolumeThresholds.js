#!/usr/bin/env node
/**
 * computeDailyVolumeThresholds.js
 *
 * Fetches daily candle data from Upstox API, computes 10 volume-bar thresholds
 * per instrument per date targeting a known number of candles/day, and updates
 * both build-version-config.json and config.json.
 *
 * Threshold logic:
 *   threshold = projectedDailyVolume / targetCandlesPerDay
 *
 * Target candles/day by instrument liquidity tier:
 *   High   (>5000 lots/day):  80–150 candles
 *   Medium (500–5000):        60–120 candles
 *   Low    (<500):            30–60  candles
 *
 * 10 evenly-spaced thresholds between min and max target bars for that tier.
 *
 * Usage:
 *   node scripts/computeDailyVolumeThresholds.js [--lookback 14]
 *
 * Outputs:
 *   build-version-config.json  → static_thresholds + thresholds map (date→[10])
 *   config.json                → volumePerBar updated for each instrument
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// ─── Constants ──────────────────────────────────────────────
const BUILD_CONFIG_PATH = path.resolve(__dirname, '..', 'build-version-config.json');
const LIVE_CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');
const DEFAULT_LOOKBACK = 14;

// ─── Lot multipliers ────────────────────────────────────────
const LOT_MULTIPLIERS = {
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

// NSE_EQ instruments — volume divisor is different
const NSE_EQ_INSTRUMENTS = new Set([
    'NSE_EQ|INE002A01018', 'NSE_EQ|INE040A01034', 'NSE_EQ|INE090A01021',
    'NSE_EQ|INE062A01020', 'NSE_EQ|INE467B01029', 'NSE_EQ|INE009A01021',
    'NSE_EQ|INE154A01025', 'NSE_EQ|INE397D01024', 'NSE_EQ|INE238A01034',
    'NSE_EQ|INE018A01030', 'NSE_EQ|INE081A01020', 'NSE_EQ|INE1TAE01010',
    'NSE_EQ|INE296A01032', 'NSE_EQ|INE237A01036', 'NSE_EQ|INE044A01036',
    'NSE_EQ|INE019A01038', 'NSE_EQ|INE522F01014', 'NSE_EQ|INE423A01024',
    'NSE_EQ|INE742F01042', 'NSE_EQ|INE038A01020', 'NSE_EQ|INE437A01024',
    'NSE_EQ|INE160A01022', 'NSE_EQ|INE114A01011', 'NSE_EQ|INE040H01021',
    'NSE_EQ|INE928J01020', 'NSE_EQ|INE415G01027', 'NSE_EQ|INE053F01010',
    'NSE_EQ|INE202E01016', 'NSE_EQ|INE257A01026', 'NSE_EQ|INE129A01025',
    'NSE_EQ|INE849A01020'
]);

function getLotMultiplier(instKey) {
    if (!instKey) return 1;
    try {
        const cfg = JSON.parse(fs.readFileSync(LIVE_CONFIG_PATH, 'utf8'));
        const i = cfg.instruments?.find(x => x.key === instKey);
        if (i && i.lotSize !== undefined) return i.lotSize;
    } catch (e) { /* fall through */ }
    const id = instKey.includes('|') ? instKey.split('|')[1] : instKey;
    return LOT_MULTIPLIERS[id] || 1;
}

function getVolumeDivisor(instKey) {
    if (NSE_EQ_INSTRUMENTS.has(instKey)) return 1000;
    return 100;
}

// ─── Liquidity tier ─────────────────────────────────────────
function getLiquidityTier(avgDailyVolumeLots) {
    if (avgDailyVolumeLots > 5000) return { name: 'high', minBars: 80, maxBars: 150 };
    if (avgDailyVolumeLots >= 500) return { name: 'medium', minBars: 80, maxBars: 120 };
    return { name: 'low', minBars: 80, maxBars: 120 };
}

// ─── Auth ────────────────────────────────────────────────────
async function getAccessToken() {
    if (process.env.UPSTOX_ACCESS_TOKEN) return process.env.UPSTOX_ACCESS_TOKEN;
    try {
        const AuthManager = require('../auth-manager');
        const auth = new AuthManager({
            apiKey: process.env.UPSTOX_API_KEY,
            apiSecret: process.env.UPSTOX_API_SECRET,
            redirectUri: process.env.UPSTOX_REDIRECT_URI,
            analyticsToken: process.env.UPSTOX_ANALYTICS_TOKEN,
            authCode: process.env.UPSTOX_AUTH_CODE,
            dataDir: path.resolve(__dirname, '..', 'market_data')
        });
        return await auth.getValidAccessToken();
    } catch (e) {
        console.warn('⚠️ AuthManager failed. Using UPSTOX_ACCESS_TOKEN env var if set.');
    }
    throw new Error('No access token available. Set UPSTOX_ACCESS_TOKEN in .env or configure auth-manager.');
}

// ─── Upstox API ─────────────────────────────────────────────
async function fetchDailyCandles(instKey, accessToken) {
    const toDate = new Date().toISOString().split('T')[0];
    const fromDateObj = new Date();
    fromDateObj.setDate(fromDateObj.getDate() - 90); // fetch up to 90 days
    const fromDate = fromDateObj.toISOString().split('T')[0];

    const encodedKey = encodeURIComponent(instKey);
    const v3Url = `https://api.upstox.com/v3/historical-candle/${encodedKey}/days/1/${toDate}/${fromDate}`;
    const v2Url = `https://api.upstox.com/v2/historical-candle/${encodedKey}/day/${toDate}/${fromDate}`;
    const headers = { 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}` };

    try {
        const resp = await axios.get(v3Url, { headers, timeout: 15000 });
        if (resp.data?.status === 'success' && Array.isArray(resp.data.data?.candles)) {
            return resp.data.data.candles;
        }
    } catch (e) { /* try v2 */ }

    try {
        const resp = await axios.get(v2Url, { headers, timeout: 15000 });
        if (resp.data?.status === 'success' && Array.isArray(resp.data.data?.candles)) {
            return resp.data.data.candles;
        }
    } catch (e) {
        throw new Error(`Upstox API error: ${e.message}`);
    }
    return [];
}

// ─── Date formatting ─────────────────────────────────────────
function formatDateDDMMYY(dateVal) {
    // dateVal can be ISO string "2026-07-03T00:00:00+05:30" or timestamp
    let d;
    if (typeof dateVal === 'string') {
        d = new Date(dateVal);
    } else {
        d = new Date(Number(dateVal));
    }
    if (isNaN(d.getTime())) return null;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

function formatDateISO(dateVal) {
    let d;
    if (typeof dateVal === 'string') {
        d = new Date(dateVal);
    } else {
        d = new Date(Number(dateVal));
    }
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

// ─── Linear regression for volume trend ──────────────────────
function linearRegressionSlope(values) {
    const n = values.length;
    if (n < 3) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += values[i];
        sumXY += i * values[i];
        sumX2 += i * i;
    }
    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return 0;
    return (n * sumXY - sumX * sumY) / denominator;
}

function projectVolume(values, lookback) {
    // values: array of daily volumes in lots (newest last)
    const recent = values.slice(-lookback);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const slope = linearRegressionSlope(recent);

    // Trend-adjusted projection
    if (slope > 0) {
        const growthRate = slope / avg;
        return avg * (1 + Math.min(growthRate, 0.3)); // cap growth at 30%
    } else if (slope < 0) {
        const declineRate = Math.abs(slope) / avg;
        return avg * (1 - Math.min(declineRate, 0.2)); // cap decline at 20%
    }
    return avg;
}

// ─── Threshold generation ────────────────────────────────────
function generateThresholds(projectedVolLots, tier) {
    const { minBars, maxBars } = tier;
    const thresholds = [];
    const step = (maxBars - minBars) / 9; // 9 intervals for 10 values

    for (let i = 0; i < 10; i++) {
        const targetBars = Math.round(minBars + step * i);
        const threshold = Math.max(1, Math.round(projectedVolLots / targetBars));
        thresholds.push(threshold);
    }
    // Sort ascending (thresholds = X/targetBars, so smaller target = larger threshold)
    thresholds.sort((a, b) => a - b);
    // Ensure strictly increasing (deduped ascending adjacency: if equal, increment by 1)
    for (let i = 1; i < thresholds.length; i++) {
        if (thresholds[i] <= thresholds[i - 1]) {
            thresholds[i] = thresholds[i - 1] + 1;
        }
    }
    return thresholds;
}

function computeDailyBarEstimates(projectedVolLots, thresholds) {
    const estimates = {};
    for (const t of thresholds) {
        estimates[t] = Math.round(projectedVolLots / t);
    }
    return estimates;
}

// ─── Ratio recommendation (same logic as before) ─────────────
function recommendRatios(instrumentType) {
    const defaults = {
        'mCX_high_vol':    { stop: 0.35, trigger: 0.10, ema: 0.20, struct: 0.15, conf: 40 },
        'mCX_metal':       { stop: 0.28, trigger: 0.08, ema: 0.12, struct: 0.12, conf: 45 },
        'mCX_base_metal':  { stop: 0.40, trigger: 0.10, ema: 0.25, struct: 0.18, conf: 35 },
        'nse_index':       { stop: 0.28, trigger: 0.06, ema: 0.10, struct: 0.10, conf: 50 },
        'nse_stock':       { stop: 0.30, trigger: 0.08, ema: 0.12, struct: 0.12, conf: 45 },
        'nse_low_vol':     { stop: 0.35, trigger: 0.10, ema: 0.15, struct: 0.15, conf: 40 },
    };
    const d = defaults[instrumentType] || defaults['nse_stock'];
    return {
        stopOffsetRatio: d.stop,
        triggerOffsetRatio: d.trigger,
        emaTouchRatio: d.ema,
        stopOffsetRatioV2: parseFloat((d.stop + 0.05).toFixed(2)),
        triggerOffsetRatioV2: d.trigger,
        emaTouchRatioV2: parseFloat((d.ema - 0.03).toFixed(2)),
        structureOffsetRatio: d.struct,
        minConfidenceThreshold: d.conf,
        instrumentType,
    };
}

function classifyInstrument(instKey) {
    const highVolMCX = ['538685', '538686', '520702', '520703'];
    const metalsMCX = ['464150', '471726', '488788', '568831', '466583', '510764', '552721'];
    const baseMetalsMCX = ['568836', '568833', '568830'];
    const nseIndices = ['61093', '61088', '61091', '61092'];
    const nseLowVol = ['61304', '61209', '61108', '61274', '61286', '61298', '61265', '61285', '61215', '61214', '61128', '61170', '61310'];
    const id = instKey.includes('|') ? instKey.split('|')[1] : instKey;
    if (highVolMCX.includes(id)) return 'mCX_high_vol';
    if (metalsMCX.includes(id)) return 'mCX_metal';
    if (baseMetalsMCX.includes(id)) return 'mCX_base_metal';
    if (nseIndices.includes(id)) return 'nse_index';
    if (nseLowVol.includes(id)) return 'nse_low_vol';
    if (instKey.includes('NSE_FO') || instKey.includes('NSE_EQ')) return 'nse_stock';
    return 'mCX_metal';
}

// ─── Per-instrument processing ───────────────────────────────
async function processInstrument(instKey, instName, accessToken, lookback) {
    console.log(`\n📊 ${instName} (${instKey})`);

    // 1. Fetch candles
    let candlesRaw;
    try {
        candlesRaw = await fetchDailyCandles(instKey, accessToken);
    } catch (e) {
        console.log(`  ❌ API error: ${e.message}`);
        return null;
    }

    if (!candlesRaw || candlesRaw.length < lookback + 5) {
        console.log(`  ⚠️ Insufficient data: ${candlesRaw?.length || 0} candles (need ${lookback + 5})`);
        return null;
    }

    // 2. Parse candles (Upstox format: [timestamp, open, high, low, close, volume, oi])
    // Sorted newest-first by API — reverse to oldest-first
    const candles = [...candlesRaw].reverse();
    const lotMul = getLotMultiplier(instKey);
    const divisor = getVolumeDivisor(instKey);

    // Extract daily volume in lots
    const dailyVolumesLots = candles.map(c => {
        const rawVol = Number(c[5]) || 0;
        return rawVol / lotMul;
    });

    console.log(`  📈 ${dailyVolumesLots.length} daily candles | Avg vol: ${Math.round(dailyVolumesLots.reduce((a,b)=>a+b,0)/dailyVolumesLots.length).toLocaleString()} lots/day`);

    // 3. Compute thresholds for each day using sliding 14-day window
    const dateThresholds = {}; // "DD/MM/YY" → [10 values]
    let currentStaticThresholds = null;
    let currentDailyBarEstimates = null;
    let currentTier = null;

    for (let i = lookback; i < candles.length; i++) {
        const candle = candles[i];
        const dateKey = formatDateDDMMYY(candle[0]);
        const dateIso = formatDateISO(candle[0]);
        if (!dateKey || !dateIso) continue;

        // Preceding 'lookback' days (excluding current)
        const windowVolumes = dailyVolumesLots.slice(i - lookback, i);
        const projectedVol = projectVolume(windowVolumes, lookback);

        const avgVol = windowVolumes.reduce((a, b) => a + b, 0) / windowVolumes.length;
        const tier = getLiquidityTier(avgVol);
        const thresholds = generateThresholds(projectedVol, tier);

        dateThresholds[dateKey] = thresholds;

        // Keep track of most recent (today's) values for static_thresholds
        if (i === candles.length - 1) {
            currentStaticThresholds = thresholds;
            currentDailyBarEstimates = computeDailyBarEstimates(projectedVol, thresholds);
            currentTier = tier;
        }
    }

    // 4. Also compute for today (next trading day) using the full last 'lookback' days
    const recentVolumes = dailyVolumesLots.slice(-lookback);
    const todayProjectedVol = projectVolume(recentVolumes, lookback);
    const todayAvgVol = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const todayTier = getLiquidityTier(todayAvgVol);
    const todayThresholds = generateThresholds(todayProjectedVol, todayTier);

    // Today's date key (for the upcoming session)
    const today = new Date();
    const todayKey = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`;
    dateThresholds[todayKey] = todayThresholds;

    currentStaticThresholds = todayThresholds;
    currentDailyBarEstimates = computeDailyBarEstimates(todayProjectedVol, todayThresholds);
    currentTier = todayTier;

    const ratios = recommendRatios(classifyInstrument(instKey));

    console.log(`  ✅ ${Object.keys(dateThresholds).length} dates processed`);
    console.log(`  📐 Tier: ${currentTier.name} (${currentTier.minBars}-${currentTier.maxBars} bars/day)`);
    console.log(`  🎯 Today's thresholds: [${todayThresholds.join(', ')}]`);
    console.log(`  📏 Est bars: [${todayThresholds.map(t => currentDailyBarEstimates[t]).join(', ')}]`);

    return {
        instrument_key: instKey,
        name: instName,
        static_thresholds: currentStaticThresholds,
        thresholds: dateThresholds,
        daily_bar_estimates: currentDailyBarEstimates,
        recommended_ratios: ratios,
    };
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const lookbackIdx = args.indexOf('--lookback');
    const lookback = lookbackIdx !== -1 && args[lookbackIdx + 1] ? parseInt(args[lookbackIdx + 1], 10) : DEFAULT_LOOKBACK;

    console.log('═'.repeat(65));
    console.log('📊 Daily Volume Threshold Calibration Engine');
    console.log(`   Lookback: ${lookback} days | Target: 30-150 candles/day (tier-adjusted)`);
    console.log('═'.repeat(65));

    // Load existing build config
    let buildConfig = [];
    if (fs.existsSync(BUILD_CONFIG_PATH)) {
        try {
            buildConfig = JSON.parse(fs.readFileSync(BUILD_CONFIG_PATH, 'utf8'));
            console.log(`📂 Loaded build config: ${buildConfig.length} instruments`);
        } catch (e) {
            console.log('⚠️ Could not parse build-version-config.json, starting fresh');
        }
    }

    // Load instrument list from config.json
    let liveConfig = { instruments: [] };
    if (fs.existsSync(LIVE_CONFIG_PATH)) {
        try {
            liveConfig = JSON.parse(fs.readFileSync(LIVE_CONFIG_PATH, 'utf8'));
            console.log(`📋 Loaded live config: ${liveConfig.instruments?.length || 0} instruments`);
        } catch (e) {
            console.log('⚠️ Could not read config.json');
        }
    }

    const instruments = liveConfig.instruments || [];
    if (instruments.length === 0) {
        console.error('❌ No instruments found in config.json');
        process.exit(1);
    }

    // Auth
    let accessToken;
    try {
        accessToken = await getAccessToken();
        console.log('🔑 Authenticated with Upstox');
    } catch (e) {
        console.error(`❌ Auth error: ${e.message}`);
        process.exit(1);
    }

    // Process instruments
    const newBuildConfig = [];
    let updated = 0, failed = 0;

    for (const inst of instruments) {
        const result = await processInstrument(inst.key, inst.name, accessToken, lookback);

        if (!result) {
            failed++;
            // Preserve existing config for this instrument
            const existing = buildConfig.find(c => c.instrument_key === inst.key);
            if (existing) newBuildConfig.push(existing);
            continue;
        }

        // Merge with existing build config (preserve fields like thresholds if we want to keep history)
        const existing = buildConfig.find(c => c.instrument_key === result.instrument_key);

        const merged = {
            instrument_key: result.instrument_key,
            name: result.name,
            static_thresholds: result.static_thresholds,
            thresholds: result.thresholds, // full date→array map
            daily_bar_estimates: result.daily_bar_estimates,
            recommended_ratios: result.recommended_ratios,
        };

        // Preserve any fields from existing that we don't regenerate
        if (existing) {
            // Keep old date entries that we didn't regenerate (dates beyond our lookback)
            if (existing.thresholds && typeof existing.thresholds === 'object') {
                for (const [dateKey, val] of Object.entries(existing.thresholds)) {
                    if (!merged.thresholds[dateKey]) {
                        // Migrate legacy single-value to array if needed
                        if (typeof val === 'number' && existing.static_thresholds) {
                            merged.thresholds[dateKey] = existing.static_thresholds;
                        } else if (Array.isArray(val)) {
                            merged.thresholds[dateKey] = val;
                        }
                    }
                }
            }
        }

        newBuildConfig.push(merged);
        updated++;

        // Update live config volumePerBar
        const liveInst = liveConfig.instruments.find(i => i.key === result.instrument_key);
        if (liveInst) {
            liveInst.volumePerBar = result.static_thresholds;
            // Also update ratio values
            if (result.recommended_ratios) {
                liveInst.stopOffsetRatio = result.recommended_ratios.stopOffsetRatio;
                liveInst.triggerOffsetRatio = result.recommended_ratios.triggerOffsetRatio;
                liveInst.emaTouchRatio = result.recommended_ratios.emaTouchRatio;
                liveInst.stopOffsetRatioV2 = result.recommended_ratios.stopOffsetRatioV2;
                liveInst.triggerOffsetRatioV2 = result.recommended_ratios.triggerOffsetRatioV2;
                liveInst.emaTouchRatioV2 = result.recommended_ratios.emaTouchRatioV2;
                liveInst.structureOffsetRatio = result.recommended_ratios.structureOffsetRatio;
            }
        }
    }

    // Preserve instruments not in live config
    for (const existing of buildConfig) {
        if (!newBuildConfig.find(c => c.instrument_key === existing.instrument_key)) {
            newBuildConfig.push(existing);
        }
    }

    // Write outputs
    fs.writeFileSync(BUILD_CONFIG_PATH, JSON.stringify(newBuildConfig, null, 2));
    console.log(`\n📄 Updated build-version-config.json (${newBuildConfig.length} instruments)`);

    fs.writeFileSync(LIVE_CONFIG_PATH, JSON.stringify(liveConfig, null, 4));
    console.log(`📄 Updated config.json (${liveConfig.instruments.length} instruments)`);

    // Summary
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`✅ Done! ${updated} updated, ${failed} failed`);
    console.log(`${'═'.repeat(65)}`);

    console.log('\n📊 Threshold Summary:');
    console.log('─'.repeat(100));
    console.log(`${'Instrument'.padEnd(32)} ${'Tier'.padEnd(16)} ${'Today Thresholds'.padEnd(36)} ${'Est Bars'.padEnd(14)}`);
    console.log('─'.repeat(100));
    for (const r of newBuildConfig) {
        if (!r.static_thresholds || !r.daily_bar_estimates) continue;
        const t = r.static_thresholds;
        const tier = r.recommended_ratios?.instrumentType || 'N/A';
        const estBars = t.map(th => r.daily_bar_estimates[th] || '?').join(',');
        console.log(
            `${(r.name || r.instrument_key).padEnd(32)} ` +
            `${tier.padEnd(16)} ` +
            `${`[${t.slice(0, 5).join(',')}...]`.padEnd(36)} ` +
            `${`[${estBars.split(',').slice(0, 5).join(',')}...]`.padEnd(14)}`
        );
    }
}

main().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});