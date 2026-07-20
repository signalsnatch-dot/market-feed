/**
 * brooksChapterStrategy.js - Complete Brooks Price Action Strategy
 * 
 * Implements concepts from "Reading Price Charts Bar by Bar" Chapters 1-4:
 *   Ch 1: Price Action Fundamentals (bars, signal bars, setups, entries)
 *   Ch 2: Trendlines & Trend Channels (micro, minor, major, channel lines)
 *   Ch 3: Trends (trend types, signs of strength, state machine)
 *   Ch 4: Pullbacks (classification hierarchy, bar counting, patterns)
 * 
 * SELF-CONTAINED: No imports from V2, brooksCoreEngine, or brooksPullbackStrategy.
 * Three independent versions: v1-strict, v2-calibrated, v3-percentage.
 * Mandatory AND-gate filter pipeline: all filters must pass for trade to fire.
 */

// ============================================================================
// MODULE 1: STRATEGY CONFIGURATION & VERSION MANAGEMENT
// ============================================================================

function loadBrooksConfig(instrumentConfig) {
    const defaults = {
        enabled: true,
        active_versions: ['v1-strict', 'v2-calibrated', 'v3-percentage', 'v4-pure-brooks'],
    v4_pure_brooks: {
        trigger_offset_ticks: 1,
        stop_offset_ticks: 1,
        target_rr_ratio: 2,
        use_measured_move: true
    },
        '2HM_bar_threshold': 24,
        mid_session_trap: {
            enabled: false,
            nse_time_utc: { start: '05:30', end: '06:30' },
            mcx_time_utc: { start: '14:30', end: '15:30' }
        },
        ema_period: 20,
        double_top_bottom_tolerance_ratio: 0.003,
        require_trendline_break_for_H2L2: true,
        min_swing_bars: 3,
        max_bars_for_bar_pullback: 2,
        trend_from_open_bars: 12,
        spike_and_channel_min_channel_bars: 10,
        shrinking_stairs_min_swings: 3,
        climax_body_ratio: 2.5,
        v1_strict: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1
        },
        v2_calibrated: {
            trigger_offset_ratio: 0.2,
            stop_offset_ratio: 0.2
        },
        v3_percentage: {
            trigger_percent_of_range: 10,
            stop_percent_of_range: 15
        },
        max_hl_count: 4,
        min_trendline_break_bars: 3,
        min_trendline_bars_for_h2l2: 5,
        require_strong_trend_bar_in_break: true,
        min_pullback_bars_for_ema_entry: 3,
        max_gap_bar_count: 2,
        max_swing_recency_bars: 3,
        min_trend_intensity_for_with_trend: 40,
        max_barb_wire_bars_before_suppress: 5,
        use_swing_recency_filter: true,
        use_trend_intensity_filter: true,
        same_pullback_dedup_window_bars: 10,
        use_same_pullback_dedup: true
    };

    // Merge instrument-level overrides
    const cfg = {};
    Object.keys(defaults).forEach(key => {
        if (instrumentConfig && instrumentConfig[key] !== undefined) {
            cfg[key] = instrumentConfig[key];
        } else {
            cfg[key] = defaults[key];
        }
    });

    // Ensure nested objects
    cfg.mid_session_trap = { ...defaults.mid_session_trap, ...(cfg.mid_session_trap || {}) };
    cfg.v1_strict = { ...defaults.v1_strict, ...(cfg.v1_strict || {}) };
    cfg.v2_calibrated = { ...defaults.v2_calibrated, ...(cfg.v2_calibrated || {}) };
    cfg.v3_percentage = { ...defaults.v3_percentage, ...(cfg.v3_percentage || {}) };
    cfg.v4_pure_brooks = { ...defaults.v4_pure_brooks, ...(cfg.v4_pure_brooks || {}) };

    return cfg;
}

// ============================================================================
// MODULE 2: CANDLE & BAR UTILITIES (Chapter 1)
// ============================================================================

const BAR_TYPE = {
    TREND_BULL: 'trend_bull',
    TREND_BEAR: 'trend_bear',
    DOJI: 'doji',
    INSIDE: 'inside',
    OUTSIDE_UP: 'outside_up',
    OUTSIDE_DOWN: 'outside_down',
    REVERSAL_BULL: 'reversal_bull',
    REVERSAL_BEAR: 'reversal_bear',
    SHAVED_BULL: 'shaved_bull',
    SHAVED_BEAR: 'shaved_bear',
    EXHAUSTION: 'exhaustion'
};

function classifyBar(bar, medianBody) {
    const body = Math.abs(bar.close - bar.open);
    const range = bar.high - bar.low;
    if (range === 0) return BAR_TYPE.DOJI;

    const bodyRatio = body / range;
    const isBull = bar.close > bar.open;
    const isBear = bar.close < bar.open;

    // Doji: tiny or no body relative to range
    if (bodyRatio < 0.15 || body === 0) {
        return BAR_TYPE.DOJI;
    }

    // Exhaustion: extremely large body relative to median
    if (medianBody && medianBody > 0 && body > medianBody * 2.5) {
        return BAR_TYPE.EXHAUSTION;
    }

    // Shaved bars
    if (isBull && bar.low === bar.open && bar.high === bar.close) {
        return BAR_TYPE.SHAVED_BULL;
    }
    if (isBear && bar.high === bar.open && bar.low === bar.close) {
        return BAR_TYPE.SHAVED_BEAR;
    }

    // Reversal bars
    if (isBull) {
        const lowerTail = bar.open - bar.low;
        const upperTail = bar.high - bar.close;
        if (lowerTail > range * 0.25 && upperTail < range * 0.15 && bar.close > bar.open) {
            return BAR_TYPE.REVERSAL_BULL;
        }
    }
    if (isBear) {
        const upperTail = bar.high - bar.open;
        const lowerTail = bar.close - bar.low;
        if (upperTail > range * 0.25 && lowerTail < range * 0.15 && bar.close < bar.open) {
            return BAR_TYPE.REVERSAL_BEAR;
        }
    }

    return isBull ? BAR_TYPE.TREND_BULL : BAR_TYPE.TREND_BEAR;
}

function isInsideBar(bar, prevBar) {
    if (!prevBar) return false;
    return bar.high <= prevBar.high && bar.low >= prevBar.low;
}

function isOutsideBar(bar, prevBar) {
    if (!prevBar) return false;
    const outside = bar.high > prevBar.high && bar.low < prevBar.low;
    if (!outside) return null;
    return bar.close > bar.open ? BAR_TYPE.OUTSIDE_UP : BAR_TYPE.OUTSIDE_DOWN;
}

function medianBody(bars, lookback) {
    const bodies = [];
    const start = Math.max(0, bars.length - lookback);
    for (let i = start; i < bars.length; i++) {
        bodies.push(Math.abs(bars[i].close - bars[i].open));
    }
    if (bodies.length === 0) return 0;
    bodies.sort((a, b) => a - b);
    const mid = Math.floor(bodies.length / 2);
    return bodies.length % 2 !== 0 ? bodies[mid] : (bodies[mid - 1] + bodies[mid]) / 2;
}

function classifySignalBar(bar, prevBar, lookbackBars, direction) {
    const medBody = medianBody(lookbackBars, 10);
    const type = classifyBar(bar, medBody);
    const inside = prevBar ? isInsideBar(bar, prevBar) : false;
    const outside = prevBar ? isOutsideBar(bar, prevBar) : null;

    let quality = 0;
    const details = { type, inside, outside };

    // Signal bar quality scoring (for filter gate)
    if (direction === 'long') {
        if (type === BAR_TYPE.REVERSAL_BULL || type === BAR_TYPE.TREND_BULL || type === BAR_TYPE.SHAVED_BULL) {
            quality += 40;
        } else if (type === BAR_TYPE.DOJI && (bar.close > bar.open)) {
            quality += 20; // Doji with bull close at extreme can be acceptable
        } else if (type === BAR_TYPE.DOJI) {
            quality += 5;
        }
    } else if (direction === 'short') {
        if (type === BAR_TYPE.REVERSAL_BEAR || type === BAR_TYPE.TREND_BEAR || type === BAR_TYPE.SHAVED_BEAR) {
            quality += 40;
        } else if (type === BAR_TYPE.DOJI && (bar.close < bar.open)) {
            quality += 20;
        } else if (type === BAR_TYPE.DOJI) {
            quality += 5;
        }
    }

    if (inside) quality += 10;
    if (outside && direction === 'long' && outside === BAR_TYPE.OUTSIDE_UP) quality += 15;
    if (outside && direction === 'short' && outside === BAR_TYPE.OUTSIDE_DOWN) quality += 15;

    return { ...details, quality, direction_match: quality >= 30 };
}

// ============================================================================
// MODULE 3: EMA & SWING COMPUTATION (Chapters 2-4)
// ============================================================================

function computeEMA(bars, period, index) {
    if (index === undefined) index = bars.length - 1;
    if (bars.length < period) return null;

    // Use the close prices
    const closes = bars.map(b => b.close);

    // Initial SMA
    let ema = 0;
    for (let i = 0; i < period; i++) {
        ema += closes[i];
    }
    ema /= period;

    const multiplier = 2 / (period + 1);
    for (let i = period; i <= index; i++) {
        ema = (closes[i] - ema) * multiplier + ema;
    }

    return ema;
}

function computeEMASeries(bars, period) {
    if (bars.length < period) return [];
    const emaValues = [];
    const closes = bars.map(b => b.close);
    let ema = 0;
    for (let i = 0; i < period; i++) ema += closes[i];
    ema /= period;
    emaValues.push(ema);
    const multiplier = 2 / (period + 1);
    for (let i = period; i < bars.length; i++) {
        ema = (closes[i] - ema) * multiplier + ema;
        emaValues.push(ema);
    }
    // Pad initial values with null
    const padded = new Array(period - 1).fill(null).concat(emaValues);
    return padded;
}

function detectSwingHighs(bars, minBarsBetween) {
    const swings = [];
    for (let i = minBarsBetween; i < bars.length - minBarsBetween; i++) {
        let isHigh = true;
        for (let j = i - minBarsBetween; j <= i + minBarsBetween; j++) {
            if (j === i) continue;
            if (bars[j].high >= bars[i].high) {
                isHigh = false;
                break;
            }
        }
        if (isHigh) swings.push({ index: i, price: bars[i].high, type: 'high', bar: bars[i] });
    }
    return swings;
}

function detectSwingLows(bars, minBarsBetween) {
    const swings = [];
    for (let i = minBarsBetween; i < bars.length - minBarsBetween; i++) {
        let isLow = true;
        for (let j = i - minBarsBetween; j <= i + minBarsBetween; j++) {
            if (j === i) continue;
            if (bars[j].low <= bars[i].low) {
                isLow = false;
                break;
            }
        }
        if (isLow) swings.push({ index: i, price: bars[i].low, type: 'low', bar: bars[i] });
    }
    return swings;
}

// ============================================================================
// MODULE 4: TRENDLINE & TREND CHANNEL ENGINE (Chapter 2)
// ============================================================================

function drawTrendline(swings, side) {
    // side: 'high' for bear trendline (connecting highs), 'low' for bull trendline (connecting lows)
    const filtered = swings.filter(s => s.type === side);
    if (filtered.length < 2) return null;

    // Use two most recent qualifying swings
    const p1 = filtered[filtered.length - 2];
    const p2 = filtered[filtered.length - 1];

    const slope = (p2.price - p1.price) / (p2.index - p1.index);
    const intercept = p1.price - slope * p1.index;

    return {
        slope,
        intercept,
        startIndex: p1.index,
        endIndex: p2.index,
        side,
        priceAt: (index) => intercept + slope * index
    };
}

function drawMicroTrendline(bars, startIdx, side, minBars) {
    // side: 'high' for bear micro trendline, 'low' for bull micro trendline
    minBars = minBars || 2;
    const endIdx = bars.length - 1;
    if (endIdx - startIdx < minBars) return null;

    // Find extreme points that touch or are close to the line
    let points = [];
    for (let i = startIdx; i <= endIdx; i++) {
        points.push({ index: i, price: side === 'high' ? bars[i].high : bars[i].low });
    }

    if (points.length < 2) return null;

    // Best fit line through first and last qualifying points
    const p1 = points[0];
    const p2 = points[points.length - 1];
    const slope = (p2.price - p1.price) / (p2.index - p1.index);
    const intercept = p1.price - slope * p1.index;

    // Check that most bars touch or are close
    let touches = 0;
    const tolerance = Math.abs(bars[endIdx].high - bars[endIdx].low) * 0.2;
    for (let i = startIdx; i <= endIdx; i++) {
        const linePrice = intercept + slope * i;
        const barExtreme = side === 'high' ? bars[i].high : bars[i].low;
        if (Math.abs(barExtreme - linePrice) <= tolerance) touches++;
    }

    if (touches < points.length * 0.6) return null; // Require at least 60% touch rate

    return {
        slope,
        intercept,
        startIndex: p1.index,
        endIndex: p2.index,
        side,
        micro: true,
        priceAt: (index) => intercept + slope * index
    };
}

function detectTrendlineBreak(trendline, bar, barIndex) {
    if (!trendline) return { broken: false };

    const linePrice = trendline.priceAt(barIndex);
    let broken = false;
    let direction = null;

    if (trendline.side === 'high') {
        // Bear trendline: break when price goes above it
        broken = bar.close > linePrice || bar.high > linePrice + (bar.high - bar.low) * 0.1;
        direction = 'up';
    } else {
        // Bull trendline: break when price goes below it
        broken = bar.close < linePrice || bar.low < linePrice - (bar.high - bar.low) * 0.1;
        direction = 'down';
    }

    const penetration = trendline.side === 'high'
        ? bar.high - linePrice
        : linePrice - bar.low;

    const momentum = penetration / (bar.high - bar.low || 1);

    return { broken, direction, penetration, momentum };
}

function detectMicroTrendlineFailure(bar, prevBar, microTL, barIndex) {
    if (!microTL) return false;

    const linePrice = microTL.priceAt(barIndex);
    const tolerance = (bar.high - bar.low) * 0.1;

    // False breakout: bar pokes through but reverses
    if (microTL.side === 'high') {
        // Bear micro TL: false breakout = bar goes above but closes below
        return bar.high > linePrice && bar.close < linePrice - tolerance;
    } else {
        // Bull micro TL: false breakout = bar goes below but closes above
        return bar.low < linePrice && bar.close > linePrice + tolerance;
    }
}

function drawTrendChannelLine(trendline, bars) {
    if (!trendline) return null;

    // Find the opposite extreme that creates the channel
    const oppositeSide = trendline.side === 'high' ? 'low' : 'high';
    let maxDistance = 0;
    let anchorIndex = trendline.startIndex;

    for (let i = trendline.startIndex; i <= trendline.endIndex; i++) {
        const linePrice = trendline.priceAt(i);
        const barExtreme = oppositeSide === 'high' ? bars[i].high : bars[i].low;
        const distance = oppositeSide === 'high'
            ? barExtreme - linePrice
            : linePrice - barExtreme;
        if (distance > maxDistance) {
            maxDistance = distance;
            anchorIndex = i;
        }
    }

    const anchorPrice = oppositeSide === 'high' ? bars[anchorIndex].high : bars[anchorIndex].low;
    const intercept = anchorPrice - trendline.slope * anchorIndex;

    return {
        slope: trendline.slope,
        intercept,
        side: oppositeSide,
        startIndex: trendline.startIndex,
        endIndex: trendline.endIndex,
        priceAt: (index) => intercept + trendline.slope * index
    };
}

function detectChannelOvershoot(bar, channelLine, barIndex) {
    if (!channelLine) return false;

    const linePrice = channelLine.priceAt(barIndex);
    const tolerance = (bar.high - bar.low) * 0.05;

    if (channelLine.side === 'high') {
        return bar.high > linePrice + tolerance;
    } else {
        return bar.low < linePrice - tolerance;
    }
}

// ============================================================================
// MODULE 5: LEG & BAR COUNTER (Chapters 3-4)
// ============================================================================

/**
 * High/Low bar counter
 * 
 * In a bull pullback (down/sideways correction):
 *   High 1 = first bar whose high > prior bar's high → ends first leg down
 *   High 2 = second occurrence → ends second leg
 *   High 3, High 4 = subsequent
 * 
 * In a bear pullback (up/sideways correction):
 *   Low 1 = first bar whose low < prior bar's low
 *   Low 2 = second occurrence
 */
function countHighLow(bars, startIdx, direction) {
    // direction: 'bull' = counting High 1,2,3,4 in a pullback from bull
    //            'bear' = counting Low 1,2,3,4 in a pullback from bear
    const results = [];
    let count = 0;
    let lastBreakIndex = -1;

    for (let i = startIdx + 1; i < bars.length; i++) {
        const prevBar = bars[i - 1];
        const currBar = bars[i];

        if (direction === 'bull') {
            // High N: current bar's high > prior bar's high
            if (currBar.high > prevBar.high) {
                count++;
                results.push({ index: i, count, type: `High ${count}`, bar: currBar });
                lastBreakIndex = i;
            }
        } else {
            // Low N: current bar's low < prior bar's low
            if (currBar.low < prevBar.low) {
                count++;
                results.push({ index: i, count, type: `Low ${count}`, bar: currBar });
                lastBreakIndex = i;
            }
        }
    }

    return { results, totalLegs: count, lastBreakIndex };
}

function hasTrendlineBreakBetween(bars, count1Idx, count2Idx, swings) {
    // Check if there's a trendline break between High/Low 1 and High/Low 2
    // This is a critical filter — no H2/L2 entry without prior trendline break

    if (count1Idx < 0 || count2Idx < 0) return false;

    // Look for any swing point in between that would create a trendline
    const midSwings = swings.filter(s => s.index > count1Idx && s.index < count2Idx);
    if (midSwings.length === 0) return false;

    // Check if the market broke a trendline during this segment
    // Simplified: if there's a strong countertrend swing between them
    const segmentBars = bars.slice(count1Idx, count2Idx + 1);
    const highs = segmentBars.map(b => b.high);
    const lows = segmentBars.map(b => b.low);

    // If segment has both higher highs and lower lows, trendline was likely broken
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const range = maxHigh - minLow;

    // Need at least minimal countertrend movement
    return segmentBars.length >= 3 && range > (bars[count1Idx].high - bars[count1Idx].low) * 0.5;
}

function detectTwoLeggedCorrection(bars, startIdx, direction, swings) {
    // direction: 'bull' = correction is down/sideways in bull trend
    //            'bear' = correction is up/sideways in bear trend
    const counter = countHighLow(bars, startIdx, direction);

    // Need at least 2 legs
    if (counter.totalLegs < 2) return { hasTwoLegs: false };

    const leg1 = counter.results[0];
    const leg2 = counter.results[1];

    // Check trendline break requirement between leg1 and leg2
    const trendlineBroken = hasTrendlineBreakBetween(bars, leg1.index, leg2.index, swings);

    return {
        hasTwoLegs: true,
        leg1,
        leg2,
        trendlineBroken,
        totalLegs: counter.totalLegs,
        thirdLeg: counter.results.length >= 3 ? counter.results[2] : null,
        fourthLeg: counter.results.length >= 4 ? counter.results[3] : null
    };
}

function detectThreePush(bars, startIdx, direction) {
    // A three-push (wedge) has three drives in the correction direction
    const counter = countHighLow(bars, startIdx, direction);
    if (counter.totalLegs < 3) return { isThreePush: false };

    const pushes = counter.results.slice(0, 3);

    // Check if third push is weaker (shrinking) — common in wedges
    const range1 = Math.abs(pushes[0].bar.high - pushes[0].bar.low);
    const range3 = Math.abs(pushes[2].bar.high - pushes[2].bar.low);

    const isShrinking = range3 < range1 * 0.8;
    const overshoot = pushes.length >= 3;

    return {
        isThreePush: true,
        pushes,
        isShrinking,
        overshoot
    };
}

/**
 * Count legs using variant rules from Chapter 4:
 * - Large tail can be one leg (Fig 4.22)
 * - Sideways doji bars can count as legs (Fig 4.23)
 * - Lower L2 than L1 still valid if two-legged structure visible (Fig 4.24)
 */
function countLegsVariant(bars, startIdx, direction) {
    // This detects "implied" two-legged structures where formal High/Low
    // counting might miss them but smaller time frame would show them.
    const results = [];
    let legCount = 0;
    let currentLegStart = startIdx;

    for (let i = startIdx + 1; i < bars.length; i++) {
        const bar = bars[i];
        const prevBar = bars[i - 1];
        const range = bar.high - bar.low;
        const body = Math.abs(bar.close - bar.open);
        const barType = classifyBar(bar, medianBody(bars.slice(0, i + 1), 10));

        if (direction === 'bull') {
            // Looking for down legs in bull correction
            // A leg ends when: bear trend bar, large tail on top, or sideways doji cluster
            const isBearBar = barType === BAR_TYPE.TREND_BEAR || barType === BAR_TYPE.REVERSAL_BEAR;
            const hasLargeUpperTail = (bar.high - Math.max(bar.open, bar.close)) > range * 0.4;

            if (isBearBar || hasLargeUpperTail) {
                if (i - currentLegStart >= 1) {
                    legCount++;
                    results.push({ index: i, count: legCount, bar, reason: isBearBar ? 'trend_bar' : 'large_tail' });
                    currentLegStart = i;
                }
            }
        } else {
            // Looking for up legs in bear correction
            const isBullBar = barType === BAR_TYPE.TREND_BULL || barType === BAR_TYPE.REVERSAL_BULL;
            const hasLargeLowerTail = (Math.min(bar.open, bar.close) - bar.low) > range * 0.4;

            if (isBullBar || hasLargeLowerTail) {
                if (i - currentLegStart >= 1) {
                    legCount++;
                    results.push({ index: i, count: legCount, bar, reason: isBullBar ? 'trend_bar' : 'large_tail' });
                    currentLegStart = i;
                }
            }
        }
    }

    return { results, totalLegs: legCount, hasTwoLegs: legCount >= 2 };
}

// ============================================================================
// MODULE 6: TREND STATE MACHINE (Chapters 3-4)
// ============================================================================

const TREND_STATE = {
    UNDEFINED: 'undefined',
    BULL_TREND_STRONG: 'bull_trend_strong',
    BULL_TREND_WEAKENING: 'bull_trend_weakening',
    BEAR_TREND_STRONG: 'bear_trend_strong',
    BEAR_TREND_WEAKENING: 'bear_trend_weakening',
    TRADING_RANGE: 'trading_range',
    TRENDING_TRADING_RANGE_BULL: 'trending_trading_range_bull',
    TRENDING_TRADING_RANGE_BEAR: 'trending_trading_range_bear',
    SPIKE_AND_CHANNEL_BULL: 'spike_and_channel_bull',
    SPIKE_AND_CHANNEL_BEAR: 'spike_and_channel_bear',
    TREND_FROM_OPEN_BULL: 'trend_from_open_bull',
    TREND_FROM_OPEN_BEAR: 'trend_from_open_bear',
    TREND_RESUMPTION_BULL: 'trend_resumption_bull',
    TREND_RESUMPTION_BEAR: 'trend_resumption_bear',
    BULL_PULLBACK: 'bull_pullback',
    BEAR_PULLBACK: 'bear_pullback',
    REVERSAL_TRANSITION: 'reversal_transition'
};

function assessTrendState(bars, emaSeries, cfg, prevState) {
    if (bars.length < cfg.ema_period + cfg.min_swing_bars * 2) {
        return { state: TREND_STATE.UNDEFINED, details: {} };
    }

    const latestIdx = bars.length - 1;
    const ema = emaSeries[latestIdx];
    if (ema === null) return { state: TREND_STATE.UNDEFINED, details: {} };

    // Compute EMA slope over last 10 bars
    const emaSlopeStart = emaSeries[Math.max(0, latestIdx - 10)];
    const emaSlope = emaSlopeStart !== null ? (ema - emaSlopeStart) / 10 : 0;

    // Bar position relative to EMA
    const latestBar = bars[latestIdx];
    const barsAboveEMA = bars.slice(-10).filter(b => {
        const idx = bars.indexOf(b);
        return emaSeries[idx] !== null && b.low > emaSeries[idx];
    }).length;
    const barsBelowEMA = bars.slice(-10).filter(b => {
        const idx = bars.indexOf(b);
        return emaSeries[idx] !== null && b.high < emaSeries[idx];
    }).length;

    // Swing analysis
    const swings = detectSwingHighs(bars, cfg.min_swing_bars).concat(
        detectSwingLows(bars, cfg.min_swing_bars)
    );
    swings.sort((a, b) => a.index - b.index);

    const recentSwingHighs = swings.filter(s => s.type === 'high').slice(-4);
    const recentSwingLows = swings.filter(s => s.type === 'low').slice(-4);

    // Higher highs / higher lows check
    let higherHighs = true;
    let higherLows = true;
    let lowerHighs = true;
    let lowerLows = true;

    for (let i = 1; i < recentSwingHighs.length; i++) {
        if (recentSwingHighs[i].price <= recentSwingHighs[i - 1].price) higherHighs = false;
        if (recentSwingHighs[i].price >= recentSwingHighs[i - 1].price) lowerHighs = false;
    }

    for (let i = 1; i < recentSwingLows.length; i++) {
        if (recentSwingLows[i].price <= recentSwingLows[i - 1].price) higherLows = false;
        if (recentSwingLows[i].price >= recentSwingLows[i - 1].price) lowerLows = false;
    }

    // Trendline analysis
    const bullTL = drawTrendline(swings, 'low');
    const bearTL = drawTrendline(swings, 'high');

    // Determine state — extract state string from prevState object if needed
    let state = (prevState && typeof prevState === 'object' && prevState.state) 
        || (typeof prevState === 'string' ? prevState : null) 
        || TREND_STATE.UNDEFINED;
    const details = { ema, emaSlope, barsAboveEMA, barsBelowEMA, higherHighs, higherLows, lowerHighs, lowerLows };

    // Strong bull criteria (Ch 3 signs of strength)
    if (emaSlope > 0.01 && barsAboveEMA >= 8 && higherHighs && higherLows && latestBar.close > ema) {
        state = TREND_STATE.BULL_TREND_STRONG;
    }
    // Strong bear criteria
    else if (emaSlope < -0.01 && barsBelowEMA >= 8 && lowerHighs && lowerLows && latestBar.close < ema) {
        state = TREND_STATE.BEAR_TREND_STRONG;
    }
    // Weakening bull
    else if (emaSlope > 0 && barsAboveEMA >= 5 && !higherHighs && higherLows) {
        state = TREND_STATE.BULL_TREND_WEAKENING;
    }
    // Weakening bear
    else if (emaSlope < 0 && barsBelowEMA >= 5 && !lowerLows && lowerHighs) {
        state = TREND_STATE.BEAR_TREND_WEAKENING;
    }
    // Trading range
    else if (Math.abs(emaSlope) < 0.005 && barsAboveEMA >= 3 && barsBelowEMA >= 3) {
        state = TREND_STATE.TRADING_RANGE;
    }
    // Reversal transition (major trendline broken + testing extreme)
    // Use state (already resolved to a string from prevState.state) for comparison
    else if (state === TREND_STATE.BULL_TREND_STRONG && bearTL && detectTrendlineBreak(bullTL, latestBar, latestIdx).broken) {
        state = TREND_STATE.REVERSAL_TRANSITION;
    } else if (state === TREND_STATE.BEAR_TREND_STRONG && bullTL && detectTrendlineBreak(bearTL, latestBar, latestIdx).broken) {
        state = TREND_STATE.REVERSAL_TRANSITION;
    }

    // Detect Trend from Open (Ch 3)
    if (bars.length >= cfg.trend_from_open_bars) {
        const firstBarIdx = 0;
        const openPrice = bars[0].open;
        const currentPrice = latestBar.close;
        const moveRatio = Math.abs(currentPrice - openPrice) / openPrice;
        const firstFew = bars.slice(0, Math.min(cfg.trend_from_open_bars, bars.length));

        if (currentPrice > openPrice * 1.002 && moveRatio > 0.005 &&
            firstFew.filter(b => b.close > b.open).length >= firstFew.length * 0.6) {
            state = TREND_STATE.TREND_FROM_OPEN_BULL;
        } else if (currentPrice < openPrice * 0.998 && moveRatio > 0.005 &&
            firstFew.filter(b => b.close < b.open).length >= firstFew.length * 0.6) {
            state = TREND_STATE.TREND_FROM_OPEN_BEAR;
        }
    }

    // Trading range determination
    if (Math.abs(emaSlope) < 0.003) {
        const recentRange = bars.slice(-20);
        const maxHigh = Math.max(...recentRange.map(b => b.high));
        const minLow = Math.min(...recentRange.map(b => b.low));
        const rangeSpan = maxHigh - minLow;

        if (rangeSpan > 0 && (maxHigh - minLow) / minLow < 0.02) {
            if (state === TREND_STATE.UNDEFINED || state === TREND_STATE.TRADING_RANGE) {
                state = TREND_STATE.TRADING_RANGE;
            }
        }
    }

    return { state, details, swings, bullTL, bearTL };
}

// ============================================================================
// MODULE 7: PATTERN DETECTORS (Chapters 1-4)
// Each returns { detected, confidence, entry, stop, target, metadata }
// ============================================================================

// ---- Chapter 4: Pullback Hierarchy Detection ----

function detectBarPullback(bars, emaSeries, state, cfg) {
    // 1-2 bar pullback (High/Low 1 on Micro Trendline)
    if (bars.length < 3) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const prevBar = bars[latestIdx - 1];
    const ema = emaSeries[latestIdx];

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');

    if (!isBullTrend && !isBearTrend) return { detected: false };

    // Draw micro trendline from last 3-6 bars
    const microStart = Math.max(0, latestIdx - 6);
    const microTL = drawMicroTrendline(
        bars, microStart,
        isBullTrend ? 'low' : 'high',
        3
    );

    if (!microTL) return { detected: false };

    // Detect false breakout of micro trendline
    const falseBreakout = detectMicroTrendlineFailure(bar, prevBar, microTL, latestIdx);

    if (!falseBreakout) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';
    const signalBar = bar;
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: isBullTrend ? 'High 1 (Micro TL)' : 'Low 1 (Micro TL)',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 85,
        signalBar,
        pullbackType: 'bar_pullback',
        metadata: { microTL }
    };
}

function detectMinorTrendlinePullback(bars, emaSeries, state, cfg) {
    // 3-5 bar pullback breaking minor trendline — High/Low 2 setup
    if (bars.length < 5) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const prevBar = bars[latestIdx - 1];
    const ema = emaSeries[latestIdx];

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';

    // Look for a recent swing point to start the pullback
    const swings = state.swings || [];
    const extremeSwings = swings.filter(s =>
        (isBullTrend && s.type === 'high') || (isBearTrend && s.type === 'low')
    ).slice(-3);

    if (extremeSwings.length === 0) return { detected: false };

    const pullbackStart = extremeSwings[extremeSwings.length - 1].index;
    const legAnalysis = detectTwoLeggedCorrection(bars, pullbackStart, direction === 'long' ? 'bull' : 'bear', swings);

    if (!legAnalysis.hasTwoLegs) return { detected: false };

    // Critical: H2/L2 requires trendline break between legs (Ch 4)
    if (cfg.require_trendline_break_for_H2L2 && !legAnalysis.trendlineBroken) {
        return { detected: false };
    }

    const leg2 = legAnalysis.leg2;
    const signalBar = leg2.bar;
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    // M2B/M2S if near EMA
    let setupType = isBullTrend ? 'High 2' : 'Low 2';
    if (ema !== null && Math.abs(signalBar.close - ema) / ema < 0.002) {
        setupType = isBullTrend ? 'M2B' : 'M2S';
    }

    return {
        detected: true,
        setupType,
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: setupType.startsWith('M') ? 90 : 80,
        signalBar,
        pullbackType: 'minor_trendline',
        metadata: { legAnalysis }
    };
}

function detectEMAPullback(bars, emaSeries, state, cfg) {
    // Pullback reaches EMA — M2B/M2S (if second entry at EMA)
    if (bars.length < cfg.ema_period + 5) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const ema = emaSeries[latestIdx];
    if (ema === null) return { detected: false };

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';

    // Check if bar touches or is near EMA
    const emaTouch = Math.abs(bar.low - ema) / ema < 0.002 ||
        Math.abs(bar.high - ema) / ema < 0.002 ||
        Math.abs(bar.close - ema) / ema < 0.002;

    if (!emaTouch) return { detected: false };

    // Look for 2-legged correction to EMA
    const swings = state.swings || [];
    const extremeSwings = swings.filter(s =>
        (isBullTrend && s.type === 'high') || (isBearTrend && s.type === 'low')
    ).slice(-5);

    if (extremeSwings.length === 0) return { detected: false };

    const pullbackStart = extremeSwings[extremeSwings.length - 1].index;
    const legAnalysis = detectTwoLeggedCorrection(bars, pullbackStart, direction === 'long' ? 'bull' : 'bear', swings);

    if (!legAnalysis.hasTwoLegs) return { detected: false };

    const leg2 = legAnalysis.leg2;
    const signalBar = leg2.bar;

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: direction === 'long' ? 'M2B (EMA Pullback)' : 'M2S (EMA Pullback)',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 90,
        signalBar,
        pullbackType: 'ema',
        metadata: { legAnalysis, emaTouch }
    };
}

function detectEMAGapBar(bars, emaSeries, state, cfg) {
    // EMA Gap Bar: bar breaks through EMA creating a gap
    // First EMA Gap Bar in trend = fade it (With Trend entry)
    if (bars.length < cfg.ema_period + 2) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const ema = emaSeries[latestIdx];
    if (ema === null) return { detected: false };

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    // EMA Gap: in bull, bar's high < EMA (gap below); in bear, bar's low > EMA (gap above)
    let isGapBar = false;
    if (isBullTrend) {
        isGapBar = bar.high < ema && bar.close < ema;
    } else {
        isGapBar = bar.low > ema && bar.close > ema;
    }

    if (!isGapBar) return { detected: false };

    // Check if this is the second EMA Gap Bar (second attempt — stronger)
    let isSecondGap = false;
    for (let i = latestIdx - 1; i >= Math.max(0, latestIdx - 20); i--) {
        const prevEma = emaSeries[i];
        if (prevEma === null) continue;
        const prevBar = bars[i];
        if (isBullTrend && prevBar.high < prevEma) {
            isSecondGap = true;
            break;
        }
        if (isBearTrend && prevBar.low > prevEma) {
            isSecondGap = true;
            break;
        }
    }

    const direction = isBullTrend ? 'long' : 'short';
    const signalBar = bar;

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: isSecondGap
            ? (isBullTrend ? 'EMA Gap 2 Bar (Long)' : 'EMA Gap 2 Bar (Short)')
            : (isBullTrend ? 'EMA Gap Bar (Long)' : 'EMA Gap Bar (Short)'),
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: isSecondGap ? 90 : 80,
        signalBar,
        pullbackType: 'ema_gap',
        metadata: { isSecondGap }
    };
}

function detectMajorTrendlinePullback(bars, emaSeries, state, cfg) {
    // Major trendline break — pullback that breaks the primary trendline
    // Often the EMA Gap Bar is also the major trendline break
    if (bars.length < 10) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';

    // Check major trendline break
    const majorTL = isBearTrend ? state.bearTL : state.bullTL;
    if (!majorTL) return { detected: false };

    const breakResult = detectTrendlineBreak(majorTL, bar, latestIdx);
    if (!breakResult.broken || breakResult.momentum < 0.3) return { detected: false };

    // After major trendline break, expect two-legged correction before
    // With Trend resumption. We're looking for the With Trend entry after
    // the correction completes with a test of the extreme.

    // This triggers a state update but the actual entry comes from
    // the pullback detectors (EMA Gap, Double Bottom/Top, etc.)
    return {
        detected: true,
        setupType: isBearTrend ? 'Major Trendline Break (Bear TL)' : 'Major Trendline Break (Bull TL)',
        direction, // With Trend direction after correction
        entryPrice: null, // Wait for specific entry setup
        stopLoss: null,
        takeProfit: null,
        confidence: 70, // Informational only — wait for entry setup
        signalBar: bar,
        pullbackType: 'major_trendline',
        metadata: { majorTL, breakResult },
        informational: true // Not a direct entry signal
    };
}

// ---- Chapter 4: Double Top/Bottom Flags ----

function detectDoubleBottomBullFlag(bars, emaSeries, state, cfg) {
    // Two near-equal lows in a bull pullback
    if (bars.length < 8) return { detected: false };

    const trendState = state.state;
    if (!trendState.includes('bull') && trendState !== TREND_STATE.TRADING_RANGE) {
        return { detected: false };
    }

    const swings = state.swings || [];
    const recentLows = swings.filter(s => s.type === 'low').slice(-4);

    if (recentLows.length < 2) return { detected: false };

    const low1 = recentLows[recentLows.length - 2];
    const low2 = recentLows[recentLows.length - 1];

    const toleranceRatio = cfg.double_top_bottom_tolerance_ratio;
    const tolerance = low1.price * toleranceRatio;
    const priceDiff = Math.abs(low2.price - low1.price);

    if (priceDiff > tolerance) return { detected: false };

    // Second low must be after a rally attempt (bull flag)
    if (low2.index - low1.index < 3) return { detected: false };

    const signalBar = low2.bar;
    const entryPrice = signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: 'Double Bottom Bull Flag',
        direction: 'long',
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 85,
        signalBar,
        metadata: { low1, low2, tolerance, priceDiff }
    };
}

function detectDoubleTopBearFlag(bars, emaSeries, state, cfg) {
    // Two near-equal highs in a bear pullback
    if (bars.length < 8) return { detected: false };

    const trendState = state.state;
    if (!trendState.includes('bear') && trendState !== TREND_STATE.TRADING_RANGE) {
        return { detected: false };
    }

    const swings = state.swings || [];
    const recentHighs = swings.filter(s => s.type === 'high').slice(-4);

    if (recentHighs.length < 2) return { detected: false };

    const high1 = recentHighs[recentHighs.length - 2];
    const high2 = recentHighs[recentHighs.length - 1];

    const toleranceRatio = cfg.double_top_bottom_tolerance_ratio;
    const tolerance = high1.price * toleranceRatio;
    const priceDiff = Math.abs(high2.price - high1.price);

    if (priceDiff > tolerance) return { detected: false };

    if (high2.index - high1.index < 3) return { detected: false };

    const signalBar = high2.bar;
    const entryPrice = signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: 'Double Top Bear Flag',
        direction: 'short',
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 85,
        signalBar,
        metadata: { high1, high2, tolerance, priceDiff }
    };
}

// ---- Chapter 4: 2HM (Two Hour Magic) ----

function detect2HM(bars, emaSeries, state, cfg) {
    // Market away from EMA for >= threshold bars (2HM converted to bars)
    const threshold = cfg['2HM_bar_threshold'] || 24;
    if (bars.length < threshold + cfg.ema_period) return { detected: false };

    const latestIdx = bars.length - 1;
    const ema = emaSeries[latestIdx];
    if (ema === null) return { detected: false };

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    // Check how many bars since last EMA touch
    let barsAwayFromEMA = 0;
    for (let i = latestIdx; i >= 0; i--) {
        const emaVal = emaSeries[i];
        if (emaVal === null) break;
        const bar = bars[i];
        const touched = isBullTrend
            ? (bar.low <= emaVal)
            : (bar.high >= emaVal);
        if (touched) break;
        barsAwayFromEMA++;
    }

    if (barsAwayFromEMA < threshold) return { detected: false };

    // 2HM setup: fade the first EMA touch
    const bar = bars[latestIdx];
    const touchedEMA = isBullTrend
        ? (bar.low <= ema || Math.abs(bar.low - ema) / ema < 0.002)
        : (bar.high >= ema || Math.abs(bar.high - ema) / ema < 0.002);

    if (!touchedEMA) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';
    const signalBar = bar;

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: isBullTrend ? '2HM Long (EMA Fade)' : '2HM Short (EMA Fade)',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 90,
        signalBar,
        pullbackType: '2hm',
        metadata: { barsAwayFromEMA, threshold }
    };
}

// ---- Chapter 4: Stop Run Trap (Mid-Session) ----

function detectMidSessionTrap(bars, emaSeries, state, cfg, instrumentConfig) {
    const trapCfg = cfg.mid_session_trap;
    if (!trapCfg || !trapCfg.enabled) return { detected: false };

    if (bars.length < 5) return { detected: false };

    // Determine which time window applies
    const instrument = instrumentConfig ? instrumentConfig.instrument_key || '' : '';
    const isMCX = instrument.includes('MCX');
    const isNSE = instrument.includes('NSE') || instrument.includes('NFO') ||
        (!instrument.includes('MCX') && !instrument.includes('BSE'));

    let timeWindow = null;
    if (isMCX) timeWindow = trapCfg.mcx_time_utc;
    else if (isNSE) timeWindow = trapCfg.nse_time_utc;
    else return { detected: false };

    if (!timeWindow) return { detected: false };

    // Parse UTC time from bar timestamp
    const latestBar = bars[bars.length - 1];
    const barTime = latestBar.timestamp || latestBar.time;
    if (!barTime) return { detected: false };

    // Check if bar time falls within trap window
    const barDate = new Date(barTime);
    const barHourMin = barDate.getUTCHours() * 60 + barDate.getUTCMinutes();

    const [startH, startM] = timeWindow.start.split(':').map(Number);
    const [endH, endM] = timeWindow.end.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    if (barHourMin < startMin || barHourMin > endMin) return { detected: false };

    // Look for strong countertrend spike (trap)
    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    // Recent bars analysis
    const recentBars = bars.slice(-5);
    const bar = latestBar;

    // In bull trend: trap = strong bear bar that will fail → buy opportunity
    // In bear trend: trap = strong bull bar that will fail → short opportunity
    const barType = classifyBar(bar, medianBody(bars, 10));

    if (isBullTrend) {
        const isBearSpike = barType === BAR_TYPE.TREND_BEAR || barType === BAR_TYPE.EXHAUSTION;
        if (!isBearSpike) return { detected: false };

        return {
            detected: true,
            setupType: '11:30 Trap (Bull Trend Stop Run)',
            direction: 'long',
            entryPrice: bar.high + cfg.v1_strict.trigger_offset_ticks * 0.05,
            stopLoss: bar.low - cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 88,
            signalBar: bar,
            metadata: { trapCfg }
        };
    } else if (isBearTrend) {
        const isBullSpike = barType === BAR_TYPE.TREND_BULL || barType === BAR_TYPE.EXHAUSTION;
        if (!isBullSpike) return { detected: false };

        return {
            detected: true,
            setupType: '11:30 Trap (Bear Trend Stop Run)',
            direction: 'short',
            entryPrice: bar.low - cfg.v1_strict.trigger_offset_ticks * 0.05,
            stopLoss: bar.high + cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 88,
            signalBar: bar,
            metadata: { trapCfg }
        };
    }

    return { detected: false };
}

// ---- Chapter 4: Three Push / Wedge Pullback ----

function detectThreePushPullback(bars, emaSeries, state, cfg) {
    if (bars.length < 8) return { detected: false };

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';

    const swings = state.swings || [];
    const extremeSwings = swings.filter(s =>
        (isBullTrend && s.type === 'high') || (isBearTrend && s.type === 'low')
    ).slice(-5);

    if (extremeSwings.length === 0) return { detected: false };

    const pullbackStart = extremeSwings[extremeSwings.length - 1].index;

    // Use bar counting direction opposite to trend
    const threePush = detectThreePush(bars, pullbackStart, direction === 'long' ? 'bull' : 'bear');

    if (!threePush.isThreePush) return { detected: false };

    const leg3 = threePush.pushes[2];
    const signalBar = leg3.bar;

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: isBullTrend ? 'High 3 (Three Push/Wedge)' : 'Low 3 (Three Push/Wedge)',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: threePush.isShrinking ? 88 : 78,
        signalBar,
        pullbackType: 'wedge_three_push',
        metadata: { threePush }
    };
}

// ---- Chapter 1: Failed Reversal = Opposite Setup ----

function detectFailedReversal(bars, emaSeries, state, cfg) {
    if (bars.length < 4) return { detected: false };

    const latestIdx = bars.length - 1;
    const prevBar = bars[latestIdx - 1];
    const bar = bars[latestIdx];
    const barBeforePrev = bars[latestIdx - 2];

    const trendState = state.state;
    const isStrongBull = trendState === TREND_STATE.BULL_TREND_STRONG;
    const isStrongBear = trendState === TREND_STATE.BEAR_TREND_STRONG;
    if (!isStrongBull && !isStrongBear) return { detected: false };

    // Failed reversal: a reversal bar forms but doesn't trigger
    // In strong bull: bear reversal bar that fails → long above it
    // In strong bear: bull reversal bar that fails → short below it
    const prevType = classifyBar(prevBar, medianBody(bars.slice(0, latestIdx), 10));

    if (isStrongBull && (prevType === BAR_TYPE.REVERSAL_BEAR || prevType === BAR_TYPE.DOJI) && bar.close > prevBar.close) {
        const entryPrice = prevBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05;
        return {
            detected: true,
            setupType: 'Failed Bear Reversal → Long',
            direction: 'long',
            entryPrice,
            stopLoss: prevBar.low - cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 82,
            signalBar: prevBar,
            metadata: { prevType, reason: 'failed_reversal_bear_in_bull' }
        };
    }

    if (isStrongBear && (prevType === BAR_TYPE.REVERSAL_BULL || prevType === BAR_TYPE.DOJI) && bar.close < prevBar.close) {
        const entryPrice = prevBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
        return {
            detected: true,
            setupType: 'Failed Bull Reversal → Short',
            direction: 'short',
            entryPrice,
            stopLoss: prevBar.high + cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 82,
            signalBar: prevBar,
            metadata: { prevType, reason: 'failed_reversal_bull_in_bear' }
        };
    }

    return { detected: false };
}

// ---- Chapter 1: Outside Bar Trap (Second Entry) ----

function detectOutsideBarTrap(bars, emaSeries, state, cfg) {
    if (bars.length < 4) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const prevBar = bars[latestIdx - 1];
    const bar2Back = bars[latestIdx - 2];

    const trendState = state.state;
    const isStrongBull = trendState === TREND_STATE.BULL_TREND_STRONG;
    const isStrongBear = trendState === TREND_STATE.BEAR_TREND_STRONG;
    if (!isStrongBull && !isStrongBear) return { detected: false };

    // Outside bar that traps countertrend traders
    // In bull: attempted Low 1/Low 2 short that reverses to outside up bar
    // In bear: attempted High 1/High 2 long that reverses to outside down bar

    const outsideType = isOutsideBar(bar, prevBar);

    if (isStrongBull && outsideType === BAR_TYPE.OUTSIDE_UP && prevBar.close < prevBar.open) {
        // Trapped shorts — bull outside up bar
        const entryPrice = bar.high + cfg.v1_strict.trigger_offset_ticks * 0.05;
        return {
            detected: true,
            setupType: 'Outside Bar Bull Trap → Long',
            direction: 'long',
            entryPrice,
            stopLoss: bar.low - cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 85,
            signalBar: bar,
            metadata: { outsideType, reason: 'trapped_shorts_bull_outside' }
        };
    }

    if (isStrongBear && outsideType === BAR_TYPE.OUTSIDE_DOWN && prevBar.close > prevBar.open) {
        // Trapped longs — bear outside down bar
        const entryPrice = bar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
        return {
            detected: true,
            setupType: 'Outside Bar Bear Trap → Short',
            direction: 'short',
            entryPrice,
            stopLoss: bar.high + cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 85,
            signalBar: bar,
            metadata: { outsideType, reason: 'trapped_longs_bear_outside' }
        };
    }

    return { detected: false };
}

// ---- Chapter 4: Failed Final Flag ----

function detectFailedFinalFlag(bars, emaSeries, state, cfg) {
    if (bars.length < 10) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const trendState = state.state;

    // Failed Final Flag = extended sideways chop then breakout in trend direction
    // that fails → reversal
    const recent10 = bars.slice(-10);
    const highs = recent10.map(b => b.high);
    const lows = recent10.map(b => b.low);
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const rangeSpan = maxHigh - minLow;

    // Check for sideways chop (tight range)
    const sidewaysBars = recent10.filter(b => {
        const body = Math.abs(b.close - b.open);
        return body < (b.high - b.low) * 0.3;
    });

    if (sidewaysBars.length < 5) return { detected: false };

    // Check for failed breakout of the range
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');

    if (isBullTrend && bar.low < minLow && bar.close > bar.open) {
        // Failed downside breakout of flag in bull → reversal long
        return {
            detected: true,
            setupType: 'Failed Final Flag (Bull)',
            direction: 'long',
            entryPrice: bar.high + cfg.v1_strict.trigger_offset_ticks * 0.05,
            stopLoss: bar.low - cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 80,
            signalBar: bar,
            metadata: { rangeSpan, sidewaysBars: sidewaysBars.length }
        };
    }

    if (isBearTrend && bar.high > maxHigh && bar.close < bar.open) {
        // Failed upside breakout of flag in bear → reversal short
        return {
            detected: true,
            setupType: 'Failed Final Flag (Bear)',
            direction: 'short',
            entryPrice: bar.low - cfg.v1_strict.trigger_offset_ticks * 0.05,
            stopLoss: bar.high + cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 80,
            signalBar: bar,
            metadata: { rangeSpan, sidewaysBars: sidewaysBars.length }
        };
    }

    return { detected: false };
}

// ---- Chapter 3: Spike and Channel Breakout ----

function detectSpikeAndChannelReversal(bars, emaSeries, state, cfg) {
    const trendState = state.state;
    if (trendState !== TREND_STATE.SPIKE_AND_CHANNEL_BULL &&
        trendState !== TREND_STATE.SPIKE_AND_CHANNEL_BEAR) {
        return { detected: false };
    }

    if (bars.length < cfg.spike_and_channel_min_channel_bars + 5) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];

    // Detect breakout of the channel (trend channel line overshoot)
    const swings = state.swings || [];
    const channelSwing = swings.filter(s => s.type === (trendState === TREND_STATE.SPIKE_AND_CHANNEL_BULL ? 'high' : 'low')).slice(-3);

    if (channelSwing.length < 2) return { detected: false };

    const tcLine = drawTrendChannelLine(
        trendState === TREND_STATE.SPIKE_AND_CHANNEL_BULL ? state.bullTL : state.bearTL,
        bars
    );

    if (!tcLine) return { detected: false };

    const overshoot = detectChannelOvershoot(bar, tcLine, latestIdx);
    if (!overshoot) return { detected: false };

    // Channel overshoot reversal — Countertrend entry
    const direction = trendState === TREND_STATE.SPIKE_AND_CHANNEL_BULL ? 'short' : 'long';
    const signalBar = bar;

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: trendState === TREND_STATE.SPIKE_AND_CHANNEL_BULL
            ? 'Channel Overshoot → Short'
            : 'Channel Overshoot → Long',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 75,
        signalBar,
        metadata: { tcLine, overshoot }
    };
}

// ---- Chapter 3: Trend Resumption Detection ----

function detectTrendResumption(bars, emaSeries, state, cfg, prevState) {
    if (bars.length < 15) return { detected: false };

    const trendState = state.state;
    const isBullResumption = trendState === TREND_STATE.TREND_RESUMPTION_BULL;
    const isBearResumption = trendState === TREND_STATE.TREND_RESUMPTION_BEAR;
    if (!isBullResumption && !isBearResumption) return { detected: false };

    // In trend resumption: market goes sideways for hours, then breaks out
    // in original trend direction. Look for pullback entry after breakout.
    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const ema = emaSeries[latestIdx];
    const direction = isBullResumption ? 'long' : 'short';

    // Look for High/Low 2 near EMA
    const swings = state.swings || [];
    const legAnalysisData = detectTwoLeggedCorrection(
        bars,
        Math.max(0, latestIdx - 20),
        direction === 'long' ? 'bull' : 'bear',
        swings
    );

    if (!legAnalysisData.hasTwoLegs) return { detected: false };

    const leg2 = legAnalysisData.leg2;
    const signalBar = leg2.bar;

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: isBullResumption ? 'Trend Resumption Long' : 'Trend Resumption Short',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 82,
        signalBar,
        metadata: { legAnalysis: legAnalysisData }
    };
}

// ============================================================================
// MODULE 9: VERSIONED ENTRY/EXIT CALCULATORS
// ============================================================================

function computeVersionedEntry(signal, cfg, version) {
    if (!signal || !signal.detected || !signal.signalBar) return null;

    const bar = signal.signalBar;
    const direction = signal.direction;

    let entryPrice, stopPrice;

    let targetRR = 2; // default RR ratio

    switch (version) {
        case 'v4-pure-brooks':
            entryPrice = direction === 'long'
                ? bar.high + cfg.v4_pure_brooks.trigger_offset_ticks * 0.05
                : bar.low - cfg.v4_pure_brooks.trigger_offset_ticks * 0.05;
            stopPrice = direction === 'long'
                ? bar.low - cfg.v4_pure_brooks.stop_offset_ticks * 0.05
                : bar.high + cfg.v4_pure_brooks.stop_offset_ticks * 0.05;
            targetRR = cfg.v4_pure_brooks.target_rr_ratio || 2;
            break;

        case 'v1-strict':
            entryPrice = direction === 'long'
                ? bar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
                : bar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
            stopPrice = direction === 'long'
                ? bar.low - cfg.v1_strict.stop_offset_ticks * 0.05
                : bar.high + cfg.v1_strict.stop_offset_ticks * 0.05;
            break;

        case 'v2-calibrated':
            const range = bar.high - bar.low;
            entryPrice = direction === 'long'
                ? bar.high + range * cfg.v2_calibrated.trigger_offset_ratio
                : bar.low - range * cfg.v2_calibrated.trigger_offset_ratio;
            stopPrice = direction === 'long'
                ? bar.low - range * cfg.v2_calibrated.stop_offset_ratio
                : bar.high + range * cfg.v2_calibrated.stop_offset_ratio;
            break;

        case 'v3-percentage':
            const rangePct = bar.high - bar.low;
            entryPrice = direction === 'long'
                ? bar.high + rangePct * (cfg.v3_percentage.trigger_percent_of_range / 100)
                : bar.low - rangePct * (cfg.v3_percentage.trigger_percent_of_range / 100);
            stopPrice = direction === 'long'
                ? bar.low - rangePct * (cfg.v3_percentage.stop_percent_of_range / 100)
                : bar.high + rangePct * (cfg.v3_percentage.stop_percent_of_range / 100);
            break;

        default:
            return null;
    }

    // Take profit: 2x risk for now (configurable later)
    const risk = Math.abs(entryPrice - stopPrice);
    const takeProfit = direction === 'long'
        ? entryPrice + risk * targetRR
        : entryPrice - risk * targetRR;

    return {
        version,
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit,
        risk,
        reward: risk * targetRR
    };
}

// ============================================================================
// MODULE 10: MAIN STRATEGY ENGINE (BROOKS PURE)
// ============================================================================

class BrooksChapterStrategy {
    constructor() {
        this.name = 'brooks_chapter';
        this.description = 'Brooks Chapters 1-4 Complete Price Action Strategy';
        this.activeVersions = ['v1-strict', 'v2-calibrated', 'v3-percentage', 'v4-pure-brooks'];
        // Per-instrument state (keyed by instrument_key)
        this.states = {};
        // Bar history per instrument
        this.barHistories = {};
        // *** Brooks Pullback Tracking State ***
        // Key: instrument_key, value: {
        //   lastTrendExtremeBarIdx: <index of last HH in bull or LL in bear>,
        //   pullbackTypesFired: <Set of pullback type strings that fired since last extreme>,
        //   activeOppositionPattern: <'double_top_bear' | 'double_bottom_bull' | null>,
        //   oppositionStartBarIdx: <index where pattern activated>,
        //   highestConfidenceSinceExtreme: <maximum confidence of any signal fired>
        // }
        this.pullbackTracking = {};
    }

    /**
     * Detect if the latest bar makes a new trend extreme (Higher High in bull, Lower Low in bear).
     * This resolves the pullback and allows new signals.
     */
    _detectNewTrendExtreme(bars, direction, lastExtremeBarIdx) {
        if (bars.length < 3) return false;
        const latestBar = bars[bars.length - 1];
        const startIdx = Math.max(0, lastExtremeBarIdx + 1);

        if (direction === 'long') {
            // Bull trend: new extreme = bar makes Higher High above all bars since lastExtremeBarIdx
            const recentBars = bars.slice(startIdx);
            const maxHigh = Math.max(...recentBars.map(b => b.high));
            return latestBar.high >= maxHigh && startIdx < bars.length - 1;
        } else {
            // Bear trend: new extreme = bar makes Lower Low below all bars since lastExtremeBarIdx
            const recentBars = bars.slice(startIdx);
            const minLow = Math.min(...recentBars.map(b => b.low));
            return latestBar.low <= minLow && startIdx < bars.length - 1;
        }
    }

    getState(instrumentKey) {
        return this.states[instrumentKey] || null;
    }

    setState(instrumentKey, state) {
        this.states[instrumentKey] = state;
    }

    getBarHistory(instrumentKey) {
        return this.barHistories[instrumentKey] || [];
    }

    addBar(instrumentKey, bar) {
        if (!this.barHistories[instrumentKey]) {
            this.barHistories[instrumentKey] = [];
        }
        this.barHistories[instrumentKey].push(bar);
        // Keep last 200 bars max to manage memory
        if (this.barHistories[instrumentKey].length > 200) {
            this.barHistories[instrumentKey] = this.barHistories[instrumentKey].slice(-200);
        }
    }

    /**
     * Main evaluateSignal function — called by candleBuilder.js and backtesterAsLive.js
     * Signature matches: STRATEGIES[key].evaluateSignal(bar, instrumentConfig, trendState)
     */
    evaluateSignal(bar, instrumentConfig, externalTrendState) {
        const instrumentKey = instrumentConfig.instrument_key || 'default';
        const cfg = loadBrooksConfig(instrumentConfig);

        if (!cfg.enabled) return null;

        // Track bar
        this.addBar(instrumentKey, bar);
        const bars = this.getBarHistory(instrumentKey);

        // Load prior state
        let priorState = this.states[instrumentKey] || null;
        if (!priorState && externalTrendState) {
            priorState = externalTrendState;
        }

        // Compute EMA series
        const emaSeries = computeEMASeries(bars, cfg.ema_period);

        // Assess trend state
        const trendAssessment = assessTrendState(bars, emaSeries, cfg, priorState);

        // Update state if trend changed significantly
        if (!priorState || trendAssessment.state !== priorState.state) {
            this.states[instrumentKey] = {
                state: trendAssessment.state,
                details: trendAssessment.details,
                updatedAt: bar.timestamp || bar.time || Date.now(),
                swings: trendAssessment.swings,
                bullTL: trendAssessment.bullTL,
                bearTL: trendAssessment.bearTL
            };
        }

        const currentState = this.states[instrumentKey] || trendAssessment;
        if (!currentState) return null;

        // ================================================================
        // BROOKS-COMPLIANT GATING & SIGNAL SELECTION (Chapters 1-4)
        // ================================================================
        const latestIdx = bars.length - 1;
        const trendStateStr = currentState.state;
        const isBullTrend = trendStateStr.includes('bull');
        const isBearTrend = trendStateStr.includes('bear');
        const trendDirection = isBullTrend ? 'long' : (isBearTrend ? 'short' : null);

        // --- Initialize pullback tracking for this instrument ---
        const ptKey = instrumentKey;
        if (!this.pullbackTracking[ptKey]) {
            this.pullbackTracking[ptKey] = {
                lastTrendExtremeBarIdx: Math.max(0, latestIdx - 20),
                pullbackTypesFired: new Set(),
                activeDoubleTopBearFlag: false,
                activeDoubleBottomBullFlag: false,
                highestConfidenceSinceExtreme: 0,
                lastSignalTimestamp: null
            };
        }
        const pt = this.pullbackTracking[ptKey];

        // --- Gate 0: Reset tracking on new trend extreme (Ch 4: "pullback resolves on test of extreme") ---
        if (trendDirection && this._detectNewTrendExtreme(bars, trendDirection, pt.lastTrendExtremeBarIdx)) {
            pt.lastTrendExtremeBarIdx = latestIdx - 1;
            pt.pullbackTypesFired = new Set();
            pt.highestConfidenceSinceExtreme = 0;
            pt.activeDoubleTopBearFlag = false;
            pt.activeDoubleBottomBullFlag = false;
        }

        // --- Run ALL pattern detectors ---
        const detectors = [
            // Chapter 4: Pullback Hierarchy (in order of increasing size)
            () => detectBarPullback(bars, emaSeries, currentState, cfg),
            () => detectMinorTrendlinePullback(bars, emaSeries, currentState, cfg),
            () => detectEMAPullback(bars, emaSeries, currentState, cfg),
            () => detectEMAGapBar(bars, emaSeries, currentState, cfg),
            () => detectMajorTrendlinePullback(bars, emaSeries, currentState, cfg),

            // Chapter 4: Double Top/Bottom Flags
            () => detectDoubleBottomBullFlag(bars, emaSeries, currentState, cfg),
            () => detectDoubleTopBearFlag(bars, emaSeries, currentState, cfg),

            // Chapter 4: 2HM
            () => detect2HM(bars, emaSeries, currentState, cfg),

            // Chapter 4: Mid-Session Trap
            () => detectMidSessionTrap(bars, emaSeries, currentState, cfg, instrumentConfig),

            // Chapter 4: Three Push / Wedge
            () => detectThreePushPullback(bars, emaSeries, currentState, cfg),

            // Chapter 1: Failed Reversal
            () => detectFailedReversal(bars, emaSeries, currentState, cfg),

            // Chapter 1: Outside Bar Trap
            () => detectOutsideBarTrap(bars, emaSeries, currentState, cfg),

            // Chapter 4: Failed Final Flag
            () => detectFailedFinalFlag(bars, emaSeries, currentState, cfg),

            // Chapter 3: Spike and Channel
            () => detectSpikeAndChannelReversal(bars, emaSeries, currentState, cfg),

            // Chapter 3: Trend Resumption
            () => detectTrendResumption(bars, emaSeries, currentState, cfg, priorState),
        ];

        const detectedSignals = [];
        for (const detector of detectors) {
            const signal = detector();
            if (!signal || !signal.detected || signal.informational) continue;

            // === Gate 1: Minimum Confidence ≥ 80 (Ch 4: "uncertainty makes traders hesitant") ===
            if (signal.confidence < 80) continue;

            // === Gate 2: High/Low count > 4 — suppress (Ch 4: "beyond H4, market is countertrending") ===
            if (signal.setupType && (signal.setupType.includes('High') || signal.setupType.includes('Low'))) {
                const hlMatch = signal.setupType.match(/(High|Low)\s*(\d+)/);
                if (hlMatch && parseInt(hlMatch[2]) > cfg.max_hl_count) continue;
            }

            // === Gate 3: Pullback Resolution Gate — one signal per pullback (Ch 4: p.101-102) ===
            const pbType = signal.pullbackType || signal.setupType;
            if (pt.pullbackTypesFired.has(pbType)) continue; // Already fired this type since last extreme
            if (pt.highestConfidenceSinceExtreme > 0 && signal.confidence <= pt.highestConfidenceSinceExtreme) continue; // Lower confidence than already fired

            // === Gate 4: First Pullback Per Type per extreme (Ch 4: "each type of first pullback...") ===
            // Each pullback type can fire only once per trend leg
            const pullbackFamily = pbType.split('_')[0] || pbType;
            if (pullbackFamily === 'bar' && pt.pullbackTypesFired.has('minor_trendline')) continue; // bar_pullback already "covered" by larger type
            if (pullbackFamily === 'minor' && pt.pullbackTypesFired.has('ema')) continue;
            if (pullbackFamily === 'bar' && pt.pullbackTypesFired.has('ema')) continue;

            // === Gate 5: Trend State Restriction (Ch 4: p.101) ===
            const isStrong = trendStateStr === TREND_STATE.BULL_TREND_STRONG || trendStateStr === TREND_STATE.BEAR_TREND_STRONG;
            const isWeak = trendStateStr.includes('weakening');
            const isTradingRange = trendStateStr === TREND_STATE.TRADING_RANGE || trendStateStr === TREND_STATE.UNDEFINED;
            const isCountertrend = signal.direction !== trendDirection && trendDirection !== null;

            if (isStrong) {
                // Strong trend: only micro trendline (H1/L1) and EMA Gap Bar entries
                // Brooks: "first minor pullback... almost always followed by a new extreme"
                if (signal.pullbackType !== 'bar_pullback' && signal.pullbackType !== 'ema_gap' && signal.pullbackType !== '2hm') continue;
            } else if (isWeak) {
                // Weakening trend: only EMA pullback (M2B/M2S) and double top/bottom flags
                // Brooks: "each pullback tends to be greater as the countertrend traders become more willing"
                if (signal.pullbackType !== 'ema' && signal.pullbackType !== 'ema_gap' &&
                    !signal.setupType.includes('Double Top') && !signal.setupType.includes('Double Bottom') &&
                    signal.pullbackType !== 'wedge_three_push') continue;
            } else if (isTradingRange) {
                // Trading range: only double top/bottom flags
                // Brooks: (p.104) "sideways bars means both buyers and sellers are active"
                if (!signal.setupType.includes('Double Top') && !signal.setupType.includes('Double Bottom') &&
                    signal.pullbackType !== 'failed_final_flag') continue;
            }

            // === Gate 6: H2/L2 Requires Steep First Leg (Ch 4: p.121) ===
            // "When the first leg is steep and its correction is only a couple bars... no significant trendline
            //  will be broken so you should not be looking to buy a High 2"
            if (signal.setupType && (signal.setupType.includes('High 2') || signal.setupType.includes('Low 2'))) {
                if (signal.metadata && signal.metadata.legAnalysis) {
                    const leg1 = signal.metadata.legAnalysis.leg1;
                    const leg2 = signal.metadata.legAnalysis.leg2;
                    if (leg1 && leg2) {
                        const leg1Bars = leg2.index - leg1.index;
                        if (leg1Bars <= 3) continue; // Too few bars for meaningful trendline break
                    }
                }
            }

            // === Gate 7: Opposition Pattern Suppression (Ch 4: p.104-105) ===
            // If a Double Top Bear Flag is active, don't fire long signals
            // If a Double Bottom Bull Flag is active, don't fire short signals
            if (pt.activeDoubleTopBearFlag && signal.direction === 'long') continue;
            if (pt.activeDoubleBottomBullFlag && signal.direction === 'short') continue;

            // === Gate 8: Barb Wire confidence reduction (Ch 4: p.122) ===
            const isBarbWireZone = isTradingRange || isWeak;
            if (isBarbWireZone && signal.confidence < 90) {
                signal.confidence = Math.max(80, signal.confidence - 5);
                if (signal.confidence < 80) continue; // Drop if below threshold after reduction
            }

            detectedSignals.push({
                ...signal,
                timestamp: bar.timestamp || bar.time || new Date().toISOString()
            });
        }

        if (detectedSignals.length === 0) return null;

        // --- Signal selection: highest confidence wins ---
        detectedSignals.sort((a, b) => b.confidence - a.confidence);
        const bestSignal = detectedSignals[0];

        // --- Update pullback tracking ---
        const bestPbType = bestSignal.pullbackType || bestSignal.setupType;
        pt.pullbackTypesFired.add(bestPbType);
        pt.highestConfidenceSinceExtreme = bestSignal.confidence;
        pt.lastSignalTimestamp = bestSignal.timestamp;

        // Track double top/bottom flags for opposition suppression
        if (bestSignal.setupType.includes('Double Top Bear Flag')) pt.activeDoubleTopBearFlag = true;
        if (bestSignal.setupType.includes('Double Bottom Bull Flag')) pt.activeDoubleBottomBullFlag = true;

        // Generate versioned entry/exit for all active versions
        const activeVersions = cfg.active_versions || this.activeVersions;
        const versionedEntries = {};

        for (const version of activeVersions) {
            const entry = computeVersionedEntry(bestSignal, cfg, version);
            if (entry) {
                versionedEntries[version] = entry;
            }
        }

        return {
            signal: bestSignal.setupType,
            direction: bestSignal.direction,
            entryPrice: bestSignal.entryPrice,
            stopLoss: bestSignal.stopLoss,
            takeProfit: bestSignal.takeProfit,
            confidence: bestSignal.confidence,
            setupType: bestSignal.setupType,
            pullbackType: bestSignal.pullbackType || null,
            signalBar: bestSignal.signalBar,
            versionedEntries,
            trendState: currentState.state,
            timestamp: bestSignal.timestamp,
            strategy: this.name,
            metadata: bestSignal.metadata || {},
            filters: bestSignal.filters || []
        };
    }

    /**
     * Backtest-compatible evaluation — returns array of versioned signals
     */
    evaluateSignalForBacktest(bar, instrumentConfig, externalTrendState) {
        const result = this.evaluateSignal(bar, instrumentConfig, externalTrendState);
        if (!result) return [];

        // Expand versioned entries for backtest to test each version independently
        const versionedResults = [];
        for (const [version, entryData] of Object.entries(result.versionedEntries || {})) {
            versionedResults.push({
                ...result,
                version,
                entryPrice: entryData.entryPrice,
                stopLoss: entryData.stopLoss,
                takeProfit: entryData.takeProfit,
                risk: entryData.risk,
                reward: entryData.reward
            });
        }

        return versionedResults;
    }

    /**
     * Get current state for persistence (TODO for live)
     */
    exportState() {
        return {
            states: this.states,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Import state (TODO for live)
     */
    importState(savedState) {
        if (savedState && savedState.states) {
            this.states = { ...this.states, ...savedState.states };
        }
    }
}

// ============================================================================
// MODULE 11: EXPORT
// ============================================================================

// Create singleton instance
const brooksChapterStrategy = new BrooksChapterStrategy();

module.exports = brooksChapterStrategy;