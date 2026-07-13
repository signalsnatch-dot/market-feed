/**
 * Price Action Strategy Versions Module (Dual-Framework Engine)
 * Houses 53 independent versions of the Thomas Wade / Al Brooks 2-Legged Pullback strategy:
 * - V1 to V10: Original absolute tick-based logic (preserves baseline results, zero regression).
 * - V11 to V20: Dynamic volatility-adjusted ratio-based logic (loaded from config.json).
 * - V21 to V30: Structural Calibrated editions incorporating three-dimensional leg completion filters.
 * - V31 to V40: Upgraded absolute tick-based versions (clones of V1-V10 utilizing optimized Al Brooks trends).
 * - V41 to V50: Upgraded structural calibrated versions (clones of V21-V30 utilizing optimized Al Brooks trends).
 * - V51 to V53: Al Brooks Structural Pure (95%+ alignment) - strict structural rules, directional EMA test, high win-rate focus.
 */

const DEFAULT_PARAMS = {
    // === Core Price Action Parameters ===
    emaPeriod: 20,
    swingLookback: 10,
    minTrendBars: 12,
    rewardRatio: 1.5,

    // === Fallback Ratio-Based Configurations ===
    emaTouchRatio: 0.20,
    triggerOffsetRatio: 0.05,
    stopOffsetRatio: 0.05,
    doubleTopBottomToleranceRatio: 0.25,

    // === Fallback Structural Ratio Configurations ===
    emaTouchRatioV2: 0.15,
    triggerOffsetRatioV2: 0.03,
    stopOffsetRatioV2: 0.30,
    doubleTopBottomToleranceRatioV2: 0.15,
    structureOffsetRatio: 0.10,

    // === Original Tick-Based Configurations (V1-V10) ===
    tickSize: 0.05,
    emaTouchTicks: 4,
    triggerOffsetTicks: 1,
    stopOffsetTicks: 1,
    doubleTopBottomToleranceTicks: 4,

    // === Signal Bar Quality Rules ===
    minSignalBarCloseRatio: 0.60,
    requireBullishBodyForLong: true,
    requireBearishBodyForShort: true,

    // === Optimization Filters ===
    enableGiantBarFilter: true,
    giantBarMultiplier: 2.2,

    enableWhipsawFilter: true,
    flatEmaSlopeThreshold: 0.0001,
    maxEmaCrosses: 3,
    whipsawLookback: 8,

    enableBodyToRangeFilter: true,
    minBodyToRangeRatio: 0.40,

    // === Trap Settings ===
    enableTraps: true,
    trapMaxLookback: 3,

    // === Confluence Overlays ===
    enableFVGConfluence: true,
    fvgLookback: 15,
    enableLiquiditySweeps: true,
    sweepLookback: 15,

    // === Confidence Filter ===
    minConfidenceThreshold: 45,
    enableConfidenceScoring: true,

    // === Risk Management ===
    maxRiskPerTrade: 0.01,
    maxConsecutiveLosses: 3,
    maxDailyLoss: 0.03,
    minBarsBetweenSignals: 3,
};

// Central dynamic tick size helper shared by both the backtester and live server
function getTickSize(instrumentKey) {
    if (!instrumentKey) return 0.05;
    if (instrumentKey.includes('MCX_FO')) {
        if (instrumentKey.includes('504265') || instrumentKey.includes('487465')) return 0.10;
        if (instrumentKey.includes('552708') || instrumentKey.includes('552711') || instrumentKey.includes('552709') || instrumentKey.includes('552706') || instrumentKey.includes('Bulldex')) return 0.05;
        return 1.0;
    }
    return 0.05;
}

function getInstrumentConfig(instrumentKey) {
    if (!instrumentKey) return null;
    const normalizedKey = instrumentKey.replace(/_/g, '|');
    try {
        const fs = require('fs');
        const path = require('path');
        let configPath = path.resolve(__dirname, 'config.json');
        if (!fs.existsSync(configPath)) {
            configPath = path.resolve(__dirname, '../config.json');
        }
        if (fs.existsSync(configPath)) {
            const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (rawConfig && Array.isArray(rawConfig.instruments)) {
                return rawConfig.instruments.find(inst => {
                    const instKeyNormalized = inst.key.replace(/_/g, '|');
                    return instKeyNormalized === normalizedKey ||
                           normalizedKey.includes(instKeyNormalized) ||
                           instKeyNormalized.includes(normalizedKey);
                });
            }
        }
    } catch (e) {}
    return null;
}

// ============================================================
// CORE MATHEMATICAL UTILITIES
// ============================================================

function calculateEMA(candles, period = 20) {
    const ema = new Array(candles.length).fill(null);
    if (candles.length < period) return ema;
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += candles[i].close;
    ema[period - 1] = sum / period;
    for (let i = period; i < candles.length; i++) {
        ema[i] = (candles[i].close - ema[i - 1]) * k + ema[i - 1];
    }
    return ema;
}

function getAverageBarRange(candles, currentIdx, lookback = 10) {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, currentIdx - lookback);
    for (let j = start; j < currentIdx; j++) {
        sum += (candles[j].high - candles[j].low);
        count++;
    }
    return count > 0 ? sum / count : 0;
}

// Swing Pivot Detection with Forward-Dominance Validation
// Three-pass priority: (1) clean pivot, (2) local peak, (3) any unbreached extreme.
// All passes verify that no subsequent bar between peak and currentIdx exceeded it.
function findPullbackSwingIndex(candles, currentIdx, lookback, direction) {
    const start = Math.max(0, currentIdx - lookback);
    const isHigh = direction === 'high';

    // Pass 1: Most recent clean pivot (both neighbors confirm) with forward dominance
    for (let i = currentIdx - 2; i >= start; i--) {
        if (i <= 0 || i >= candles.length - 1) continue;
        const val = isHigh ? candles[i].high : candles[i].low;
        const leftVal = isHigh ? candles[i - 1].high : candles[i - 1].low;
        const rightVal = isHigh ? candles[i + 1].high : candles[i + 1].low;
        if (isHigh ? (val <= leftVal || val <= rightVal) : (val >= leftVal || val >= rightVal)) continue;

        let isHighest = true;
        for (let j = i + 1; j < currentIdx; j++) {
            if (isHigh ? candles[j].high > val : candles[j].low < val) { isHighest = false; break; }
        }
        if (isHighest) return i;
    }

    // Pass 2: Most recent local peak (higher/lower than left neighbor) with forward dominance
    for (let i = currentIdx - 1; i >= start; i--) {
        if (i <= 0 || i >= candles.length - 1) continue;
        const val = isHigh ? candles[i].high : candles[i].low;
        const leftVal = isHigh ? candles[i - 1].high : candles[i - 1].low;
        if (isHigh ? val <= leftVal : val >= leftVal) continue;

        let isHighest = true;
        for (let j = i + 1; j < currentIdx; j++) {
            if (isHigh ? candles[j].high > val : candles[j].low < val) { isHighest = false; break; }
        }
        if (isHighest) return i;
    }

    // Pass 3: Best absolute value that is unbreached forward
    let bestIdx = null;
    let bestVal = isHigh ? -Infinity : Infinity;
    for (let i = currentIdx - 1; i >= start; i--) {
        if (i <= 0 || i >= candles.length - 1) continue;
        const val = isHigh ? candles[i].high : candles[i].low;

        let isHighest = true;
        for (let j = i + 1; j < currentIdx; j++) {
            if (isHigh ? candles[j].high > val : candles[j].low < val) { isHighest = false; break; }
        }
        if (isHighest) {
            const isBetter = isHigh ? val > bestVal : val < bestVal;
            if (isBetter) { bestVal = val; bestIdx = i; }
        }
    }
    return bestIdx;
}

// ============================================================
// TREND EVALUATION SELECTORS
// ============================================================

function assessTrend(candles, ema, i, params) {
    if (params.useBrooksTrend) {
        return assessTrendBrooks(candles, ema, i, params);
    }
    return assessTrendLegacy(candles, ema, i, params);
}

function assessTrendLegacy(candles, ema, i, params) {
    const { emaPeriod, minTrendBars } = params;
    if (i < emaPeriod + minTrendBars || ema[i] == null || ema[i - 5] == null) {
        return { bullish: false, bearish: false };
    }
    const emaSlope = (ema[i] - ema[i - 5]) / ema[i - 5];
    const aboveEma = candles[i].close > ema[i];
    const belowEma = candles[i].close < ema[i];

    let higherEMA = 0;
    let lowerEMA = 0;
    for (let j = i - 5; j <= i; j++) {
        if (ema[j] > ema[j - 1]) higherEMA++;
        if (ema[j] < ema[j - 1]) lowerEMA++;
    }

    const bullish = aboveEma && higherEMA >= 4 && emaSlope > 0.00002;
    const bearish = belowEma && lowerEMA >= 4 && emaSlope < -0.00002;

    return { bullish, bearish };
}

function assessTrendBrooks(candles, ema, i, params) {
    const { emaPeriod, minTrendBars } = params;

    const macroLookback = minTrendBars || 18;
    if (i < emaPeriod + macroLookback || ema[i] == null || ema[i - 15] == null) {
        return { bullish: false, bearish: false };
    }

    const avgRange = getAverageBarRange(candles, i, 10);
    if (avgRange <= 0) return { bullish: false, bearish: false };

    const emaDelta = ema[i] - ema[i - 15];
    const normalizedSlope = emaDelta / (avgRange * 15);

    let barsAbove = 0;
    let barsBelow = 0;
    const trendStart = i - macroLookback;
    for (let j = trendStart; j <= i; j++) {
        if (candles[j].close > ema[j]) barsAbove++;
        if (candles[j].close < ema[j]) barsBelow++;
    }

    let hasBullishGapBar = false;
    let hasBearishGapBar = false;
    for (let j = i - 15; j < i; j++) {
        if (candles[j].low > ema[j]) hasBullishGapBar = true;
        if (candles[j].high < ema[j]) hasBearishGapBar = true;
    }

    const bullish = (barsAbove / (macroLookback + 1)) >= 0.80 && normalizedSlope > 0.08 && hasBullishGapBar;
    const bearish = (barsBelow / (macroLookback + 1)) >= 0.80 && normalizedSlope < -0.08 && hasBearishGapBar;

    return { bullish, bearish };
}

// ============================================================
// WHIPSAW FILTER SELECTORS
// ============================================================

function isWhipsawing(candles, ema, i, p) {
    if (!p.enableWhipsawFilter) return false;
    if (p.useBrooksTrend) {
        return isWhipsawingBrooks(candles, ema, i, p);
    }
    return isWhipsawingLegacy(candles, ema, i, p);
}

function isWhipsawingLegacy(candles, ema, i, p) {
    const emaSlope = (ema[i] - ema[i - 5]) / ema[i - 5];
    const isFlat = Math.abs(emaSlope) < p.flatEmaSlopeThreshold;

    if (!isFlat) return false;

    let emaCrosses = 0;
    for (let j = i - p.whipsawLookback; j < i; j++) {
        if (!ema[j] || !ema[j - 1]) continue;
        const crossedAbove = candles[j].close > ema[j] && candles[j - 1].close < ema[j - 1];
        const crossedBelow = candles[j].close < ema[j] && candles[j - 1].close > ema[j - 1];
        if (crossedAbove || crossedBelow) {
            emaCrosses++;
        }
    }
    return emaCrosses > p.maxEmaCrosses;
}

function isWhipsawingBrooks(candles, ema, i, p) {
    const avgRange = getAverageBarRange(candles, i, 10);
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
        if (crossedAbove || crossedBelow) {
            emaCrosses++;
        }
    }
    return emaCrosses > p.maxEmaCrosses;
}

// ============================================================
// CONFLUENCE MATRIX SCORING UTILITIES
// ============================================================

function checkFVGConfluence(candles, i, type, lookback) {
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

function checkLiquiditySweep(candles, i, type, lookback) {
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

function calculateConfidenceScore(candles, ema, i, type, p, avgRange) {
    let score = 0;
    const sBar = candles[i];
    const range = sBar.high - sBar.low;
    if (range <= 0) return 0;

    const body = Math.abs(sBar.close - sBar.open);
    const bodyRatio = body / range;

    const slope = (ema[i] - ema[i - 5]) / ema[i - 5];
    const absSlope = Math.abs(slope);

    const slopePoints = Math.min(15, Math.round(absSlope * 150000));
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

    const hasSweep = checkLiquiditySweep(candles, i, type === 'BUY' ? 'BUY' : 'SELL', p.sweepLookback);
    if (hasSweep) score += 20;

    const hasFVG = checkFVGConfluence(candles, i, type === 'BUY' ? 'BUY' : 'SELL', p.fvgLookback);
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

function validateSignalBar(sBar, type, p) {
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
// STRUCTURAL LEG COMPLETION WITH TIME & Acceptance Filters
// ============================================================

function isStructuralHighBreach(candles, j, prevHigh, avgRange, structureOffsetRatio, consecutiveBreachesRef) {
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

function isStructuralLowBreach(candles, j, prevLow, avgRange, structureOffsetRatio, consecutiveBreachesRef) {
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
// TP PEAK VALIDATION: ensure TP uses most recent unbroken peak
// ============================================================

function validateTPPeakLong(candles, peakIdx, signalBarIdx) {
    // Scan forward from peakIdx to signalBarIdx; if a higher high exists
    // between them, re-anchor to the most recent higher peak
    let tpPeakIdx = peakIdx;
    for (let k = peakIdx + 1; k < signalBarIdx; k++) {
        if (candles[k].high > candles[tpPeakIdx].high) {
            tpPeakIdx = k;
        }
    }
    return tpPeakIdx;
}

function validateTPPeakShort(candles, peakIdx, signalBarIdx) {
    // Scan forward from peakIdx to signalBarIdx; if a lower low exists
    // between them, re-anchor to the most recent lower trough
    let tpPeakIdx = peakIdx;
    for (let k = peakIdx + 1; k < signalBarIdx; k++) {
        if (candles[k].low < candles[tpPeakIdx].low) {
            tpPeakIdx = k;
        }
    }
    return tpPeakIdx;
}

// ============================================================
// STRUCTURAL PRICE ACTION LEG COUNTING ENGINE
// ============================================================

function evaluateH2Setup(candles, swingHighIdx, currentIdx, tickSize, p) {
    if (swingHighIdx === null || swingHighIdx >= currentIdx - 2) {
        return { isH2: false };
    }

    let firstLegStarted = false;
    let h1TriggerIdx = -1;
    let h1SignalIdx = -1;
    let secondLegStarted = false;
    let h2TriggerIdx = -1;
    let h2SignalIdx = -1;
    let pullbackLow = Infinity;

    const useStrict = p && p.useStrictLegInitiation;

    for (let j = swingHighIdx + 1; j <= currentIdx; j++) {
        const prevHigh = candles[j - 1].high;
        const currentHigh = candles[j].high;
        const prevLow = candles[j - 1].low;
        const currentLow = candles[j].low;
        const isBullish = candles[j].close > candles[j].open;
        const isBearish = candles[j].close < candles[j].open;

        // Track lowest low across entire pullback structure for SL anchoring
        pullbackLow = Math.min(pullbackLow, currentLow);

        // Step 1: First Leg Down initiation
        if (useStrict && !firstLegStarted) {
            if (isBearish && currentLow < prevLow) {
                firstLegStarted = true;
            }
            continue;
        }

        // Step 2: H1 completion (Accumulation / Bounce start)
        if (h1TriggerIdx === -1) {
            if (useStrict) {
                if (isBullish && currentHigh > prevHigh) {
                    h1TriggerIdx = j;
                    h1SignalIdx = j - 1;
                }
            } else {
                if (currentHigh > prevHigh) {
                    h1TriggerIdx = j;
                    h1SignalIdx = j - 1;
                }
            }
        }
        // Step 3: Second Leg Down initiation
        else if (!secondLegStarted) {
            if (useStrict) {
                if (isBearish && currentLow < prevLow) {
                    secondLegStarted = true;
                }
            } else {
                if (candles[j].low < prevLow || candles[j].high < prevHigh) {
                    secondLegStarted = true;
                }
            }
        }
        // Step 4: Track if a previous H2 trigger has already occurred
        else if (h2TriggerIdx === -1) {
            if (currentHigh > prevHigh) {
                h2TriggerIdx = j;
                h2SignalIdx = j - 1;
            }
        }
    }

    const leg1Valid = useStrict ? firstLegStarted : true;
    const isValidH2Signal = leg1Valid && (h1TriggerIdx !== -1) && secondLegStarted && (h2TriggerIdx === -1);

    return {
        isH2: isValidH2Signal,
        h1TriggerIdx,
        h1SignalIdx,
        secondLegStarted,
        swingHighIdx,
        pullbackLow: pullbackLow !== Infinity ? pullbackLow : null
    };
}

function evaluateL2Setup(candles, swingLowIdx, currentIdx, tickSize, p) {
    if (swingLowIdx === null || swingLowIdx >= currentIdx - 2) {
        return { isL2: false };
    }

    let firstLegStarted = false;
    let l1TriggerIdx = -1;
    let l1SignalIdx = -1;
    let secondLegStarted = false;
    let l2TriggerIdx = -1;
    let l2SignalIdx = -1;
    let pullbackHigh = -Infinity;

    const useStrict = p && p.useStrictLegInitiation;

    for (let j = swingLowIdx + 1; j <= currentIdx; j++) {
        const prevLow = candles[j - 1].low;
        const prevHigh = candles[j - 1].high;
        const currentLow = candles[j].low;
        const currentHigh = candles[j].high;
        const isBullish = candles[j].close > candles[j].open;
        const isBearish = candles[j].close < candles[j].open;

        // Track highest high across entire pullback structure for SL anchoring
        pullbackHigh = Math.max(pullbackHigh, currentHigh);

        // Step 1: First Leg Up initiation
        if (useStrict && !firstLegStarted) {
            if (isBullish && currentHigh > prevHigh) {
                firstLegStarted = true;
            }
            continue;
        }

        // Step 2: L1 completion (Consolidation / Pullback start)
        if (l1TriggerIdx === -1) {
            if (useStrict) {
                if (isBearish && currentLow < prevLow) {
                    l1TriggerIdx = j;
                    l1SignalIdx = j - 1;
                }
            } else {
                if (candles[j].low < prevLow) {
                    l1TriggerIdx = j;
                    l1SignalIdx = j - 1;
                }
            }
        }
        // Step 3: Second Leg Up initiation
        else if (!secondLegStarted) {
            if (useStrict) {
                if (isBullish && currentHigh > prevHigh) {
                    secondLegStarted = true;
                }
            } else {
                if (candles[j].high > prevHigh || candles[j].low > prevLow) {
                    secondLegStarted = true;
                }
            }
        }
        // Step 4: Track if a previous L2 trigger has already occurred
        else if (l2TriggerIdx === -1) {
            if (candles[j].low < prevLow) {
                l2TriggerIdx = j;
                l2SignalIdx = j - 1;
            }
        }
    }

    const leg1Valid = useStrict ? firstLegStarted : true;
    const isValidL2Signal = leg1Valid && (l1TriggerIdx !== -1) && secondLegStarted && (l2TriggerIdx === -1);

    return {
        isL2: isValidL2Signal,
        l1TriggerIdx,
        l1SignalIdx,
        secondLegStarted,
        swingLowIdx,
        pullbackHigh: pullbackHigh !== -Infinity ? pullbackHigh : null
    };
}

// === BROOKS/WADE STRICT LEG EVALUATIONS ===

function evaluateStrictH2Setup(candles, swingHighIdx, currentIdx, tickSize, p) {
    const setup = evaluateH2Setup(candles, swingHighIdx, currentIdx, tickSize, p);
    if (!setup.isH2) return setup;

    const h1TriggerIdx = setup.h1TriggerIdx;
    const h1SignalIdx = setup.h1SignalIdx;

    let firstLegLow = Infinity;
    for (let k = swingHighIdx; k <= h1SignalIdx; k++) {
        if (candles[k].low < firstLegLow) firstLegLow = candles[k].low;
    }

    let secondLegLow = Infinity;
    for (let k = h1TriggerIdx; k <= currentIdx; k++) {
        if (candles[k].low < secondLegLow) secondLegLow = candles[k].low;
    }

    if (secondLegLow >= firstLegLow) {
        setup.isH2 = false;
    }

    // propagate pullbackLow from inner evaluateH2Setup
    return setup;
}

function evaluateStrictL2Setup(candles, swingLowIdx, currentIdx, tickSize, p) {
    const setup = evaluateL2Setup(candles, swingLowIdx, currentIdx, tickSize, p);
    if (!setup.isL2) return setup;

    const l1TriggerIdx = setup.l1TriggerIdx;
    const l1SignalIdx = setup.l1SignalIdx;

    let firstLegHigh = -Infinity;
    for (let k = swingLowIdx; k <= l1SignalIdx; k++) {
        if (candles[k].high > firstLegHigh) firstLegHigh = candles[k].high;
    }

    let secondLegHigh = -Infinity;
    for (let k = l1TriggerIdx; k <= currentIdx; k++) {
        if (candles[k].high > secondLegHigh) secondLegHigh = candles[k].high;
    }

    if (secondLegHigh <= firstLegHigh) {
        setup.isL2 = false;
    }

    // propagate pullbackHigh from inner evaluateL2Setup
    return setup;
}

// === NOISE-CANCELLED STRUCTURAL LEG EVALUATIONS ===

function evaluateStructuralH2Setup(candles, swingHighIdx, currentIdx, tickSize, avgRange, p) {
    if (swingHighIdx === null || swingHighIdx >= currentIdx - 2) {
        return { isH2: false };
    }

    let firstLegStarted = false;
    let h1TriggerIdx = -1;
    let h1SignalIdx = -1;
    let secondLegStarted = false;
    let h2TriggerIdx = -1;
    let h2SignalIdx = -1;
    let pullbackLow = Infinity;

    let h1Breaches = { count: 0 };
    let h2Breaches = { count: 0 };

    const structureOffsetRatio = (p && p.structureOffsetRatio !== undefined) ? p.structureOffsetRatio : 0.10;
    const useStrict = p && p.useStrictLegInitiation;

    for (let j = swingHighIdx + 1; j <= currentIdx; j++) {
        const prevHigh = candles[j - 1].high;
        const prevLow = candles[j - 1].low;
        const currentHigh = candles[j].high;
        const currentLow = candles[j].low;
        const isBullish = candles[j].close > candles[j].open;
        const isBearish = candles[j].close < candles[j].open;

        // Track lowest low across entire pullback structure for SL anchoring
        pullbackLow = Math.min(pullbackLow, currentLow);

        // Step 1: First Leg Down initiation
        if (useStrict && !firstLegStarted) {
            const structuralLowOffset = prevLow - (avgRange * structureOffsetRatio);
            if (isBearish && currentLow < structuralLowOffset) {
                firstLegStarted = true;
            }
            continue;
        }

        // Step 2: H1 completion
        if (h1TriggerIdx === -1) {
            if (useStrict) {
                const structuralHighOffset = prevHigh + (avgRange * structureOffsetRatio);
                if (isBullish && currentHigh > structuralHighOffset) {
                    h1TriggerIdx = j;
                    h1SignalIdx = j - 1;
                }
            } else {
                if (isStructuralHighBreach(candles, j, prevHigh, avgRange, structureOffsetRatio, h1Breaches)) {
                    h1TriggerIdx = j;
                    h1SignalIdx = j - 1;
                }
            }
        }
        // Step 3: Second Leg Down initiation
        else if (!secondLegStarted) {
            if (useStrict) {
                const structuralLowOffset = prevLow - (avgRange * structureOffsetRatio);
                if (isBearish && currentLow < structuralLowOffset) {
                    secondLegStarted = true;
                }
            } else {
                if (candles[j].low < prevLow || candles[j].high < prevHigh) {
                    secondLegStarted = true;
                }
            }
        }
        // Step 4: Previous trigger check
        else if (h2TriggerIdx === -1) {
            if (isStructuralHighBreach(candles, j, prevHigh, avgRange, structureOffsetRatio, h2Breaches)) {
                h2TriggerIdx = j;
                h2SignalIdx = j - 1;
            }
        }
    }

    const leg1Valid = useStrict ? firstLegStarted : true;
    const isValidH2Signal = leg1Valid && (h1TriggerIdx !== -1) && secondLegStarted && (h2TriggerIdx === -1);

    return {
        isH2: isValidH2Signal,
        h1TriggerIdx,
        h1SignalIdx,
        secondLegStarted,
        swingHighIdx,
        pullbackLow: pullbackLow !== Infinity ? pullbackLow : null
    };
}

function evaluateStructuralL2Setup(candles, swingLowIdx, currentIdx, tickSize, avgRange, p) {
    if (swingLowIdx === null || swingLowIdx >= currentIdx - 2) {
        return { isL2: false };
    }

    let firstLegStarted = false;
    let l1TriggerIdx = -1;
    let l1SignalIdx = -1;
    let secondLegStarted = false;
    let l2TriggerIdx = -1;
    let l2SignalIdx = -1;
    let pullbackHigh = -Infinity;

    let l1Breaches = { count: 0 };
    let l2Breaches = { count: 0 };

    const structureOffsetRatio = (p && p.structureOffsetRatio !== undefined) ? p.structureOffsetRatio : 0.10;
    const useStrict = p && p.useStrictLegInitiation;

    for (let j = swingLowIdx + 1; j <= currentIdx; j++) {
        const prevLow = candles[j - 1].low;
        const prevHigh = candles[j - 1].high;
        const currentLow = candles[j].low;
        const currentHigh = candles[j].high;
        const isBullish = candles[j].close > candles[j].open;
        const isBearish = candles[j].close < candles[j].open;

        // Track highest high across entire pullback structure for SL anchoring
        pullbackHigh = Math.max(pullbackHigh, currentHigh);

        // Step 1: First Leg Up initiation
        if (useStrict && !firstLegStarted) {
            const structuralHighOffset = prevHigh + (avgRange * structureOffsetRatio);
            if (isBullish && currentHigh > structuralHighOffset) {
                firstLegStarted = true;
            }
            continue;
        }

        // Step 2: L1 completion
        if (l1TriggerIdx === -1) {
            if (useStrict) {
                const structuralLowOffset = prevLow - (avgRange * structureOffsetRatio);
                if (isBearish && currentLow < structuralLowOffset) {
                    l1TriggerIdx = j;
                    l1SignalIdx = j - 1;
                }
            } else {
                if (isStructuralLowBreach(candles, j, prevLow, avgRange, structureOffsetRatio, l1Breaches)) {
                    l1TriggerIdx = j;
                    l1SignalIdx = j - 1;
                }
            }
        }
        // Step 3: Second Leg Up initiation
        else if (!secondLegStarted) {
            if (useStrict) {
                const structuralHighOffset = prevHigh + (avgRange * structureOffsetRatio);
                if (isBullish && currentHigh > structuralHighOffset) {
                    secondLegStarted = true;
                }
            } else {
                if (candles[j].high > prevHigh || candles[j].low > prevLow) {
                    secondLegStarted = true;
                }
            }
        }
        // Step 4: Previous trigger check
        else if (l2TriggerIdx === -1) {
            if (isStructuralLowBreach(candles, j, prevLow, avgRange, structureOffsetRatio, l2Breaches)) {
                l2TriggerIdx = j;
                l2SignalIdx = j - 1;
            }
        }
    }

    const leg1Valid = useStrict ? firstLegStarted : true;
    const isValidL2Signal = leg1Valid && (l1TriggerIdx !== -1) && secondLegStarted && (l2TriggerIdx === -1);

    return {
        isL2: isValidL2Signal,
        l1TriggerIdx,
        l1SignalIdx,
        secondLegStarted,
        swingLowIdx,
        pullbackHigh: pullbackHigh !== -Infinity ? pullbackHigh : null
    };
}

// Sophisticated Brooks strict check: accepts if deeper OR if forming a tight double-bottom
function evaluateStructuralStrictH2Setup(candles, swingHighIdx, currentIdx, tickSize, avgRange, p) {
    const setup = evaluateStructuralH2Setup(candles, swingHighIdx, currentIdx, tickSize, avgRange, p);
    if (!setup.isH2) return setup;

    const h1TriggerIdx = setup.h1TriggerIdx;
    const h1SignalIdx = setup.h1SignalIdx;

    let firstLegLow = Infinity;
    for (let k = swingHighIdx; k <= h1SignalIdx; k++) {
        if (candles[k].low < firstLegLow) firstLegLow = candles[k].low;
    }

    let secondLegLow = Infinity;
    for (let k = h1TriggerIdx; k <= currentIdx; k++) {
        if (candles[k].low < secondLegLow) secondLegLow = candles[k].low;
    }

    const dbTolerance = avgRange * ((p && p.doubleTopBottomToleranceRatioV2) || 0.15);
    const isDoubleBottom = Math.abs(secondLegLow - firstLegLow) <= dbTolerance;

    if (secondLegLow >= firstLegLow && !isDoubleBottom) {
        setup.isH2 = false;
    }
    // pullbackLow propagated from inner evaluateStructuralH2Setup
    return setup;
}

// Sophisticated Brooks strict check: accepts if shallower OR if forming a tight double-top
function evaluateStructuralStrictL2Setup(candles, swingLowIdx, currentIdx, tickSize, avgRange, p) {
    const setup = evaluateStructuralL2Setup(candles, swingLowIdx, currentIdx, tickSize, avgRange, p);
    if (!setup.isL2) return setup;

    const l1TriggerIdx = setup.l1TriggerIdx;
    const l1SignalIdx = setup.l1SignalIdx;

    let firstLegHigh = -Infinity;
    for (let k = swingLowIdx; k <= l1SignalIdx; k++) {
        if (candles[k].high > firstLegHigh) firstLegHigh = candles[k].high;
    }

    let secondLegHigh = -Infinity;
    for (let k = l1TriggerIdx; k <= currentIdx; k++) {
        if (candles[k].high > secondLegHigh) secondLegHigh = candles[k].high;
    }

    const dtTolerance = avgRange * ((p && p.doubleTopBottomToleranceRatioV2) || 0.15);
    const isDoubleTop = Math.abs(secondLegHigh - firstLegHigh) <= dtTolerance;

    if (secondLegHigh <= firstLegHigh && !isDoubleTop) {
        setup.isL2 = false;
    }
    // pullbackHigh propagated from inner evaluateStructuralL2Setup
    return setup;
}

// ============================================================
// CENTRAL STRATEGY EVALUATION MODULE
// ============================================================

function twoLeggedPullbackCore(candles, params = {}) {
    const sampleCandle = candles[0];
    const instrumentKey = sampleCandle?.instrument || sampleCandle?.instrument_key || params.instrument_key || params.instrument;
    const instConfig = getInstrumentConfig(instrumentKey);
    const resolvedTickSize = params.tickSize !== undefined
        ? params.tickSize
        : (instConfig?.tickSize || getTickSize(instrumentKey));

    const useStructural = params.useStructuralRules || false;

    let emaTouchRatioVal;
    let triggerOffsetRatioVal;
    let stopOffsetRatioVal;
    let doubleTopBottomToleranceRatioVal;
    let structureOffsetRatioVal;

    if (useStructural) {
        emaTouchRatioVal = instConfig?.emaTouchRatioV2 !== undefined
            ? instConfig.emaTouchRatioV2
            : (params.emaTouchRatioV2 !== undefined ? params.emaTouchRatioV2 : DEFAULT_PARAMS.emaTouchRatioV2);
        triggerOffsetRatioVal = instConfig?.triggerOffsetRatioV2 !== undefined
            ? instConfig.triggerOffsetRatioV2
            : (params.triggerOffsetRatioV2 !== undefined ? params.triggerOffsetRatioV2 : DEFAULT_PARAMS.triggerOffsetRatioV2);
        stopOffsetRatioVal = instConfig?.stopOffsetRatioV2 !== undefined
            ? instConfig.stopOffsetRatioV2
            : (params.stopOffsetRatioV2 !== undefined ? params.stopOffsetRatioV2 : DEFAULT_PARAMS.stopOffsetRatioV2);
        doubleTopBottomToleranceRatioVal = instConfig?.doubleTopBottomToleranceRatioV2 !== undefined
            ? instConfig.doubleTopBottomToleranceRatioV2
            : (params.doubleTopBottomToleranceRatioV2 !== undefined ? params.doubleTopBottomToleranceRatioV2 : DEFAULT_PARAMS.doubleTopBottomToleranceRatioV2);
        structureOffsetRatioVal = instConfig?.structureOffsetRatio !== undefined
            ? instConfig.structureOffsetRatio
            : (params.structureOffsetRatio !== undefined ? params.structureOffsetRatio : DEFAULT_PARAMS.structureOffsetRatio);
    } else {
        emaTouchRatioVal = instConfig?.emaTouchRatio !== undefined
            ? instConfig.emaTouchRatio
            : (params.emaTouchRatio !== undefined ? params.emaTouchRatio : DEFAULT_PARAMS.emaTouchRatio);
        triggerOffsetRatioVal = instConfig?.triggerOffsetRatio !== undefined
            ? instConfig.triggerOffsetRatio
            : (params.triggerOffsetRatio !== undefined ? params.triggerOffsetRatio : DEFAULT_PARAMS.triggerOffsetRatio);
        stopOffsetRatioVal = instConfig?.stopOffsetRatio !== undefined
            ? instConfig.stopOffsetRatio
            : (params.stopOffsetRatio !== undefined ? params.stopOffsetRatio : DEFAULT_PARAMS.stopOffsetRatio);
        doubleTopBottomToleranceRatioVal = instConfig?.doubleTopBottomToleranceRatio !== undefined
            ? instConfig.doubleTopBottomToleranceRatio
            : (params.doubleTopBottomToleranceRatio !== undefined ? params.doubleTopBottomToleranceRatio : DEFAULT_PARAMS.doubleTopBottomToleranceRatio);
        structureOffsetRatioVal = DEFAULT_PARAMS.structureOffsetRatio;
    }

    const p = {
        requireStrictSecondLeg: false,
        requireDoubleTopBottomTrap: false,
        useRatios: false,
        useStructuralRules: useStructural,
        ...DEFAULT_PARAMS,
        emaTouchRatio: emaTouchRatioVal,
        triggerOffsetRatio: triggerOffsetRatioVal,
        stopOffsetRatio: stopOffsetRatioVal,
        doubleTopBottomToleranceRatio: doubleTopBottomToleranceRatioVal,
        structureOffsetRatio: structureOffsetRatioVal,
        tickSize: resolvedTickSize,
        ...params
    };

    const signals = [];
    if (candles.length < p.emaPeriod + p.minTrendBars) return signals;

    const ema = calculateEMA(candles, p.emaPeriod);

    let lastPullbackSignalIdx = -Infinity;
    let lastTrapSignalIdx = -Infinity;

    for (let i = p.emaPeriod + p.minTrendBars; i < candles.length; i++) {
        const trend = assessTrend(candles, ema, i, p);
        const sBar = candles[i];
        const range = sBar.high - sBar.low;
        if (range <= 0) continue;

        const avgRange = getAverageBarRange(candles, i, 10);

        let emaTouchDistance, triggerOffset, stopOffset, doubleTopBottomTolerance, triggerBreakDist;

        if (p.useRatios) {
            emaTouchDistance = avgRange > 0 ? avgRange * p.emaTouchRatio : (p.emaTouchTicks * p.tickSize);
            triggerOffset = avgRange > 0 ? avgRange * p.triggerOffsetRatio : (p.triggerOffsetTicks * p.tickSize);
            stopOffset = avgRange > 0 ? avgRange * p.stopOffsetRatio : (p.stopOffsetTicks * p.tickSize);
            doubleTopBottomTolerance = avgRange > 0 ? avgRange * p.doubleTopBottomToleranceRatio : (p.doubleTopBottomToleranceTicks * p.tickSize);
            triggerBreakDist = avgRange > 0 ? avgRange * p.triggerOffsetRatio : p.tickSize;
        } else {
            emaTouchDistance = p.emaTouchTicks * p.tickSize;
            triggerOffset = p.triggerOffsetTicks * p.tickSize;
            stopOffset = p.stopOffsetTicks * p.tickSize;
            doubleTopBottomTolerance = p.doubleTopBottomToleranceTicks * p.tickSize;
            triggerBreakDist = p.tickSize;
        }

        if (isWhipsawing(candles, ema, i, p)) continue;

        if (p.enableGiantBarFilter) {
            if (range > avgRange * p.giantBarMultiplier) continue;
        }

        let signalFound = false;

        // Dynamic Double Top / Bottom pivot reset logic for structural configurations
        let adjustedSwingHighIdx = null;
        let adjustedSwingLowIdx = null;

        if (p.useStructuralRules) {
            const rawHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
            if (rawHighIdx !== null) {
                adjustedSwingHighIdx = rawHighIdx;
                const dtTolerance = avgRange * (p.doubleTopBottomToleranceRatioV2 || 0.15);
                for (let k = rawHighIdx + 1; k < i - 1; k++) {
                    if (candles[k].high <= candles[rawHighIdx].high &&
                        (candles[rawHighIdx].high - candles[k].high) <= dtTolerance) {
                        adjustedSwingHighIdx = k;
                    }
                }
            }
            const rawLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
            if (rawLowIdx !== null) {
                adjustedSwingLowIdx = rawLowIdx;
                const dbTolerance = avgRange * (p.doubleTopBottomToleranceRatioV2 || 0.15);
                for (let k = rawLowIdx + 1; k < i - 1; k++) {
                    if (candles[k].low >= candles[rawLowIdx].low &&
                        (candles[k].low - candles[rawLowIdx].low) <= dbTolerance) {
                        adjustedSwingLowIdx = k;
                    }
                }
            }
        } else {
            adjustedSwingHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
            adjustedSwingLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
        }

        // 1. SECOND ENTRY LONG (H2)
        if (trend.bullish && (i - lastPullbackSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            if (adjustedSwingHighIdx !== null) {
                const setup = p.useStructuralRules
                    ? (p.requireStrictSecondLeg
                        ? evaluateStructuralStrictH2Setup(candles, adjustedSwingHighIdx, i, p.tickSize, avgRange, p)
                        : evaluateStructuralH2Setup(candles, adjustedSwingHighIdx, i, p.tickSize, avgRange, p))
                    : (p.requireStrictSecondLeg
                        ? evaluateStrictH2Setup(candles, adjustedSwingHighIdx, i, p.tickSize, p)
                        : evaluateH2Setup(candles, adjustedSwingHighIdx, i, p.tickSize, p));

                if (setup.isH2) {
                    let touchEMA;
                    if (p.useDirectionalEMATest) {
                        touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.close > ema[i];
                    } else {
                        touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.high >= ema[i] - emaTouchDistance;
                    }
                    const passesSignalBarCheck = validateSignalBar(sBar, 'BUY', p);

                    if (touchEMA && passesSignalBarCheck) {
                        let score = 100;
                        let passesScore = true;

                        if (p.enableConfidenceScoring) {
                            score = calculateConfidenceScore(candles, ema, i, 'BUY', p, avgRange);
                            passesScore = typeof p.confidenceFilter === 'function'
                                ? p.confidenceFilter(score)
                                : (score >= p.minConfidenceThreshold);
                        }

                        if (passesScore) {
                            const triggerPrice = sBar.high + triggerOffset;

                            // Brooks principle: SL anchored to structural pullback trough when useStructuralTarget active
                            let stopLoss;
                            if (p.useStructuralTarget && setup.pullbackLow !== null && setup.pullbackLow !== undefined) {
                                stopLoss = setup.pullbackLow - stopOffset;
                            } else {
                                stopLoss = sBar.low - stopOffset;
                            }

                            let takeProfit = triggerPrice + (triggerPrice - stopLoss) * p.rewardRatio;
                            let structuralTarget = null;
                            if (p.useStructuralTarget && adjustedSwingHighIdx !== null) {
                                // Validate TP peak: use most recent unbroken swing high
                                const tpPeakIdx = validateTPPeakLong(candles, adjustedSwingHighIdx, i);
                                structuralTarget = candles[tpPeakIdx].high + triggerOffset;
                                takeProfit = structuralTarget;
                            }

                            const risk = Math.abs(triggerPrice - stopLoss);
                            const reward = Math.abs(takeProfit - triggerPrice);
                            const rrr = risk > 0 ? reward / risk : 0;

                            if (!p.useStructuralTarget || (rrr >= 1.0 && rrr <= 2.2)) {
                                signals.push({
                                    index: i,
                                    type: 'BUY_STOP',
                                    triggerPrice,
                                    stopLoss,
                                    takeProfit,
                                    rewardRatio: p.rewardRatio,
                                    useStructuralTarget: p.useStructuralTarget,
                                    structuralTarget,
                                    confidence: p.enableConfidenceScoring ? score : null,
                                    timestamp: sBar.timestamp,
                                    reason: p.enableConfidenceScoring
                                        ? `H2 Pullback (Conf: ${score}/100)`
                                        : `H2 Signal Bar (Close: ${sBar.close})`
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
        if (trend.bearish && (i - lastPullbackSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            if (adjustedSwingLowIdx !== null) {
                const setup = p.useStructuralRules
                    ? (p.requireStrictSecondLeg
                        ? evaluateStructuralStrictL2Setup(candles, adjustedSwingLowIdx, i, p.tickSize, avgRange, p)
                        : evaluateStructuralL2Setup(candles, adjustedSwingLowIdx, i, p.tickSize, avgRange, p))
                    : (p.requireStrictSecondLeg
                        ? evaluateStrictL2Setup(candles, adjustedSwingLowIdx, i, p.tickSize, p)
                        : evaluateL2Setup(candles, adjustedSwingLowIdx, i, p.tickSize, p));

                if (setup.isL2) {
                    let touchEMA;
                    if (p.useDirectionalEMATest) {
                        touchEMA = sBar.high >= ema[i] - emaTouchDistance && sBar.close < ema[i];
                    } else {
                        touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.high >= ema[i] - emaTouchDistance;
                    }
                    const passesSignalBarCheck = validateSignalBar(sBar, 'SELL', p);

                    if (touchEMA && passesSignalBarCheck) {
                        let score = 100;
                        let passesScore = true;

                        if (p.enableConfidenceScoring) {
                            score = calculateConfidenceScore(candles, ema, i, 'SELL', p, avgRange);
                            passesScore = typeof p.confidenceFilter === 'function'
                                ? p.confidenceFilter(score)
                                : (score >= p.minConfidenceThreshold);
                        }

                        if (passesScore) {
                            const triggerPrice = sBar.low - triggerOffset;

                            // Brooks principle: SL anchored to structural pullback peak when useStructuralTarget active
                            let stopLoss;
                            if (p.useStructuralTarget && setup.pullbackHigh !== null && setup.pullbackHigh !== undefined) {
                                stopLoss = setup.pullbackHigh + stopOffset;
                            } else {
                                stopLoss = sBar.high + stopOffset;
                            }

                            let takeProfit = triggerPrice - (stopLoss - triggerPrice) * p.rewardRatio;
                            let structuralTarget = null;
                            if (p.useStructuralTarget && adjustedSwingLowIdx !== null) {
                                // Validate TP trough: use most recent unbroken swing low
                                const tpPeakIdx = validateTPPeakShort(candles, adjustedSwingLowIdx, i);
                                structuralTarget = candles[tpPeakIdx].low - triggerOffset;
                                takeProfit = structuralTarget;
                            }

                            const risk = Math.abs(triggerPrice - stopLoss);
                            const reward = Math.abs(takeProfit - triggerPrice);
                            const rrr = risk > 0 ? reward / risk : 0;

                            if (!p.useStructuralTarget || (rrr >= 1.0 && rrr <= 2.2)) {
                                signals.push({
                                    index: i,
                                    type: 'SELL_STOP',
                                    triggerPrice,
                                    stopLoss,
                                    takeProfit,
                                    rewardRatio: p.rewardRatio,
                                    useStructuralTarget: p.useStructuralTarget,
                                    structuralTarget,
                                    confidence: p.enableConfidenceScoring ? score : null,
                                    timestamp: sBar.timestamp,
                                    reason: p.enableConfidenceScoring
                                        ? `L2 Pullback (Conf: ${score}/100)`
                                        : `L2 Signal Bar (Close: ${sBar.close})`
                                });
                                lastPullbackSignalIdx = i;
                                signalFound = true;
                            }
                        }
                    }
                }
            }
        }

        // 3. FAILED SECOND ENTRY TRAPS (DOUBLE TRAP METHOD)
        if (p.enableTraps && (i - lastTrapSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            // --- Long Trap Setup ---
            if (trend.bullish) {
                const lookbackStart = Math.max(p.emaPeriod, i - p.trapMaxLookback);
                for (let L = i - 1; L >= lookbackStart; L--) {
                    const swingLowIdx = findPullbackSwingIndex(candles, L, p.swingLookback + p.minTrendBars, 'low');
                    if (swingLowIdx !== null) {
                        const setupL2 = p.useStructuralRules
                            ? (p.requireStrictSecondLeg
                                ? evaluateStructuralStrictL2Setup(candles, swingLowIdx, L, p.tickSize, avgRange, p)
                                : evaluateStructuralL2Setup(candles, swingLowIdx, L, p.tickSize, avgRange, p))
                            : (p.requireStrictSecondLeg
                                ? evaluateStrictL2Setup(candles, swingLowIdx, L, p.tickSize, p)
                                : evaluateL2Setup(candles, swingLowIdx, L, p.tickSize, p));

                        if (setupL2.isL2) {
                            const triggeredShort = candles[L + 1].low < candles[L].low - triggerBreakDist;

                            if (triggeredShort) {
                                let isDoubleBottom = true;
                                if (p.requireDoubleTopBottomTrap) {
                                    const l2Low = Math.min(candles[L].low, candles[L + 1].low);
                                    const diff = Math.abs(l2Low - candles[swingLowIdx].low);
                                    isDoubleBottom = diff <= doubleTopBottomTolerance;
                                }

                                const structureHigh = Math.max(candles[L].high, candles[L + 1].high);
                                if (sBar.high >= structureHigh && isDoubleBottom) {
                                    let score = 100;
                                    let passesScore = true;

                                    if (p.enableConfidenceScoring) {
                                        score = calculateConfidenceScore(candles, ema, i, 'BUY', p, avgRange);
                                        passesScore = typeof p.confidenceFilter === 'function'
                                            ? p.confidenceFilter(score)
                                            : (score >= p.minConfidenceThreshold);
                                    }

                                    if (passesScore) {
                                        const triggerPrice = structureHigh + triggerOffset;

                                        const stopLoss = p.useStructuralTarget
                                            ? candles[swingLowIdx].low - stopOffset
                                            : Math.min(sBar.low, structureHigh) - stopOffset;

                                        let takeProfit = triggerPrice + (triggerPrice - stopLoss) * p.rewardRatio;
                                        let structuralTarget = null;
                                        const swingHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
                                        if (p.useStructuralTarget && swingHighIdx !== null) {
                                            const tpPeakIdx = validateTPPeakLong(candles, swingHighIdx, i);
                                            structuralTarget = candles[tpPeakIdx].high + triggerOffset;
                                            takeProfit = structuralTarget;
                                        }

                                        const risk = Math.abs(triggerPrice - stopLoss);
                                        const reward = Math.abs(takeProfit - triggerPrice);
                                        const rrr = risk > 0 ? reward / risk : 0;

                                        if (risk > 0 && (!p.useStructuralTarget || (rrr >= 1.0 && rrr <= 2.2))) {
                                            signals.push({
                                                index: i,
                                                type: 'BUY_STOP',
                                                triggerPrice,
                                                stopLoss,
                                                takeProfit,
                                                rewardRatio: p.rewardRatio,
                                                useStructuralTarget: p.useStructuralTarget,
                                                structuralTarget,
                                                confidence: p.enableConfidenceScoring ? score : null,
                                                timestamp: sBar.timestamp,
                                                reason: p.enableConfidenceScoring
                                                    ? `DOUBLE_TRAP_BUY (Conf: ${score}/100)`
                                                    : `DOUBLE_TRAP_BUY: Failed L2 Short Setup`
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

            // --- Short Trap Setup ---
            if (trend.bearish && !signalFound) {
                const lookbackStart = Math.max(p.emaPeriod, i - p.trapMaxLookback);
                for (let L = i - 1; L >= lookbackStart; L--) {
                    const swingHighIdx = findPullbackSwingIndex(candles, L, p.swingLookback + p.minTrendBars, 'high');
                    if (swingHighIdx !== null) {
                        const setupH2 = p.useStructuralRules
                            ? (p.requireStrictSecondLeg
                                ? evaluateStructuralStrictH2Setup(candles, swingHighIdx, L, p.tickSize, avgRange, p)
                                : evaluateStructuralH2Setup(candles, swingHighIdx, L, p.tickSize, avgRange, p))
                            : (p.requireStrictSecondLeg
                                ? evaluateStructuralStrictH2Setup(candles, swingHighIdx, L, p.tickSize, p)
                                : evaluateH2Setup(candles, swingHighIdx, L, p.tickSize, p));

                        if (setupH2.isH2) {
                            const triggeredLong = candles[L + 1].high > candles[L].high + triggerBreakDist;

                            if (triggeredLong) {
                                let isDoubleTop = true;
                                if (p.requireDoubleTopBottomTrap) {
                                    const h2High = Math.max(candles[L].high, candles[L + 1].high);
                                    const diff = Math.abs(h2High - candles[swingHighIdx].high);
                                    isDoubleTop = diff <= doubleTopBottomTolerance;
                                }

                                const structureLow = Math.min(candles[L].low, candles[L + 1].low);
                                if (sBar.low <= structureLow && isDoubleTop) {
                                    let score = 100;
                                    let passesScore = true;

                                    if (p.enableConfidenceScoring) {
                                        score = calculateConfidenceScore(candles, ema, i, 'SELL', p, avgRange);
                                        passesScore = typeof p.confidenceFilter === 'function'
                                            ? p.confidenceFilter(score)
                                            : (score >= p.minConfidenceThreshold);
                                    }

                                    if (passesScore) {
                                        const triggerPrice = structureLow - triggerOffset;

                                        const stopLoss = p.useStructuralTarget
                                            ? candles[swingHighIdx].high + stopOffset
                                            : Math.max(sBar.high, structureLow) + stopOffset;

                                        let takeProfit = triggerPrice - (stopLoss - triggerPrice) * p.rewardRatio;
                                        let structuralTarget = null;
                                        const swingLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
                                        if (p.useStructuralTarget && swingLowIdx !== null) {
                                            const tpPeakIdx = validateTPPeakShort(candles, swingLowIdx, i);
                                            structuralTarget = candles[tpPeakIdx].low - triggerOffset;
                                            takeProfit = structuralTarget;
                                        }

                                        const risk = Math.abs(triggerPrice - stopLoss);
                                        const reward = Math.abs(takeProfit - triggerPrice);
                                        const rrr = risk > 0 ? reward / risk : 0;

                                        if (risk > 0 && (!p.useStructuralTarget || (rrr >= 1.0 && rrr <= 2.2))) {
                                            signals.push({
                                                index: i,
                                                type: 'SELL_STOP',
                                                triggerPrice,
                                                stopLoss,
                                                takeProfit,
                                                rewardRatio: p.rewardRatio,
                                                useStructuralTarget: p.useStructuralTarget,
                                                structuralTarget,
                                                confidence: p.enableConfidenceScoring ? score : null,
                                                timestamp: sBar.timestamp,
                                                reason: p.enableConfidenceScoring
                                                    ? `DOUBLE_TRAP_SELL (Conf: ${score}/100)`
                                                    : `DOUBLE_TRAP_SELL: Failed H2 Long Setup`
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

// ============================================================
// STRATEGIES MAP (PARALLEL CONFIGS)
// ============================================================

const STRATEGIES = {
    "V1: Double Traps": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true });
    },
    "V2: EMA Pullback": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false });
    },
    "V3: High Confidence": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, enableConfidenceScoring: true, minConfidenceThreshold: 45 });
    },
    "V4: Aggressive": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false, minSignalBarCloseRatio: 0.50 });
    },
    "V5: Wade Structural": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, useStructuralTarget: true });
    },
    "V6: Double Traps (Strict)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true });
    },
    "V7: EMA Pullback (Strict)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false, requireStrictSecondLeg: true });
    },
    "V8: High Confidence (Strict)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, minConfidenceThreshold: 45 });
    },
    "V9: Aggressive (Strict)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50 });
    },
    "V10: Wade Structural (Strict)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true });
    },
    "V11: Double Traps (Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true });
    },
    "V12: EMA Pullback (Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false });
    },
    "V13: High Confidence (Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, enableConfidenceScoring: true, minConfidenceThreshold: 45 });
    },
    "V14: Aggressive (Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, minSignalBarCloseRatio: 0.50 });
    },
    "V15: Wade Structural (Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralTarget: true });
    },
    "V16: Double Traps (Strict-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true });
    },
    "V17: EMA Pullback (Strict-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, requireStrictSecondLeg: true });
    },
    "V18: High Confidence (Strict-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, minConfidenceThreshold: 45 });
    },
    "V19: Aggressive (Strict-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50 });
    },
    "V20: Wade Structural (Strict-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true });
    },
    "V21: Double Traps (Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true });
    },
    "V22: EMA Pullback (Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true });
    },
    "V23: High Confidence (Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, enableConfidenceScoring: true, minConfidenceThreshold: 45 });
    },
    "V24: Aggressive (Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, minSignalBarCloseRatio: 0.50 });
    },
    "V25: Wade Structural (Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, useStructuralTarget: true });
    },
    "V26: Double Traps (Strict Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true });
    },
    "V27: EMA Pullback (Strict Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true });
    },
    "V28: High Confidence (Strict Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, minConfidenceThreshold: 45 });
    },
    "V29: Aggressive (Strict Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50 });
    },
    "V30: Wade Structural (Strict Structural-Calibrated)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true });
    },
    "V31: Double Traps (Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V32: EMA Pullback (Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V33: High Confidence (Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, enableConfidenceScoring: true, minConfidenceThreshold: 45, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V34: Aggressive (Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V35: Wade Structural (Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V36: Double Traps (Strict Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V37: EMA Pullback (Strict Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false, requireStrictSecondLeg: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V38: High Confidence (Strict Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, minConfidenceThreshold: 45, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V39: Aggressive (Strict Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: false, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V40: Wade Structural (Strict Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, useRatios: false, enableTraps: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V41: Double Traps (Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V42: EMA Pullback (Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V43: High Confidence (Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, enableConfidenceScoring: true, minConfidenceThreshold: 45, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V44: Aggressive (Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V45: Wade Structural (Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V46: Double Traps (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V47: EMA Pullback (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V48: High Confidence (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, enableConfidenceScoring: true, minConfidenceThreshold: 45, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V49: Aggressive (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, requireStrictSecondLeg: true, minSignalBarCloseRatio: 0.50, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V50: Wade Structural (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: true, useStructuralRules: true, requireStrictSecondLeg: true, requireDoubleTopBottomTrap: true, useStructuralTarget: true, useBrooksTrend: true, minTrendBars: 18, swingLookback: 12 });
    },
    "V51: Brooks Structural Pure": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
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
            minBarsBetweenSignals: 3
        });
    },
    "V52: Brooks Volume-Optimized": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
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
            minBarsBetweenSignals: 4
        });
    },
    "V53: Brooks Selective (Win-Rate Focus)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
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
            minSignalBarCloseRatio: 0.70
        });
    }
};

// Map useRatios and useStructuralRules flags automatically to parallel editions
Object.keys(STRATEGIES).forEach(key => {
    const isCalibrated = key.includes("(Calibrated)") ||
                         key.includes("-Calibrated)") ||
                         key.includes("Structural-Calibrated");
    const isStructural = key.includes("Structural-Calibrated");
    const isBrooksTrend = key.includes("Upgraded");
    const versionNum = parseInt(key.match(/^V(\d+):/)?.[1] || 0, 10);
    const isStrictLegInit = versionNum >= 10;

    const originalFunc = STRATEGIES[key];
    STRATEGIES[key] = (candles, params = {}) => {
        const mergedParams = {
            useRatios: isCalibrated,
            useStructuralRules: isStructural,
            useBrooksTrend: isBrooksTrend,
            useStrictLegInitiation: isStrictLegInit,
            ...(isBrooksTrend ? { minTrendBars: 18, swingLookback: 12 } : {}),
            ...params
        };
        return originalFunc(candles, mergedParams);
    };
});

// ============================================================
// SIMULATED PRICE ACTION BACKTESTER (SAFE PARAMS & STOPS)
// ============================================================

function runPriceActionBacktest(candles, signals = [], initialCapital = 100000, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };

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

    for (let i = p.emaPeriod + p.minTrendBars; i < candles.length; i++) {
        const bar = candles[i];

        if (position) {
            if (position.direction === 'long') {
                position.bestPrice = Math.max(position.bestPrice, bar.high);
                position.worstPrice = Math.min(position.worstPrice, bar.low);
            } else {
                position.bestPrice = Math.min(position.bestPrice, bar.low);
                position.worstPrice = Math.max(position.worstPrice, bar.high);
            }

            let exitPrice = null;
            let exitReason = null;

            if (position.direction === 'long') {
                const stoppedOut = bar.low <= position.stopLoss;
                const tpReached = bar.high >= position.takeProfit;

                if (stoppedOut && tpReached) {
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

                if (stoppedOut && tpReached) {
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

                const initialSlDist = Math.abs(position.entry - position.stopLoss);
                const maePercentage = initialSlDist > 0
                    ? Math.max(0, (Math.abs(position.entry - position.worstPrice) / initialSlDist) * 100)
                    : 0;

                trades.push({
                    entryIndex: position.entryIndex,
                    exitIndex: i,
                    entryPrice: position.entry,
                    exitPrice,
                    stopLoss: position.stopLoss,
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
                    metadata: position.metadata
                });

                position = null;
            }
        }

        if (!position && pendingOrder) {
            let triggered = false;
            let entryPrice = 0;

            if (pendingOrder.type === 'BUY_STOP') {
                if (bar.high >= pendingOrder.triggerPrice) {
                    triggered = true;
                    entryPrice = Math.max(bar.open, pendingOrder.triggerPrice);
                }
            } else {
                if (bar.low <= pendingOrder.triggerPrice) {
                    triggered = true;
                    entryPrice = Math.min(bar.open, pendingOrder.triggerPrice);
                }
            }

            if (triggered) {
                const risk = Math.abs(entryPrice - pendingOrder.stopLoss);
                if (risk > 0) {
                    const riskAmount = equity * p.maxRiskPerTrade;
                    const quantity = riskAmount / risk;

                    let finalTP;
                    if (pendingOrder.useStructuralTarget && pendingOrder.structuralTarget !== null) {
                        finalTP = pendingOrder.structuralTarget;
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
                        takeProfit: finalTP,
                        confidence: pendingOrder.confidence,
                        bestPrice: entryPrice,
                        worstPrice: entryPrice,
                        metadata: pendingOrder.metadata
                    };

                    if (position.direction === 'long') {
                        position.bestPrice = Math.max(position.bestPrice, bar.high);
                        position.worstPrice = Math.min(position.worstPrice, bar.low);
                    } else {
                        position.bestPrice = Math.min(position.bestPrice, bar.low);
                        position.worstPrice = Math.max(position.worstPrice, bar.high);
                    }

                    let exitPrice = null;
                    let exitReason = null;

                    if (position.direction === 'long') {
                        const stoppedOut = bar.low <= position.stopLoss;
                        const tpReached = bar.high >= position.takeProfit;

                        if (stoppedOut && tpReached) {
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

                        if (stoppedOut && tpReached) {
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

                        const initialSlDist = Math.abs(position.entry - position.stopLoss);
                        const maePercentage = initialSlDist > 0
                            ? Math.max(0, (Math.abs(position.entry - position.worstPrice) / initialSlDist) * 100)
                            : 0;

                        trades.push({
                            entryIndex: position.entryIndex,
                            exitIndex: i,
                            entryPrice: position.entry,
                            exitPrice,
                            stopLoss: position.stopLoss,
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
                            metadata: position.metadata
                        });

                        position = null;
                    }
                }
            }

            pendingOrder = null;
        }

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
                    metadata: { setupType: signal.type, signalBarIndex: i }
                };
            }
        }
    }

    const totalTrades = trades.length;
    const wins = trades.filter(t => t.exitReason === 'take_profit').length;
    const losses = trades.filter(t => t.exitReason === 'stop_loss').length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    return {
        trades,
        finalEquity: equity,
        summary: {
            totalTrades,
            wins,
            losses,
            winRate,
            win_rate: winRate,
            "Win Rate": winRate,
            pnlPercentage: ((equity - startingCapital) / startingCapital) * 100,
            pnl: ((equity - startingCapital) / startingCapital) * 100
        }
    };
}

module.exports = {
    DEFAULT_PARAMS,
    calculateEMA,
    findPullbackSwingIndex,
    evaluateH2Setup,
    evaluateL2Setup,
    evaluateStrictH2Setup,
    evaluateStrictL2Setup,
    evaluateStructuralH2Setup,
    evaluateStructuralL2Setup,
    evaluateStructuralStrictH2Setup,
    evaluateStructuralStrictL2Setup,
    STRATEGIES,
    twoLeggedPullback: STRATEGIES["V1: Double Traps"],
    runPriceActionBacktest
};