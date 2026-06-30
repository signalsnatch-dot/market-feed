/**
 * Price Action Strategy Versions Module (Dual-Framework Engine)
 * Houses 43 independent versions of the Thomas Wade / Al Brooks 2-Legged Pullback strategy:
 * - V1 to V10: Original absolute tick-based logic (preserves baseline results, zero regression).
 * - V11 to V20: New dynamic volatility-adjusted ratio-based logic (loaded from config.json).
 * - V21 to V23: Filtered variations of V3 (Absolute Tick-Based)
 * - V24 to V26: Filtered variations of V8 (Strict Absolute Tick-Based)
 * - V27 to V29: Filtered variations of V13 (Calibrated Ratio-Based)
 * - V30 to V32: Filtered variations of V18 (Strict Calibrated Ratio-Based)
 * - V33 to V42: Structural Calibrated editions incorporating three-dimensional leg completion filters.
 * - V43: Dynamic Structural variation with confidence metrics.
 */

const DEFAULT_PARAMS = {
    // === Core Price Action Parameters ===
    emaPeriod: 20,                      // Wade/Mack standard 20 EMA
    swingLookback: 10,                  // Lookback to find the recent high/low trend extremes
    minTrendBars: 12,                   // Minimum bars required to establish trend structure
    rewardRatio: 1.5,                   // Target reward-to-risk ratio (Typically 1:1 to 1:1.5)
    
    // === Fallback Ratio-Based Configurations (V11-V32) ===
    emaTouchRatio: 0.20,                // Tolerates EMA test within 20% of average bar range
    triggerOffsetRatio: 0.05,           // Offset order entry by 5% of average bar range beyond signal bar high/low
    stopOffsetRatio: 0.05,              // Stop placed 5% of average bar range beyond opposite extreme
    doubleTopBottomToleranceRatio: 0.25,// Double top/bottom tolerance within 25% of average bar range

    // === Fallback Structural Ratio Configurations (V33-V43) ===
    emaTouchRatioV2: 0.15,              // Volatility-padded EMA touch threshold
    triggerOffsetRatioV2: 0.03,         // Volatility-padded stop order triggers
    stopOffsetRatioV2: 0.30,            // Volatility-padded stops protecting against noise sweeps
    doubleTopBottomToleranceRatioV2: 0.15, // Padded double top/bottom verification
    structureOffsetRatio: 0.10,         // Minimum ABR breach buffer to confirm a structural breakout (10% default)
    
    // === Original Tick-Based Configurations (V1-V10) ===
    tickSize: 0.05,                     // Fallback minimum tick size (0.05 paisa/points)
    emaTouchTicks: 4,                   // Maximum ticks from EMA to consider it a valid test
    triggerOffsetTicks: 1,              // Enter 1 tick beyond signal bar high/low
    stopOffsetTicks: 1,                 // Stop placed 1 tick beyond signal bar opposite extreme
    doubleTopBottomToleranceTicks: 4,   // How close (in ticks) a trap must be to a prior swing high/low to count as double top/bottom
    
    // === Signal Bar Quality Rules ===
    minSignalBarCloseRatio: 0.60,       // Close must be in the top/bottom 40% of the bar's range
    requireBullishBodyForLong: true,    // H2 signal bar must have a bullish body (close > open)
    requireBearishBodyForShort: true,   // L2 signal bar must have a bearish close (close < open)
    
    // === Optimization Filters ===
    enableGiantBarFilter: true,         // Rejects signal bars that are excessively wide
    giantBarMultiplier: 2.2,            // Bar range cannot exceed 2.2x the 10-bar average range
    
    enableWhipsawFilter: true,          // Detects trading ranges / sideways chop
    flatEmaSlopeThreshold: 0.0001,      // Slopes below this are considered flat (sideways market)
    maxEmaCrosses: 3,                   // Rejects setups if price crosses EMA more than 3 times
    whipsawLookback: 8,                 // Number of bars back to analyze whipsaw crosses
    
    enableBodyToRangeFilter: true,      // Rejects high-wick "indecision" candles
    minBodyToRangeRatio: 0.40,          // Body (open-close) must cover at least 40% of overall bar range (if not a pinbar)
    
    // === Trap Settings ===
    enableTraps: true,                  // Enables Failed Second Entry (Trap) signals
    trapMaxLookback: 3,                 // Maximum bars allowed for the setup to fail and trigger the trap
    
    // === Confluence Overlays ===
    enableFVGConfluence: true,          // Evaluates Fair Value Gaps for scoring
    fvgLookback: 15,                    // Bars to look back for active FVGs acting as support/resistance
    enableLiquiditySweeps: true,        // Evaluates structural swing sweeps for scoring
    sweepLookback: 15,                  // Bars back to check for swept highs/lows
    
    // === Confidence Filter ===
    minConfidenceThreshold: 45,         // Only execute setups that score >= 45/100 on the Confluence Matrix
    enableConfidenceScoring: true,      // Toggles scoring calculations
     
    // === Risk Management ===
    maxRiskPerTrade: 0.01,              // Risk 1% of equity per trade
    maxConsecutiveLosses: 3,            // Cool-down after consecutive losses
    maxDailyLoss: 0.03,                 // Max daily loss limit (3%)
    minBarsBetweenSignals: 3,           // Minimum candles to wait before scanning new setups
};

// Central dynamic tick size helper shared by both the backtester and live server
function getTickSize(instrumentKey) {
    if (!instrumentKey) return 0.05;
    if (instrumentKey.includes('MCX_FO')) {
        // Natural Gas
        if (instrumentKey.includes('504265') || instrumentKey.includes('487465')) return 0.10;
        // Base Metals (Zinc, Lead, Copper, Aluminium)
        if (instrumentKey.includes('552708') || instrumentKey.includes('552711') || instrumentKey.includes('552709') || instrumentKey.includes('552706') || instrumentKey.includes('Bulldex')) return 0.05;
        // Crude Oil, Silver, Gold
        return 1.0;
    }
    return 0.05; // NSE Standard
}

/**
 * Dynamic Instrument Config Lookup Helper
 * Parses instrument keys, matching them with configurations inside the JSON file.
 * Automatically resolves common delimiter swaps (e.g. '|' vs '_').
 */
function getInstrumentConfig(instrumentKey) {
    if (!instrumentKey) return null;
    
    const normalizedKey = instrumentKey.replace(/_/g, '|'); // Standardize format for match verification
    
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
    } catch (e) {
        // Fall back gracefully if disk read is unavailable or fails
    }
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

function findPullbackSwingIndex(candles, currentIdx, lookback, direction) {
    let bestIdx = null;
    let bestVal = direction === 'high' ? -Infinity : Infinity;
    const start = Math.max(0, currentIdx - lookback);
    for (let i = start; i < currentIdx; i++) {
        const val = direction === 'high' ? candles[i].high : candles[i].low;
        const isBetter = direction === 'high' ? val > bestVal : val < bestVal;
        if (isBetter) {
            bestVal = val;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// === Trend Evaluation Selection Helper ===
function assessTrend(candles, ema, i, params) {
    if (params.useBrooksTrend) {
        return assessTrendBrooks(candles, ema, i, params);
    }
    return assessTrendLegacy(candles, ema, i, params);
}

// === Legacy Trend Logic (Strictly preserved for V1-V30) ===
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

// === New Al Brooks Trend Logic (Upgraded for V31-V50) ===
function assessTrendBrooks(candles, ema, i, params) {
    const { emaPeriod, minTrendBars } = params;
    
    const macroLookback = minTrendBars || 18;
    if (i < emaPeriod + macroLookback || ema[i] == null || ema[i - 15] == null) {
        return { bullish: false, bearish: false };
    }

    const avgRange = getAverageBarRange(candles, i, 10);
    if (avgRange <= 0) return { bullish: false, bearish: false };

    // ABR-Normalized Slope
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

// === Whipsaw Filter Selector ===
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

    // Volatility-Adjusted EMA Proximity Scoring
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
    
    // 1. Distance Rule
    if (candles[j].high > hardBreakoutLevel) {
        return true;
    }
    
    // 2. Close Acceptance Rule
    if (candles[j].close > prevHigh) {
        return true;
    }
    
    // 3. Time-at-Level Rule (3 consecutive breaches)
    if (candles[j].high > prevHigh) {
        consecutiveBreachesRef.count++;
        if (consecutiveBreachesRef.count >= 3) {
            return true;
        }
    } else {
        consecutiveBreachesRef.count = 0;
    }
    
    return false;
}

function isStructuralLowBreach(candles, j, prevLow, avgRange, structureOffsetRatio, consecutiveBreachesRef) {
    const hardBreakoutLevel = prevLow - (avgRange * structureOffsetRatio);
    
    // 1. Distance Rule
    if (candles[j].low < hardBreakoutLevel) {
        return true;
    }
    
    // 2. Close Acceptance Rule
    if (candles[j].close < prevLow) {
        return true;
    }
    
    // 3. Time-at-Level Rule
    if (candles[j].low < prevLow) {
        consecutiveBreachesRef.count++;
        if (consecutiveBreachesRef.count >= 3) {
            return true;
        }
    } else {
        consecutiveBreachesRef.count = 0;
    }
    
    return false;
}

// ============================================================
// STRUCTURAL PRICE ACTION LEG COUNTING ENGINE
// ============================================================

function evaluateH2Setup(candles, swingHighIdx, currentIdx, tickSize) {
    if (swingHighIdx === null || swingHighIdx >= currentIdx - 2) {
        return { isH2: false };
    }

    let h1TriggerIdx = -1;
    let h1SignalIdx = -1;
    let secondLegStarted = false;
    let h2TriggerIdx = -1;
    let h2SignalIdx = -1;

    for (let j = swingHighIdx + 1; j <= currentIdx; j++) {
        const prevHigh = candles[j - 1].high;
        const currentHigh = candles[j].high;

        if (h1TriggerIdx === -1) {
            if (currentHigh > prevHigh) {
                h1TriggerIdx = j;
                h1SignalIdx = j - 1;
            }
        } else if (!secondLegStarted) {
            if (candles[j].low < candles[j - 1].low || candles[j].high < candles[j - 1].high) {
                secondLegStarted = true;
            }
        } else if (h2TriggerIdx === -1) {
            if (currentHigh > prevHigh) {
                h2TriggerIdx = j;
                h2SignalIdx = j - 1;
            }
        }
    }

    const isValidH2Signal = (h1TriggerIdx !== -1) && secondLegStarted && (h2TriggerIdx === -1);

    return {
        isH2: isValidH2Signal,
        h1TriggerIdx,
        h1SignalIdx,
        secondLegStarted,
        swingHighIdx
    };
}

function evaluateL2Setup(candles, swingLowIdx, currentIdx, tickSize) {
    if (swingLowIdx === null || swingLowIdx >= currentIdx - 2) {
        return { isL2: false };
    }

    let l1TriggerIdx = -1;
    let l1SignalIdx = -1;
    let secondLegStarted = false;
    let l2TriggerIdx = -1;
    let l2SignalIdx = -1;

    for (let j = swingLowIdx + 1; j <= currentIdx; j++) {
        const prevLow = candles[j - 1].low;
        const currentLow = candles[j].low;

        if (l1TriggerIdx === -1) {
            if (currentLow < prevLow) {
                l1TriggerIdx = j;
                l1SignalIdx = j - 1;
            }
        } else if (!secondLegStarted) {
            if (candles[j].high > candles[j - 1].high || candles[j].low > candles[j - 1].low) {
                secondLegStarted = true;
            }
        } else if (l2TriggerIdx === -1) {
            if (currentLow < prevLow) {
                l2TriggerIdx = j;
                l2SignalIdx = j - 1;
            }
        }
    }

    const isValidL2Signal = (l1TriggerIdx !== -1) && secondLegStarted && (l2TriggerIdx === -1);

    return {
        isL2: isValidL2Signal,
        l1TriggerIdx,
        l1SignalIdx,
        secondLegStarted,
        swingLowIdx
    };
}

// === BROOKS/WADE STRICT LEG EVALUATIONS ===

function evaluateStrictH2Setup(candles, swingHighIdx, currentIdx, tickSize) {
    const setup = evaluateH2Setup(candles, swingHighIdx, currentIdx, tickSize);
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

    return setup;
}

function evaluateStrictL2Setup(candles, swingLowIdx, currentIdx, tickSize) {
    const setup = evaluateL2Setup(candles, swingLowIdx, currentIdx, tickSize);
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

    return setup;
}

// === NOISE-CANCELLED STRUCTURAL LEG EVALUATIONS (V33-V43) ===

function evaluateStructuralH2Setup(candles, swingHighIdx, currentIdx, tickSize, avgRange, p) {
    if (swingHighIdx === null || swingHighIdx >= currentIdx - 2) {
        return { isH2: false };
    }

    let h1TriggerIdx = -1;
    let h1SignalIdx = -1;
    let secondLegStarted = false;
    let h2TriggerIdx = -1;
    let h2SignalIdx = -1;

    let h1Breaches = { count: 0 };
    let h2Breaches = { count: 0 };

    const structureOffsetRatio = p.structureOffsetRatio !== undefined ? p.structureOffsetRatio : 0.10;

    for (let j = swingHighIdx + 1; j <= currentIdx; j++) {
        const prevHigh = candles[j - 1].high;
        const prevLow = candles[j - 1].low;

        if (h1TriggerIdx === -1) {
            if (isStructuralHighBreach(candles, j, prevHigh, avgRange, structureOffsetRatio, h1Breaches)) {
                h1TriggerIdx = j;
                h1SignalIdx = j - 1;
            }
        } else if (!secondLegStarted) {
            if (candles[j].low < prevLow || candles[j].high < prevHigh) {
                secondLegStarted = true;
            }
        } else if (h2TriggerIdx === -1) {
            if (isStructuralHighBreach(candles, j, prevHigh, avgRange, structureOffsetRatio, h2Breaches)) {
                h2TriggerIdx = j;
                h2SignalIdx = j - 1;
            }
        }
    }

    const isValidH2Signal = (h1TriggerIdx !== -1) && secondLegStarted && (h2TriggerIdx === -1);

    return {
        isH2: isValidH2Signal,
        h1TriggerIdx,
        h1SignalIdx,
        secondLegStarted,
        swingHighIdx
    };
}

function evaluateStructuralL2Setup(candles, swingLowIdx, currentIdx, tickSize, avgRange, p) {
    if (swingLowIdx === null || swingLowIdx >= currentIdx - 2) {
        return { isL2: false };
    }

    let l1TriggerIdx = -1;
    let l1SignalIdx = -1;
    let secondLegStarted = false;
    let l2TriggerIdx = -1;
    let l2SignalIdx = -1;

    let l1Breaches = { count: 0 };
    let l2Breaches = { count: 0 };

    const structureOffsetRatio = p.structureOffsetRatio !== undefined ? p.structureOffsetRatio : 0.10;

    for (let j = swingLowIdx + 1; j <= currentIdx; j++) {
        const prevLow = candles[j - 1].low;
        const prevHigh = candles[j - 1].high;

        if (l1TriggerIdx === -1) {
            if (isStructuralLowBreach(candles, j, prevLow, avgRange, structureOffsetRatio, l1Breaches)) {
                l1TriggerIdx = j;
                l1SignalIdx = j - 1;
            }
        } else if (!secondLegStarted) {
            if (candles[j].high > prevHigh || candles[j].low > prevLow) {
                secondLegStarted = true;
            }
        } else if (l2TriggerIdx === -1) {
            if (isStructuralLowBreach(candles, j, prevLow, avgRange, structureOffsetRatio, l2Breaches)) {
                l2TriggerIdx = j;
                l2SignalIdx = j - 1;
            }
        }
    }

    const isValidL2Signal = (l1TriggerIdx !== -1) && secondLegStarted && (l2TriggerIdx === -1);

    return {
        isL2: isValidL2Signal,
        l1TriggerIdx,
        l1SignalIdx,
        secondLegStarted,
        swingLowIdx
    };
}

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

    if (secondLegLow >= firstLegLow) {
        setup.isH2 = false;
    }

    return setup;
}

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

    if (secondLegHigh <= firstLegHigh) {
        setup.isL2 = false;
    }

    return setup;
}

// ============================================================
// CENTRAL STRATEGY EVALUATION MODULE
// ============================================================

function twoLeggedPullbackCore(candles, params = {}) {
    const sampleCandle = candles[0];
    const instrumentKey = sampleCandle?.instrument || sampleCandle?.instrument_key || params.instrument_key || params.instrument;
    
    // Dynamically retrieve the calibration config for this specific instrument from config.json
    const instConfig = getInstrumentConfig(instrumentKey);
    
    const resolvedTickSize = params.tickSize !== undefined 
        ? params.tickSize 
        : (instConfig?.tickSize || getTickSize(instrumentKey));

    // Decoupled Structural Logic configuration parsing
    const useStructural = params.useStructuralRules || false;
    
    // Dynamic Parameter Precedence logic with complete separation of versions
    let emaTouchRatioVal;
    let triggerOffsetRatioVal;
    let stopOffsetRatioVal;
    let doubleTopBottomToleranceRatioVal;
    let structureOffsetRatioVal;

    if (useStructural) {
        // High probability V33-V43 editions
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
        // Standard baseline V11-V32 editions
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

        // Fetch dynamic baseline volatility (average bar range of the last 10 candles)
        const avgRange = getAverageBarRange(candles, i, 10);
        
        let emaTouchDistance, triggerOffset, stopOffset, doubleTopBottomTolerance, triggerBreakDist;

        if (p.useRatios) {
            // Dynamic, volatility-adjusted limits derived from config.json data
            emaTouchDistance = avgRange > 0 ? avgRange * p.emaTouchRatio : (p.emaTouchTicks * p.tickSize);
            triggerOffset = avgRange > 0 ? avgRange * p.triggerOffsetRatio : (p.triggerOffsetTicks * p.tickSize);
            stopOffset = avgRange > 0 ? avgRange * p.stopOffsetRatio : (p.stopOffsetTicks * p.tickSize);
            doubleTopBottomTolerance = avgRange > 0 ? avgRange * p.doubleTopBottomToleranceRatio : (p.doubleTopBottomToleranceTicks * p.tickSize);
            triggerBreakDist = avgRange > 0 ? avgRange * p.triggerOffsetRatio : p.tickSize;
        } else {
            // Original absolute tick-based limits
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

        // 1. SECOND ENTRY LONG (H2)
        if (trend.bullish && (i - lastPullbackSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            const swingHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
            if (swingHighIdx !== null) {
                const setup = p.useStructuralRules
                    ? (p.requireStrictSecondLeg 
                        ? evaluateStructuralStrictH2Setup(candles, swingHighIdx, i, p.tickSize, avgRange, p)
                        : evaluateStructuralH2Setup(candles, swingHighIdx, i, p.tickSize, avgRange, p))
                    : (p.requireStrictSecondLeg 
                        ? evaluateStrictH2Setup(candles, swingHighIdx, i, p.tickSize)
                        : evaluateH2Setup(candles, swingHighIdx, i, p.tickSize));

                if (setup.isH2) {
                    const touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.high >= ema[i] - emaTouchDistance;
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
                            const stopLoss = sBar.low - stopOffset;
                            
                            let takeProfit = triggerPrice + (triggerPrice - stopLoss) * p.rewardRatio;
                            let structuralTarget = null;
                            if (p.useStructuralTarget && swingHighIdx !== null) {
                                structuralTarget = candles[swingHighIdx].high + triggerOffset;
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
            const swingLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
            if (swingLowIdx !== null) {
                const setup = p.useStructuralRules
                    ? (p.requireStrictSecondLeg
                        ? evaluateStructuralStrictL2Setup(candles, swingLowIdx, i, p.tickSize, avgRange, p)
                        : evaluateStructuralL2Setup(candles, swingLowIdx, i, p.tickSize, avgRange, p))
                    : (p.requireStrictSecondLeg
                        ? evaluateStrictL2Setup(candles, swingLowIdx, i, p.tickSize)
                        : evaluateL2Setup(candles, swingLowIdx, i, p.tickSize));

                if (setup.isL2) {
                    const touchEMA = sBar.low <= ema[i] + emaTouchDistance && sBar.high >= ema[i] - emaTouchDistance;
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
                            const stopLoss = sBar.high + stopOffset;

                            let takeProfit = triggerPrice - (stopLoss - triggerPrice) * p.rewardRatio;
                            let structuralTarget = null;
                            if (p.useStructuralTarget && swingLowIdx !== null) {
                                structuralTarget = candles[swingLowIdx].low - triggerOffset;
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
                                ? evaluateStrictL2Setup(candles, swingLowIdx, L, p.tickSize)
                                : evaluateL2Setup(candles, swingLowIdx, L, p.tickSize));
                        
                        if (setupL2.isL2) {
                            const triggeredShort = candles[L + 1].low < candles[L].low - triggerBreakDist;
                            
                            if (triggeredShort) {
                                // Double Bottom Check
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
                                        const stopLoss = Math.min(sBar.low, structureHigh) - stopOffset;
                                        
                                        let takeProfit = triggerPrice + (triggerPrice - stopLoss) * p.rewardRatio;
                                        let structuralTarget = null;
                                        const swingHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
                                        if (p.useStructuralTarget && swingHighIdx !== null) {
                                            structuralTarget = candles[swingHighIdx].high + triggerOffset;
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
                                ? evaluateStrictH2Setup(candles, swingHighIdx, L, p.tickSize)
                                : evaluateH2Setup(candles, swingHighIdx, L, p.tickSize));
                        
                        if (setupH2.isH2) {
                            const triggeredLong = candles[L + 1].high > candles[L].high + triggerBreakDist;
                            
                            if (triggeredLong) {
                                // Double Top Check
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
                                        const stopLoss = Math.max(sBar.high, structureLow) + stopOffset;
                                        
                                        let takeProfit = triggerPrice - (stopLoss - triggerPrice) * p.rewardRatio;
                                        let structuralTarget = null;
                                        const swingLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
                                        if (p.useStructuralTarget && swingLowIdx !== null) {
                                            structuralTarget = candles[swingLowIdx].low - triggerOffset;
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
// STRATEGY VERSIONS MAP (PARALLEL CONFIGS)
// ============================================================

// === STRATEGIES DICTIONARY (V1 to V50) ===
const STRATEGIES = {
    // === V1 to V10: Original Absolute Ticks ===
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

    // === V11-V20: Original Calibrated Ratio Editions ===
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

    // === V21-V30: Structural Calibrated Editions (Shifted down from V33-V42) ===
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

    // === V31-V40: Upgraded Clones of V1-V10 (With Al Brooks Trend & Parameter Optimization) ===
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

    // === V41-V50: Upgraded Clones of V21-V30 (With Al Brooks Trend & Parameter Optimization) ===
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
        return twoLeggedPullbackCore(candles, { ...params, enableTraps: false, useStructuralRules: true, minSignalBarCloseRatio: 0.50, useStructuralTarget: false, useBrooksTrend: true, useBrooksTrend: true });
    },
    "V45: Wade Structural (Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: true,
            enableConfidenceScoring: true,
            enableFVGConfluence: true,
            enableLiquiditySweeps: true,
            minConfidenceThreshold: 45,
            useStructuralTarget: true,
            useRatios: true,
            useStructuralRules: true
        });
    },
    "V46: Double Traps (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: true,
            enableConfidenceScoring: false,
            enableFVGConfluence: false,
            enableLiquiditySweeps: false,
            useStructuralTarget: false,
            requireStrictSecondLeg: true,
            requireDoubleTopBottomTrap: true,
            useRatios: true,
            useStructuralRules: true
        });
    },
    "V47: EMA Pullback (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: false,
            enableConfidenceScoring: false,
            enableFVGConfluence: false,
            enableLiquiditySweeps: false,
            useStructuralTarget: false,
            requireStrictSecondLeg: true,
            useRatios: true,
            useStructuralRules: true
        });
    },
    "V48: High Confidence (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: true,
            enableConfidenceScoring: true,
            enableFVGConfluence: true,
            enableLiquiditySweeps: true,
            minConfidenceThreshold: 45,
            useStructuralTarget: false,
            requireStrictSecondLeg: true,
            requireDoubleTopBottomTrap: true,
            useRatios: true,
            useStructuralRules: true
        });
    },
    "V49: Aggressive (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: false,
            enableConfidenceScoring: false,
            enableFVGConfluence: false,
            enableLiquiditySweeps: false,
            useStructuralTarget: false,
            requireStrictSecondLeg: true,
            minSignalBarCloseRatio: 0.50,
            useRatios: true,
            useStructuralRules: true
        });
    },
    "V50: Wade Structural (Strict Structural-Calibrated Upgraded)": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: true,
            enableConfidenceScoring: true,
            enableFVGConfluence: true,
            enableLiquiditySweeps: true,
            minConfidenceThreshold: 45,
            useStructuralTarget: true,
            requireStrictSecondLeg: true,
            requireDoubleTopBottomTrap: true,
            useRatios: true,
            useStructuralRules: true
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

    const originalFunc = STRATEGIES[key];
    STRATEGIES[key] = (candles, params = {}) => {
        const mergedParams = {
            useRatios: isCalibrated, 
            useStructuralRules: isStructural,
            useBrooksTrend: isBrooksTrend,
            ...(isBrooksTrend ? { minTrendBars: 18, swingLookback: 12 } : {}),
            ...params 
        };
        return originalFunc(candles, mergedParams);
    };
});

// ============================================================
// SIMULATED PRICE ACTION BACKTESTER (SAFE PARAMS & STOPS)
// ============================================================

/**
 * STREAMING_CHUNK: Running mock portfolio orders, updating MAE/MAFE bounds, and generating JSON results...
 */

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

        // 1. Process active trade exits and track extremes (MFE/MAE)
        if (position) {
            // Track Worst Price (MAE) and Best Price (MAFE/MFE) for active long/short trades
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

                // Calculate MAFE & MAE relative percentage distances
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

        // 2. Check and execute pending Stop Orders on the next bar
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

                    // FIX: Re-align target execution with structural target boundaries
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

                    // Initial tick assessment on triggering bar
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

                        // Calculate MAFE & MAE ratios
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

        // 3. Scan lookup map for signals
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
    evaluateH2Setup, 
    evaluateL2Setup,
    evaluateStrictH2Setup,
    evaluateStrictL2Setup,
    evaluateStructuralH2Setup,
    evaluateStructuralL2Setup,
    evaluateStructuralStrictH2Setup,
    evaluateStructuralStrictL2Setup,
    STRATEGIES,
    twoLeggedPullback: STRATEGIES["V1: Double Traps"], // Fallback
    runPriceActionBacktest 
};