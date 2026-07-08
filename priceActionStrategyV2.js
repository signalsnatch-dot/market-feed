/**
 * Price Action Strategy V2 (Fixed Editions Engine)
 * 
 * Inherits all V1–V53 strategies from priceActionStrategy.js untouched.
 * Introduces V51–V100 (fixed clones of V1–V50) and V104–V106 (fixed clones of V101–V103).
 * 
 * Version Map:
 *   V1–V50     → Preserved from original (UNCHANGED)
 *   V51–V53    → Renamed to V101–V103 (preserved, UNCHANGED)
 *   V51–V100   → Fixed clones of V1–V50 with all corrections applied
 *   V104–V106  → Fixed clones of V101–V103 with all corrections applied
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
// BATCH VERSIONS GENERATOR — V51–V300 are clones of V1–V50
// with fix_profile injected for per-batch testing
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
    { baseVersion: 51,  prefix: "(Baseline)",   fix_profile: "off",         desc: "Baseline clones — no fixes" },
    { baseVersion: 101, prefix: "(Entry/Stop)", fix_profile: "entry_stop", desc: "Entry/Stop fixes" },
    { baseVersion: 151, prefix: "(Trend)",      fix_profile: "trend",      desc: "Trend fixes" },
    { baseVersion: 201, prefix: "(Leg Quality)",fix_profile: "leg_quality",desc: "Leg Quality fixes" },
    { baseVersion: 251, prefix: "(Exit Mgmt)",  fix_profile: "exit_mgmt",  desc: "Exit Management fixes" },
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
// BROOKS STRATEGIES (V301–V306)
// ============================================================

const BROOKS_STRATEGIES = {
    // V301–V303: Original Brooks (renamed from V51-V53)
    "V301: Brooks Structural Pure (Original)": undefined,        // filled from rename map
    "V302: Brooks Volume-Optimized (Original)": undefined,
    "V303: Brooks Selective (Win-Rate Focus) (Original)": undefined,

    // V304–V306: Fixed Brooks (clones of V301–V303 with fix_profile)
    "V304: Brooks Structural Pure (Fixed)": (candles, params = {}) => {
        return twoLeggedPullbackCoreV2(candles, {
            ...params,
            useStructuralRules: true,
            requireStrictSecondLeg: true,
            requireDoubleTopBottomTrap: true,
            useBrooksTrend: true,
            minTrendBars: 18,
            swingLookback: 12,
            enableTraps: false,
            enableConfidenceScoring: false,
            useDirectionalEMATest: true,
            useStructuralTarget: true,
            structureOffsetRatio: 0.08,
            doubleTopBottomToleranceRatioV2: 0.12,
            minBarsBetweenSignals: 3,
        });
    },
    "V305: Brooks Volume-Optimized (Fixed)": (candles, params = {}) => {
        return twoLeggedPullbackCoreV2(candles, {
            ...params,
            useStructuralRules: true,
            requireStrictSecondLeg: true,
            requireDoubleTopBottomTrap: true,
            useBrooksTrend: true,
            minTrendBars: 12,
            swingLookback: 8,
            enableTraps: false,
            enableConfidenceScoring: false,
            useDirectionalEMATest: true,
            useStructuralTarget: true,
            structureOffsetRatio: 0.10,
            doubleTopBottomToleranceRatioV2: 0.15,
            emaTouchRatioV2: 0.18,
            minBarsBetweenSignals: 4,
        });
    },
    "V306: Brooks Selective (Win-Rate Focus) (Fixed)": (candles, params = {}) => {
        return twoLeggedPullbackCoreV2(candles, {
            ...params,
            useStructuralRules: true,
            requireStrictSecondLeg: true,
            requireDoubleTopBottomTrap: true,
            useBrooksTrend: true,
            minTrendBars: 20,
            swingLookback: 14,
            enableTraps: false,
            enableConfidenceScoring: false,
            useDirectionalEMATest: true,
            useStructuralTarget: true,
            structureOffsetRatio: 0.08,
            doubleTopBottomToleranceRatioV2: 0.10,
            emaTouchRatioV2: 0.12,
            minBarsBetweenSignals: 5,
            minSignalBarCloseRatio: 0.70,
        });
    },
};

// ============================================================
// BUILD FINAL EXPORT MAP
// ============================================================

// Re-export V1–V50 unchanged from original
const FINAL_STRATEGIES = {};

// Copy V1-V50 from original
for (const [key, fn] of Object.entries(original.STRATEGIES)) {
    const versionMatch = key.match(/^V(\d+):/);
    if (versionMatch) {
        const vNum = parseInt(versionMatch[1], 10);
        if (vNum >= 1 && vNum <= 50) {
            FINAL_STRATEGIES[key] = fn;
        }
    }
}

// Rename original V51-V53 → V301-V303 (Brooks)
const renameMap = {
    "V51: Brooks Structural Pure": "V301: Brooks Structural Pure (Original)",
    "V52: Brooks Volume-Optimized": "V302: Brooks Volume-Optimized (Original)",
    "V53: Brooks Selective (Win-Rate Focus)": "V303: Brooks Selective (Win-Rate Focus) (Original)",
};

for (const [origName, newName] of Object.entries(renameMap)) {
    if (original.STRATEGIES[origName]) {
        FINAL_STRATEGIES[newName] = original.STRATEGIES[origName];
    }
}

// Add all V2 batch strategies (V51–V300)
for (const [key, fn] of Object.entries(STRATEGIES_V2)) {
    FINAL_STRATEGIES[key] = fn;
}

// Add Brooks strategies (V301–V306)
for (const [key, fn] of Object.entries(BROOKS_STRATEGIES)) {
    if (fn !== undefined) {
        FINAL_STRATEGIES[key] = fn;
    }
}

// Apply useRatios and useStructuralRules flags automatically for original V1-V50
Object.keys(FINAL_STRATEGIES).forEach(key => {
    const versionMatch = key.match(/^V(\d+):/);
    const versionNum = versionMatch ? parseInt(versionMatch[1], 10) : 0;
    const isFixed = versionNum >= 51;
    // Skip batch-generated and Brooks strategies — they wrap correctly already
    if (isFixed) return;

    const isCalibrated = key.includes("(Calibrated)") ||
        key.includes("-Calibrated)") ||
        key.includes("Structural-Calibrated");
    const isStructural = key.includes("Structural-Calibrated");
    const isBrooksTrend = key.includes("Upgraded");
    const isStrictLegInit = versionNum >= 10;

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

    // All strategies (V1–V50 original, V51–V100 fixed, V101–V103 preserved original Brooks, V104–V106 fixed Brooks)
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