/**
 * Price Action Strategy Versions Module
 * Houses 5 independent versions of the Thomas Wade 2-Legged Pullback strategy.
 */

const DEFAULT_PARAMS = {
    // === Core Price Action Parameters ===
    emaPeriod: 20,                      // Wade/Mack standard 20 EMA
    swingLookback: 10,                  // Lookback to find the recent high/low trend extremes
    minTrendBars: 12,                   // Minimum bars required to establish trend structure
    rewardRatio: 1.5,                   // Target reward-to-risk ratio (Typically 1:1 to 1:1.5)
    
    // === Tick-Based Configurations for NSE ===
    tickSize: 0.05,                     // NSE minimum tick size (0.05 paisa/points)
    emaTouchTicks: 4,                   // Maximum ticks from EMA to consider it a valid test
    triggerOffsetTicks: 1,              // Enter 1 tick beyond signal bar high/low
    stopOffsetTicks: 1,                 // Stop placed 1 tick beyond signal bar opposite extreme
    
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

// ============================================================
// SHARED STRATEGY MATHEMATICAL UTILITIES
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

function assessTrend(candles, ema, i, params) {
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

function calculateConfidenceScore(candles, ema, i, type, p) {
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
    const ticksToEMA = distanceToEMA / p.tickSize;
    if (ticksToEMA <= 1.0) {
        score += 15;
    } else if (ticksToEMA <= 2.0) {
        score += 10;
    } else if (ticksToEMA <= p.emaTouchTicks) {
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

function isWhipsawing(candles, ema, i, p) {
    if (!p.enableWhipsawFilter) return false;

    const slope = (ema[i] - ema[i - 5]) / ema[i - 5];
    const isFlat = Math.abs(slope) < p.flatEmaSlopeThreshold;

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
// PRICE ACTION LEG COUNTING ENGINE
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

// ============================================================
// CORE PIPELINE WITH ADAPTIVE STRUCTURAL TARGETING SUPPORT
// ============================================================

function twoLeggedPullbackCore(candles, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
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

        if (isWhipsawing(candles, ema, i, p)) continue;

        if (p.enableGiantBarFilter) {
            const averageRange = getAverageBarRange(candles, i, 10);
            if (range > averageRange * p.giantBarMultiplier) continue;
        }

        let signalFound = false;

        // 1. STANDARD SECOND ENTRY LONG (H2)
        if (trend.bullish && (i - lastPullbackSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            const swingHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
            if (swingHighIdx !== null) {
                const setup = evaluateH2Setup(candles, swingHighIdx, i, p.tickSize);
                if (setup.isH2) {
                    const touchEMA = sBar.low <= ema[i] + (p.emaTouchTicks * p.tickSize) && sBar.high >= ema[i] - (p.emaTouchTicks * p.tickSize);
                    const passesSignalBarCheck = validateSignalBar(sBar, 'BUY', p);

                    if (touchEMA && passesSignalBarCheck) {
                        let score = 100;
                        let passesScore = true;
                        
                        if (p.enableConfidenceScoring) {
                            score = calculateConfidenceScore(candles, ema, i, 'BUY', p);
                            passesScore = score >= p.minConfidenceThreshold;
                        }

                        if (passesScore) {
                            const triggerPrice = sBar.high + (p.triggerOffsetTicks * p.tickSize);
                            const stopLoss = sBar.low - (p.stopOffsetTicks * p.tickSize);
                            
                            // Dynamically evaluate target price based on structural peaks if enabled (Wade Structural Target)
                            let takeProfit = triggerPrice + (triggerPrice - stopLoss) * p.rewardRatio;
                            if (p.useStructuralTarget && swingHighIdx !== null) {
                                takeProfit = candles[swingHighIdx].high + (p.triggerOffsetTicks * p.tickSize);
                            }

                            const risk = Math.abs(triggerPrice - stopLoss);
                            const reward = Math.abs(takeProfit - triggerPrice);
                            const rrr = risk > 0 ? reward / risk : 0;

                            // Skip setups that fail Wade's reward restrictions (not worth taking (< 1.0) or too far (> 2.2))
                            if (!p.useStructuralTarget || (rrr >= 1.0 && rrr <= 2.2)) {
                                signals.push({
                                    index: i,
                                    type: 'BUY_STOP',
                                    triggerPrice,
                                    stopLoss,
                                    takeProfit,
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

        // 2. STANDARD SECOND ENTRY SHORT (L2)
        if (trend.bearish && (i - lastPullbackSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            const swingLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
            if (swingLowIdx !== null) {
                const setup = evaluateL2Setup(candles, swingLowIdx, i, p.tickSize);
                if (setup.isL2) {
                    const touchEMA = sBar.low <= ema[i] + (p.emaTouchTicks * p.tickSize) && sBar.high >= ema[i] - (p.emaTouchTicks * p.tickSize);
                    const passesSignalBarCheck = validateSignalBar(sBar, 'SELL', p);

                    if (touchEMA && passesSignalBarCheck) {
                        let score = 100;
                        let passesScore = true;

                        if (p.enableConfidenceScoring) {
                            score = calculateConfidenceScore(candles, ema, i, 'SELL', p);
                            passesScore = score >= p.minConfidenceThreshold;
                        }

                        if (passesScore) {
                            const triggerPrice = sBar.low - (p.triggerOffsetTicks * p.tickSize);
                            const stopLoss = sBar.high + (p.stopOffsetTicks * p.tickSize);

                            let takeProfit = triggerPrice - (stopLoss - triggerPrice) * p.rewardRatio;
                            if (p.useStructuralTarget && swingLowIdx !== null) {
                                takeProfit = candles[swingLowIdx].low - (p.triggerOffsetTicks * p.tickSize);
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
            // --- Long Trap Setup (Failed L2 in an Uptrend) ---
            if (trend.bullish) {
                const lookbackStart = Math.max(p.emaPeriod, i - p.trapMaxLookback);
                for (let L = i - 1; L >= lookbackStart; L--) {
                    const swingLowIdx = findPullbackSwingIndex(candles, L, p.swingLookback + p.minTrendBars, 'low');
                    if (swingLowIdx !== null) {
                        const setupL2 = evaluateL2Setup(candles, swingLowIdx, L, p.tickSize);
                        
                        if (setupL2.isL2) {
                            const triggeredShort = candles[L + 1].low < candles[L].low - (p.tickSize);
                            
                            if (triggeredShort) {
                                const structureHigh = Math.max(candles[L].high, candles[L + 1].high);
                                if (sBar.high >= structureHigh) {
                                    let score = 100;
                                    let passesScore = true;

                                    if (p.enableConfidenceScoring) {
                                        score = calculateConfidenceScore(candles, ema, i, 'BUY', p);
                                        passesScore = score >= p.minConfidenceThreshold;
                                    }

                                    if (passesScore) {
                                        const triggerPrice = structureHigh + (p.triggerOffsetTicks * p.tickSize);
                                        const stopLoss = sBar.low - (p.stopOffsetTicks * p.tickSize);
                                        
                                        let takeProfit = triggerPrice + (triggerPrice - stopLoss) * p.rewardRatio;
                                        const swingHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
                                        if (p.useStructuralTarget && swingHighIdx !== null) {
                                            takeProfit = candles[swingHighIdx].high + (p.triggerOffsetTicks * p.tickSize);
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

            // --- Short Trap Setup (Failed H2 in a Downtrend) ---
            if (trend.bearish && !signalFound) {
                const lookbackStart = Math.max(p.emaPeriod, i - p.trapMaxLookback);
                for (let L = i - 1; L >= lookbackStart; L--) {
                    const swingHighIdx = findPullbackSwingIndex(candles, L, p.swingLookback + p.minTrendBars, 'high');
                    if (swingHighIdx !== null) {
                        const setupH2 = evaluateH2Setup(candles, swingHighIdx, L, p.tickSize);
                        
                        if (setupH2.isH2) {
                            const triggeredLong = candles[L + 1].high > candles[L].high + (p.tickSize);
                            
                            if (triggeredLong) {
                                const structureLow = Math.min(candles[L].low, candles[L + 1].low);
                                if (sBar.low <= structureLow) {
                                    let score = 100;
                                    let passesScore = true;

                                    if (p.enableConfidenceScoring) {
                                        score = calculateConfidenceScore(candles, ema, i, 'SELL', p);
                                        passesScore = score >= p.minConfidenceThreshold;
                                    }

                                    if (passesScore) {
                                        const triggerPrice = structureLow - (p.triggerOffsetTicks * p.tickSize);
                                        const stopLoss = sBar.high + (p.stopOffsetTicks * p.tickSize);
                                        
                                        let takeProfit = triggerPrice - (stopLoss - triggerPrice) * p.rewardRatio;
                                        const swingLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
                                        if (p.useStructuralTarget && swingLowIdx !== null) {
                                            takeProfit = candles[swingLowIdx].low - (p.triggerOffsetTicks * p.tickSize);
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
// PARALLEL CONFIGURATIONS STRATEGY INDEX
// ============================================================

const STRATEGIES = {
    "V1: Double Traps": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: true,
            enableConfidenceScoring: true,
            enableFVGConfluence: true,
            enableLiquiditySweeps: true,
            minConfidenceThreshold: 45,
            useStructuralTarget: false
        });
    },
    "V2: EMA Pullback": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: false,
            enableConfidenceScoring: false,
            enableFVGConfluence: false,
            enableLiquiditySweeps: false,
            useStructuralTarget: false
        });
    },
    "V3: High Confidence": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: true,
            enableConfidenceScoring: true,
            enableFVGConfluence: true,
            enableLiquiditySweeps: true,
            minConfidenceThreshold: 60,
            useStructuralTarget: false
        });
    },
    "V4: Aggressive": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: false,
            enableConfidenceScoring: false,
            enableGiantBarFilter: false,
            enableWhipsawFilter: false,
            enableBodyToRangeFilter: false,
            minSignalBarCloseRatio: 0.50,
            useStructuralTarget: false
        });
    },
    "V5: Wade Structural": (candles, params = {}) => {
        return twoLeggedPullbackCore(candles, {
            ...params,
            enableTraps: true,
            enableConfidenceScoring: true,
            enableFVGConfluence: true,
            enableLiquiditySweeps: true,
            minConfidenceThreshold: 45,
            useStructuralTarget: true // Calculates TP targets using structural extremes
        });
    }
};

// ============================================================
// BACKTEST SIMULATOR
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

                trades.push({
                    entryIndex: position.entryIndex,
                    exitIndex: i,
                    entryPrice: position.entry,
                    exitPrice,
                    pnlPercentage: (pnlAmount / (equity - pnlAmount)) * 100,
                    pnlAmount,
                    exitReason,
                    direction: position.direction,
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

                    position = {
                        direction: pendingOrder.type === 'BUY_STOP' ? 'long' : 'short',
                        entry: entryPrice,
                        quantity,
                        entryIndex: i,
                        stopLoss: pendingOrder.stopLoss,
                        takeProfit: pendingOrder.type === 'BUY_STOP' 
                            ? entryPrice + risk * p.rewardRatio 
                            : entryPrice - risk * p.rewardRatio,
                        metadata: pendingOrder.metadata
                    };

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

                        trades.push({
                            entryIndex: position.entryIndex,
                            exitIndex: i,
                            entryPrice: position.entry,
                            exitPrice,
                            pnlPercentage: (pnlAmount / (equity - pnlAmount)) * 100,
                            pnlAmount,
                            exitReason,
                            direction: position.direction,
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
        }
    };
}

module.exports = { 
    DEFAULT_PARAMS, 
    calculateEMA, 
    evaluateH2Setup, 
    evaluateL2Setup, 
    STRATEGIES, // FIX: Export STRATEGIES map explicitly
    twoLeggedPullback: STRATEGIES["V1: Double Traps"], // Backward-compatibility
    runPriceActionBacktest 
};