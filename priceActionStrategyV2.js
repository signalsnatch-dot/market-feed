/**
 * Price Action Strategy V2 (Fixed Editions Engine)
 * 
 * Inherits all V1-V50 strategies from priceActionStrategy.js untouched.
 * Generates V51-V250 (batch fix clones) and V251-V850 (individual fix clones).
 * Brooks strategies at V851-V904.
 * 
 * Version Map:
 *   V1-V50     → Original strategies (preserved from priceActionStrategy.js)
 *   V51-V100   → Batch: Entry/Stop fixes (renumbered from old V101-V150)
 *   V101-V150  → Batch: Trend fixes (renumbered from old V151-V200)
 *   V151-V200  → Batch: Leg Quality fixes (renumbered from old V201-V250)
 *   V201-V250  → Batch: Exit Mgmt fixes (renumbered from old V251-V300)
 *   V251-V850  → Individual fix clones: 12 fixes × 50 originals
 *   V851-V853  → Brooks Original
 *   V854-V868  → Brooks × 5 batch profiles
 *   V869-V904  → Brooks × 12 individual fix profiles
 * 
 * Each fix is named and logged in signal metadata for root-cause tracking:
 *   - TREND_ABR_NORMALIZED_SLOPE  (#1)
 *   - TREND_ADX_FILTER            (#2)
 *   - TREND_GAP_BAR_OPTIONAL      (#3)
 *   - LEG_MIN_BAR_SPACING_VOLUME  (#5)
 *   - PIVOT_STRUCTURAL_DETECTION  (#6)
 *   - LEG_DEPTH_RATIO             (#7)
 *   - STOP_WIDER_RATIO            (#8)
 *   - ATR_DYNAMIC_STOP_FLOOR      (#9)
 *   - TRIGGER_WIDER_OFFSET        (#10)
 *   - DEFAULT_V2_RATIOS           (#11)
 *   - TRAILING_STOP               (#12)
 *   - TIME_BASED_EXIT             (#13)
 *   - STRUCTURAL_TARGET_RRR_FIX   (#14)
 *   - SCORING_PERCENTILE_SLOPE    (#15)
 *   - FVG_UNMITIGATED_CHECK       (#16)
 *   - PER_INSTRUMENT_CONFIDENCE   (#17)
 *   - SAME_BAR_EXIT_PATH          (#24)
 *   - DAILY_PNL_RESET             (#25)
 *   - SLIPPAGE_MODELING           (#26)
 */

const original = require('./priceActionStrategy');

// ============================================================
// V2 DEFAULT PARAMS (with fixes applied)
// ============================================================

const DEFAULT_PARAMS_V2 = {
    // === Core Price Action Parameters (unchanged) ===
    emaPeriod: 20,
    swingLookback: 10,
    minTrendBars: 12,
    rewardRatio: 1.5,

    // === FIX #8: STOP_WIDER_RATIO — Wider default stop offsets ===
    stopOffsetRatio: 0.05,              // ORIGINAL: 5% ABR (fix raises to 0.30)
    stopOffsetTicks: 1,                 // Fallback (only used when ABR unavailable)

    // === FIX #10: TRIGGER_WIDER_OFFSET — Wider default trigger offsets ===
    triggerOffsetRatio: 0.05,           // ORIGINAL: 5% ABR (fix raises to 0.08)
    triggerOffsetTicks: 1,

    // === FIX #11: DEFAULT_V2_RATIOS — Non-structural versions use V2 config values ===
    emaTouchRatio: 0.20,                // ORIGINAL: 0.20 (fix tightens to 0.15)
    doubleTopBottomToleranceRatio: 0.25,// ORIGINAL: 0.25 (fix tightens to 0.15)

    // === V2 Structural ratio defaults (matching original V2) ===
    emaTouchRatioV2: 0.15,
    triggerOffsetRatioV2: 0.03,         // ORIGINAL V2: 0.03 (fix raises to 0.08)
    stopOffsetRatioV2: 0.30,
    doubleTopBottomToleranceRatioV2: 0.15,
    structureOffsetRatio: 0.10,

    // === Original Tick-Based (fallback only) ===
    tickSize: 0.05,
    emaTouchTicks: 4,
    doubleTopBottomToleranceTicks: 4,

    // === FIX #1: TREND_ABR_NORMALIZED_SLOPE ===
    useABRNormalizedSlope: false,       // OFF: use raw threshold (fix enables ABR-normalized slope)

    // === FIX #2: TREND_ADX_FILTER ===
    enableADXFilter: false,
    adxThreshold: 20,
    adxPeriod: 14,

    // === FIX #3: TREND_GAP_BAR_OPTIONAL ===
    requireGapBar: true,                // ORIGINAL: gap bar required (fix makes optional)

    // === FIX #5: LEG_MIN_BAR_SPACING_VOLUME ===
    minLeg1Bars: 3,
    minH1BounceBars: 2,
    minLeg2Bars: 2,
    skipMinBarSpacingBelowDailyBars: 30, // Skip spacing check if < 30 bars/day

    // === FIX #6: PIVOT_STRUCTURAL_DETECTION ===
    useStructuralPivotDetection: false, // OFF: use simple extremum (fix enables structural pivot)
    pivotConfirmationBars: 2,

    // === FIX #7: LEG_DEPTH_RATIO ===
    minSecondLegDepthRatio: 0.30,       // ORIGINAL: 30% (fix raises to 0.60)

    // === FIX #9: ATR_DYNAMIC_STOP_FLOOR ===
    enableATRStopFloor: false,
    atrStopMultiplier: 0.5,
    atrStopPeriod: 14,

    // === FIX #12: TRAILING_STOP ===
    enableTrailingStop: false,
    breakevenRR: 0.80,                  // Move stop to breakeven at 0.8R
    trailRR: 1.20,                      // Start trailing at 1.2R
    trailDistanceRR: 0.50,              // Trail by 0.5R behind price

    // === FIX #13: TIME_BASED_EXIT ===
    enableTimeExit: false,
    maxBarsInTrade: 20,

    // === FIX #24: SAME_BAR_EXIT_PATH ===
    useBarPathExitResolution: false,    // OFF: standard resolution (fix enables bar-path)

    // === FIX #26: SLIPPAGE_MODELING ===
    slippageTicks: 0,                   // ORIGINAL: no slippage (fix adds 1 tick)

    // === Signal Bar Quality (unchanged) ===
    minSignalBarCloseRatio: 0.60,
    requireBullishBodyForLong: true,
    requireBearishBodyForShort: true,

    // === Optimization Filters (unchanged) ===
    enableGiantBarFilter: true,
    giantBarMultiplier: 2.2,
    enableWhipsawFilter: true,
    flatEmaSlopeThreshold: 0.0001,
    maxEmaCrosses: 3,
    whipsawLookback: 8,
    enableBodyToRangeFilter: true,
    minBodyToRangeRatio: 0.40,

    // === Trap Settings (unchanged) ===
    enableTraps: true,
    trapMaxLookback: 3,

    // === Confluence Overlays ===
    enableFVGConfluence: true,
    fvgLookback: 15,
    enableLiquiditySweeps: true,
    sweepLookback: 15,

    // === FIX #15, #16, #17: Confidence scoring improvements ===
    minConfidenceThreshold: 45,
    enableConfidenceScoring: true,
    usePercentileSlopeScoring: false,   // FIX #15 (these are always-on when confidence enabled in V2)
    useUnmitigatedFVGCheck: false,      // FIX #16 — but NOT part of batched testing (always on in V2)

    // === Risk Management (unchanged) ===
    maxRiskPerTrade: 0.01,
    maxConsecutiveLosses: 3,
    maxDailyLoss: 0.03,
    minBarsBetweenSignals: 3,

    // === FIX #25: DAILY_PNL_RESET — handled in backtester, param for reference ===
    resetDailyPnLAtSession: true,
};

// ============================================================
// FIX PROFILES — Batch testing: each profile enables only its batch of fixes
// Controlled via process.env.FIX_PROFILE (or passed as param.fix_profile)
// ============================================================
const FIX_PROFILES = {
    // All fixes OFF — V51-V106 behave identically to V1-V50
    "off": {},

    // Batch 1: Entry/Stop — STOP_WIDER_RATIO, TRIGGER_WIDER_OFFSET, ATR_DYNAMIC_STOP_FLOOR, SLIPPAGE
    "entry_stop": {
        stopOffsetRatio: 0.30,
        triggerOffsetRatio: 0.08,
        triggerOffsetRatioV2: 0.08,
        enableATRStopFloor: true,
        slippageTicks: 1,
    },

    // Batch 2: Trend — TREND_ABR_NORMALIZED_SLOPE, TREND_ADX_FILTER, TREND_GAP_BAR_OPTIONAL
    "trend": {
        useABRNormalizedSlope: true,
        enableADXFilter: true,
        requireGapBar: false,
    },

    // Batch 3: Leg Quality — LEG_DEPTH_RATIO, PIVOT_STRUCTURAL_DETECTION
    "leg_quality": {
        minSecondLegDepthRatio: 0.60,
        useStructuralPivotDetection: true,
    },

    // Batch 4: Exit Management — TRAILING_STOP, TIME_BASED_EXIT, SAME_BAR_EXIT_PATH
    "exit_mgmt": {
        enableTrailingStop: true,
        enableTimeExit: true,
        useBarPathExitResolution: true,
    },

    // ─── Individual Fix Profiles (1 fix each) ──────────────────────
    "stop_wider":     { stopOffsetRatio: 0.30 },
    "trigger_wider":  { triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08 },
    "atr_floor":      { enableATRStopFloor: true },
    "slippage":       { slippageTicks: 1 },
    "abr_slope":      { useABRNormalizedSlope: true },
    "adx_filter":     { enableADXFilter: true },
    "gap_optional":   { requireGapBar: false },
    "leg_depth":      { minSecondLegDepthRatio: 0.60 },
    "pivot_struct":   { useStructuralPivotDetection: true },
    "trailing":       { enableTrailingStop: true },
    "time_exit":      { enableTimeExit: true },
    "bar_path":       { useBarPathExitResolution: true },
};

// Ordered list of all individual fix profiles
const INDIVIDUAL_FIX_ORDER = [
    "stop_wider", "trigger_wider", "atr_floor", "slippage",
    "abr_slope", "adx_filter", "gap_optional",
    "leg_depth", "pivot_struct",
    "trailing", "time_exit", "bar_path",
];

// Label map
const INDIVIDUAL_FIX_LABELS = {
    "stop_wider":     "(Stop Wider)",
    "trigger_wider":  "(Trigger Wider)",
    "atr_floor":      "(ATR Floor)",
    "slippage":       "(Slippage)",
    "abr_slope":      "(ABR Slope)",
    "adx_filter":     "(ADX Filter)",
    "gap_optional":   "(Gap Optional)",
    "leg_depth":      "(Leg Depth)",
    "pivot_struct":   "(Pivot Structural)",
    "trailing":       "(Trailing Stop)",
    "time_exit":      "(Time Exit)",
    "bar_path":       "(Bar Path Exit)",
};

function resolveFixProfile(params = {}) {
    // Priority: params.fix_profile > process.env.FIX_PROFILE > "off"
    const profileName = params.fix_profile || process.env.FIX_PROFILE || "off";
    const profile = FIX_PROFILES[profileName];
    if (!profile) {
        console.warn(`Unknown fix_profile "${profileName}", using "off"`);
        return {};
    }
    return profile;
}

// ============================================================
// Re-export original utilities unchanged
// ============================================================
const calculateEMA = original.calculateEMA;
const getTickSize = original.getTickSize || (() => 0.05);
const getInstrumentConfig = original.getInstrumentConfig || (() => null);

// ============================================================
// FIX #6: PIVOT_STRUCTURAL_DETECTION — Proper swing pivot finder
// ============================================================
function findPullbackSwingIndexV2(candles, currentIdx, lookback, direction, params) {
    if (!params || !params.useStructuralPivotDetection) {
        // Fallback to original simple extremum search
        return originalFindSwing(candles, currentIdx, lookback, direction);
    }

    const confirmationBars = params.pivotConfirmationBars || 2;
    let bestIdx = null;
    let bestVal = direction === 'high' ? -Infinity : Infinity;
    const start = Math.max(confirmationBars + 1, currentIdx - lookback);

    for (let i = currentIdx - confirmationBars; i >= start; i--) {
        if (i - confirmationBars < 0 || i + confirmationBars >= candles.length) continue;

        const val = direction === 'high' ? candles[i].high : candles[i].low;

        // Verify this is a structural pivot: all bars within confirmation window
        // must have lower highs (for swing high) / higher lows (for swing low)
        let isPivot = true;
        for (let k = 1; k <= confirmationBars; k++) {
            if (direction === 'high') {
                if (candles[i - k].high >= val || candles[i + k].high >= val) {
                    isPivot = false;
                    break;
                }
            } else {
                if (candles[i - k].low <= val || candles[i + k].low <= val) {
                    isPivot = false;
                    break;
                }
            }
        }

        if (isPivot) {
            const isBetter = direction === 'high' ? val > bestVal : val < bestVal;
            if (isBetter) {
                bestVal = val;
                bestIdx = i;
            }
        }
    }

    // Fallback: if no structural pivot found, use simple extremum
    if (bestIdx === null) {
        return originalFindSwing(candles, currentIdx, lookback, direction);
    }

    return bestIdx;
}

// Simple extremum search (same as original findPullbackSwingIndex)
function originalFindSwing(candles, currentIdx, lookback, direction) {
    let bestIdx = null;
    let bestVal = direction === 'high' ? -Infinity : Infinity;
    const start = Math.max(0, currentIdx - lookback);
    for (let i = currentIdx - 1; i >= start; i--) {
        if (i <= 0 || i >= candles.length - 1) continue;
        const val = direction === 'high' ? candles[i].high : candles[i].low;
        const isBetter = direction === 'high' ? val > bestVal : val < bestVal;
        if (isBetter) {
            bestVal = val;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// ============================================================
// FIX #15: SCORING_PERCENTILE_SLOPE — Percentile-based EMA slope scoring
// ============================================================
function calculateConfidenceScoreV2(candles, ema, i, type, p, avgRange, slopePercentileCache) {
    let score = 0;
    const sBar = candles[i];
    const range = sBar.high - sBar.low;
    if (range <= 0) return 0;

    const body = Math.abs(sBar.close - sBar.open);
    const bodyRatio = body / range;

    // FIX #15: Percentile-based slope scoring
    let slopePoints = 0;
    if (p.usePercentileSlopeScoring && slopePercentileCache && slopePercentileCache[i] !== undefined) {
        const percentile = slopePercentileCache[i];
        if (percentile >= 80) slopePoints = 15;
        else if (percentile >= 65) slopePoints = 12;
        else if (percentile >= 50) slopePoints = 8;
        else if (percentile >= 35) slopePoints = 5;
        else if (percentile >= 20) slopePoints = 2;
        else slopePoints = 0;
    } else {
        // Fallback to original formula (but capped at 15)
        const slope = (ema[i] - ema[i - 5]) / ema[i - 5];
        const absSlope = Math.abs(slope);
        slopePoints = Math.min(15, Math.round(absSlope * 150000));
    }
    score += slopePoints;

    const alignedBody = type === 'BUY' ? (sBar.close > sBar.open) : (sBar.close < sBar.open);
    if (alignedBody) score += 10;

    const closeRatio = type === 'BUY' ? (sBar.close - sBar.low) / range : (sBar.high - sBar.close) / range;
    if (closeRatio >= 0.80) {
        score += 15;
    } else if (closeRatio >= 0.65) {
        score += 10;
    }

    if (bodyRatio >= 0.40) {
        score += 10;
    } else if (bodyRatio >= 0.20) {
        score += 5;
    }

    // Liquidity sweep (unchanged)
    const hasSweep = checkLiquiditySweepV2(candles, i, type === 'BUY' ? 'BUY' : 'SELL', p.sweepLookback);
    if (hasSweep) score += 20;

    // FIX #16: Unmitigated FVG check
    const hasFVG = p.useUnmitigatedFVGCheck
        ? checkFVGConfluenceUnmitigatedV2(candles, i, type === 'BUY' ? 'BUY' : 'SELL', p.fvgLookback)
        : checkFVGConfluenceLegacyV2(candles, i, type === 'BUY' ? 'BUY' : 'SELL', p.fvgLookback);
    if (hasFVG) score += 15;

    const extreme = type === 'BUY' ? sBar.low : sBar.high;
    const distanceToEMA = Math.abs(extreme - ema[i]);
    const emaTouchDistance = avgRange > 0 ? avgRange * p.emaTouchRatio : (p.emaTouchTicks * p.tickSize);

    if (distanceToEMA <= emaTouchDistance * 0.25) {
        score += 15;
    } else if (distanceToEMA <= emaTouchDistance * 0.50) {
        score += 10;
    } else if (distanceToEMA <= emaTouchDistance) {
        score += 5;
    }

    return score;
}

// FIX #16: Unmitigated FVG check
function checkFVGConfluenceUnmitigatedV2(candles, i, type, lookback) {
    const start = Math.max(2, i - lookback);
    for (let j = i - 1; j >= start; j--) {
        if (type === 'BUY') {
            // Bullish FVG: candle[j].low > candle[j-2].high
            if (candles[j].low > candles[j - 2].high) {
                // Check if FVG is unmitigated: no bar between j+1 and i-1 has traded into the gap
                const gapTop = candles[j].low;
                const gapBottom = candles[j - 2].high;
                let mitigated = false;
                for (let k = j + 1; k < i; k++) {
                    if (candles[k].low <= gapTop && candles[k].high >= gapBottom) {
                        mitigated = true;
                        break;
                    }
                }
                if (!mitigated) return true;
            }
        } else {
            // Bearish FVG: candle[j].high < candle[j-2].low
            if (candles[j].high < candles[j - 2].low) {
                const gapTop = candles[j - 2].low;
                const gapBottom = candles[j].high;
                let mitigated = false;
                for (let k = j + 1; k < i; k++) {
                    if (candles[k].high >= gapBottom && candles[k].low <= gapTop) {
                        mitigated = true;
                        break;
                    }
                }
                if (!mitigated) return true;
            }
        }
    }
    return false;
}

// Legacy FVG check (original behavior)
function checkFVGConfluenceLegacyV2(candles, i, type, lookback) {
    const start = Math.max(2, i - lookback);
    for (let j = i - 1; j >= start; j--) {
        if (type === 'BUY') {
            if (candles[j].low > candles[j - 2].high) {
                if (candles[i].low <= candles[j].low && candles[i].high >= candles[j - 2].high) {
                    return true;
                }
            }
        } else {
            if (candles[j].high < candles[j - 2].low) {
                if (candles[i].high >= candles[j].high && candles[i].low <= candles[j - 2].low) {
                    return true;
                }
            }
        }
    }
    return false;
}

function checkLiquiditySweepV2(candles, i, type, lookback) {
    const start = Math.max(0, i - lookback);
    let localExtreme = type === 'BUY' ? Infinity : -Infinity;

    for (let j = i - 1; j >= start; j--) {
        if (type === 'BUY') {
            if (candles[j].low < localExtreme) localExtreme = candles[j].low;
        } else {
            if (candles[j].high > localExtreme) localExtreme = candles[j].high;
        }
    }

    if (type === 'BUY') {
        return candles[i].low < localExtreme && candles[i].close > localExtreme;
    } else {
        return candles[i].high > localExtreme && candles[i].close < localExtreme;
    }
}

// ============================================================
// FIX #1 + #2 + #3: TREND ASSESSMENT V2
// ============================================================
function getAverageBarRangeV2(candles, currentIdx, lookback = 10) {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, currentIdx - lookback);
    for (let j = start; j < currentIdx; j++) {
        sum += (candles[j].high - candles[j].low);
        count++;
    }
    return count > 0 ? sum / count : 0;
}

function calculateADX(candles, i, period = 14) {
    if (i < period * 2) return 0;
    let trSum = 0, plusDMSum = 0, minusDMSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
        const tr = Math.max(
            candles[j].high - candles[j].low,
            Math.abs(candles[j].high - candles[j - 1].close),
            Math.abs(candles[j].low - candles[j - 1].close)
        );
        const upMove = candles[j].high - candles[j - 1].high;
        const downMove = candles[j - 1].low - candles[j].low;
        const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
        const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;
        trSum += tr;
        plusDMSum += plusDM;
        minusDMSum += minusDM;
    }
    if (trSum === 0) return 0;
    const plusDI = (plusDMSum / trSum) * 100;
    const minusDI = (minusDMSum / trSum) * 100;
    const dxSum = plusDI + minusDI;
    if (dxSum === 0) return 0;
    const dx = Math.abs(plusDI - minusDI) / dxSum * 100;
    return dx;
}

function assessTrendV2(candles, ema, i, params) {
    const { emaPeriod, minTrendBars } = params;
    const macroLookback = minTrendBars || 18;

    if (useBrooksTrend(params)) {
        return assessTrendBrooksV2(candles, ema, i, params);
    }
    return assessTrendLegacyV2(candles, ema, i, params);
}

function useBrooksTrend(params) {
    return params.useBrooksTrend === true;
}

function assessTrendLegacyV2(candles, ema, i, params) {
    const { emaPeriod, minTrendBars } = params;
    if (i < emaPeriod + minTrendBars || ema[i] == null || ema[i - 5] == null) {
        return { bullish: false, bearish: false };
    }

    // FIX #1: ABR-normalized slope instead of raw threshold
    let bullish, bearish;

    if (params.useABRNormalizedSlope) {
        const avgRange = getAverageBarRangeV2(candles, i, 10);
        if (avgRange <= 0) return { bullish: false, bearish: false };

        const emaDelta = ema[i] - ema[i - 5];
        const normalizedSlope = emaDelta / (avgRange * 5);

        const aboveEma = candles[i].close > ema[i];
        const belowEma = candles[i].close < ema[i];

        let barsAbove = 0, barsBelow = 0;
        for (let j = i - minTrendBars; j <= i; j++) {
            if (candles[j].close > ema[j]) barsAbove++;
            if (candles[j].close < ema[j]) barsBelow++;
        }

        bullish = aboveEma && (barsAbove / (minTrendBars + 1)) >= 0.65 && normalizedSlope > 0.03;
        bearish = belowEma && (barsBelow / (minTrendBars + 1)) >= 0.65 && normalizedSlope < -0.03;
    } else {
        // Original legacy logic (preserved for comparison)
        const emaSlope = (ema[i] - ema[i - 5]) / ema[i - 5];
        const aboveEma = candles[i].close > ema[i];
        const belowEma = candles[i].close < ema[i];

        let higherEMA = 0, lowerEMA = 0;
        for (let j = i - 5; j <= i; j++) {
            if (ema[j] > ema[j - 1]) higherEMA++;
            if (ema[j] < ema[j - 1]) lowerEMA++;
        }

        bullish = aboveEma && higherEMA >= 4 && emaSlope > 0.00002;
        bearish = belowEma && lowerEMA >= 4 && emaSlope < -0.00002;
    }

    // FIX #2: ADX filter
    if (params.enableADXFilter) {
        const adx = calculateADX(candles, i, params.adxPeriod || 14);
        if (adx < (params.adxThreshold || 20)) {
            return { bullish: false, bearish: false };
        }
    }

    return { bullish, bearish };
}

function assessTrendBrooksV2(candles, ema, i, params) {
    const { emaPeriod } = params;
    const macroLookback = params.minTrendBars || 18;

    if (i < emaPeriod + macroLookback || ema[i] == null || ema[i - 15] == null) {
        return { bullish: false, bearish: false };
    }

    const avgRange = getAverageBarRangeV2(candles, i, 10);
    if (avgRange <= 0) return { bullish: false, bearish: false };

    const emaDelta = ema[i] - ema[i - 15];
    const normalizedSlope = emaDelta / (avgRange * 15);

    let barsAbove = 0, barsBelow = 0;
    for (let j = i - macroLookback; j <= i; j++) {
        if (candles[j].close > ema[j]) barsAbove++;
        if (candles[j].close < ema[j]) barsBelow++;
    }

    // FIX #3: Gap bar now optional, default false
    let hasBullishGapBar = true;
    let hasBearishGapBar = true;
    if (params.requireGapBar) {
        hasBullishGapBar = false;
        hasBearishGapBar = false;
        for (let j = i - 15; j < i; j++) {
            if (candles[j].low > ema[j]) hasBullishGapBar = true;
            if (candles[j].high < ema[j]) hasBearishGapBar = true;
        }
    }

    const bullish = (barsAbove / (macroLookback + 1)) >= 0.80 && normalizedSlope > 0.08 && hasBullishGapBar;
    const bearish = (barsBelow / (macroLookback + 1)) >= 0.80 && normalizedSlope < -0.08 && hasBearishGapBar;

    // FIX #2: ADX filter
    if (params.enableADXFilter && (bullish || bearish)) {
        const adx = calculateADX(candles, i, params.adxPeriod || 14);
        if (adx < (params.adxThreshold || 20)) {
            return { bullish: false, bearish: false };
        }
    }

    return { bullish, bearish };
}

// ============================================================
// WHIPSAW FILTER (unchanged logic, same as original)
// ============================================================
function isWhipsawingV2(candles, ema, i, p) {
    if (!p.enableWhipsawFilter) return false;
    if (useBrooksTrend(p)) {
        return isWhipsawingBrooksV2(candles, ema, i, p);
    }
    return isWhipsawingLegacyV2(candles, ema, i, p);
}

function isWhipsawingLegacyV2(candles, ema, i, p) {
    const emaSlope = (ema[i] - ema[i - 5]) / ema[i - 5];
    const isFlat = Math.abs(emaSlope) < p.flatEmaSlopeThreshold;
    if (!isFlat) return false;
    let emaCrosses = 0;
    for (let j = i - p.whipsawLookback; j < i; j++) {
        if (!ema[j] || !ema[j - 1]) continue;
        const crossedAbove = candles[j].close > ema[j] && candles[j - 1].close < ema[j - 1];
        const crossedBelow = candles[j].close < ema[j] && candles[j - 1].close > ema[j - 1];
        if (crossedAbove || crossedBelow) emaCrosses++;
    }
    return emaCrosses > p.maxEmaCrosses;
}

function isWhipsawingBrooksV2(candles, ema, i, p) {
    const avgRange = getAverageBarRangeV2(candles, i, 10);
    if (avgRange <= 0) return false;
    const emaDelta = ema[i] - ema[i - 5];
    const normalizedSlope = emaDelta / (avgRange * 5);
    const isFlat = Math.abs(normalizedSlope) < 0.05;
    if (!isFlat) return false;
    let emaCrosses = 0;
    for (let j = i - p.whipsawLookback; j < i; j++) {
        if (!ema[j] || !ema[j - 1]) continue;
        const crossedAbove = candles[j].close > ema[j] && candles[j - 1].close < ema[j - 1];
        const crossedBelow = candles[j].close < ema[j] && candles[j - 1].close > ema[j - 1];
        if (crossedAbove || crossedBelow) emaCrosses++;
    }
    return emaCrosses > p.maxEmaCrosses;
}

// ============================================================
// SIGNAL BAR VALIDATOR (unchanged)
// ============================================================
function validateSignalBarV2(sBar, type, p) {
    const range = sBar.high - sBar.low;
    if (range <= 0) return false;
    const body = Math.abs(sBar.close - sBar.open);
    const bodyRatio = body / range;

    if (type === 'BUY') {
        const closeRatio = (sBar.close - sBar.low) / range;
        const isPinbar = closeRatio >= 0.70;
        if (isPinbar) {
            if (bodyRatio < 0.15) return false;
        } else {
            if (p.enableBodyToRangeFilter && bodyRatio < p.minBodyToRangeRatio) return false;
            if (closeRatio < p.minSignalBarCloseRatio) return false;
        }
        if (p.requireBullishBodyForLong && sBar.close < sBar.open) return false;
    } else {
        const closeRatio = (sBar.high - sBar.close) / range;
        const isPinbar = closeRatio >= 0.70;
        if (isPinbar) {
            if (bodyRatio < 0.15) return false;
        } else {
            if (p.enableBodyToRangeFilter && bodyRatio < p.minBodyToRangeRatio) return false;
            if (closeRatio < p.minSignalBarCloseRatio) return false;
        }
        if (p.requireBearishBodyForShort && sBar.close > sBar.open) return false;
    }
    return true;
}

// ============================================================
// FIX #5 + #7: LEG COUNTING V2 (Volume-Aware Spacing + Depth Ratio)
// ============================================================
function getDailyBarEstimate(params) {
    if (params.volumeThreshold && params.dailyBarEstimates) {
        const est = params.dailyBarEstimates[String(params.volumeThreshold)];
        if (est !== undefined) return est;
    }
    return 60; // Default: assume enough bars
}

function shouldSkipBarSpacing(params) {
    const dailyBars = getDailyBarEstimate(params);
    const threshold = params.skipMinBarSpacingBelowDailyBars || 30;
    return dailyBars < threshold;
}

function evaluateH2SetupV2(candles, swingHighIdx, currentIdx, tickSize, p) {
    if (swingHighIdx === null || swingHighIdx >= currentIdx - 2) {
        return { isH2: false };
    }

    let firstLegStarted = false;
    let h1TriggerIdx = -1;
    let h1SignalIdx = -1;
    let secondLegStarted = false;
    let h2TriggerIdx = -1;
    let h2SignalIdx = -1;

    const useStrict = p && p.useStrictLegInitiation;
    const skipSpacing = shouldSkipBarSpacing(p);
    const minLeg1Bars = skipSpacing ? 1 : (p.minLeg1Bars || 3);
    const minH1Bars = skipSpacing ? 1 : (p.minH1BounceBars || 2);
    const minLeg2Bars = skipSpacing ? 1 : (p.minLeg2Bars || 2);

    let leg1BarCount = 0;
    let h1BarCount = 0;
    let leg2BarCount = 0;

    for (let j = swingHighIdx + 1; j <= currentIdx; j++) {
        const prevHigh = candles[j - 1].high;
        const currentHigh = candles[j].high;
        const prevLow = candles[j - 1].low;
        const currentLow = candles[j].low;
        const isBullish = candles[j].close > candles[j].open;
        const isBearish = candles[j].close < candles[j].open;

        if (useStrict && !firstLegStarted) {
            if (isBearish && currentLow < prevLow) {
                leg1BarCount++;
                if (leg1BarCount >= minLeg1Bars) {
                    firstLegStarted = true;
                }
            } else {
                leg1BarCount = 0;
            }
            continue;
        }

        if (h1TriggerIdx === -1) {
            if (useStrict) {
                if (isBullish && currentHigh > prevHigh) {
                    h1BarCount++;
                    if (h1BarCount >= minH1Bars) {
                        h1TriggerIdx = j;
                        h1SignalIdx = j - (minH1Bars - 1);
                    }
                } else {
                    h1BarCount = 0;
                }
            } else {
                if (currentHigh > prevHigh) {
                    h1BarCount++;
                    if (h1BarCount >= minH1Bars) {
                        h1TriggerIdx = j;
                        h1SignalIdx = j - (minH1Bars - 1);
                    }
                } else {
                    h1BarCount = 0;
                }
            }
        } else if (!secondLegStarted) {
            if (useStrict) {
                if (isBearish && currentLow < prevLow) {
                    leg2BarCount++;
                    if (leg2BarCount >= minLeg2Bars) {
                        secondLegStarted = true;
                    }
                } else {
                    leg2BarCount = 0;
                }
            } else {
                if (candles[j].low < prevLow || candles[j].high < prevHigh) {
                    leg2BarCount++;
                    if (leg2BarCount >= minLeg2Bars) {
                        secondLegStarted = true;
                    }
                } else {
                    leg2BarCount = 0;
                }
            }
        } else if (h2TriggerIdx === -1) {
            if (currentHigh > prevHigh) {
                h2TriggerIdx = j;
                h2SignalIdx = j - 1;
            }
        }
    }

    const leg1Valid = useStrict ? firstLegStarted : true;
    const isValidH2Signal = leg1Valid && (h1TriggerIdx !== -1) && secondLegStarted && (h2TriggerIdx === -1);

    // FIX #7: LEG_DEPTH_RATIO — second leg must reach ≥ 60% of first leg
    if (isValidH2Signal && !p.requireStrictSecondLeg && (p.minSecondLegDepthRatio || 0.60) > 0) {
        let firstLegLow = Infinity;
        for (let k = swingHighIdx; k <= h1SignalIdx; k++) {
            if (candles[k].low < firstLegLow) firstLegLow = candles[k].low;
        }
        let secondLegLow = Infinity;
        for (let k = h1TriggerIdx; k <= currentIdx; k++) {
            if (candles[k].low < secondLegLow) secondLegLow = candles[k].low;
        }
        const firstLegDepth = candles[swingHighIdx].high - firstLegLow;
        const secondLegDepth = candles[swingHighIdx].high - secondLegLow;
        if (firstLegDepth > 0 && (secondLegDepth / firstLegDepth) < (p.minSecondLegDepthRatio || 0.60)) {
            return {
                isH2: false,
                h1TriggerIdx,
                h1SignalIdx,
                secondLegStarted,
                swingHighIdx,
                _fixRejection: `LEG_DEPTH_RATIO_FAILED: ${((secondLegDepth/firstLegDepth)*100).toFixed(0)}% < ${((p.minSecondLegDepthRatio||0.60)*100).toFixed(0)}%`
            };
        }
    }

    return { isH2: isValidH2Signal, h1TriggerIdx, h1SignalIdx, secondLegStarted, swingHighIdx };
}

function evaluateL2SetupV2(candles, swingLowIdx, currentIdx, tickSize, p) {
    if (swingLowIdx === null || swingLowIdx >= currentIdx - 2) {
        return { isL2: false };
    }

    let firstLegStarted = false;
    let l1TriggerIdx = -1;
    let l1SignalIdx = -1;
    let secondLegStarted = false;
    let l2TriggerIdx = -1;
    let l2SignalIdx = -1;

    const useStrict = p && p.useStrictLegInitiation;
    const skipSpacing = shouldSkipBarSpacing(p);
    const minLeg1Bars = skipSpacing ? 1 : (p.minLeg1Bars || 3);
    const minL1Bars = skipSpacing ? 1 : (p.minH1BounceBars || 2);
    const minLeg2Bars = skipSpacing ? 1 : (p.minLeg2Bars || 2);

    let leg1BarCount = 0;
    let l1BarCount = 0;
    let leg2BarCount = 0;

    for (let j = swingLowIdx + 1; j <= currentIdx; j++) {
        const prevLow = candles[j - 1].low;
        const prevHigh = candles[j - 1].high;
        const currentLow = candles[j].low;
        const currentHigh = candles[j].high;
        const isBullish = candles[j].close > candles[j].open;
        const isBearish = candles[j].close < candles[j].open;

        if (useStrict && !firstLegStarted) {
            if (isBullish && currentHigh > prevHigh) {
                leg1BarCount++;
                if (leg1BarCount >= minLeg1Bars) {
                    firstLegStarted = true;
                }
            } else {
                leg1BarCount = 0;
            }
            continue;
        }

        if (l1TriggerIdx === -1) {
            if (useStrict) {
                if (isBearish && currentLow < prevLow) {
                    l1BarCount++;
                    if (l1BarCount >= minL1Bars) {
                        l1TriggerIdx = j;
                        l1SignalIdx = j - (minL1Bars - 1);
                    }
                } else {
                    l1BarCount = 0;
                }
            } else {
                if (candles[j].low < prevLow) {
                    l1BarCount++;
                    if (l1BarCount >= minL1Bars) {
                        l1TriggerIdx = j;
                        l1SignalIdx = j - (minL1Bars - 1);
                    }
                } else {
                    l1BarCount = 0;
                }
            }
        } else if (!secondLegStarted) {
            if (useStrict) {
                if (isBullish && currentHigh > prevHigh) {
                    leg2BarCount++;
                    if (leg2BarCount >= minLeg2Bars) {
                        secondLegStarted = true;
                    }
                } else {
                    leg2BarCount = 0;
                }
            } else {
                if (candles[j].high > prevHigh || candles[j].low > prevLow) {
                    leg2BarCount++;
                    if (leg2BarCount >= minLeg2Bars) {
                        secondLegStarted = true;
                    }
                } else {
                    leg2BarCount = 0;
                }
            }
        } else if (l2TriggerIdx === -1) {
            if (candles[j].low < prevLow) {
                l2TriggerIdx = j;
                l2SignalIdx = j - 1;
            }
        }
    }

    const leg1Valid = useStrict ? firstLegStarted : true;
    const isValidL2Signal = leg1Valid && (l1TriggerIdx !== -1) && secondLegStarted && (l2TriggerIdx === -1);

    // FIX #7: LEG_DEPTH_RATIO
    if (isValidL2Signal && !p.requireStrictSecondLeg && (p.minSecondLegDepthRatio || 0.60) > 0) {
        let firstLegHigh = -Infinity;
        for (let k = swingLowIdx; k <= l1SignalIdx; k++) {
            if (candles[k].high > firstLegHigh) firstLegHigh = candles[k].high;
        }
        let secondLegHigh = -Infinity;
        for (let k = l1TriggerIdx; k <= currentIdx; k++) {
            if (candles[k].high > secondLegHigh) secondLegHigh = candles[k].high;
        }
        const firstLegDepth = firstLegHigh - candles[swingLowIdx].low;
        const secondLegDepth = secondLegHigh - candles[swingLowIdx].low;
        if (firstLegDepth > 0 && (secondLegDepth / firstLegDepth) < (p.minSecondLegDepthRatio || 0.60)) {
            return {
                isL2: false,
                l1TriggerIdx,
                l1SignalIdx,
                secondLegStarted,
                swingLowIdx,
                _fixRejection: `LEG_DEPTH_RATIO_FAILED: ${((secondLegDepth/firstLegDepth)*100).toFixed(0)}% < ${((p.minSecondLegDepthRatio||0.60)*100).toFixed(0)}%`
            };
        }
    }

    return { isL2: isValidL2Signal, l1TriggerIdx, l1SignalIdx, secondLegStarted, swingLowIdx };
}

// ============================================================
// STRUCTURAL LEG EVALUATION (delegated — structural versions use V2 trend/pivot)
// These are wrappers that call the original structural functions with V2 arguments
// ============================================================
function isStructuralHighBreachV2(candles, j, prevHigh, avgRange, structureOffsetRatio, consecutiveBreachesRef) {
    const hardBreakoutLevel = prevHigh + (avgRange * structureOffsetRatio);
    if (candles[j].high > hardBreakoutLevel) return true;
    if (candles[j].close > prevHigh) return true;
    if (candles[j].high > prevHigh) {
        consecutiveBreachesRef.count++;
        if (consecutiveBreachesRef.count >= 3) return true;
    } else {
        consecutiveBreachesRef.count = 0;
    }
    return false;
}

function isStructuralLowBreachV2(candles, j, prevLow, avgRange, structureOffsetRatio, consecutiveBreachesRef) {
    const hardBreakoutLevel = prevLow - (avgRange * structureOffsetRatio);
    if (candles[j].low < hardBreakoutLevel) return true;
    if (candles[j].close < prevLow) return true;
    if (candles[j].low < prevLow) {
        consecutiveBreachesRef.count++;
        if (consecutiveBreachesRef.count >= 3) return true;
    } else {
        consecutiveBreachesRef.count = 0;
    }
    return false;
}

// ============================================================
// FIX #9: ATR Computation for dynamic stop floor
// ============================================================
function computeATR(candles, i, period = 14) {
    if (i < period + 1) return 0;
    let sum = 0;
    let count = 0;
    const start = Math.max(1, i - period + 1);
    for (let j = start; j <= i; j++) {
        const tr = Math.max(
            candles[j].high - candles[j].low,
            Math.abs(candles[j].high - candles[j - 1].close),
            Math.abs(candles[j].low - candles[j - 1].close)
        );
        sum += tr;
        count++;
    }
    return count > 0 ? sum / count : 0;
}

// ============================================================
// FIX #15: Slope percentile cache computation
// ============================================================
function computeSlopePercentiles(candles, ema, lookback = 50) {
    const percentiles = new Array(candles.length).fill(undefined);
    const slopes = [];

    for (let i = 0; i < candles.length; i++) {
        if (i < 5 || ema[i] == null || ema[i - 5] == null || ema[i - 5] === 0) {
            continue;
        }
        const slope = (ema[i] - ema[i - 5]) / Math.abs(ema[i - 5]);
        slopes.push({ index: i, slope: Math.abs(slope) });
    }

    // For each bar, compute where its slope ranks among the last 'lookback' slopes
    for (let i = 0; i < slopes.length; i++) {
        const currentSlope = slopes[i].slope;
        const windowStart = Math.max(0, i - lookback);
        const windowSlopes = slopes.slice(windowStart, i + 1).map(s => s.slope);
        windowSlopes.sort((a, b) => a - b);
        let rank = 0;
        for (let k = 0; k < windowSlopes.length; k++) {
            if (currentSlope >= windowSlopes[k]) rank++;
        }
        const percentile = (rank / windowSlopes.length) * 100;
        percentiles[slopes[i].index] = percentile;
    }

    return percentiles;
}

// ============================================================
// CORE STRATEGY EVALUATION V2 (with all fixes integrated)
// ============================================================

function twoLeggedPullbackCoreV2(candles, params = {}) {
    // Merge: defaults → fix profile → caller overrides (caller wins)
    const profileOverrides = resolveFixProfile(params);
    const p = { ...DEFAULT_PARAMS_V2, ...profileOverrides, ...params };

    const sampleCandle = candles[0];
    const instrumentKey = sampleCandle?.instrument || sampleCandle?.instrument_key || p.instrument_key || p.instrument;
    const instConfig = getInstrumentConfig(instrumentKey);
    const resolvedTickSize = p.tickSize !== undefined
        ? p.tickSize
        : (instConfig?.tickSize || getTickSize(instrumentKey));

    const useStructural = p.useStructuralRules || false;
    const isBrooksTrend = useBrooksTrend(p);

    let emaTouchRatioVal, triggerOffsetRatioVal, stopOffsetRatioVal;
    let doubleTopBottomToleranceRatioVal, structureOffsetRatioVal;

    if (useStructural) {
        emaTouchRatioVal = instConfig?.emaTouchRatioV2 !== undefined
            ? instConfig.emaTouchRatioV2
            : p.emaTouchRatioV2;
        triggerOffsetRatioVal = instConfig?.triggerOffsetRatioV2 !== undefined
            ? instConfig.triggerOffsetRatioV2
            : p.triggerOffsetRatioV2;
        stopOffsetRatioVal = instConfig?.stopOffsetRatioV2 !== undefined
            ? instConfig.stopOffsetRatioV2
            : p.stopOffsetRatioV2;
        doubleTopBottomToleranceRatioVal = instConfig?.doubleTopBottomToleranceRatioV2 !== undefined
            ? instConfig.doubleTopBottomToleranceRatioV2
            : p.doubleTopBottomToleranceRatioV2;
        structureOffsetRatioVal = instConfig?.structureOffsetRatio !== undefined
            ? instConfig.structureOffsetRatio
            : p.structureOffsetRatio;
    } else {
        // FIX #11: Non-structural versions also read V2 config values now
        emaTouchRatioVal = instConfig?.emaTouchRatioV2 !== undefined
            ? instConfig.emaTouchRatioV2
            : p.emaTouchRatio;
        triggerOffsetRatioVal = instConfig?.triggerOffsetRatioV2 !== undefined
            ? instConfig.triggerOffsetRatioV2
            : p.triggerOffsetRatio;
        stopOffsetRatioVal = instConfig?.stopOffsetRatioV2 !== undefined
            ? instConfig.stopOffsetRatioV2
            : p.stopOffsetRatio;
        doubleTopBottomToleranceRatioVal = instConfig?.doubleTopBottomToleranceRatioV2 !== undefined
            ? instConfig.doubleTopBottomToleranceRatioV2
            : p.doubleTopBottomToleranceRatio;
        structureOffsetRatioVal = instConfig?.structureOffsetRatio !== undefined
            ? instConfig.structureOffsetRatio
            : p.structureOffsetRatio;
    }

    // FIX #17: Per-instrument confidence threshold
    let minConfidenceThreshold = p.minConfidenceThreshold;
    if (instConfig?.minConfidenceThreshold !== undefined) {
        minConfidenceThreshold = instConfig.minConfidenceThreshold;
    }

    const finalParams = {
        ...p,
        emaTouchRatio: emaTouchRatioVal,
        triggerOffsetRatio: triggerOffsetRatioVal,
        stopOffsetRatio: stopOffsetRatioVal,
        doubleTopBottomToleranceRatio: doubleTopBottomToleranceRatioVal,
        structureOffsetRatio: structureOffsetRatioVal,
        tickSize: resolvedTickSize,
        minConfidenceThreshold,
    };

    const signals = [];
    if (candles.length < finalParams.emaPeriod + finalParams.minTrendBars) return signals;

    const ema = calculateEMA(candles, finalParams.emaPeriod);

    // FIX #15: Pre-compute slope percentiles for confidence scoring
    let slopePercentileCache = null;
    if (finalParams.enableConfidenceScoring && finalParams.usePercentileSlopeScoring) {
        slopePercentileCache = computeSlopePercentiles(candles, ema, 50);
    }

    let lastPullbackSignalIdx = -Infinity;
    let lastTrapSignalIdx = -Infinity;

    for (let i = finalParams.emaPeriod + finalParams.minTrendBars; i < candles.length; i++) {
        const trend = assessTrendV2(candles, ema, i, finalParams);
        const sBar = candles[i];
        const range = sBar.high - sBar.low;
        if (range <= 0) continue;

        const avgRange = getAverageBarRangeV2(candles, i, 10);

        let emaTouchDistance, triggerOffset, stopOffset, doubleTopBottomTolerance, triggerBreakDist;

        if (finalParams.useRatios) {
            emaTouchDistance = avgRange > 0 ? avgRange * finalParams.emaTouchRatio : (finalParams.emaTouchTicks * finalParams.tickSize);
            triggerOffset = avgRange > 0 ? avgRange * finalParams.triggerOffsetRatio : (finalParams.triggerOffsetTicks * finalParams.tickSize);
            stopOffset = avgRange > 0 ? avgRange * finalParams.stopOffsetRatio : (finalParams.stopOffsetTicks * finalParams.tickSize);
            doubleTopBottomTolerance = avgRange > 0 ? avgRange * finalParams.doubleTopBottomToleranceRatio : (finalParams.doubleTopBottomToleranceTicks * finalParams.tickSize);
            triggerBreakDist = avgRange > 0 ? avgRange * finalParams.triggerOffsetRatio : finalParams.tickSize;
        } else {
            emaTouchDistance = finalParams.emaTouchTicks * finalParams.tickSize;
            triggerOffset = finalParams.triggerOffsetTicks * finalParams.tickSize;
            stopOffset = finalParams.stopOffsetTicks * finalParams.tickSize;
            doubleTopBottomTolerance = finalParams.doubleTopBottomToleranceTicks * finalParams.tickSize;
            triggerBreakDist = finalParams.tickSize;
        }

        // FIX #9: ATR dynamic stop floor
        let atrStopFloor = 0;
        if (finalParams.enableATRStopFloor) {
            const atrVal = computeATR(candles, i, finalParams.atrStopPeriod || 14);
            atrStopFloor = atrVal * (finalParams.atrStopMultiplier || 0.5);
        }

        if (isWhipsawingV2(candles, ema, i, finalParams)) continue;

        if (finalParams.enableGiantBarFilter) {
            if (range > avgRange * finalParams.giantBarMultiplier) continue;
        }

        let signalFound = false;

        // FIX #6: Structural pivot detection
        const effectiveSwingLookback = finalParams.swingLookback + finalParams.minTrendBars;
        let adjustedSwingHighIdx, adjustedSwingLowIdx;

        if (finalParams.useStructuralRules) {
            const rawHighIdx = findPullbackSwingIndexV2(candles, i, effectiveSwingLookback, 'high', finalParams);
            if (rawHighIdx !== null) {
                adjustedSwingHighIdx = rawHighIdx;
                const dtTolerance = avgRange * (finalParams.doubleTopBottomToleranceRatioV2 || 0.15);
                for (let k = rawHighIdx + 1; k < i - 1; k++) {
                    if (candles[k].high <= candles[rawHighIdx].high &&
                        (candles[rawHighIdx].high - candles[k].high) <= dtTolerance) {
                        adjustedSwingHighIdx = k;
                    }
                }
            }
            const rawLowIdx = findPullbackSwingIndexV2(candles, i, effectiveSwingLookback, 'low', finalParams);
            if (rawLowIdx !== null) {
                adjustedSwingLowIdx = rawLowIdx;
                const dbTolerance = avgRange * (finalParams.doubleTopBottomToleranceRatioV2 || 0.15);
                for (let k = rawLowIdx + 1; k < i - 1; k++) {
                    if (candles[k].low >= candles[rawLowIdx].low &&
                        (candles[k].low - candles[rawLowIdx].low) <= dbTolerance) {
                        adjustedSwingLowIdx = k;
                    }
                }
            }
        } else {
            adjustedSwingHighIdx = findPullbackSwingIndexV2(candles, i, effectiveSwingLookback, 'high', finalParams);
            adjustedSwingLowIdx = findPullbackSwingIndexV2(candles, i, effectiveSwingLookback, 'low', finalParams);
        }

        // FIX #5 + #7: Use V2 leg evaluators
        // Build legacy-style setup objects for structural wrappers
        const legEvalParams = { ...finalParams };

        // 1. SECOND ENTRY LONG (H2)
        if (trend.bullish && (i - lastPullbackSignalIdx >= finalParams.minBarsBetweenSignals) && !signalFound) {
            if (adjustedSwingHighIdx !== null) {
                let setup;
                if (finalParams.useStructuralRules) {
                    // Delegate to original structural evaluators (they use the same logic, V2 only changes pivot/trend which is already handled above)
                    setup = finalParams.requireStrictSecondLeg
                        ? original.evaluateStructuralStrictH2Setup(candles, adjustedSwingHighIdx, i, finalParams.tickSize, avgRange, finalParams)
                        : original.evaluateStructuralH2Setup(candles, adjustedSwingHighIdx, i, finalParams.tickSize, avgRange, finalParams);
                } else {
                    setup = finalParams.requireStrictSecondLeg
                        ? (original.evaluateStrictH2Setup ? original.evaluateStrictH2Setup(candles, adjustedSwingHighIdx, i, finalParams.tickSize, finalParams) : evaluateH2SetupV2(candles, adjustedSwingHighIdx, i, finalParams.tickSize, legEvalParams))
                        : evaluateH2SetupV2(candles, adjustedSwingHighIdx, i, finalParams.tickSize, legEvalParams);
                }

                if (setup.isH2) {
                    let touchEMA;
                    if (finalParams.useDirectionalEMATest) {
                        touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.close > ema[i];
                    } else {
                        touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.high >= ema[i] - emaTouchDistance;
                    }
                    const passesSignalBarCheck = validateSignalBarV2(sBar, 'BUY', finalParams);

                    if (touchEMA && passesSignalBarCheck) {
                        let score = 100;
                        let passesScore = true;

                        if (finalParams.enableConfidenceScoring) {
                            score = calculateConfidenceScoreV2(candles, ema, i, 'BUY', finalParams, avgRange, slopePercentileCache);
                            passesScore = typeof finalParams.confidenceFilter === 'function'
                                ? finalParams.confidenceFilter(score)
                                : (score >= minConfidenceThreshold);
                        }

                        if (passesScore) {
                            const baseStopLoss = sBar.low - stopOffset;
                            // FIX #9: ATR stop floor
                            const stopLoss = finalParams.enableATRStopFloor
                                ? Math.min(baseStopLoss, sBar.low - atrStopFloor)
                                : baseStopLoss;

                            const triggerPrice = sBar.high + triggerOffset;
                            const risk = Math.abs(triggerPrice - stopLoss);

                            let takeProfit = triggerPrice + risk * finalParams.rewardRatio;
                            let structuralTarget = null;
                            if (finalParams.useStructuralTarget && adjustedSwingHighIdx !== null) {
                                structuralTarget = candles[adjustedSwingHighIdx].high + triggerOffset;
                                // FIX #14: Cap structural target at 2.2R instead of rejecting
                                const maxTP = triggerPrice + risk * 2.2;
                                takeProfit = Math.min(structuralTarget, maxTP);
                            }

                            const reward = Math.abs(takeProfit - triggerPrice);
                            const rrr = risk > 0 ? reward / risk : 0;

                            if (risk > 0 && rrr >= 0.8) {
                                signals.push({
                                    index: i,
                                    type: 'BUY_STOP',
                                    triggerPrice,
                                    stopLoss,
                                    takeProfit,
                                    rewardRatio: finalParams.rewardRatio,
                                    useStructuralTarget: finalParams.useStructuralTarget,
                                    structuralTarget: structuralTarget || takeProfit,
                                    confidence: finalParams.enableConfidenceScoring ? score : null,
                                    timestamp: sBar.timestamp,
                                    reason: `H2 Pullback V2${finalParams.enableConfidenceScoring ? ` (Conf: ${score}/${minConfidenceThreshold})` : ''}`,
                                    fixes_applied: getActiveFixes(finalParams),
                                });
                                lastPullbackSignalIdx = i;
                                signalFound = true;
                            }
                        }
                    }
                }
            }
        }

        // 2. SECOND ENTRY SHORT (L2)
        if (trend.bearish && (i - lastPullbackSignalIdx >= finalParams.minBarsBetweenSignals) && !signalFound) {
            if (adjustedSwingLowIdx !== null) {
                let setup;
                if (finalParams.useStructuralRules) {
                    setup = finalParams.requireStrictSecondLeg
                        ? original.evaluateStructuralStrictL2Setup(candles, adjustedSwingLowIdx, i, finalParams.tickSize, avgRange, finalParams)
                        : original.evaluateStructuralL2Setup(candles, adjustedSwingLowIdx, i, finalParams.tickSize, avgRange, finalParams);
                } else {
                    setup = finalParams.requireStrictSecondLeg
                        ? (original.evaluateStrictL2Setup ? original.evaluateStrictL2Setup(candles, adjustedSwingLowIdx, i, finalParams.tickSize, finalParams) : evaluateL2SetupV2(candles, adjustedSwingLowIdx, i, finalParams.tickSize, legEvalParams))
                        : evaluateL2SetupV2(candles, adjustedSwingLowIdx, i, finalParams.tickSize, legEvalParams);
                }

                if (setup.isL2) {
                    let touchEMA;
                    if (finalParams.useDirectionalEMATest) {
                        touchEMA = sBar.high >= ema[i] - emaTouchDistance && sBar.close < ema[i];
                    } else {
                        touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.high >= ema[i] - emaTouchDistance;
                    }
                    const passesSignalBarCheck = validateSignalBarV2(sBar, 'SELL', finalParams);

                    if (touchEMA && passesSignalBarCheck) {
                        let score = 100;
                        let passesScore = true;

                        if (finalParams.enableConfidenceScoring) {
                            score = calculateConfidenceScoreV2(candles, ema, i, 'SELL', finalParams, avgRange, slopePercentileCache);
                            passesScore = typeof finalParams.confidenceFilter === 'function'
                                ? finalParams.confidenceFilter(score)
                                : (score >= minConfidenceThreshold);
                        }

                        if (passesScore) {
                            const baseStopLoss = sBar.high + stopOffset;
                            // FIX #9: ATR stop floor
                            const stopLoss = finalParams.enableATRStopFloor
                                ? Math.max(baseStopLoss, sBar.high + atrStopFloor)
                                : baseStopLoss;

                            const triggerPrice = sBar.low - triggerOffset;
                            const risk = Math.abs(stopLoss - triggerPrice);

                            let takeProfit = triggerPrice - risk * finalParams.rewardRatio;
                            let structuralTarget = null;
                            if (finalParams.useStructuralTarget && adjustedSwingLowIdx !== null) {
                                structuralTarget = candles[adjustedSwingLowIdx].low - triggerOffset;
                                // FIX #14: Cap structural target at 2.2R instead of rejecting
                                const maxTP = triggerPrice - risk * 2.2;
                                takeProfit = Math.max(structuralTarget, maxTP);
                            }

                            const reward = Math.abs(triggerPrice - takeProfit);
                            const rrr = risk > 0 ? reward / risk : 0;

                            if (risk > 0 && rrr >= 0.8) {
                                signals.push({
                                    index: i,
                                    type: 'SELL_STOP',
                                    triggerPrice,
                                    stopLoss,
                                    takeProfit,
                                    rewardRatio: finalParams.rewardRatio,
                                    useStructuralTarget: finalParams.useStructuralTarget,
                                    structuralTarget: structuralTarget || takeProfit,
                                    confidence: finalParams.enableConfidenceScoring ? score : null,
                                    timestamp: sBar.timestamp,
                                    reason: `L2 Pullback V2${finalParams.enableConfidenceScoring ? ` (Conf: ${score}/${minConfidenceThreshold})` : ''}`,
                                    fixes_applied: getActiveFixes(finalParams),
                                });
                                lastPullbackSignalIdx = i;
                                signalFound = true;
                            }
                        }
                    }
                }
            }
        }

        // 3. FAILED SECOND ENTRY TRAPS
        if (finalParams.enableTraps && (i - lastTrapSignalIdx >= finalParams.minBarsBetweenSignals) && !signalFound) {
            // --- Long Trap ---
            if (trend.bullish) {
                const lookbackStart = Math.max(finalParams.emaPeriod, i - finalParams.trapMaxLookback);
                for (let L = i - 1; L >= lookbackStart; L--) {
                    const swingLowIdx = findPullbackSwingIndexV2(candles, L, effectiveSwingLookback, 'low', finalParams);
                    if (swingLowIdx !== null) {
                        let setupL2;
                        if (finalParams.useStructuralRules) {
                            setupL2 = finalParams.requireStrictSecondLeg
                                ? original.evaluateStructuralStrictL2Setup(candles, swingLowIdx, L, finalParams.tickSize, avgRange, finalParams)
                                : original.evaluateStructuralL2Setup(candles, swingLowIdx, L, finalParams.tickSize, avgRange, finalParams);
                        } else {
                            setupL2 = finalParams.requireStrictSecondLeg
                                ? (original.evaluateStrictL2Setup ? original.evaluateStrictL2Setup(candles, swingLowIdx, L, finalParams.tickSize, finalParams) : evaluateL2SetupV2(candles, swingLowIdx, L, finalParams.tickSize, legEvalParams))
                                : evaluateL2SetupV2(candles, swingLowIdx, L, finalParams.tickSize, legEvalParams);
                        }

                        if (setupL2.isL2) {
                            const triggeredShort = candles[L + 1] && candles[L + 1].low < candles[L].low - triggerBreakDist;
                            if (triggeredShort) {
                                let isDoubleBottom = true;
                                if (finalParams.requireDoubleTopBottomTrap) {
                                    const l2Low = Math.min(candles[L].low, candles[L + 1].low);
                                    const diff = Math.abs(l2Low - candles[swingLowIdx].low);
                                    isDoubleBottom = diff <= doubleTopBottomTolerance;
                                }

                                const structureHigh = Math.max(candles[L].high, candles[L + 1].high);
                                if (sBar.high >= structureHigh && isDoubleBottom) {
                                    let score = 100;
                                    let passesScore = true;

                                    if (finalParams.enableConfidenceScoring) {
                                        score = calculateConfidenceScoreV2(candles, ema, i, 'BUY', finalParams, avgRange, slopePercentileCache);
                                        passesScore = typeof finalParams.confidenceFilter === 'function'
                                            ? finalParams.confidenceFilter(score)
                                            : (score >= minConfidenceThreshold);
                                    }

                                    if (passesScore) {
                                        const triggerPrice = structureHigh + triggerOffset;
                                        const baseStopLoss = Math.min(sBar.low, structureHigh) - stopOffset;
                                        const stopLoss = finalParams.enableATRStopFloor
                                            ? Math.min(baseStopLoss, Math.min(sBar.low, structureHigh) - atrStopFloor)
                                            : baseStopLoss;
                                        const risk = Math.abs(triggerPrice - stopLoss);

                                        let takeProfit = triggerPrice + risk * finalParams.rewardRatio;
                                        let structuralTarget = null;
                                        const swingHighIdx = findPullbackSwingIndexV2(candles, i, effectiveSwingLookback, 'high', finalParams);
                                        if (finalParams.useStructuralTarget && swingHighIdx !== null) {
                                            structuralTarget = candles[swingHighIdx].high + triggerOffset;
                                            const maxTP = triggerPrice + risk * 2.2;
                                            takeProfit = Math.min(structuralTarget, maxTP);
                                        }

                                        const reward = Math.abs(takeProfit - triggerPrice);
                                        const rrr = risk > 0 ? reward / risk : 0;

                                        if (risk > 0 && rrr >= 0.8) {
                                            signals.push({
                                                index: i,
                                                type: 'BUY_STOP',
                                                triggerPrice,
                                                stopLoss,
                                                takeProfit,
                                                rewardRatio: finalParams.rewardRatio,
                                                useStructuralTarget: finalParams.useStructuralTarget,
                                                structuralTarget: structuralTarget || takeProfit,
                                                confidence: finalParams.enableConfidenceScoring ? score : null,
                                                timestamp: sBar.timestamp,
                                                reason: `DOUBLE_TRAP_BUY V2${finalParams.enableConfidenceScoring ? ` (Conf: ${score}/${minConfidenceThreshold})` : ''}`,
                                                fixes_applied: getActiveFixes(finalParams),
                                            });
                                            lastTrapSignalIdx = i;
                                            signalFound = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // --- Short Trap ---
            if (trend.bearish && !signalFound) {
                const lookbackStart = Math.max(finalParams.emaPeriod, i - finalParams.trapMaxLookback);
                for (let L = i - 1; L >= lookbackStart; L--) {
                    const swingHighIdx = findPullbackSwingIndexV2(candles, L, effectiveSwingLookback, 'high', finalParams);
                    if (swingHighIdx !== null) {
                        let setupH2;
                        if (finalParams.useStructuralRules) {
                            setupH2 = finalParams.requireStrictSecondLeg
                                ? original.evaluateStructuralStrictH2Setup(candles, swingHighIdx, L, finalParams.tickSize, avgRange, finalParams)
                                : original.evaluateStructuralH2Setup(candles, swingHighIdx, L, finalParams.tickSize, avgRange, finalParams);
                        } else {
                            setupH2 = finalParams.requireStrictSecondLeg
                                ? (original.evaluateStrictH2Setup ? original.evaluateStrictH2Setup(candles, swingHighIdx, L, finalParams.tickSize, finalParams) : evaluateH2SetupV2(candles, swingHighIdx, L, finalParams.tickSize, legEvalParams))
                                : evaluateH2SetupV2(candles, swingHighIdx, L, finalParams.tickSize, legEvalParams);
                        }

                        if (setupH2.isH2) {
                            const triggeredLong = candles[L + 1] && candles[L + 1].high > candles[L].high + triggerBreakDist;
                            if (triggeredLong) {
                                let isDoubleTop = true;
                                if (finalParams.requireDoubleTopBottomTrap) {
                                    const h2High = Math.max(candles[L].high, candles[L + 1].high);
                                    const diff = Math.abs(h2High - candles[swingHighIdx].high);
                                    isDoubleTop = diff <= doubleTopBottomTolerance;
                                }

                                const structureLow = Math.min(candles[L].low, candles[L + 1].low);
                                if (sBar.low <= structureLow && isDoubleTop) {
                                    let score = 100;
                                    let passesScore = true;

                                    if (finalParams.enableConfidenceScoring) {
                                        score = calculateConfidenceScoreV2(candles, ema, i, 'SELL', finalParams, avgRange, slopePercentileCache);
                                        passesScore = typeof finalParams.confidenceFilter === 'function'
                                            ? finalParams.confidenceFilter(score)
                                            : (score >= minConfidenceThreshold);
                                    }

                                    if (passesScore) {
                                        const triggerPrice = structureLow - triggerOffset;
                                        const baseStopLoss = Math.max(sBar.high, structureLow) + stopOffset;
                                        const stopLoss = finalParams.enableATRStopFloor
                                            ? Math.max(baseStopLoss, Math.max(sBar.high, structureLow) + atrStopFloor)
                                            : baseStopLoss;
                                        const risk = Math.abs(stopLoss - triggerPrice);

                                        let takeProfit = triggerPrice - risk * finalParams.rewardRatio;
                                        let structuralTarget = null;
                                        const swingLowIdx = findPullbackSwingIndexV2(candles, i, effectiveSwingLookback, 'low', finalParams);
                                        if (finalParams.useStructuralTarget && swingLowIdx !== null) {
                                            structuralTarget = candles[swingLowIdx].low - triggerOffset;
                                            const maxTP = triggerPrice - risk * 2.2;
                                            takeProfit = Math.max(structuralTarget, maxTP);
                                        }

                                        const reward = Math.abs(triggerPrice - takeProfit);
                                        const rrr = risk > 0 ? reward / risk : 0;

                                        if (risk > 0 && rrr >= 0.8) {
                                            signals.push({
                                                index: i,
                                                type: 'SELL_STOP',
                                                triggerPrice,
                                                stopLoss,
                                                takeProfit,
                                                rewardRatio: finalParams.rewardRatio,
                                                useStructuralTarget: finalParams.useStructuralTarget,
                                                structuralTarget: structuralTarget || takeProfit,
                                                confidence: finalParams.enableConfidenceScoring ? score : null,
                                                timestamp: sBar.timestamp,
                                                reason: `DOUBLE_TRAP_SELL V2${finalParams.enableConfidenceScoring ? ` (Conf: ${score}/${minConfidenceThreshold})` : ''}`,
                                                fixes_applied: getActiveFixes(finalParams),
                                            });
                                            lastTrapSignalIdx = i;
                                            signalFound = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    signals.sort((a, b) => a.index - b.index);
    return signals;
}

// Helper: list of active fixes for logging
function getActiveFixes(params) {
    const fixes = [];
    if (params.useABRNormalizedSlope) fixes.push('TREND_ABR_NORMALIZED_SLOPE');
    if (params.enableADXFilter) fixes.push('TREND_ADX_FILTER');
    if (!params.requireGapBar) fixes.push('TREND_GAP_BAR_OPTIONAL');
    if (params.minLeg1Bars > 1 || params.minH1BounceBars > 1 || params.minLeg2Bars > 1) fixes.push('LEG_MIN_BAR_SPACING_VOLUME');
    if (params.useStructuralPivotDetection) fixes.push('PIVOT_STRUCTURAL_DETECTION');
    if ((params.minSecondLegDepthRatio || 0) > 0 && !params.requireStrictSecondLeg) fixes.push('LEG_DEPTH_RATIO');
    if (params.stopOffsetRatio >= 0.25) fixes.push('STOP_WIDER_RATIO');
    if (params.enableATRStopFloor) fixes.push('ATR_DYNAMIC_STOP_FLOOR');
    if (params.triggerOffsetRatio >= 0.08) fixes.push('TRIGGER_WIDER_OFFSET');
    fixes.push('DEFAULT_V2_RATIOS');
    if (params.enableTrailingStop) fixes.push('TRAILING_STOP');
    if (params.enableTimeExit) fixes.push('TIME_BASED_EXIT');
    if (params.useStructuralTarget) fixes.push('STRUCTURAL_TARGET_RRR_FIX');
    if (params.usePercentileSlopeScoring) fixes.push('SCORING_PERCENTILE_SLOPE');
    if (params.useUnmitigatedFVGCheck) fixes.push('FVG_UNMITIGATED_CHECK');
    fixes.push('PER_INSTRUMENT_CONFIDENCE');
    if (params.useBarPathExitResolution) fixes.push('SAME_BAR_EXIT_PATH');
    if (params.resetDailyPnLAtSession) fixes.push('DAILY_PNL_RESET');
    if ((params.slippageTicks || 0) > 0) fixes.push('SLIPPAGE_MODELING');
    return fixes;
}

// ============================================================
// FIX #12, #13, #24, #25, #26: BACKTESTER V2
// ============================================================

function runPriceActionBacktestV2(candles, signals = [], initialCapital = 100000, params = {}) {
    const p = { ...DEFAULT_PARAMS_V2, ...params };

    let startingCapital = parseFloat(initialCapital);
    if (isNaN(startingCapital) || typeof startingCapital !== 'number') {
        startingCapital = 100000;
    }

    let equity = startingCapital;
    let position = null;
    let pendingOrder = null;
    const trades = [];

    let consecutiveLosses = 0;
    let dailyPnL = 0;
    const maxDailyLoss = equity * p.maxDailyLoss;

    const signalMap = new Map();
    if (Array.isArray(signals)) {
        signals.forEach(sig => {
            signalMap.set(sig.index, sig);
        });
    }

    // FIX #25: Track session boundaries for daily PnL reset
    let currentSessionDate = null;

    for (let i = p.emaPeriod + p.minTrendBars; i < candles.length; i++) {
        const bar = candles[i];

        // FIX #25: Check session date and reset dailyPnL
        if (p.resetDailyPnLAtSession && bar.timestamp) {
            const barDate = new Date(bar.timestamp).toISOString().split('T')[0];
            if (currentSessionDate && barDate !== currentSessionDate) {
                dailyPnL = 0;
                consecutiveLosses = 0;
            }
            currentSessionDate = barDate;
        }

        // 1. Process active trade exits
        if (position) {
            if (position.direction === 'long') {
                position.bestPrice = Math.max(position.bestPrice, bar.high);
                position.worstPrice = Math.min(position.worstPrice, bar.low);
            } else {
                position.bestPrice = Math.min(position.bestPrice, bar.low);
                position.worstPrice = Math.max(position.worstPrice, bar.high);
            }

            // FIX #12: Trailing stop logic
            if (p.enableTrailingStop && position.entryPrice) {
                const risk = Math.abs(position.entryPrice - position.stopLoss_initial);
                const profitInR = position.direction === 'long'
                    ? (bar.high - position.entryPrice) / risk
                    : (position.entryPrice - bar.low) / risk;

                if (profitInR >= p.breakevenRR && !position.stopMovedToBE) {
                    // Move stop to breakeven
                    position.stopLoss = position.entryPrice;
                    position.stopMovedToBE = true;
                }

                if (profitInR >= p.trailRR) {
                    // Trail the stop
                    const trailDistance = risk * p.trailDistanceRR;
                    if (position.direction === 'long') {
                        const newStop = bar.high - trailDistance;
                        if (newStop > position.stopLoss) {
                            position.stopLoss = newStop;
                        }
                    } else {
                        const newStop = bar.low + trailDistance;
                        if (newStop < position.stopLoss) {
                            position.stopLoss = newStop;
                        }
                    }
                }
            }

            let exitPrice = null;
            let exitReason = null;

            if (position.direction === 'long') {
                const stoppedOut = bar.low <= position.stopLoss;
                const tpReached = bar.high >= position.takeProfit;

                // FIX #24: Use bar path resolution
                if (stoppedOut && tpReached && p.useBarPathExitResolution) {
                    // Check open→high→low path
                    const hitTPFirst = bar.open <= position.takeProfit && bar.high >= position.takeProfit;
                    const hitSLFirst = bar.open >= position.stopLoss && bar.low <= position.stopLoss;
                    if (hitTPFirst && !hitSLFirst) {
                        exitPrice = position.takeProfit;
                        exitReason = 'take_profit';
                    } else if (hitSLFirst && !hitTPFirst) {
                        exitPrice = position.stopLoss;
                        exitReason = 'stop_loss';
                    } else {
                        // Both or neither — default to stop (conservative)
                        exitPrice = position.stopLoss;
                        exitReason = 'stop_loss';
                    }
                } else if (stoppedOut && tpReached) {
                    exitPrice = position.stopLoss;
                    exitReason = 'stop_loss';
                } else if (stoppedOut) {
                    exitPrice = position.stopLoss;
                    exitReason = 'stop_loss';
                } else if (tpReached) {
                    exitPrice = position.takeProfit;
                    exitReason = 'take_profit';
                }
            } else {
                const stoppedOut = bar.high >= position.stopLoss;
                const tpReached = bar.low <= position.takeProfit;

                if (stoppedOut && tpReached && p.useBarPathExitResolution) {
                    const hitTPFirst = bar.open >= position.takeProfit && bar.low <= position.takeProfit;
                    const hitSLFirst = bar.open <= position.stopLoss && bar.high >= position.stopLoss;
                    if (hitTPFirst && !hitSLFirst) {
                        exitPrice = position.takeProfit;
                        exitReason = 'take_profit';
                    } else if (hitSLFirst && !hitTPFirst) {
                        exitPrice = position.stopLoss;
                        exitReason = 'stop_loss';
                    } else {
                        exitPrice = position.stopLoss;
                        exitReason = 'stop_loss';
                    }
                } else if (stoppedOut && tpReached) {
                    exitPrice = position.stopLoss;
                    exitReason = 'stop_loss';
                } else if (stoppedOut) {
                    exitPrice = position.stopLoss;
                    exitReason = 'stop_loss';
                } else if (tpReached) {
                    exitPrice = position.takeProfit;
                    exitReason = 'take_profit';
                }
            }

            // FIX #13: Time-based exit
            if (!exitPrice && p.enableTimeExit) {
                const barsInTrade = i - position.entryIndex;
                if (barsInTrade >= p.maxBarsInTrade) {
                    exitPrice = bar.close;
                    exitReason = 'time_exit';
                }
            }

            if (exitPrice !== null) {
                const pnlAmount = position.quantity * (exitPrice - position.entry) * (position.direction === 'long' ? 1 : -1);
                equity += pnlAmount;

                if (pnlAmount < 0) {
                    consecutiveLosses++;
                    dailyPnL += pnlAmount;
                } else {
                    consecutiveLosses = 0;
                }

                const initialTpDist = Math.abs(position.takeProfit - position.entry);
                const mafePercentage = initialTpDist > 0
                    ? Math.min(100, Math.max(0, (Math.abs(position.bestPrice - position.entry) / initialTpDist) * 100))
                    : 0;

                const initialSlDist = Math.abs(position.entry - position.stopLoss_initial || position.stopLoss);
                const maePercentage = initialSlDist > 0
                    ? Math.max(0, (Math.abs(position.entry - position.worstPrice) / initialSlDist) * 100)
                    : 0;

                trades.push({
                    entryIndex: position.entryIndex,
                    exitIndex: i,
                    entryPrice: position.entry,
                    exitPrice,
                    stopLoss: position.stopLoss_initial || position.stopLoss,
                    takeProfit: position.takeProfit,
                    pnlPercentage: (pnlAmount / (equity - pnlAmount)) * 100,
                    pnlAmount,
                    exitReason,
                    direction: position.direction,
                    confidence: position.confidence,
                    mafePrice: position.bestPrice,
                    mafePercentage: parseFloat(mafePercentage.toFixed(2)),
                    maePrice: position.worstPrice,
                    maePercentage: parseFloat(maePercentage.toFixed(2)),
                    wasTrailed: position.stopMovedToBE || false,
                    metadata: position.metadata,
                    fixes_applied: position.fixes_applied || [],
                });

                position = null;
            }
        }

        // 2. Pending orders
        if (!position && pendingOrder) {
            let triggered = false;
            let entryPrice = 0;

            // FIX #26: Slippage modeling
            const slipAmount = p.slippageTicks * p.tickSize;

            if (pendingOrder.type === 'BUY_STOP') {
                if (bar.high >= pendingOrder.triggerPrice) {
                    triggered = true;
                    entryPrice = Math.max(bar.open, pendingOrder.triggerPrice) + slipAmount;
                }
            } else {
                if (bar.low <= pendingOrder.triggerPrice) {
                    triggered = true;
                    entryPrice = Math.min(bar.open, pendingOrder.triggerPrice) - slipAmount;
                }
            }

            if (triggered) {
                const risk = Math.abs(entryPrice - pendingOrder.stopLoss);
                if (risk > 0) {
                    const riskAmount = equity * p.maxRiskPerTrade;
                    const quantity = riskAmount / risk;

                    let finalTP;
                    if (pendingOrder.useStructuralTarget && pendingOrder.structuralTarget !== null) {
                        const maxTP = pendingOrder.type === 'BUY_STOP'
                            ? entryPrice + risk * 2.2
                            : entryPrice - risk * 2.2;
                        if (pendingOrder.type === 'BUY_STOP') {
                            finalTP = Math.min(pendingOrder.structuralTarget, maxTP);
                        } else {
                            finalTP = Math.max(pendingOrder.structuralTarget, maxTP);
                        }
                    } else {
                        finalTP = pendingOrder.type === 'BUY_STOP'
                            ? entryPrice + risk * pendingOrder.rewardRatio
                            : entryPrice - risk * pendingOrder.rewardRatio;
                    }

                    position = {
                        direction: pendingOrder.type === 'BUY_STOP' ? 'long' : 'short',
                        entry: entryPrice,
                        quantity,
                        entryIndex: i,
                        stopLoss: pendingOrder.stopLoss,
                        stopLoss_initial: pendingOrder.stopLoss,
                        takeProfit: finalTP,
                        confidence: pendingOrder.confidence,
                        bestPrice: entryPrice,
                        worstPrice: entryPrice,
                        stopMovedToBE: false,
                        metadata: pendingOrder.metadata,
                        fixes_applied: pendingOrder.fixes_applied || [],
                    };

                    if (position.direction === 'long') {
                        position.bestPrice = Math.max(position.bestPrice, bar.high);
                        position.worstPrice = Math.min(position.worstPrice, bar.low);
                    } else {
                        position.bestPrice = Math.min(position.bestPrice, bar.low);
                        position.worstPrice = Math.max(position.worstPrice, bar.high);
                    }

                    // Check for same-bar exit
                    let exitPrice = null;
                    let exitReason = null;

                    if (position.direction === 'long') {
                        const stoppedOut = bar.low <= position.stopLoss;
                        const tpReached = bar.high >= position.takeProfit;
                        if (stoppedOut && tpReached && p.useBarPathExitResolution) {
                            const hitTPFirst = bar.open <= position.takeProfit && bar.high >= position.takeProfit;
                            if (hitTPFirst) {
                                exitPrice = position.takeProfit;
                                exitReason = 'take_profit';
                            } else {
                                exitPrice = position.stopLoss;
                                exitReason = 'stop_loss';
                            }
                        } else if (stoppedOut && tpReached) {
                            exitPrice = position.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = position.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = position.takeProfit;
                            exitReason = 'take_profit';
                        }
                    } else {
                        const stoppedOut = bar.high >= position.stopLoss;
                        const tpReached = bar.low <= position.takeProfit;
                        if (stoppedOut && tpReached && p.useBarPathExitResolution) {
                            const hitTPFirst = bar.open >= position.takeProfit && bar.low <= position.takeProfit;
                            if (hitTPFirst) {
                                exitPrice = position.takeProfit;
                                exitReason = 'take_profit';
                            } else {
                                exitPrice = position.stopLoss;
                                exitReason = 'stop_loss';
                            }
                        } else if (stoppedOut && tpReached) {
                            exitPrice = position.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = position.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = position.takeProfit;
                            exitReason = 'take_profit';
                        }
                    }

                    if (exitPrice !== null) {
                        const pnlAmount = position.quantity * (exitPrice - position.entry) * (position.direction === 'long' ? 1 : -1);
                        equity += pnlAmount;

                        if (pnlAmount < 0) {
                            consecutiveLosses++;
                            dailyPnL += pnlAmount;
                        } else {
                            consecutiveLosses = 0;
                        }

                        const initialTpDist = Math.abs(position.takeProfit - position.entry);
                        const mafePercentage = initialTpDist > 0
                            ? Math.min(100, Math.max(0, (Math.abs(position.bestPrice - position.entry) / initialTpDist) * 100))
                            : 0;
                        const initialSlDist = Math.abs(position.entry - position.stopLoss_initial || position.stopLoss);
                        const maePercentage = initialSlDist > 0
                            ? Math.max(0, (Math.abs(position.entry - position.worstPrice) / initialSlDist) * 100)
                            : 0;

                        trades.push({
                            entryIndex: position.entryIndex,
                            exitIndex: i,
                            entryPrice: position.entry,
                            exitPrice,
                            stopLoss: position.stopLoss_initial || position.stopLoss,
                            takeProfit: position.takeProfit,
                            pnlPercentage: (pnlAmount / (equity - pnlAmount)) * 100,
                            pnlAmount,
                            exitReason,
                            direction: position.direction,
                            confidence: position.confidence,
                            mafePrice: position.bestPrice,
                            mafePercentage: parseFloat(mafePercentage.toFixed(2)),
                            maePrice: position.worstPrice,
                            maePercentage: parseFloat(maePercentage.toFixed(2)),
                            wasTrailed: false,
                            metadata: position.metadata,
                            fixes_applied: position.fixes_applied || [],
                        });

                        position = null;
                    }
                }
            }

            pendingOrder = null;
        }

        // 3. Scan signals (with FIX #25 cool-down respecting daily reset)
        if (!position && consecutiveLosses < p.maxConsecutiveLosses && dailyPnL > -maxDailyLoss) {
            if (signalMap.has(i)) {
                const signal = signalMap.get(i);
                pendingOrder = {
                    type: signal.type,
                    triggerPrice: signal.triggerPrice,
                    stopLoss: signal.stopLoss,
                    rewardRatio: signal.rewardRatio !== undefined ? signal.rewardRatio : p.rewardRatio,
                    useStructuralTarget: signal.useStructuralTarget || false,
                    structuralTarget: signal.structuralTarget || null,
                    confidence: signal.confidence !== undefined ? signal.confidence : null,
                    fixes_applied: signal.fixes_applied || [],
                    metadata: { setupType: signal.type, signalBarIndex: i },
                };
            }
        }
    }

    const totalTrades = trades.length;
    const wins = trades.filter(t => t.exitReason === 'take_profit').length;
    const losses = trades.filter(t => t.exitReason === 'stop_loss').length;
    const timeExits = trades.filter(t => t.exitReason === 'time_exit').length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    return {
        trades,
        finalEquity: equity,
        summary: {
            totalTrades,
            wins,
            losses,
            timeExits,
            winRate,
            win_rate: winRate,
            "Win Rate": winRate,
            pnlPercentage: ((equity - startingCapital) / startingCapital) * 100,
            pnl: ((equity - startingCapital) / startingCapital) * 100,
        },
    };
}

// ============================================================
// BATCH VERSIONS GENERATOR — V51–V250 are clones of V1–V50 with fix profiles
// V251–V850: individual fix clones (12 fixes × 50 originals)
// ============================================================

// Map: V1→V50 name suffixes to their param overrides (mirrors V1-V50 definitions)
// Each V1-V50 strategy has: useRatios flag + enableTraps + optional extras
const V1_V50_TEMPLATES = [
    // V1–V10: Original Absolute Ticks
    { suffix: "Double Traps",                      overrides: { useRatios: false, enableTraps: true } },
    { suffix: "EMA Pullback",                      overrides: { useRatios: false, enableTraps: false } },
    { suffix: "High Confidence",                   overrides: { useRatios: false, enableTraps: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true } },
    { suffix: "Aggressive",                        overrides: { useRatios: false, enableTraps: false, minSignalBarCloseRatio: 0.50 } },
    { suffix: "Wade Structural",                   overrides: { useRatios: false, enableTraps: true, useStructuralTarget: true } },
    { suffix: "Double Traps (Strict)",             overrides: { useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true } },
    { suffix: "EMA Pullback (Strict)",             overrides: { useRatios: false, enableTraps: false, requireStrictSecondLeg: true } },
    { suffix: "High Confidence (Strict)",          overrides: { useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true } },
    { suffix: "Aggressive (Strict)",               overrides: { useRatios: false, enableTraps: false, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50 } },
    { suffix: "Wade Structural (Strict)",           overrides: { useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true } },
    // V11–V20: Calibrated Ratio
    { suffix: "Double Traps (Calibrated)",          overrides: { enableTraps: true } },
    { suffix: "EMA Pullback (Calibrated)",          overrides: { enableTraps: false } },
    { suffix: "High Confidence (Calibrated)",       overrides: { enableTraps: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true } },
    { suffix: "Aggressive (Calibrated)",            overrides: { enableTraps: false, minSignalBarCloseRatio: 0.50 } },
    { suffix: "Wade Structural (Calibrated)",       overrides: { enableTraps: true, useStructuralTarget: true } },
    { suffix: "Double Traps (Strict-Calibrated)",   overrides: { enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true } },
    { suffix: "EMA Pullback (Strict-Calibrated)",   overrides: { enableTraps: false, requireStrictSecondLeg: true } },
    { suffix: "High Confidence (Strict-Calibrated)",overrides: { enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true } },
    { suffix: "Aggressive (Strict-Calibrated)",     overrides: { enableTraps: false, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50 } },
    { suffix: "Wade Structural (Strict-Calibrated)",overrides: { enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true } },
    // V21–V30: Structural Calibrated
    { suffix: "Double Traps (Structural-Calibrated)",       overrides: { enableTraps: true, useStructuralRules: true } },
    { suffix: "EMA Pullback (Structural-Calibrated)",       overrides: { enableTraps: false, useStructuralRules: true } },
    { suffix: "High Confidence (Structural-Calibrated)",    overrides: { enableTraps: true, useStructuralRules: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true } },
    { suffix: "Aggressive (Structural-Calibrated)",         overrides: { enableTraps: false, useStructuralRules: true, minSignalBarCloseRatio: 0.50 } },
    { suffix: "Wade Structural (Structural-Calibrated)",    overrides: { enableTraps: true, useStructuralRules: true, useStructuralTarget: true } },
    { suffix: "Double Traps (Strict Structural-Calibrated)",overrides: { enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true } },
    { suffix: "EMA Pullback (Strict Structural-Calibrated)",overrides: { enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true } },
    { suffix: "High Confidence (Strict Structural-Calibrated)",overrides: { enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true } },
    { suffix: "Aggressive (Strict Structural-Calibrated)",  overrides: { enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50 } },
    { suffix: "Wade Structural (Strict Structural-Calibrated)",overrides: { enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true } },
    // V31–V40: Upgraded Absolute Ticks
    { suffix: "Double Traps (Upgraded)",             overrides: { useRatios: false, enableTraps: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "EMA Pullback (Upgraded)",             overrides: { useRatios: false, enableTraps: false, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "High Confidence (Upgraded)",          overrides: { useRatios: false, enableTraps: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Aggressive (Upgraded)",               overrides: { useRatios: false, enableTraps: false, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Wade Structural (Upgraded)",           overrides: { useRatios: false, enableTraps: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Double Traps (Strict Upgraded)",       overrides: { useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "EMA Pullback (Strict Upgraded)",       overrides: { useRatios: false, enableTraps: false, requireStrictSecondLeg: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "High Confidence (Strict Upgraded)",    overrides: { useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Aggressive (Strict Upgraded)",         overrides: { useRatios: false, enableTraps: false, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Wade Structural (Strict Upgraded)",    overrides: { useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    // V41–V50: Upgraded Structural Calibrated
    { suffix: "Double Traps (Structural-Calibrated Upgraded)",       overrides: { enableTraps: true, useStructuralRules: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "EMA Pullback (Structural-Calibrated Upgraded)",       overrides: { enableTraps: false, useStructuralRules: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "High Confidence (Structural-Calibrated Upgraded)",    overrides: { enableTraps: true, useStructuralRules: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Aggressive (Structural-Calibrated Upgraded)",         overrides: { enableTraps: false, useStructuralRules: true, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Wade Structural (Structural-Calibrated Upgraded)",    overrides: { enableTraps: true, useStructuralRules: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Double Traps (Strict Structural-Calibrated Upgraded)", overrides: { enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "EMA Pullback (Strict Structural-Calibrated Upgraded)", overrides: { enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "High Confidence (Strict Structural-Calibrated Upgraded)",overrides: { enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, usePercentileSlopeScoring: true, useUnmitigatedFVGCheck: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Aggressive (Strict Structural-Calibrated Upgraded)", overrides: { enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
    { suffix: "Wade Structural (Strict Structural-Calibrated Upgraded)",overrides: { enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 } },
];

// Batch definitions: { baseVersion, prefix, fix_profile }
const BATCHES = [
    { baseVersion: 51,  prefix: "(Entry/Stop)", fix_profile: "entry_stop", desc: "Entry/Stop fixes" },
    { baseVersion: 101, prefix: "(Trend)",      fix_profile: "trend",      desc: "Trend fixes" },
    { baseVersion: 151, prefix: "(Leg Quality)",fix_profile: "leg_quality",desc: "Leg Quality fixes" },
    { baseVersion: 201, prefix: "(Exit Mgmt)",  fix_profile: "exit_mgmt",  desc: "Exit Management fixes" },
];

function generateBatchStrategies() {
    const strategies = {};

    for (const batch of BATCHES) {
        for (let i = 0; i < V1_V50_TEMPLATES.length; i++) {
            const tpl = V1_V50_TEMPLATES[i];
            const origV = i + 1;
            const batchV = batch.baseVersion + i;
            const label = `V${batchV}: ${tpl.suffix} ${batch.prefix}`;

            strategies[label] = (candles, params = {}) => {
                return twoLeggedPullbackCoreV2(candles, {
                    ...tpl.overrides,
                    fix_profile: batch.fix_profile,
                    ...params,
                });
            };
        }
    }

    return strategies;
}

const STRATEGIES_V2 = generateBatchStrategies();

// ============================================================
// INDIVIDUAL FIX STRATEGIES — V251-V850: 12 fixes × 50 originals
// Each version applies exactly ONE fix to its base original
// ============================================================

function generateIndividualFixStrategies() {
    const strategies = {};

    for (let fixIdx = 0; fixIdx < INDIVIDUAL_FIX_ORDER.length; fixIdx++) {
        const fixProfile = INDIVIDUAL_FIX_ORDER[fixIdx];
        const fixLabel = INDIVIDUAL_FIX_LABELS[fixProfile];
        const baseVersion = 251 + fixIdx * 50;

        for (let i = 0; i < V1_V50_TEMPLATES.length; i++) {
            const tpl = V1_V50_TEMPLATES[i];
            const verNum = baseVersion + i;
            const label = `V${verNum}: ${tpl.suffix} ${fixLabel}`;

            strategies[label] = (candles, params = {}) => {
                return twoLeggedPullbackCoreV2(candles, {
                    ...tpl.overrides,
                    fix_profile: fixProfile,
                    ...params,
                });
            };
        }
    }

    return strategies;
}

const INDIVIDUAL_FIX_STRATEGIES = generateIndividualFixStrategies();
console.error(`Generated ${Object.keys(INDIVIDUAL_FIX_STRATEGIES).length} individual fix strategies (V251-V${251 + INDIVIDUAL_FIX_ORDER.length * 50 - 1})`);

// ============================================================
// COMBINED FIX PROFILES — V51-V100: best winning fix combination per base version
// Each version applies the UNION of all winning batch fix profiles for that base.
// Generated from Section C WR Delta analysis.
// ============================================================

const COMBINED_FIX_PROFILES = {
  "combined_v1": {"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true},                        // V51: Double Traps (Leg Quality)
  "combined_v2": {},                                                                                         // V52: EMA Pullback (no winners)
  "combined_v3": {},                                                                                         // V53: High Confidence (no winners)
  "combined_v4": {},                                                                                         // V54: Aggressive (no winners)
  "combined_v5": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V55: Wade Structural (Entry/Stop + Exit Mgmt + Trend)
  "combined_v6": {"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},                        // V56: Double Traps Strict (Exit Mgmt + Trend)
  "combined_v7": {},                                                                                         // V57: EMA Pullback Strict (no winners)
  "combined_v8": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V58: High Confidence Strict (all 4)
  "combined_v9": {"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false},                // V59: Aggressive Strict (Trend)
  "combined_v10": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V60: Wade Structural Strict (all 4)
  "combined_v11": {},                                                                                        // V61: Double Traps Calibrated (no winners)
  "combined_v12": {"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true},                        // V62: EMA Pullback Calibrated (Leg Quality)
  "combined_v13": {},                                                                                        // V63: High Confidence Calibrated (no winners)
  "combined_v14": {"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true},                        // V64: Aggressive Calibrated (Leg Quality)
  "combined_v15": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V65: Wade Structural Calibrated (Entry/Stop + Exit Mgmt + Trend)
  "combined_v16": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V66-V70: Strict-Calibrated (all 4)
  "combined_v17": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v18": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v19": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v20": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v21": {},                                                                                        // V71: Double Traps Structural-Calibrated (no winners — already optimal)
  "combined_v22": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V72-V80: Strict-Structural-Calibrated (all 4)
  "combined_v24": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v25": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V75: Wade Structural Structural-Calibrated (all 4)
  "combined_v26": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v27": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v28": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v29": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v30": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v31": {"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},  // V81: Double Traps Upgraded (Exit Mgmt + Leg Quality + Trend)
  "combined_v32": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},   // V82: (all 4)
  "combined_v33": {"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},   // V83: High Confidence Upgraded (Exit Mgmt + Leg Quality)
  "combined_v34": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},   // V84-V85: (all 4)
  "combined_v35": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v36": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V86: (Entry/Stop + Exit Mgmt + Leg Quality)
  "combined_v37": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V87
  "combined_v38": {"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true}, // V88: High Confidence Strict Upgraded (Leg Quality)
  "combined_v39": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V89
  "combined_v41": {"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true}, // V91: Double Traps Structural-Calibrated Upgraded (Leg Quality)
  "combined_v42": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V92
  "combined_v43": {"useABRNormalizedSlope":true,"enableADXFilter":true,"requireGapBar":false,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V93: High Confidence SC Upgraded (Exit Mgmt + Trend)
  "combined_v44": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V94-V97: Entry/Stop + Exit Mgmt
  "combined_v45": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v46": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v47": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true},
  "combined_v48": {"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true}, // V98: High Confidence SSU (Leg Quality)
  "combined_v49": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V99
  "combined_v50": {"stopOffsetRatio":0.3,"triggerOffsetRatio":0.08,"triggerOffsetRatioV2":0.08,"enableATRStopFloor":true,"slippageTicks":1,"minSecondLegDepthRatio":0.6,"useStructuralPivotDetection":true,"enableTrailingStop":true,"enableTimeExit":true,"useBarPathExitResolution":true}, // V100
};

// ============================================================
// V51-V100: BASE + COMBINED FIXES (best winning fix combination per version)
// ============================================================

const COMBINED_FIX_LABELS = {
    "combined_v1": "(Leg Quality)", "combined_v2": "(Base)", "combined_v3": "(Base)", "combined_v4": "(Base)",
    "combined_v5": "(Entry/Stop + Trend + Exit Mgmt)", "combined_v6": "(Trend + Exit Mgmt)", "combined_v7": "(Base)",
    "combined_v8": "(All 4 Fixes)", "combined_v9": "(Trend)", "combined_v10": "(All 4 Fixes)",
    "combined_v11": "(Base)", "combined_v12": "(Leg Quality)", "combined_v13": "(Base)", "combined_v14": "(Leg Quality)",
    "combined_v15": "(Entry/Stop + Trend + Exit Mgmt)", "combined_v16": "(All 4 Fixes)", "combined_v17": "(All 4 Fixes)",
    "combined_v18": "(All 4 Fixes)", "combined_v19": "(All 4 Fixes)", "combined_v20": "(All 4 Fixes)",
    "combined_v21": "(Base - Already Optimal)", "combined_v22": "(All 4 Fixes)",
    "combined_v24": "(All 4 Fixes)", "combined_v25": "(All 4 Fixes)",
    "combined_v26": "(All 4 Fixes)", "combined_v27": "(All 4 Fixes)", "combined_v28": "(All 4 Fixes)",
    "combined_v29": "(All 4 Fixes)", "combined_v30": "(All 4 Fixes)",
    "combined_v31": "(Trend + Leg Quality + Exit Mgmt)", "combined_v32": "(All 4 Fixes)",
    "combined_v33": "(Leg Quality + Exit Mgmt)", "combined_v34": "(All 4 Fixes)", "combined_v35": "(All 4 Fixes)",
    "combined_v36": "(Entry/Stop + Leg Quality + Exit Mgmt)", "combined_v37": "(Entry/Stop + Leg Quality + Exit Mgmt)",
    "combined_v38": "(Leg Quality)", "combined_v39": "(Entry/Stop + Leg Quality + Exit Mgmt)",
    "combined_v41": "(Leg Quality)", "combined_v42": "(Entry/Stop + Leg Quality + Exit Mgmt)",
    "combined_v43": "(Trend + Exit Mgmt)", "combined_v44": "(Entry/Stop + Exit Mgmt)", "combined_v45": "(Entry/Stop + Exit Mgmt)",
    "combined_v46": "(Entry/Stop + Exit Mgmt)", "combined_v47": "(Entry/Stop + Exit Mgmt)",
    "combined_v48": "(Leg Quality)", "combined_v49": "(Entry/Stop + Exit Mgmt)", "combined_v50": "(Entry/Stop + Leg Quality + Exit Mgmt)",
};

function generateCombinedFixStrategies() {
    const strategies = {};
    // Bases where NO batch fix improves WR — skip combined fix version
    const SKIP_BASES = new Set([2, 3, 4, 7, 11, 13, 21, 23]);

    for (let i = 0; i < V1_V50_TEMPLATES.length; i++) {
        const origV = i + 1;
        if (SKIP_BASES.has(origV)) continue;
        
        const tpl = V1_V50_TEMPLATES[i];
        const verNum = origV + 50; // V51-V100
        const profileKey = 'combined_v' + origV;
        const fixParams = COMBINED_FIX_PROFILES[profileKey];
        const labelSuffix = COMBINED_FIX_LABELS[profileKey] || '(Combined Fixes)';
        const label = `V${verNum}: ${tpl.suffix} ${labelSuffix}`;

        strategies[label] = (candles, params = {}) => {
            // Apply combined fix parameters directly as overrides (not via fix_profile)
            return twoLeggedPullbackCoreV2(candles, {
                ...tpl.overrides,
                ...fixParams,
                ...params,
            });
        };
    }

    return strategies;
}

const COMBINED_FIX_STRATEGIES = generateCombinedFixStrategies();
console.error('Generated ' + Object.keys(COMBINED_FIX_STRATEGIES).length + ' combined fix strategies (V51-V100, 8 bases excluded)');

// ============================================================
// SUBSET FALLBACK PROFILES — V115-V133: smaller fix combos
// For bases with 3+ winning profiles, test subsets in case full combination reduces trades
// ============================================================

const SUBSET_FALLBACKS = [
    // V5: Wade Structural — 3 winning profiles (Entry/Stop, Trend, Exit Mgmt)
    { base: 5, ver: 115, label: '(Exit Mgmt)', overrides: { enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    { base: 5, ver: 116, label: '(Trend)', overrides: { useABRNormalizedSlope: true, enableADXFilter: true, requireGapBar: false } },
    { base: 5, ver: 117, label: '(Exit Mgmt + Trend)', overrides: { enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true, useABRNormalizedSlope: true, enableADXFilter: true, requireGapBar: false } },
    // V8: High Confidence Strict — 4 winning profiles
    { base: 8, ver: 118, label: '(Entry/Stop + Exit Mgmt)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    { base: 8, ver: 119, label: '(Leg Quality + Exit Mgmt)', overrides: { minSecondLegDepthRatio: 0.60, useStructuralPivotDetection: true, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    { base: 8, ver: 120, label: '(Entry/Stop + Leg Quality + Exit Mgmt)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, minSecondLegDepthRatio: 0.60, useStructuralPivotDetection: true, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    // V15: Wade Structural Calibrated — 3 winning profiles
    { base: 15, ver: 121, label: '(Exit Mgmt)', overrides: { enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    { base: 15, ver: 122, label: '(Trend)', overrides: { useABRNormalizedSlope: true, enableADXFilter: true, requireGapBar: false } },
    // V25: Wade Structural SC — 4 winning profiles
    { base: 25, ver: 123, label: '(Exit Mgmt)', overrides: { enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    { base: 25, ver: 124, label: '(Trend)', overrides: { useABRNormalizedSlope: true, enableADXFilter: true, requireGapBar: false } },
    { base: 25, ver: 125, label: '(Entry/Stop + Exit Mgmt)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    // V16-V20: Strict-Calibrated (all 4) — test without Trend
    { base: 16, ver: 126, label: '(Entry/Stop + Exit Mgmt + Leg Quality)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, minSecondLegDepthRatio: 0.60, useStructuralPivotDetection: true, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    // V26-V30: Strict-SC (all 4) — test Exit Mgmt + Trend only
    { base: 26, ver: 127, label: '(Exit Mgmt + Trend)', overrides: { enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true, useABRNormalizedSlope: true, enableADXFilter: true, requireGapBar: false } },
    // V31: Double Traps Upgraded — Leg Quality only
    { base: 31, ver: 128, label: '(Leg Quality)', overrides: { minSecondLegDepthRatio: 0.60, useStructuralPivotDetection: true } },
    // V36-V37: Strict Upgraded — Entry/Stop + Exit Mgmt
    { base: 36, ver: 129, label: '(Entry/Stop + Exit Mgmt)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    // V10: Wade Structural Strict — entry/stop + exit mgmt
    { base: 10, ver: 130, label: '(Entry/Stop + Exit Mgmt)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    // V18: HC Strict-Calibrated — entry/stop + exit mgmt
    { base: 18, ver: 131, label: '(Entry/Stop + Exit Mgmt)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    // V36 Base: Double Traps Strict Upgraded — Exit Mgmt only
    { base: 36, ver: 132, label: '(Exit Mgmt)', overrides: { enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
    // V50: Wade SSU — Entry/Stop + Exit Mgmt
    { base: 50, ver: 133, label: '(Entry/Stop + Exit Mgmt)', overrides: { stopOffsetRatio: 0.30, triggerOffsetRatio: 0.08, triggerOffsetRatioV2: 0.08, enableATRStopFloor: true, slippageTicks: 1, enableTrailingStop: true, enableTimeExit: true, useBarPathExitResolution: true } },
];

function generateSubsetFallbackStrategies() {
    const strategies = {};

    for (const fb of SUBSET_FALLBACKS) {
        const tpl = V1_V50_TEMPLATES[fb.base - 1]; // 0-indexed
        if (!tpl) continue;
        const label = `V${fb.ver}: ${tpl.suffix} ${fb.label}`;

        strategies[label] = (candles, params = {}) => {
            return twoLeggedPullbackCoreV2(candles, {
                ...tpl.overrides,
                ...fb.overrides,
                ...params,
            });
        };
    }

    return strategies;
}

const SUBSET_FALLBACK_STRATEGIES = generateSubsetFallbackStrategies();
console.error('Generated ' + Object.keys(SUBSET_FALLBACK_STRATEGIES).length + ' subset fallback strategies (V115-V133)');

// ============================================================
// BROOKS BASE PARAM TEMPLATES (used by both V851+ and V101-V114)
// ============================================================

const BROOKS_BASE_PARAMS = [
    { suffix: 'Brooks Structural Pure', overrides: { useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12, enableTraps: false, enableConfidenceScoring: false, useDirectionalEMATest: true, useStructuralTarget: true, structureOffsetRatio: 0.08, doubleTopBottomToleranceRatioV2: 0.12, minBarsBetweenSignals: 3 } },
    { suffix: 'Brooks Volume-Optimized', overrides: { useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useBrooksTrend: true, minTrendBars: 12, swingLookback: 8, enableTraps: false, enableConfidenceScoring: false, useDirectionalEMATest: true, useStructuralTarget: true, structureOffsetRatio: 0.10, doubleTopBottomToleranceRatioV2: 0.15, emaTouchRatioV2: 0.18, minBarsBetweenSignals: 4 } },
    { suffix: 'Brooks Selective (Win-Rate Focus)', overrides: { useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useBrooksTrend: true, minTrendBars: 20, swingLookback: 14, enableTraps: false, enableConfidenceScoring: false, useDirectionalEMATest: true, useStructuralTarget: true, structureOffsetRatio: 0.08, doubleTopBottomToleranceRatioV2: 0.10, emaTouchRatioV2: 0.12, minBarsBetweenSignals: 5, minSignalBarCloseRatio: 0.70 } },
];

const BROOKS_BATCH_PROFILES = [
    { offset: 0,  label: '(Original)',   fix_profile: 'off' },
    { offset: 3,  label: '(Entry/Stop)', fix_profile: 'entry_stop' },
    { offset: 6,  label: '(Trend)',      fix_profile: 'trend' },
    { offset: 9,  label: '(Leg Quality)',fix_profile: 'leg_quality' },
    { offset: 12, label: '(Exit Mgmt)',  fix_profile: 'exit_mgmt' },
];

function generateBrooksStrategies() {
    const strategies = {};
    const BROOKS_BASE = 851;
    strategies['V851: Brooks Structural Pure (Original)'] = undefined;
    strategies['V852: Brooks Volume-Optimized (Original)'] = undefined;
    strategies['V853: Brooks Selective (Win-Rate Focus) (Original)'] = undefined;
    for (const batch of BROOKS_BATCH_PROFILES) {
        if (batch.label === '(Original)') continue;
        for (let i = 0; i < BROOKS_BASE_PARAMS.length; i++) {
            const verNum = BROOKS_BASE + 3 + batch.offset + i;
            const label = 'V' + verNum + ': ' + BROOKS_BASE_PARAMS[i].suffix + ' ' + batch.label;
            strategies[label] = (candles, params = {}) => {
                return twoLeggedPullbackCoreV2(candles, { ...BROOKS_BASE_PARAMS[i].overrides, fix_profile: batch.fix_profile, ...params });
            };
        }
    }
    const BROOKS_INDIV_BASE = BROOKS_BASE + 3 + 15;
    for (let fixIdx = 0; fixIdx < INDIVIDUAL_FIX_ORDER.length; fixIdx++) {
        const fp = INDIVIDUAL_FIX_ORDER[fixIdx];
        const fl = INDIVIDUAL_FIX_LABELS[fp];
        for (let i = 0; i < BROOKS_BASE_PARAMS.length; i++) {
            const verNum = BROOKS_INDIV_BASE + fixIdx * 3 + i;
            const label = 'V' + verNum + ': ' + BROOKS_BASE_PARAMS[i].suffix + ' ' + fl;
            strategies[label] = (candles, params = {}) => {
                return twoLeggedPullbackCoreV2(candles, { ...BROOKS_BASE_PARAMS[i].overrides, fix_profile: fp, ...params });
            };
        }
    }
    return strategies;
}

const BROOKS_STRATEGIES = generateBrooksStrategies();
console.error('Generated ' + Object.keys(BROOKS_STRATEGIES).filter(k => BROOKS_STRATEGIES[k] !== undefined).length + ' Brooks strategies (V851-V' + (851 + 3 + 15 + 3 * INDIVIDUAL_FIX_ORDER.length - 1) + ')');

// ============================================================
// BROOKS V101-V114: remapped Brooks strategies for final 106-set
// (Must be after BROOKS_BASE_PARAMS is defined)
// ============================================================

const BROOKS_V101_V114 = [
    { ver: 101, base: 0, label: '(Original)' },
    { ver: 102, base: 1, label: '(Original)' },
    { ver: 103, base: 2, label: '(Original)' },
    { ver: 104, base: 2, label: '(Exit Mgmt)', fix: 'exit_mgmt' },
    { ver: 105, base: 2, label: '(Leg Quality)', fix: 'leg_quality' },
    { ver: 106, base: 2, label: '(Stop Wider)', fix: 'stop_wider' },
    { ver: 107, base: 2, label: '(Entry/Stop)', fix: 'entry_stop' },
    { ver: 108, base: 0, label: '(Exit Mgmt)', fix: 'exit_mgmt' },
    { ver: 109, base: 1, label: '(Exit Mgmt)', fix: 'exit_mgmt' },
    { ver: 110, base: 2, label: '(ABR Slope)', fix: 'abr_slope' },
    { ver: 111, base: 2, label: '(Bar Path Exit)', fix: 'bar_path' },
    { ver: 112, base: 0, label: '(Leg Quality)', fix: 'leg_quality' },
    { ver: 113, base: 1, label: '(Leg Quality)', fix: 'leg_quality' },
    { ver: 114, base: 2, label: '(Trailing Stop)', fix: 'trailing' },
];

function generateBrooks101to114() {
    const strategies = {};

    for (const entry of BROOKS_V101_V114) {
        const bp = BROOKS_BASE_PARAMS[entry.base];
        if (!bp) continue;
        const label = `V${entry.ver}: ${bp.suffix} ${entry.label}`;

        if (entry.fix) {
            strategies[label] = (candles, params = {}) => {
                return twoLeggedPullbackCoreV2(candles, {
                    ...bp.overrides,
                    fix_profile: entry.fix,
                    ...params,
                });
            };
        } else {
            strategies[label] = (candles, params = {}) => {
                return twoLeggedPullbackCoreV2(candles, {
                    ...bp.overrides,
                    ...params,
                });
            };
        }
    }

    return strategies;
}

const BROOKS_101_114_STRATEGIES = generateBrooks101to114();
console.error('Generated ' + Object.keys(BROOKS_101_114_STRATEGIES).length + ' Brooks V101-V114 strategies');


// ============================================================
// NEW COMBINATORIAL FIX GENERATOR — V901-V950
// Combines individual fixes NOT covered by existing group/batch fixes
// Each combo applies a union of 2-3 positive individual fix profiles
// ============================================================

const COMBINATORIAL_COMBOS = [
    // ABR Slope + ADX Filter (for Double Traps / High Confidence families)
    { profiles: ["abr_slope", "adx_filter"], label: "(ABR Slope + ADX Filter)", note: "2-fix combo — beats Group Trend for Double Traps" },
    // ATR Floor + ADX Filter (for Struct-Cal High Conf / Wade families)
    { profiles: ["atr_floor", "adx_filter"], label: "(ATR Floor + ADX Filter)", note: "2-fix combo — strongest for Struct-Cal" },
    // ATR Floor + ABR Slope (for Struct-Cal families)
    { profiles: ["atr_floor", "abr_slope"], label: "(ATR Floor + ABR Slope)", note: "2-fix combo — both positive for Struct-Cal" },
    // ATR Floor + ABR Slope + ADX Filter — Triple combo
    { profiles: ["atr_floor", "abr_slope", "adx_filter"], label: "(ATR Floor + ABR Slope + ADX Filter)", note: "Triple combo — maximum positive fixes" },
];

function buildCombinatorialProfile(profiles) {
    const merged = {};
    for (const pName of profiles) {
        const profile = FIX_PROFILES[pName];
        if (profile) Object.assign(merged, profile);
    }
    return merged;
}

function generateCombinatorialFixStrategies() {
    const strategies = {};
    // Only generate combinatorials for specific base families (1-5, 11-15, 21-25, 31-35, 41-45)
    // i.e., skip strict versions (6-10, 16-20, 26-30, 36-40, 46-50)
    const TARGET_INDICES = [0,1,2,3,4, 10,11,12,13,14, 20,21,22,23,24, 30,31,32,33,34, 40,41,42,43,44];

    for (let comboIdx = 0; comboIdx < COMBINATORIAL_COMBOS.length; comboIdx++) {
        const combo = COMBINATORIAL_COMBOS[comboIdx];
        const baseVersion = 901 + comboIdx * 10; // V901, V911, V921, V931
        const mergedParams = buildCombinatorialProfile(combo.profiles);

        for (let ti = 0; ti < TARGET_INDICES.length; ti++) {
            const i = TARGET_INDICES[ti];
            if (i >= V1_V50_TEMPLATES.length) continue;
            const tpl = V1_V50_TEMPLATES[i];
            const verNum = baseVersion + (i % 100);
            const label = `V${verNum}: ${tpl.suffix} ${combo.label}`;
            strategies[label] = (candles, params = {}) => {
                return twoLeggedPullbackCoreV2(candles, {
                    ...tpl.overrides,
                    ...mergedParams,
                    ...params,
                });
            };
        }
    }
    return strategies;
}

const COMBINATORIAL_FIX_STRATEGIES = generateCombinatorialFixStrategies();
console.error(`Generated ${Object.keys(COMBINATORIAL_FIX_STRATEGIES).length} combinatorial fix strategies (V901-V${901 + COMBINATORIAL_COMBOS.length * 10})`);

// ============================================================
// INSTRUMENT-PINDEX ANNOTATIONS for top-performing versions
// Appended to version name for live-trading reference
// ============================================================
const INSTRUMENT_ANNOTATIONS = {
    "V55: Wade Structural (Entry/Stop + Trend + Exit Mgmt)": " [SilverMini-p1, RelianceFut-p1, GoldPetal-p8]",
    "V92: EMA Pullback (Structural-Calibrated Upgraded) (Entry/Stop + Leg Quality + Exit Mgmt)": " [CrudeOil-p9, InfosysFut-p3, ApolloHospFut-p3]",
    "V94: Aggressive (Structural-Calibrated Upgraded) (Entry/Stop + Exit Mgmt)": " [CrudeOil-p6, AdaniEnt-p2]",
    "V125: Wade Structural (Structural-Calibrated) (Entry/Stop + Exit Mgmt)": " [ZincFut-p3, CrudeOilMini-p4, BajajFin-p1]",
    "V371: Double Traps (Structural-Calibrated) (ATR Floor)": " [TataSteel-p9, SAILFut-p10, JSWSteelFut-p1, BhartiAirtelFut-p3]",
    "V373: High Confidence (Structural-Calibrated) (ATR Floor)": " [TataSteel-p9, AdaniEnt-p9, TCS-p3, HindalcoFut-p9, KotakBankFut-p5]",
    "V375: Wade Structural (Structural-Calibrated) (ATR Floor)": " [ZincFut-p3, CrudeOilMini-p4, BajajFin-p1, NiftyBankFut-p9, SunPharma-p5]",
    "V376: Double Traps (Strict Structural-Calibrated) (ATR Floor)": " [GoldPetal-p6, TRENT-p8, Reliance-p1]",
    "V455: Wade Structural (ABR Slope)": " [PAYTM-p1, SilverMini-p10, Gold-p9]",
    "V523: High Confidence (Structural-Calibrated) (ADX Filter)": " [HDFCBank-p5, GAILFut-p3, TRENT-p5, TRENTFut-p3, AdaniEntFut-p3]",
    "V525: Wade Structural (Structural-Calibrated) (ADX Filter)": " [RelianceFut-p5, ICICIBank-p5]",
};

// ============================================================
// VERSION WHITELIST — keep ~122 versions (all V1-V50 + best fixes)
// ============================================================
const KEEP_VERSIONS = new Set([

    // === V1-V50: ALL BASE VERSIONS (including strict for future data) ===
    "V1: Double Traps", "V2: EMA Pullback", "V3: High Confidence", "V4: Aggressive", "V5: Wade Structural",
    "V6: Double Traps (Strict)", "V7: EMA Pullback (Strict)", "V8: High Confidence (Strict)", "V9: Aggressive (Strict)", "V10: Wade Structural (Strict)",
    "V11: Double Traps (Calibrated)", "V12: EMA Pullback (Calibrated)", "V13: High Confidence (Calibrated)", "V14: Aggressive (Calibrated)", "V15: Wade Structural (Calibrated)",
    "V16: Double Traps (Strict-Calibrated)", "V17: EMA Pullback (Strict-Calibrated)", "V18: High Confidence (Strict-Calibrated)", "V19: Aggressive (Strict-Calibrated)", "V20: Wade Structural (Strict-Calibrated)",
    "V21: Double Traps (Structural-Calibrated)", "V22: EMA Pullback (Structural-Calibrated)", "V23: High Confidence (Structural-Calibrated)", "V24: Aggressive (Structural-Calibrated)", "V25: Wade Structural (Structural-Calibrated)",
    "V26: Double Traps (Strict Structural-Calibrated)", "V27: EMA Pullback (Strict Structural-Calibrated)", "V28: High Confidence (Strict Structural-Calibrated)", "V29: Aggressive (Strict Structural-Calibrated)", "V30: Wade Structural (Strict Structural-Calibrated)",
    "V31: Double Traps (Upgraded)", "V32: EMA Pullback (Upgraded)", "V33: High Confidence (Upgraded)", "V34: Aggressive (Upgraded)", "V35: Wade Structural (Upgraded)",
    "V36: Double Traps (Strict Upgraded)", "V37: EMA Pullback (Strict Upgraded)", "V38: High Confidence (Strict Upgraded)", "V39: Aggressive (Strict Upgraded)", "V40: Wade Structural (Strict Upgraded)",
    "V41: Double Traps (Structural-Calibrated Upgraded)", "V42: EMA Pullback (Structural-Calibrated Upgraded)", "V43: High Confidence (Structural-Calibrated Upgraded)", "V44: Aggressive (Structural-Calibrated Upgraded)", "V45: Wade Structural (Structural-Calibrated Upgraded)",
    "V46: Double Traps (Strict Structural-Calibrated Upgraded)", "V47: EMA Pullback (Strict Structural-Calibrated Upgraded)", "V48: High Confidence (Strict Structural-Calibrated Upgraded)", "V49: Aggressive (Strict Structural-Calibrated Upgraded)", "V50: Wade Structural (Strict Structural-Calibrated Upgraded)",

    // === V51-V100: Best Combined Fix Winners (8) ===
    "V55: Wade Structural (Entry/Stop + Trend + Exit Mgmt)",
    "V60: Wade Structural (Strict) (All 4 Fixes)",
    "V65: Wade Structural (Calibrated) (Entry/Stop + Trend + Exit Mgmt)",
    "V70: Wade Structural (Strict-Calibrated) (All 4 Fixes)",
    "V83: High Confidence (Upgraded) (Leg Quality + Exit Mgmt)",
    "V90: Wade Structural (Strict Upgraded) (Combined Fixes)",
    "V92: EMA Pullback (Structural-Calibrated Upgraded) (Entry/Stop + Leg Quality + Exit Mgmt)",
    "V94: Aggressive (Structural-Calibrated Upgraded) (Entry/Stop + Exit Mgmt)",

    // === V101-V250: Best Batch Clones (15) ===
    "V101: Double Traps (Trend)",
    "V103: High Confidence (Trend)",
    "V105: Wade Structural (Trend)",
    "V111: Double Traps (Calibrated) (Trend)",
    "V125: Wade Structural (Structural-Calibrated) (Entry/Stop + Exit Mgmt)",
    "V153: High Confidence (Leg Quality)",
    "V163: High Confidence (Calibrated) (Leg Quality)",
    "V171: Double Traps (Structural-Calibrated) (Leg Quality)",
    "V203: High Confidence (Exit Mgmt)",
    "V205: Wade Structural (Exit Mgmt)",
    "V225: Wade Structural (Structural-Calibrated) (Exit Mgmt)",
    "V233: High Confidence (Upgraded) (Exit Mgmt)",
    "V115: Wade Structural (Exit Mgmt)",             // subset fallback
    "V124: Wade Structural (Structural-Calibrated) (Trend)",  // subset fallback
    "V123: Wade Structural (Structural-Calibrated) (Exit Mgmt)", // subset fallback

    // === V251-V350 Entry/Stop: Wade variants only (3, rest redundant) ===
    "V255: Wade Structural (Stop Wider)",
    "V305: Wade Structural (Trigger Wider)",

    // === V351-V400 ATR Floor (12) ===
    "V351: Double Traps (ATR Floor)",
    "V353: High Confidence (ATR Floor)",
    "V355: Wade Structural (ATR Floor)",
    "V356: Double Traps (Strict) (ATR Floor)",
    "V361: Double Traps (Calibrated) (ATR Floor)",
    "V365: Wade Structural (Calibrated) (ATR Floor)",
    "V371: Double Traps (Structural-Calibrated) (ATR Floor)",
    "V373: High Confidence (Structural-Calibrated) (ATR Floor)",
    "V375: Wade Structural (Structural-Calibrated) (ATR Floor)",
    "V376: Double Traps (Strict Structural-Calibrated) (ATR Floor)",
    "V381: Double Traps (Upgraded) (ATR Floor)",
    "V391: Double Traps (Structural-Calibrated Upgraded) (ATR Floor)",

    // === V451-V500 ABR Slope (6) ===
    "V451: Double Traps (ABR Slope)",
    "V453: High Confidence (ABR Slope)",
    "V455: Wade Structural (ABR Slope)",
    "V461: Double Traps (Calibrated) (ABR Slope)",
    "V475: Wade Structural (Structural-Calibrated) (ABR Slope)",
    "V495: Wade Structural (Structural-Calibrated Upgraded) (ABR Slope)",

    // === V501-V550 ADX Filter (8) ===
    "V501: Double Traps (ADX Filter)",
    "V503: High Confidence (ADX Filter)",
    "V505: Wade Structural (ADX Filter)",
    "V511: Double Traps (Calibrated) (ADX Filter)",
    "V521: Double Traps (Structural-Calibrated) (ADX Filter)",
    "V523: High Confidence (Structural-Calibrated) (ADX Filter)",
    "V525: Wade Structural (Structural-Calibrated) (ADX Filter)",
    "V531: Double Traps (Upgraded) (ADX Filter)",

    // === V651-V700 Pivot Structural (3) ===
    "V651: Double Traps (Pivot Structural)",
    "V653: High Confidence (Pivot Structural)",
    "V671: Double Traps (Structural-Calibrated) (Pivot Structural)",
]);

// ============================================================
// BUILD FINAL_EXPORT_MAP (~122 versions)
// ============================================================

const FINAL_STRATEGIES = {};

// Step 1: Copy V1-V50 from original
for (const [key, fn] of Object.entries(original.STRATEGIES)) {
    const vMatch = key.match(/^V(\d+):/);
    if (vMatch) {
        const vNum = parseInt(vMatch[1], 10);
        if (vNum >= 1 && vNum <= 50) {
            const baseKey = key.split(" [")[0]; // strip any existing annotation
            FINAL_STRATEGIES[baseKey] = fn;
        }
    }
}

// Step 2: From COMBINED_FIX_STRATEGIES — only whitelisted V51-V100
for (const [key, fn] of Object.entries(COMBINED_FIX_STRATEGIES)) {
    const baseKey = key.split(" [")[0];
    if (KEEP_VERSIONS.has(baseKey)) {
        const annotatedKey = INSTRUMENT_ANNOTATIONS[baseKey] ? baseKey + INSTRUMENT_ANNOTATIONS[baseKey] : baseKey;
        FINAL_STRATEGIES[annotatedKey] = fn;
    }
}

// Step 3: From batch strategies V2 — only whitelisted V101-V250
for (const [key, fn] of Object.entries(STRATEGIES_V2)) {
    const baseKey = key.split(" [")[0];
    if (KEEP_VERSIONS.has(baseKey)) {
        const annotatedKey = INSTRUMENT_ANNOTATIONS[baseKey] ? baseKey + INSTRUMENT_ANNOTATIONS[baseKey] : baseKey;
        FINAL_STRATEGIES[annotatedKey] = fn;
    }
}

// Step 4: From individual fix strategies — only whitelisted V251+
for (const [key, fn] of Object.entries(INDIVIDUAL_FIX_STRATEGIES)) {
    const baseKey = key.split(" [")[0];
    if (KEEP_VERSIONS.has(baseKey)) {
        const annotatedKey = INSTRUMENT_ANNOTATIONS[baseKey] ? baseKey + INSTRUMENT_ANNOTATIONS[baseKey] : baseKey;
        FINAL_STRATEGIES[annotatedKey] = fn;
    }
}

// Step 5: From subset fallback — only whitelisted V115-V133
for (const [key, fn] of Object.entries(SUBSET_FALLBACK_STRATEGIES)) {
    const baseKey = key.split(" [")[0];
    if (KEEP_VERSIONS.has(baseKey)) {
        const annotatedKey = INSTRUMENT_ANNOTATIONS[baseKey] ? baseKey + INSTRUMENT_ANNOTATIONS[baseKey] : baseKey;
        FINAL_STRATEGIES[annotatedKey] = fn;
    }
}

// Step 6: All combinatorial fixes (V901-V950)
for (const [key, fn] of Object.entries(COMBINATORIAL_FIX_STRATEGIES)) {
    FINAL_STRATEGIES[key] = fn;
}

// Step 7: Brooks strategies (minimal set for baseline comparison)
const BROOKS_RENAME = {
    "V51: Brooks Structural Pure": "V851: Brooks Structural Pure (Original)",
    "V52: Brooks Volume-Optimized": "V852: Brooks Volume-Optimized (Original)",
    "V53: Brooks Selective (Win-Rate Focus)": "V853: Brooks Selective (Win-Rate Focus) (Original)",
};
for (const [origName, newName] of Object.entries(BROOKS_RENAME)) {
    if (original.STRATEGIES[origName]) {
        FINAL_STRATEGIES[newName] = original.STRATEGIES[origName];
    }
}
// Also add select Brooks 101-114
const KEEP_BROOKS_101_114 = ["V101: Brooks Structural Pure (Original)", "V108: Brooks Structural Pure (Exit Mgmt)", "V113: Brooks Volume-Optimized (Leg Quality)"];
for (const [key, fn] of Object.entries(BROOKS_101_114_STRATEGIES)) {
    if (KEEP_BROOKS_101_114.includes(key)) {
        FINAL_STRATEGIES[key] = fn;
    }
}

console.error(`FINAL_STRATEGIES: ${Object.keys(FINAL_STRATEGIES).length} versions selected from ${Object.keys(original.STRATEGIES).length + Object.keys(STRATEGIES_V2).length + Object.keys(INDIVIDUAL_FIX_STRATEGIES).length + Object.keys(COMBINATORIAL_FIX_STRATEGIES).length} total`);

// Step 8: Apply useRatios/useStructuralRules flags for V1-V50 in FINAL_STRATEGIES
Object.keys(FINAL_STRATEGIES).forEach(key => {
    const vMatch = key.match(/^V(\d+):/);
    const vNum = vMatch ? parseInt(vMatch[1], 10) : 0;
    const isFixed = vNum >= 51;
    if (isFixed) return;

    const isCalibrated = key.includes("(Calibrated)") || key.includes("-Calibrated)") || key.includes("Structural-Calibrated");
    const isStructural = key.includes("Structural-Calibrated");
    const isBrooksTrend = key.includes("Upgraded");
    const isStrictLegInit = vNum >= 10;

    const originalFunc = FINAL_STRATEGIES[key];
    FINAL_STRATEGIES[key] = (candles, params = {}) => {
        const mergedParams = {
            useRatios: isCalibrated,
            useStructuralRules: isStructural,
            useBrooksTrend: isBrooksTrend,
            useStrictLegInitiation: isStrictLegInit,
            ...(isBrooksTrend ? { minTrendBars: 18, swingLookback: 12 } : {}),
            ...params,
        };
        return originalFunc(candles, mergedParams);
    };
});

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    // Original utilities
    DEFAULT_PARAMS: original.DEFAULT_PARAMS,
    calculateEMA: original.calculateEMA,
    findPullbackSwingIndex: original.findPullbackSwingIndex,
    evaluateH2Setup: original.evaluateH2Setup,
    evaluateL2Setup: original.evaluateL2Setup,
    evaluateStrictH2Setup: original.evaluateStrictH2Setup,
    evaluateStrictL2Setup: original.evaluateStrictL2Setup,

    // V2 utilities
    DEFAULT_PARAMS_V2,
    findPullbackSwingIndexV2,
    calculateConfidenceScoreV2,
    evaluateH2SetupV2,
    evaluateL2SetupV2,
    twoLeggedPullbackCoreV2,
    runPriceActionBacktestV2,
    computeSlopePercentiles,
    computeATR,
    getActiveFixes,

    // All strategies (V1–V50 original, V51–V250 batch fix clones, V251–V850 individual fix clones, V851+ Brooks)
    STRATEGIES: FINAL_STRATEGIES,

    // Convenience exports for backward compatibility
    twoLeggedPullback: FINAL_STRATEGIES["V51: Fixed Double Traps"] || FINAL_STRATEGIES["V1: Double Traps"],
    runPriceActionBacktest: (candles, signals, initialCapital, params) => {
        // Auto-detect V2 vs V1: if signals have fixes_applied, use V2 backtester
        const hasV2Signals = signals && signals.length > 0 && signals[0].fixes_applied;
        if (hasV2Signals) {
            return runPriceActionBacktestV2(candles, signals, initialCapital, params);
        }
        return original.runPriceActionBacktest(candles, signals, initialCapital, params);
    },
};