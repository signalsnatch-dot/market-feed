#!/usr/bin/env node
/**
 * computeDailyVolumeThresholds.js — Enhanced Volume Threshold Engine v2
 *
 * Modes:
 *   --premarket    (default) Pre-market: compute thresholds from historical daily candles.
 *                            Uses rolling median, day-of-week adjustment, expiry detection.
 *   --adjust-10am  Post-open adjustment: fetch 1h intraday volume, compare to projection,
 *                   update config.json if deviation > 20%.
 *   --check        On-demand: fetch partial-day volume, project remaining, update if needed.
 *                   Accepts --time HH:MM (default: now).
 *   --profile      Build volume-profile.json (firstHourPct, time-of-day curve, DOW factors)
 *                   from last N days of intraday data. Run once, refresh weekly.
 *
 * Usage:
 *   node scripts/computeDailyVolumeThresholds.js --premarket [--lookback 14]
 *   node scripts/computeDailyVolumeThresholds.js --adjust-10am
 *   node scripts/computeDailyVolumeThresholds.js --check [--time 14:30]
 *   node scripts/computeDailyVolumeThresholds.js --profile [--lookback 10]
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// ─── Constants ──────────────────────────────────────────────
const BUILD_CONFIG_PATH = path.resolve(__dirname, '..', 'build-version-config.json');
const LIVE_CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');
const VOLUME_PROFILE_PATH = path.resolve(__dirname, '..', 'volume-profiles.json');
const ADJUSTMENT_LOG_PATH = path.resolve(__dirname, '..', 'logs', 'threshold_adjustments.log');
const DEFAULT_LOOKBACK = 14;
const ADJUSTMENT_THRESHOLD = 0.20;  // 20% deviation triggers adjustment
const ADJUSTMENT_CAP = 0.30;        // Cap adjustment at ±30% of premarket estimate

// ─── CLI args ───────────────────────────────────────────────
const args = process.argv.slice(2);
const MODE = args.includes('--adjust-10am') ? 'adjust-10am' :
             args.includes('--check') ? 'check' :
             args.includes('--profile') ? 'profile' : 'premarket';
const lookbackIdx = args.indexOf('--lookback');
const LOOKBACK = lookbackIdx !== -1 && args[lookbackIdx + 1] ? parseInt(args[lookbackIdx + 1], 10) : DEFAULT_LOOKBACK;
const timeIdx = args.indexOf('--time');
const CHECK_TIME = timeIdx !== -1 && args[timeIdx + 1] ? args[timeIdx + 1] : null;

// ─── Lot multipliers & helpers ──────────────────────────────
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

function getLiquidityTier(avgDailyVolumeLots) {
    if (avgDailyVolumeLots > 5000) return { name: 'high', minBars: 80, maxBars: 150 };
    if (avgDailyVolumeLots >= 500) return { name: 'medium', minBars: 80, maxBars: 120 };
    return { name: 'low', minBars: 80, maxBars: 120 };
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
        stopOffsetRatio: d.stop, triggerOffsetRatio: d.trigger, emaTouchRatio: d.ema,
        stopOffsetRatioV2: parseFloat((d.stop + 0.05).toFixed(2)),
        triggerOffsetRatioV2: d.trigger,
        emaTouchRatioV2: parseFloat((d.ema - 0.03).toFixed(2)),
        structureOffsetRatio: d.struct, minConfidenceThreshold: d.conf, instrumentType,
    };
}

function formatDateDDMMYY(dateVal) {
    let d;
    if (typeof dateVal === 'string') d = new Date(dateVal);
    else d = new Date(Number(dateVal));
    if (isNaN(d.getTime())) return null;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

function formatDateISO(dateVal) {
    let d;
    if (typeof dateVal === 'string') d = new Date(dateVal);
    else d = new Date(Number(dateVal));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

function getTodayKey() {
    const today = new Date();
    return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`;
}

function getTodayISO() {
    return new Date().toISOString().split('T')[0];
}

// ─── Auth ────────────────────────────────────────────────────
async function getAccessToken() {
    if (process.env.UPSTOX_ACCESS_TOKEN) return process.env.UPSTOX_ACCESS_TOKEN;
    try {
        const AuthManager = require('../auth-manager');
        const auth = new AuthManager({
            apiKey: process.env.UPSTOX_API_KEY, apiSecret: process.env.UPSTOX_API_SECRET,
            redirectUri: process.env.UPSTOX_REDIRECT_URI, analyticsToken: process.env.UPSTOX_ANALYTICS_TOKEN,
            authCode: process.env.UPSTOX_AUTH_CODE, dataDir: path.resolve(__dirname, '..', 'market_data'),
        });
        return await auth.getValidAccessToken();
    } catch (e) {
        console.warn('⚠️ AuthManager failed.');
    }
    throw new Error('No access token available.');
}

// ─── Upstox API ─────────────────────────────────────────────
async function fetchDailyCandles(instKey, accessToken) {
    const toDate = new Date().toISOString().split('T')[0];
    const fromDateObj = new Date();
    fromDateObj.setDate(fromDateObj.getDate() - 90);
    const fromDate = fromDateObj.toISOString().split('T')[0];
    const encodedKey = encodeURIComponent(instKey);
    const headers = { 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}` };

    // Try multiple URL formats — NSE and MCX may differ
    const urls = [
        `https://api.upstox.com/v3/historical-candle/${encodedKey}/days/1/${toDate}/${fromDate}`,
        `https://api.upstox.com/v2/historical-candle/${encodedKey}/day/${toDate}/${fromDate}`,
        `https://api.upstox.com/v2/historical-candle/${encodedKey}/1day/${toDate}/${fromDate}`,
    ];

    for (const url of urls) {
        try {
            const resp = await axios.get(url, { headers, timeout: 15000 });
            if (resp.data?.status === 'success' && Array.isArray(resp.data.data?.candles)) {
                return resp.data.data.candles;
            }
        } catch (e) {
            // Try next URL
        }
    }
    return null; // Return null — caller handles gracefully
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchIntradayCandles(instKey, accessToken, interval = '30minute', dateIso = null) {
    const toDate = dateIso || getTodayISO();
    const fromDate = toDate;
    const encodedKey = encodeURIComponent(instKey);
    const headers = { 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}` };

    // Try multiple URL formats since MCX and NSE may differ.
    // Upstox uses different segment identifiers in paths for different exchanges.
    // Also try alternative date format (IN timezone) if needed.

    const todayIST = toDate; // already in YYYY-MM-DD
    // For intraday, some API endpoints need fromDate < toDate (not equal)
    const yesterdayIST = new Date();
    yesterdayIST.setDate(yesterdayIST.getDate() - 1);
    const fromDateAlt = yesterdayIST.toISOString().split('T')[0];

    const urls = [
        // v2 with same from/to
        `https://api.upstox.com/v2/historical-candle/${encodedKey}/${interval}/${toDate}/${fromDate}`,
        // v3 with same from/to
        `https://api.upstox.com/v3/historical-candle/${encodedKey}/${interval}/${toDate}/${fromDate}`,
        // v2 with yesterday as from date (some APIs need from < to)
        `https://api.upstox.com/v2/historical-candle/${encodedKey}/${interval}/${toDate}/${fromDateAlt}`,
        // v3 with yesterday as from date
        `https://api.upstox.com/v3/historical-candle/${encodedKey}/${interval}/${toDate}/${fromDateAlt}`,
    ];

    // For profile mode (non-today dates), try more variants
    if (dateIso) {
        urls.unshift(
            `https://api.upstox.com/v2/historical-candle/${encodedKey}/${interval}/${toDate}/${fromDateAlt}`,
            `https://api.upstox.com/v3/historical-candle/${encodedKey}/${interval}/${toDate}/${fromDateAlt}`,
        );
    }

    let lastError = null;
    for (const url of urls) {
        try {
            const resp = await axios.get(url, { headers, timeout: 15000 });
            if (resp.data?.status === 'success' && Array.isArray(resp.data.data?.candles)) {
                return resp.data.data.candles;
            }
            lastError = `status=${resp.data?.status}, code=${resp.status}`;
        } catch (e) {
            lastError = e.response?.status ? `HTTP ${e.response.status}` : e.message;
        }
    }
    // Log the last attempt for debugging
    if (lastError) {
        const shortName = instKey.includes('|') ? instKey.split('|').slice(1).join('|') : instKey;
        console.log(`  ℹ️ ${shortName}: intraday fetch failed (${lastError}) — tried ${urls.length} URL formats`);
    }
    return null; // Return null — caller handles gracefully
}

// ─── Math helpers ───────────────────────────────────────────
function rollingMedian(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function linearRegressionSlope(values) {
    const n = values.length;
    if (n < 3) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) { sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i; }
    const denom = n * sumX2 - sumX * sumX;
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function isExpiryDay(dateIso, instrumentKey) {
    // NSE F&O expiry: last Thursday of the month
    // MCX expiry: various dates. We use a simple approximation.
    const d = new Date(dateIso);
    const day = d.getDay(); // 0=Sun, 4=Thu
    const date = d.getDate();
    // Last Thursday check
    const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (day === 4 && date > lastDayOfMonth - 7) return true;
    return false;
}

function getDayOfWeek(dateIso) {
    const d = new Date(dateIso);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

// ─── Volume projection (enhanced) ───────────────────────────
function projectVolumeEnhanced(values, dates, volumeProfile) {
    const recent = values.slice(-LOOKBACK);
    const recentDates = dates.slice(-LOOKBACK);
    const median = rollingMedian(recent);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const slope = linearRegressionSlope(recent);

    // 1. Start with a blend of median and mean (median is more robust to outliers)
    let baseProjection = median * 0.6 + avg * 0.4;

    // 2. Trend adjustment
    if (slope > 0) {
        const growthRate = Math.min(slope / avg || 0, 0.30);
        baseProjection *= (1 + growthRate);
    } else if (slope < 0) {
        const declineRate = Math.min(Math.abs(slope) / avg || 0, 0.20);
        baseProjection *= (1 - declineRate);
    }

    // 3. Day-of-week adjustment
    if (volumeProfile && volumeProfile.dayOfWeekFactor) {
        const today = getTodayISO();
        const dow = getDayOfWeek(today);
        const dowFactor = volumeProfile.dayOfWeekFactor[dow] || 1.0;
        baseProjection *= dowFactor;
    }

    // 4. Expiry day adjustment
    const today = getTodayISO();
    if (isExpiryDay(today, '')) {
        baseProjection *= 1.25; // 25% volume spike on expiry
    }

    return Math.round(baseProjection);
}

// ─── Threshold generation ────────────────────────────────────
function generateThresholds(projectedVolLots, tier) {
    const { minBars, maxBars } = tier;
    const thresholds = [];
    const step = (maxBars - minBars) / 9;
    for (let i = 0; i < 10; i++) {
        const targetBars = Math.round(minBars + step * i);
        thresholds.push(Math.max(1, Math.round(projectedVolLots / targetBars)));
    }
    thresholds.sort((a, b) => a - b);
    for (let i = 1; i < thresholds.length; i++) {
        if (thresholds[i] <= thresholds[i - 1]) thresholds[i] = thresholds[i - 1] + 1;
    }
    return thresholds;
}

function computeDailyBarEstimates(projectedVolLots, thresholds) {
    const estimates = {};
    for (const t of thresholds) estimates[t] = Math.round(projectedVolLots / t);
    return estimates;
}

// ─── Adjustment functions ────────────────────────────────────
function shouldAdjust(newProjection, currentThresholds, projectedVolLots) {
    const midCurrent = currentThresholds[Math.floor(currentThresholds.length / 2)];
    const tier = getLiquidityTier(projectedVolLots);
    const newThresholds = generateThresholds(newProjection, tier);
    const midNew = newThresholds[Math.floor(newThresholds.length / 2)];
    const deviation = Math.abs(midNew - midCurrent) / Math.max(midCurrent, 1);
    return { should: deviation > ADJUSTMENT_THRESHOLD, deviation, newThresholds, midCurrent, midNew };
}

function logAdjustment(instKey, instName, reason, oldThresholds, newThresholds, projectedVol, newProjectedVol) {
    const ts = new Date().toISOString();
    const entry = {
        timestamp: ts, instrument: instKey, name: instName, reason,
        oldMidThreshold: oldThresholds[Math.floor(oldThresholds.length / 2)],
        newMidThreshold: newThresholds[Math.floor(newThresholds.length / 2)],
        projectedVol, newProjectedVol, oldThresholds, newThresholds,
    };
    try {
        fs.mkdirSync(path.dirname(ADJUSTMENT_LOG_PATH), { recursive: true });
        fs.appendFileSync(ADJUSTMENT_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch (e) { /* ignore */ }
    console.log(`  📝 Logged adjustment: ${instName} — ${reason}`);
}

// ─── Volume Profile Builder ─────────────────────────────────
// Since Upstox intraday historical APIs are unreliable for MCX/NSE,
// we build profiles from daily candle patterns + market heuristics.
function buildVolumeProfileHeuristic(instKey, dailyVolumesLots, dates) {
    const recent = dailyVolumesLots.slice(-LOOKBACK);
    const avgVol = recent.reduce((a, b) => a + b, 0) / recent.length;

    // Check if it's an MCX instrument (trades 9:00-23:30) or NSE (9:15-15:30)
    const isMCX = instKey.includes('MCX_FO');
    const isNSE_EQ = instKey.includes('NSE_EQ');

    // First-hour proportion (based on typical market patterns)
    // NSE: first hour ~12-18% of daily volume (opening volatility)
    // MCX: first hour ~8-12% (commodities open slower, global overlap in evening)
    let firstHourPct = isMCX ? 0.10 : isNSE_EQ ? 0.14 : 0.14;

    // Time-of-day cumulative volume curve (heuristic based on market structure)
    const timeProfile = {};
    if (isMCX) {
        // MCX: 9:00 AM - 11:30 PM (870 minutes). Slow morning, peaks in evening.
        // Cumulative percentages at key times:
        const mcxCurve = [
            ['09:45', 0.03], ['10:15', 0.07], ['10:45', 0.10], ['11:15', 0.13],
            ['11:45', 0.16], ['12:15', 0.19], ['12:45', 0.22], ['13:15', 0.25],
            ['13:45', 0.28], ['14:15', 0.31], ['14:45', 0.34], ['15:15', 0.37],
            ['15:45', 0.40], ['16:15', 0.43], ['16:45', 0.46], ['17:15', 0.50],
            ['17:45', 0.54], ['18:15', 0.58], ['18:45', 0.62], ['19:15', 0.66],
            ['19:45', 0.70], ['20:15', 0.74], ['20:45', 0.78], ['21:15', 0.82],
            ['21:45', 0.86], ['22:15', 0.90], ['22:45', 0.94], ['23:15', 0.98],
            ['23:30', 1.00],
        ];
        for (const [t, p] of mcxCurve) timeProfile[t] = p;
    } else {
        // NSE: 9:15 AM - 3:30 PM (375 minutes). Bell-shaped volume curve.
        const nseCurve = [
            ['09:45', 0.06], ['10:15', 0.14], ['10:45', 0.22], ['11:15', 0.29],
            ['11:45', 0.36], ['12:15', 0.42], ['12:45', 0.47], ['13:15', 0.52],
            ['13:45', 0.57], ['14:15', 0.64], ['14:45', 0.73], ['15:15', 0.85],
            ['15:30', 1.00],
        ];
        for (const [t, p] of nseCurve) timeProfile[t] = p;
    }

    return { firstHourPct, timeProfile, totalVol: avgVol, isHeuristic: true };
}

async function buildDayOfWeekProfile(instKey, accessToken) {
    const candles = await fetchDailyCandles(instKey, accessToken);
    if (!candles || candles.length < LOOKBACK * 2) return null;

    const volumes = candles.map(c => Number(c[5]) || 0);
    const dates = candles.map(c => formatDateISO(c[0])).filter(d => d);
    const lotMul = getLotMultiplier(instKey);
    const dailyLots = volumes.map(v => v / lotMul);

    const dowBuckets = { 'Mon': [], 'Tue': [], 'Wed': [], 'Thu': [], 'Fri': [] };
    for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        const dow = getDayOfWeek(d);
        if (dowBuckets[dow] != null && dailyLots[i] > 0) {
            dowBuckets[dow].push(dailyLots[i]);
        }
    }

    const grandAvg = dailyLots.filter(v => v > 0).reduce((a, b) => a + b, 0) / dailyLots.filter(v => v > 0).length;
    const factors = {};
    for (const [dow, vals] of Object.entries(dowBuckets)) {
        if (vals.length >= 2) {
            factors[dow] = (vals.reduce((a, b) => a + b, 0) / vals.length) / grandAvg;
        } else {
            factors[dow] = 1.0;
        }
    }
    return factors;
}

// ─── Per-instrument processing (premarket) ──────────────────
async function processInstrumentPremarket(instKey, instName, accessToken, volumeProfiles) {
    console.log(`\n📊 ${instName} (${instKey})`);

    let candlesRaw;
    try { candlesRaw = await fetchDailyCandles(instKey, accessToken); }
    catch (e) { console.log(`  ❌ API error: ${e.message}`); return null; }

    if (!candlesRaw || candlesRaw.length < LOOKBACK + 5) {
        console.log(`  ⚠️ Insufficient data: ${candlesRaw?.length || 0} candles`);
        return null;
    }

    const candles = [...candlesRaw].reverse();
    const lotMul = getLotMultiplier(instKey);
    const dailyVolumesLots = candles.map(c => Number(c[5]) / lotMul);
    const dates = candles.map(c => formatDateISO(c[0])).filter(d => d);

    console.log(`  📈 ${dailyVolumesLots.length} daily candles | Median vol: ${Math.round(rollingMedian(dailyVolumesLots.slice(-LOOKBACK))).toLocaleString()} lots/day`);

    const dateThresholds = {};
    const volumeHistory = [];

    for (let i = LOOKBACK; i < candles.length; i++) {
        const candle = candles[i];
        const dateKey = formatDateDDMMYY(candle[0]);
        const dateIso = formatDateISO(candle[0]);
        if (!dateKey || !dateIso) continue;

        const windowVolumes = dailyVolumesLots.slice(i - LOOKBACK, i);
        const projectedVol = projectVolumeEnhanced(windowVolumes, dates.slice(i - LOOKBACK, i), volumeProfiles);
        const avgVol = windowVolumes.reduce((a, b) => a + b, 0) / windowVolumes.length;
        const tier = getLiquidityTier(avgVol);
        const thresholds = generateThresholds(projectedVol, tier);
        dateThresholds[dateKey] = thresholds;

        if (i >= LOOKBACK) {
            volumeHistory.push({ date: dateIso, volume: Math.round(windowVolumes[windowVolumes.length - 1]), dayOfWeek: getDayOfWeek(dateIso) });
        }
    }

    // Today's projection
    const recentVolumes = dailyVolumesLots.slice(-LOOKBACK);
    const todayProjectedVol = projectVolumeEnhanced(recentVolumes, dates.slice(-LOOKBACK), volumeProfiles);
    const todayAvgVol = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const todayTier = getLiquidityTier(todayAvgVol);
    const todayThresholds = generateThresholds(todayProjectedVol, todayTier);
    const todayKey = getTodayKey();
    dateThresholds[todayKey] = todayThresholds;

    const dailyBarEstimates = computeDailyBarEstimates(todayProjectedVol, todayThresholds);
    const ratios = recommendRatios(classifyInstrument(instKey));

    console.log(`  ✅ ${Object.keys(dateThresholds).length} dates | Tier: ${todayTier.name}`);
    console.log(`  🎯 Today thresholds: [${todayThresholds.join(', ')}]`);

    return {
        instrument_key: instKey, name: instName,
        static_thresholds: todayThresholds,
        thresholds: dateThresholds,
        daily_bar_estimates: dailyBarEstimates,
        volume_history: volumeHistory.slice(-LOOKBACK),
        projected_vol_lots: todayProjectedVol,
        last_updated: new Date().toISOString(),
        recommended_ratios: ratios,
    };
}

// ─── Per-instrument processing (10am adjustment) ────────────
async function adjustInstrumentAt10am(instKey, instName, accessToken, existingEntry) {
    const lotMul = getLotMultiplier(instKey);
    const intradayCandles = await fetchIntradayCandles(instKey, accessToken);
    if (!intradayCandles || intradayCandles.length < 2) {
        console.log(`  ⚠️ ${instName}: No intraday data yet`);
        return null;
    }

    // First 2 candles = ~1h (9:15-10:15)
    const firstHourRawVol = intradayCandles.slice(0, 2).reduce((s, c) => s + (Number(c[5]) || 0), 0);
    const firstHourLots = firstHourRawVol / lotMul;

    const profile = existingEntry.volume_profile || {};
    const firstHourPct = profile.firstHourPct || 0.12; // default ~12%
    const projectedFull = firstHourLots / firstHourPct;

    // Compare to current estimate
    const currentThresholds = existingEntry.static_thresholds || [];
    const currentProjected = existingEntry.projected_vol_lots || projectedFull;
    const { should, deviation, newThresholds } = shouldAdjust(projectedFull, currentThresholds, projectedFull);

    console.log(`  📊 ${instName}: 1h=${firstHourLots.toLocaleString()} lots (${(firstHourPct*100).toFixed(0)}% expected) → projected=${Math.round(projectedFull).toLocaleString()} (deviation: ${(deviation*100).toFixed(1)}%)`);

    if (should) {
        // Cap adjustment
        const cappedProjection = currentProjected + Math.min(Math.max(projectedFull - currentProjected, -currentProjected * ADJUSTMENT_CAP), currentProjected * ADJUSTMENT_CAP);
        const tier = getLiquidityTier(cappedProjection);
        const cappedThresholds = generateThresholds(Math.round(cappedProjection), tier);
        logAdjustment(instKey, instName, `10am: 1h=${Math.round(firstHourLots)} lots, dev=${(deviation*100).toFixed(0)}%`, currentThresholds, cappedThresholds, currentProjected, Math.round(cappedProjection));

        return {
            newThresholds: cappedThresholds,
            newProjectedVol: Math.round(cappedProjection),
            dailyBarEstimates: computeDailyBarEstimates(Math.round(cappedProjection), cappedThresholds),
            deviation, reason: '10am_adjustment',
        };
    }

    return { noChange: true };
}

// ─── Per-instrument processing (on-demand check) ────────────
async function checkInstrumentOnDemand(instKey, instName, accessToken, existingEntry, checkTime) {
    const lotMul = getLotMultiplier(instKey);
    const candles = await fetchIntradayCandles(instKey, accessToken);
    if (!candles || candles.length < 2) {
        console.log(`  ⚠️ ${instName}: No intraday data`);
        return null;
    }

    const profile = existingEntry.volume_profile;
    if (!profile || !profile.timeProfile) {
        console.log(`  ⚠️ ${instName}: No volume profile available for time-based projection`);
        return null;
    }

    // Compute current cumulative volume
    const totalSoFar = candles.reduce((s, c) => s + (Number(c[5]) || 0), 0) / lotMul;

    // Find closest time in profile
    const profileKeys = Object.keys(profile.timeProfile).sort();
    let closestKey = profileKeys[0];
    if (checkTime) {
        for (const k of profileKeys) {
            if (k <= checkTime) closestKey = k;
        }
    } else {
        closestKey = profileKeys[profileKeys.length - 1];
    }

    const expectedPct = profile.timeProfile[closestKey] || profileKeys.length > 0 ? profile.timeProfile[profileKeys[profileKeys.length - 1]] : 0.8;
    const projectedFull = expectedPct > 0 ? totalSoFar / expectedPct : totalSoFar * 1.5;

    const currentThresholds = existingEntry.static_thresholds || [];
    const currentProjected = existingEntry.projected_vol_lots || projectedFull;
    const { should, deviation, newThresholds } = shouldAdjust(projectedFull, currentThresholds, projectedFull);

    console.log(`  📊 ${instName}: So far=${Math.round(totalSoFar).toLocaleString()} lots (${(expectedPct*100).toFixed(0)}% expected @${closestKey}) → projected=${Math.round(projectedFull).toLocaleString()} (dev: ${(deviation*100).toFixed(1)}%)`);

    if (should) {
        const cappedProjection = currentProjected + Math.min(Math.max(projectedFull - currentProjected, -currentProjected * ADJUSTMENT_CAP), currentProjected * ADJUSTMENT_CAP);
        const tier = getLiquidityTier(cappedProjection);
        const cappedThresholds = generateThresholds(Math.round(cappedProjection), tier);
        logAdjustment(instKey, instName, `check @${checkTime || 'now'}: dev=${(deviation*100).toFixed(0)}%`, currentThresholds, cappedThresholds, currentProjected, Math.round(cappedProjection));

        return {
            newThresholds: cappedThresholds,
            newProjectedVol: Math.round(cappedProjection),
            dailyBarEstimates: computeDailyBarEstimates(Math.round(cappedProjection), cappedThresholds),
            deviation, reason: `check_${checkTime || 'now'}`,
        };
    }

    return { noChange: true };
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
    console.log('═'.repeat(65));
    console.log(`📊 Volume Threshold Engine v2 — Mode: ${MODE}`);
    console.log(`   Lookback: ${LOOKBACK} days${MODE === 'check' && CHECK_TIME ? ` | Check time: ${CHECK_TIME}` : ''}`);
    console.log('═'.repeat(65));

    // Load configs
    let buildConfig = [];
    if (fs.existsSync(BUILD_CONFIG_PATH)) {
        try { buildConfig = JSON.parse(fs.readFileSync(BUILD_CONFIG_PATH, 'utf8')); }
        catch (e) { console.log('⚠️ Could not parse build-version-config.json'); }
    }
    let liveConfig = { instruments: [] };
    if (fs.existsSync(LIVE_CONFIG_PATH)) {
        try { liveConfig = JSON.parse(fs.readFileSync(LIVE_CONFIG_PATH, 'utf8')); }
        catch (e) { console.log('⚠️ Could not read config.json'); }
    }
    const instruments = liveConfig.instruments || [];
    if (instruments.length === 0) { console.error('❌ No instruments in config.json'); process.exit(1); }

    // Auth
    let accessToken;
    try { accessToken = await getAccessToken(); console.log('🔑 Authenticated'); }
    catch (e) { console.error(`❌ Auth error: ${e.message}`); process.exit(1); }

    // Load volume profiles
    let volumeProfiles = {};
    if (fs.existsSync(VOLUME_PROFILE_PATH)) {
        try { volumeProfiles = JSON.parse(fs.readFileSync(VOLUME_PROFILE_PATH, 'utf8')); }
        catch (e) { /* ignore */ }
    }

    // ─── MODE: profile ───────────────────────────────────────
    if (MODE === 'profile') {
        console.log('\n📊 Building volume profiles from daily candle data + heuristics...\n');
        const profiles = {};
        for (const inst of instruments) {
            console.log(`${inst.name}...`);
            const dowFactors = await buildDayOfWeekProfile(inst.key, accessToken);
            // Build heuristic profile from daily volumes if available
            let profile = null;
            try {
                const candlesRaw = await fetchDailyCandles(inst.key, accessToken);
                if (candlesRaw && candlesRaw.length > LOOKBACK) {
                    const candles = [...candlesRaw].reverse();
                    const lotMul = getLotMultiplier(inst.key);
                    const dailyVolumesLots = candles.map(c => Number(c[5]) / lotMul);
                    const dates = candles.map(c => formatDateISO(c[0])).filter(d => d);
                    profile = buildVolumeProfileHeuristic(inst.key, dailyVolumesLots, dates);
                }
            } catch (e) { /* ignore */ }
            if (profile) {
                profiles[inst.key] = { ...profile, dayOfWeekFactor: dowFactors || {} };
                console.log(`  ✅ 1h pct: ${(profile.firstHourPct*100).toFixed(1)}% (heuristic) | dailyVol: ~${Math.round(profile.totalVol).toLocaleString()} lots | DOW: ${JSON.stringify(dowFactors)}`);
            } else {
                console.log(`  ⚠️ No daily data available`);
            }
        }
        fs.writeFileSync(VOLUME_PROFILE_PATH, JSON.stringify(profiles, null, 2));
        console.log(`\n📄 Wrote volume-profiles.json (${Object.keys(profiles).length} instruments)`);
        return;
    }

    // ─── MODE: premarket ─────────────────────────────────────
    if (MODE === 'premarket') {
        const newBuildConfig = [];
        let adjustedCount = 0;
        for (const inst of instruments) {
            const entry = await processInstrumentPremarket(inst.key, inst.name, accessToken, volumeProfiles[inst.key]);
            if (!entry) {
                const existing = buildConfig.find(c => c.instrument_key === inst.key);
                if (existing) newBuildConfig.push(existing);
                continue;
            }

            // Attach volume profile if available
            if (volumeProfiles[inst.key]) entry.volume_profile = volumeProfiles[inst.key];

            const existing = buildConfig.find(c => c.instrument_key === entry.instrument_key);
            const merged = { ...entry };
            if (existing) {
                if (existing.thresholds && typeof existing.thresholds === 'object') {
                    for (const [k, v] of Object.entries(existing.thresholds)) {
                        if (!merged.thresholds[k]) merged.thresholds[k] = Array.isArray(v) ? v : existing.static_thresholds;
                    }
                }
            }

            newBuildConfig.push(merged);
            adjustedCount++;

            // Update live config
            const liveInst = liveConfig.instruments.find(i => i.key === entry.instrument_key);
            if (liveInst) {
                liveInst.volumePerBar = entry.static_thresholds;
                if (entry.recommended_ratios) {
                    const r = entry.recommended_ratios;
                    liveInst.stopOffsetRatio = r.stopOffsetRatio;
                    liveInst.triggerOffsetRatio = r.triggerOffsetRatio;
                    liveInst.emaTouchRatio = r.emaTouchRatio;
                    liveInst.stopOffsetRatioV2 = r.stopOffsetRatioV2;
                    liveInst.triggerOffsetRatioV2 = r.triggerOffsetRatioV2;
                    liveInst.emaTouchRatioV2 = r.emaTouchRatioV2;
                    liveInst.structureOffsetRatio = r.structureOffsetRatio;
                }
            }
        }

        for (const existing of buildConfig) {
            if (!newBuildConfig.find(c => c.instrument_key === existing.instrument_key)) newBuildConfig.push(existing);
        }

        fs.writeFileSync(BUILD_CONFIG_PATH, JSON.stringify(newBuildConfig, null, 2));
        console.log(`\n📄 Updated build-version-config.json (${newBuildConfig.length} instruments)`);
        fs.writeFileSync(LIVE_CONFIG_PATH, JSON.stringify(liveConfig, null, 4));
        console.log(`📄 Updated config.json`);
        printSummary(newBuildConfig);
        return;
    }

    // ─── MODE: adjust-10am ──────────────────────────────────
    if (MODE === 'adjust-10am') {
        let adjustedCount = 0;
        for (const inst of instruments) {
            const existing = buildConfig.find(c => c.instrument_key === inst.key);
            if (!existing || !existing.static_thresholds) {
                console.log(`  ⚠️ ${inst.name}: No premarket thresholds, skipping`);
                continue;
            }
            const result = await adjustInstrumentAt10am(inst.key, inst.name, accessToken, existing);
            if (!result || result.noChange) continue;

            // Update config.json
            const liveInst = liveConfig.instruments.find(i => i.key === inst.key);
            if (liveInst) liveInst.volumePerBar = result.newThresholds;

            // Update build config static thresholds for today
            existing.static_thresholds = result.newThresholds;
            existing.projected_vol_lots = result.newProjectedVol;
            existing.daily_bar_estimates = result.dailyBarEstimates;
            existing.last_adjusted = new Date().toISOString();
            if (existing.thresholds) existing.thresholds[getTodayKey()] = result.newThresholds;

            adjustedCount++;
        }

        if (adjustedCount > 0) {
            fs.writeFileSync(BUILD_CONFIG_PATH, JSON.stringify(buildConfig, null, 2));
            fs.writeFileSync(LIVE_CONFIG_PATH, JSON.stringify(liveConfig, null, 4));
        }
        console.log(`\n✅ 10am adjustment: ${adjustedCount} instruments updated`);
        return;
    }

    // ─── MODE: check ─────────────────────────────────────────
    if (MODE === 'check') {
        let adjustedCount = 0;
        for (const inst of instruments) {
            const existing = buildConfig.find(c => c.instrument_key === inst.key);
            if (!existing || !existing.static_thresholds) {
                console.log(`  ⚠️ ${inst.name}: No premarket thresholds, skipping`);
                continue;
            }
            const result = await checkInstrumentOnDemand(inst.key, inst.name, accessToken, existing, CHECK_TIME);
            if (!result || result.noChange) continue;

            const liveInst = liveConfig.instruments.find(i => i.key === inst.key);
            if (liveInst) liveInst.volumePerBar = result.newThresholds;

            existing.static_thresholds = result.newThresholds;
            existing.projected_vol_lots = result.newProjectedVol;
            existing.daily_bar_estimates = result.dailyBarEstimates;
            existing.last_adjusted = new Date().toISOString();
            if (existing.thresholds) existing.thresholds[getTodayKey()] = result.newThresholds;

            adjustedCount++;
        }

        if (adjustedCount > 0) {
            fs.writeFileSync(BUILD_CONFIG_PATH, JSON.stringify(buildConfig, null, 2));
            fs.writeFileSync(LIVE_CONFIG_PATH, JSON.stringify(liveConfig, null, 4));
        }
        console.log(`\n✅ On-demand check: ${adjustedCount} instruments updated`);
        return;
    }
}

function printSummary(config) {
    console.log('\n📊 Threshold Summary:');
    console.log('─'.repeat(100));
    console.log(`${'Instrument'.padEnd(32)} ${'Tier'.padEnd(16)} ${'Today Thresholds'.padEnd(36)} ${'Est Bars'.padEnd(14)}`);
    console.log('─'.repeat(100));
    for (const r of config) {
        if (!r.static_thresholds || !r.daily_bar_estimates) continue;
        const t = r.static_thresholds;
        const tier = r.recommended_ratios?.instrumentType || 'N/A';
        const estBars = t.map(th => r.daily_bar_estimates[th] || '?').join(',');
        console.log(`${(r.name || r.instrument_key).padEnd(32)} ${tier.padEnd(16)} ${`[${t.slice(0, 5).join(',')}...]`.padEnd(36)} ${`[${estBars.split(',').slice(0, 5).join(',')}...]`.padEnd(14)}`);
    }
}

main().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});