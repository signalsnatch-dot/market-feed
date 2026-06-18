/**
 * Price Action Strategy — Thomas Wade 2-Legged Pullback & Double Traps
 * Fully Optimized with Dynamic Pinbar Exemptions, Slope-Adaptive Whipsaw Filters,
 * Uncoupled Cooldowns, and a Confluence-Based Confidence Scoring Filter.
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
    
    // === Confluence Overlays (Adaptive Confidence Inputs) ===
    enableFVGConfluence: true,         // Evaluates Fair Value Gaps for scoring
    fvgLookback: 15,                    // Bars to look back for active FVGs acting as support/resistance
    
    enableLiquiditySweeps: true,        // Evaluates structural swing sweeps for scoring
    sweepLookback: 15,                  // Bars back to check for swept highs/lows
    
    // === Confidence Filter ===
    minConfidenceThreshold: 45,         // Only execute setups that score >= 45/100 on the Confluence Matrix
    
    // === Risk Management ===
    maxRiskPerTrade: 0.01,              // Risk 1% of equity per trade
    maxConsecutiveLosses: 3,           // Cool-down after consecutive losses
    maxDailyLoss: 0.03,                 // Max daily loss limit (3%)
    minBarsBetweenSignals: 3,           // Minimum candles to wait before scanning new setups
    
    // === Backtest Specific ===
    allowOverlappingTrades: false,      // If true, takes all concurrent signals (matches live signal list)
};

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
// HIGH-PROBABILITY CONFLUENCE SCANNER
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

// ============================================================
// CONFLUENCE MATRIX CONFIDENCE SCORING ENGINE
// ============================================================

function calculateConfidenceScore(candles, ema, i, type, p) {
    let score = 0;
    const sBar = candles[i];
    const range = sBar.high - sBar.low;
    if (range <= 0) return 0;

    const body = Math.abs(sBar.close - sBar.open);
    const bodyRatio = body / range;

    // 1. Trend & Slope Alignment (Max 25 pts)
    const slope = (ema[i] - ema[i - 5]) / ema[i - 5];
    const absSlope = Math.abs(slope);
    
    // Scale slope up to 15 points
    const slopePoints = Math.min(15, Math.round(absSlope * 150000)); 
    score += slopePoints;

    const alignedBody = type === 'BUY' ? (sBar.close > sBar.open) : (sBar.close < sBar.open);
    if (alignedBody) score += 10;

    // 2. Signal Bar Quality (Max 25 pts)
    const closeRatio = type === 'BUY' ? (sBar.close - sBar.low) / range : (sBar.high - sBar.close) / range;
    if (closeRatio >= 0.80) {
        score += 15; // Outstanding pinbar
    } else if (closeRatio >= 0.65) {
        score += 10; // Standard rejection bar
    }

    if (bodyRatio >= 0.40) {
        score += 10; // Strong momentum body
    } else if (bodyRatio >= 0.20) {
        score += 5;
    }

    // 3. Liquidity Sweep Confluence (Max 20 pts)
    const hasSweep = checkLiquiditySweep(candles, i, type === 'BUY' ? 'BUY' : 'SELL', p.sweepLookback);
    if (hasSweep) {
        score += 20;
    }

    // 4. FVG Retest Confluence (Max 15 pts)
    const hasFVG = checkFVGConfluence(candles, i, type === 'BUY' ? 'BUY' : 'SELL', p.fvgLookback);
    if (hasFVG) {
        score += 15;
    }

    // 5. EMA Touch Precision (Max 15 pts)
    const extreme = type === 'BUY' ? sBar.low : sBar.high;
    const distanceToEMA = Math.abs(extreme - ema[i]);
    const ticksToEMA = distanceToEMA / p.tickSize;
    if (ticksToEMA <= 1.0) {
        score += 15; // Perfect touch
    } else if (ticksToEMA <= 2.0) {
        score += 10;
    } else if (ticksToEMA <= p.emaTouchTicks) {
        score += 5;
    }

    return score;
}

// ============================================================
// DYNAMIC SIGNAL BAR & TREND-SLOPE VALIDATION
// ============================================================

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
// STRUCTURAL PRICE ACTION LEG COUNTING ENGINES
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
// COMPREHENSIVE SIGNAL SCANNING (PULLBACKS & TRAPS)
// ============================================================

function twoLeggedPullback(candles, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const signals = [];
    if (candles.length < p.emaPeriod + p.minTrendBars) return signals;

    const ema = calculateEMA(candles, p.emaPeriod);
    
    // Uncoupled tracking trackers to prevent signal lockout conflicts
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

        // ============================================================
        // 1. STANDARD SECOND ENTRY LONG (H2)
        // ============================================================
        if (trend.bullish && (i - lastPullbackSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            const swingHighIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'high');
            if (swingHighIdx !== null) {
                const setup = evaluateH2Setup(candles, swingHighIdx, i, p.tickSize);
                if (setup.isH2) {
                    const touchEMA = sBar.low <= ema[i] + (p.emaTouchTicks * p.tickSize) && sBar.high >= ema[i] - (p.emaTouchTicks * p.tickSize);
                    const passesSignalBarCheck = validateSignalBar(sBar, 'BUY', p);

                    if (touchEMA && passesSignalBarCheck) {
                        const score = calculateConfidenceScore(candles, ema, i, 'BUY', p);
                        
                        // Enforce the Confidence filter
                        if (score >= p.minConfidenceThreshold) {
                            const triggerPrice = sBar.high + (p.triggerOffsetTicks * p.tickSize);
                            const stopLoss = sBar.low - (p.stopOffsetTicks * p.tickSize);
                            
                            signals.push({
                                index: i,
                                type: 'BUY_STOP',
                                triggerPrice,
                                stopLoss,
                                takeProfit: triggerPrice + (triggerPrice - stopLoss) * p.rewardRatio,
                                timestamp: sBar.timestamp,
                                reason: `H2 Pullback (Conf: ${score}/100)`
                            });
                            lastPullbackSignalIdx = i;
                            signalFound = true;
                        }
                    }
                }
            }
        }

        // ============================================================
        // 2. STANDARD SECOND ENTRY SHORT (L2)
        // ============================================================
        if (trend.bearish && (i - lastPullbackSignalIdx >= p.minBarsBetweenSignals) && !signalFound) {
            const swingLowIdx = findPullbackSwingIndex(candles, i, p.swingLookback + p.minTrendBars, 'low');
            if (swingLowIdx !== null) {
                const setup = evaluateL2Setup(candles, swingLowIdx, i, p.tickSize);
                if (setup.isL2) {
                    const touchEMA = sBar.low <= ema[i] + (p.emaTouchTicks * p.tickSize) && sBar.high >= ema[i] - (p.emaTouchTicks * p.tickSize);
                    const passesSignalBarCheck = validateSignalBar(sBar, 'SELL', p);

                    if (touchEMA && passesSignalBarCheck) {
                        const score = calculateConfidenceScore(candles, ema, i, 'SELL', p);

                        if (score >= p.minConfidenceThreshold) {
                            const triggerPrice = sBar.low - (p.triggerOffsetTicks * p.tickSize);
                            const stopLoss = sBar.high + (p.stopOffsetTicks * p.tickSize);

                            signals.push({
                                index: i,
                                type: 'SELL_STOP',
                                triggerPrice,
                                stopLoss,
                                takeProfit: triggerPrice - (stopLoss - triggerPrice) * p.rewardRatio,
                                timestamp: sBar.timestamp,
                                reason: `L2 Pullback (Conf: ${score}/100)`
                            });
                            lastPullbackSignalIdx = i;
                            signalFound = true;
                        }
                    }
                }
            }
        }

        // ============================================================
        // 3. FAILED SECOND ENTRY TRAPS (DOUBLE TRAP METHOD)
        // ============================================================
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
                                    const score = calculateConfidenceScore(candles, ema, i, 'BUY', p);

                                    if (score >= p.minConfidenceThreshold) {
                                        const triggerPrice = structureHigh + (p.triggerOffsetTicks * p.tickSize);
                                        const stopLoss = sBar.low - (p.stopOffsetTicks * p.tickSize);
                                        const risk = triggerPrice - stopLoss;

                                        if (risk > 0) {
                                            signals.push({
                                                index: i,
                                                type: 'BUY_STOP',
                                                triggerPrice,
                                                stopLoss,
                                                takeProfit: triggerPrice + risk * p.rewardRatio,
                                                timestamp: sBar.timestamp,
                                                reason: `DOUBLE_TRAP_BUY (Conf: ${score}/100)`
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
                                    const score = calculateConfidenceScore(candles, ema, i, 'SELL', p);

                                    if (score >= p.minConfidenceThreshold) {
                                        const triggerPrice = structureLow - (p.triggerOffsetTicks * p.tickSize);
                                        const stopLoss = sBar.high + (p.stopOffsetTicks * p.tickSize);
                                        const risk = stopLoss - triggerPrice;

                                        if (risk > 0) {
                                            signals.push({
                                                index: i,
                                                type: 'SELL_STOP',
                                                triggerPrice,
                                                stopLoss,
                                                takeProfit: triggerPrice - risk * p.rewardRatio,
                                                timestamp: sBar.timestamp,
                                                reason: `DOUBLE_TRAP_SELL (Conf: ${score}/100)`
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
// SIMULATED PRICE ACTION BACKTESTER (SAFE PARAMS & STOPS)
// ============================================================

function runPriceActionBacktest(candles, signals = [], initialCapital = 100000, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const allowOverlapping = p.allowOverlappingTrades || false;
    
    let startingCapital = parseFloat(initialCapital);
    if (isNaN(startingCapital) || typeof startingCapital !== 'number') {
        startingCapital = 100000;
    }
    
    let equity = startingCapital;
    let activePositions = []; // Tracks multiple concurrent positions if allowOverlapping is true
    let position = null;      // Standard single position
    let pendingOrder = null; 
    const trades = [];
    
    let consecutiveLosses = 0;
    let dailyPnL = 0;
    const maxDailyLoss = equity * p.maxDailyLoss;
    let lastTradeDay = null;

    const signalMap = new Map();
    if (Array.isArray(signals)) {
        signals.forEach(sig => {
            signalMap.set(sig.index, sig);
        });
    }

    for (let i = p.emaPeriod + p.minTrendBars; i < candles.length; i++) {
        const bar = candles[i];

        // 0. Detect Day Boundary to Reset Daily Limits
        if (bar.timestamp) {
            const dateObj = new Date(bar.timestamp);
            const currentDay = dateObj.getUTCDate();
            if (lastTradeDay !== null && currentDay !== lastTradeDay) {
                dailyPnL = 0;
                consecutiveLosses = 0; // Reset consecutive loss counters daily
            }
            lastTradeDay = currentDay;
        }

        // 1. Process active trade exits
        if (allowOverlapping) {
            const remainingPositions = [];
            for (const pos of activePositions) {
                let exitPrice = null;
                let exitReason = null;

                if (pos.direction === 'long') {
                    const stoppedOut = bar.low <= pos.stopLoss;
                    const tpReached = bar.high >= pos.takeProfit;

                    if (stoppedOut && tpReached) {
                        exitPrice = pos.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (stoppedOut) {
                        exitPrice = pos.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (tpReached) {
                        exitPrice = pos.takeProfit;
                        exitReason = 'take_profit';
                    }
                } else {
                    const stoppedOut = bar.high >= pos.stopLoss;
                    const tpReached = bar.low <= pos.takeProfit;

                    if (stoppedOut && tpReached) {
                        exitPrice = pos.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (stoppedOut) {
                        exitPrice = pos.stopLoss;
                        exitReason = 'stop_loss';
                    } else if (tpReached) {
                        exitPrice = pos.takeProfit;
                        exitReason = 'take_profit';
                    }
                }

                if (exitPrice !== null) {
                    const pnlAmount = pos.direction === 'long'
                        ? pos.quantity * (exitPrice - pos.entry)
                        : pos.quantity * (pos.entry - exitPrice);
                    
                    equity += pnlAmount;

                    if (pnlAmount < 0) {
                        consecutiveLosses++;
                        dailyPnL += pnlAmount;
                    } else {
                        consecutiveLosses = 0;
                    }

                    trades.push({
                        entryIndex: pos.entryIndex,
                        exitIndex: i,
                        entryPrice: pos.entry,
                        exitPrice,
                        stopLoss: pos.stopLoss,
                        takeProfit: pos.takeProfit,
                        pnl: pos.direction === 'long' 
                            ? ((exitPrice - pos.entry) / pos.entry) * 100 
                            : ((pos.entry - exitPrice) / pos.entry) * 100,
                        pnlPercentage: pos.direction === 'long' 
                            ? ((exitPrice - pos.entry) / pos.entry) * 100 
                            : ((pos.entry - exitPrice) / pos.entry) * 100,
                        pnlAmount,
                        exitReason,
                        direction: pos.direction,
                        metadata: pos.metadata
                    });
                } else {
                    remainingPositions.push(pos);
                }
            }
            activePositions = remainingPositions;
        } else if (position) {
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
                const pnlAmount = position.direction === 'long'
                    ? position.quantity * (exitPrice - position.entry)
                    : position.quantity * (position.entry - exitPrice);
                
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
                    stopLoss: position.stopLoss,         
                    takeProfit: position.takeProfit,     
                    pnl: position.direction === 'long' 
                        ? ((exitPrice - position.entry) / position.entry) * 100 
                        : ((position.entry - exitPrice) / position.entry) * 100,
                    pnlPercentage: position.direction === 'long' 
                        ? ((exitPrice - position.entry) / position.entry) * 100 
                        : ((position.entry - exitPrice) / position.entry) * 100,
                    pnlAmount,
                    exitReason,
                    direction: position.direction,
                    metadata: position.metadata
                });

                position = null;
            }
        }

        // 2. Check and execute pending Stop Orders on the next bar
        const hasCapacity = allowOverlapping || !position;
        if (hasCapacity && pendingOrder) {
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

                    const newPos = {
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

                    if (allowOverlapping) {
                        activePositions.push(newPos);
                    } else {
                        position = newPos;
                    }

                    // Check if it triggers and exits on the exact same bar
                    let exitPrice = null;
                    let exitReason = null;
                    const checkPos = allowOverlapping ? activePositions[activePositions.length - 1] : position;

                    if (checkPos.direction === 'long') {
                        const stoppedOut = bar.low <= checkPos.stopLoss;
                        const tpReached = bar.high >= checkPos.takeProfit;

                        if (stoppedOut && tpReached) {
                            exitPrice = checkPos.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = checkPos.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = checkPos.takeProfit;
                            exitReason = 'take_profit';
                        }
                    } else {
                        const stoppedOut = bar.high >= checkPos.stopLoss;
                        const tpReached = bar.low <= checkPos.takeProfit;

                        if (stoppedOut && tpReached) {
                            exitPrice = checkPos.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (stoppedOut) {
                            exitPrice = checkPos.stopLoss;
                            exitReason = 'stop_loss';
                        } else if (tpReached) {
                            exitPrice = checkPos.takeProfit;
                            exitReason = 'take_profit';
                        }
                    }

                    if (exitPrice !== null) {
                        const pnlAmount = checkPos.direction === 'long'
                            ? checkPos.quantity * (exitPrice - checkPos.entry)
                            : checkPos.quantity * (checkPos.entry - exitPrice);
                        
                        equity += pnlAmount;

                        if (pnlAmount < 0) {
                            consecutiveLosses++;
                            dailyPnL += pnlAmount;
                        } else {
                            consecutiveLosses = 0;
                        }

                        trades.push({
                            entryIndex: checkPos.entryIndex,
                            exitIndex: i,
                            entryPrice: checkPos.entry,
                            exitPrice,
                            stopLoss: checkPos.stopLoss,     
                            takeProfit: checkPos.takeProfit, 
                            pnl: checkPos.direction === 'long' 
                                ? ((exitPrice - checkPos.entry) / checkPos.entry) * 100 
                                : ((checkPos.entry - exitPrice) / checkPos.entry) * 100,
                            pnlPercentage: checkPos.direction === 'long' 
                                ? ((exitPrice - checkPos.entry) / checkPos.entry) * 100 
                                : ((checkPos.entry - exitPrice) / checkPos.entry) * 100,
                            pnlAmount,
                            exitReason,
                            direction: checkPos.direction,
                            metadata: checkPos.metadata
                        });

                        if (allowOverlapping) {
                            activePositions.pop();
                        } else {
                            position = null;
                        }
                    }
                }
            }

            pendingOrder = null;
        }

        // 3. Scan lookup map for pre-generated signals that ended on this bar
        const canTakeNewTrade = allowOverlapping || (!position && activePositions.length === 0);
        if (canTakeNewTrade && consecutiveLosses < p.maxConsecutiveLosses && dailyPnL > -maxDailyLoss) {
            if (signalMap.has(i)) {
                const signal = signalMap.get(i);
                pendingOrder = {
                    type: signal.type,
                    triggerPrice: signal.triggerPrice,
                    stopLoss: signal.stopLoss,
                    metadata: { setupType: signal.type, signalBarIndex: i, reason: signal.reason }
                };
            }
        }
    }

    // Report Summary
    const totalTrades = trades.length;
    const wins = trades.filter(t => t.pnlAmount > 0).length;
    const losses = trades.filter(t => t.pnlAmount <= 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    console.log(`=== Thomas Wade PA Backtest Summary ===`);
    console.log(`Total Trades: ${totalTrades} | Wins: ${wins} | Losses: ${losses}`);
    console.log(`Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`Final Equity: ${equity.toFixed(2)} (Initial: ${startingCapital.toFixed(2)})`);
    console.log(`=======================================`);

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
    twoLeggedPullback, 
    runPriceActionBacktest 
};