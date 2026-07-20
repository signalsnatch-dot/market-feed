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
        // HIGH PROBABILITY VERSIONS ONLY (10 unique)
        // Each targets a distinct Brooks Ch 1-4 concept with unique gate mask or boost
        active_versions: [
            'v7-conf-only',                   // 1. Baseline: confidence + HL count + opposition (mask 67)
            'v19-gate-3-pb-resolve',          // 2. Adds pullback resolution (mask 71)
            'v25-signal-quality-filter',      // 3. Adds signal quality + climax + pullback type (mask 579)
            'v26-chapter-full',               // 4. All 11 gates (mask 2687)
            'v23-2hm-boost',                  // 5. 2HM confidence boost (mask 67)
            'v24-m2-boost',                   // 6. M2B/M2S confidence boost (mask 67)
            'v31-mid-session-trap-boost',     // 7. Mid-session trap +10 (mask 579)
            'v32-wedge-boost',                // 8. Wedge/three-push +15 (mask 579)
            'v36-m2-ema-origin-boost',        // 9. M2 at EMA +8 (mask 579)
            'v37-wr-stack-all',               // 10. All 6 boosts + fix TP (mask 579)
        ],
        // Version-specific gate masks (bitmask: Gate 1=1, Gate 2=2, Gate 3=4, Gate 4=8, Gate 5=16, Gate 6=32, Gate 7=64, Gate 8=128)
        version_gate_masks: {
            // Baseline: V964 = v7-conf-only (Gates 1,2,7)
            'v7-conf-only':              67,  // Gates 1,2,7 (1+2+64)
            // Instrument-calibrated versions (kept for future instrument-specific testing)
            'v17-instrument-calibrated': 255, // All 8 gates, uses per-instrument tickSize, tolerance ratios
            'v18-calibrated-volume':     63,  // Gates 1,2,3,4,5,6 (255-64-128=63) — no Barb Wire, no Opposition
            // NEW: V964-variant with one additional Brooks-based gate each
            'v19-gate-3-pb-resolve':     71,  // V964 (67) + Gate 3 Pullback Resolve (4) = 71
            'v20-gate-6-steep-leg':      99,  // V964 (67) + Gate 6 Steep Leg (32) = 99
            'v21-gate-4-first-type':     75,  // V964 (67) + Gate 4 First Per Type (8) = 75
            'v22-gate-5-state-restrict': 83,  // V964 (67) + Gate 5 State Restrict (16) = 83
            'v23-2hm-boost':             67,  // Same as V964, but +5 confidence to 2HM signals
            'v24-m2-boost':              67,  // Same as V964, but +5 confidence to M2B/M2S signals
            'v25-signal-quality-filter':  579, // V964 (67) + Gate 9 Signal Quality (512) = 579
            'v26-chapter-full':           2687,  // All 11 gates MINUS Gate 10 (climax hard-reject):
            // Batch 1: V978-V979 — TP-multiplied versions of V976 (v25)
            'v27-tp-mult-4':             579,
            'v28-tp-mult-3':             579,
            // Batch 1: V980-V982 — Confidence/original variants of V964 (v7-conf-only)
            'v29-conf-90':               67,
            'v30-conf-80':               67,
            // Batch 2: V983-V988 — WR improvement stack on V976 (v25) — UNWIRED old
            'v31-mid-session-trap':      579,
            'v32-measured-move':         579,
            'v33-wedge-boost':           579,
            'v34-barb-wire-second':      579,
            'v35-failed-flag-refine':    579,
            'v36-m2-ema-origin':         579,
            // NEW: WR improvement stack with DISTINCT BOOST LOGIC (mask=579, conf=80)
            'v31-mid-session-trap-boost':      579,
            'v32-wedge-boost':                 579,
            'v33-barb-wire-second-boost':      579,
            'v34-measured-move-target':        579,
            'v35-failed-flag-boost':           579,
            'v36-m2-ema-origin-boost':         579,
            // WR Stack COMBINED
            'v37-wr-stack-all':          579,
            'v37-wr-stack-all-conf-85': 579,
            // Confidence variants (same gate masks as originals, different thresholds)
            'v7-conf-75':                67,
            'v7-conf-85':                67,
            'v25-conf-75':               579,
            'v25-conf-80':               579,
            'v25-conf-85':               579,
            'v26-conf-80':               2687,
            'v26-conf-85':               2687,
        },
        version_confidence_thresholds: {
            'v7-conf-only':              70,
            'v17-instrument-calibrated': 80,
            'v18-calibrated-volume':     75,
            'v19-gate-3-pb-resolve':     70,
            'v20-gate-6-steep-leg':      70,
            'v21-gate-4-first-type':     70,
            'v22-gate-5-state-restrict': 70,
            'v23-2hm-boost':             70,
            'v24-m2-boost':              70,
            'v25-signal-quality-filter':  70,
            'v26-chapter-full':           75,
            // Batch 1: V978-V979 — same conf as V976 (70)
            'v27-tp-mult-4':             70,
            'v28-tp-mult-3':             70,
            // Batch 1: V980-V982 — higher conf thresholds
            'v29-conf-90':               90,
            'v30-conf-80':               80,
            // Batch 2: V983-V988 — same conf as V976 (70) — UNWIRED old
            'v31-mid-session-trap':      70,
            'v32-measured-move':         70,
            'v33-wedge-boost':           70,
            'v34-barb-wire-second':      70,
            'v35-failed-flag-refine':    70,
            'v36-m2-ema-origin':         70,
            // NEW: Distinct boost versions (conf=80 base)
            'v31-mid-session-trap-boost': 80,
            'v32-wedge-boost':           80,
            'v33-barb-wire-second-boost': 80,
            'v34-measured-move-target':  80,
            'v35-failed-flag-boost':     80,
            'v36-m2-ema-origin-boost':   80,
            // WR Stack COMBINED
            'v37-wr-stack-all':          80,
            'v37-wr-stack-all-conf-85': 85,
            // Confidence variants
            'v7-conf-75':                75,
            'v7-conf-85':                85,
            'v25-conf-75':               75,
            'v25-conf-80':               80,
            'v25-conf-85':               85,
            'v26-conf-80':               80,
            'v26-conf-85':               85,
        },
        version_target_ratios: {
            'v27-tp-mult-4':             4,
            'v28-tp-mult-3':             3,
        },
        v4_pure_brooks: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: true
        },
        v5_relaxed_pullback: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: true
        },
        v6_no_state_restrict: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: true
        },
        v7_conf_only: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: true
        },
        v8_all_gates_lower_conf: {
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
    cfg.v5_relaxed_pullback = { ...defaults.v5_relaxed_pullback, ...(cfg.v5_relaxed_pullback || {}) };
    cfg.v6_no_state_restrict = { ...defaults.v6_no_state_restrict, ...(cfg.v6_no_state_restrict || {}) };
    cfg.v7_conf_only = { ...defaults.v7_conf_only, ...(cfg.v7_conf_only || {}) };
    cfg.v8_all_gates_lower_conf = { ...defaults.v8_all_gates_lower_conf, ...(cfg.v8_all_gates_lower_conf || {}) };
    // --- Graduated dilution series (v9-v16) ---
    cfg.v9_drop_barb_wire = { ...defaults.v9_drop_barb_wire, ...(cfg.v9_drop_barb_wire || {}) };
    cfg.v10_drop_opposition = { ...defaults.v10_drop_opposition, ...(cfg.v10_drop_opposition || {}) };
    cfg.v11_drop_hl_count = { ...defaults.v11_drop_hl_count, ...(cfg.v11_drop_hl_count || {}) };
    cfg.v12_lower_confidence = { ...defaults.v12_lower_confidence, ...(cfg.v12_lower_confidence || {}) };
    cfg.v13_drop_state_restrict = { ...defaults.v13_drop_state_restrict, ...(cfg.v13_drop_state_restrict || {}) };
    cfg.v14_drop_first_type = { ...defaults.v14_drop_first_type, ...(cfg.v14_drop_first_type || {}) };
    cfg.v15_drop_steep_leg = { ...defaults.v15_drop_steep_leg, ...(cfg.v15_drop_steep_leg || {}) };
    cfg.v16_all_dropped = { ...defaults.v16_all_dropped, ...(cfg.v16_all_dropped || {}) };

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

        // All versions use Brooks-compliant 1-tick offset with uniform entry/exit logic
        // Differences are in the GATING, not the entry/exit computation
        const tickSize = 0.05;
        switch (version) {
        case 'v4-pure-brooks': {
            const vc = cfg.v4_pure_brooks || {};
            entryPrice = direction === 'long'
                ? bar.high + (vc.trigger_offset_ticks || 1) * tickSize
                : bar.low - (vc.trigger_offset_ticks || 1) * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - (vc.stop_offset_ticks || 1) * tickSize
                : bar.high + (vc.stop_offset_ticks || 1) * tickSize;
            targetRR = vc.target_rr_ratio || 2;
            break;
        }
        case 'v5-relaxed-pullback': {
            const vc = cfg.v5_relaxed_pullback || {};
            entryPrice = direction === 'long'
                ? bar.high + (vc.trigger_offset_ticks || 1) * tickSize
                : bar.low - (vc.trigger_offset_ticks || 1) * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - (vc.stop_offset_ticks || 1) * tickSize
                : bar.high + (vc.stop_offset_ticks || 1) * tickSize;
            targetRR = vc.target_rr_ratio || 2;
            break;
        }
        case 'v6-no-state-restrict': {
            const vc = cfg.v6_no_state_restrict || {};
            entryPrice = direction === 'long'
                ? bar.high + (vc.trigger_offset_ticks || 1) * tickSize
                : bar.low - (vc.trigger_offset_ticks || 1) * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - (vc.stop_offset_ticks || 1) * tickSize
                : bar.high + (vc.stop_offset_ticks || 1) * tickSize;
            targetRR = vc.target_rr_ratio || 2;
            break;
        }
        case 'v7-conf-only': {
            const vc = cfg.v7_conf_only || {};
            entryPrice = direction === 'long'
                ? bar.high + (vc.trigger_offset_ticks || 1) * tickSize
                : bar.low - (vc.trigger_offset_ticks || 1) * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - (vc.stop_offset_ticks || 1) * tickSize
                : bar.high + (vc.stop_offset_ticks || 1) * tickSize;
            targetRR = vc.target_rr_ratio || 2;
            break;
        }
        case 'v8-all-gates-lower-conf': {
            const vc = cfg.v8_all_gates_lower_conf || {};
            entryPrice = direction === 'long'
                ? bar.high + (vc.trigger_offset_ticks || 1) * tickSize
                : bar.low - (vc.trigger_offset_ticks || 1) * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - (vc.stop_offset_ticks || 1) * tickSize
                : bar.high + (vc.stop_offset_ticks || 1) * tickSize;
            targetRR = vc.target_rr_ratio || 2;
            break;
        }
        // --- Graduated dilution series (v9-v16): all use 1-tick offset, 2R target ---
        case 'v9-drop-barb-wire':
        case 'v10-drop-opposition':
        case 'v11-drop-hl-count':
        case 'v12-lower-confidence':
        case 'v13-drop-state-restrict':
        case 'v14-drop-first-type':
        case 'v15-drop-steep-leg':
        case 'v16-all-dropped': {
            // All use standard 1-tick offset with 2R target (pure Brooks)
            entryPrice = direction === 'long'
                ? bar.high + 1 * tickSize
                : bar.low - 1 * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - 1 * tickSize
                : bar.high + 1 * tickSize;
            targetRR = 2;
            break;
        }
        case 'v1-strict':
            entryPrice = direction === 'long'
                ? bar.high + cfg.v1_strict.trigger_offset_ticks * tickSize
                : bar.low - cfg.v1_strict.trigger_offset_ticks * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - cfg.v1_strict.stop_offset_ticks * tickSize
                : bar.high + cfg.v1_strict.stop_offset_ticks * tickSize;
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

        // --- v17-v26: all use standard 1-tick offset, 2R target ---
        case 'v17-instrument-calibrated':
        case 'v18-calibrated-volume':
        case 'v19-gate-3-pb-resolve':
        case 'v20-gate-6-steep-leg':
        case 'v21-gate-4-first-type':
        case 'v22-gate-5-state-restrict':
        case 'v23-2hm-boost':
        case 'v24-m2-boost':
        case 'v25-signal-quality-filter':
        case 'v26-chapter-full':
        // --- Batch 1: V978-V979 — TP-multiplied versions (v27/v28) ---
        case 'v27-tp-mult-4':
        case 'v28-tp-mult-3':
        // --- Batch 1: V980-V982 — Confidence variants (v29/v30) ---
        case 'v29-conf-90':
        case 'v30-conf-80':
        // --- Batch 2: V983-V988 — WR improvement stack (v31-v36) ---
        case 'v31-mid-session-trap':
        case 'v32-measured-move':
        case 'v33-wedge-boost':
        case 'v34-barb-wire-second':
        case 'v35-failed-flag-refine':
        case 'v36-m2-ema-origin':
        // NEW: Distinct boost WR improvement versions
        case 'v31-mid-session-trap-boost':
        case 'v32-wedge-boost':
        case 'v33-barb-wire-second-boost':
        case 'v34-measured-move-target':
        case 'v35-failed-flag-boost':
        case 'v36-m2-ema-origin-boost':
        // WR Stack COMBINED
        case 'v37-wr-stack-all':
        case 'v37-wr-stack-all-conf-85':
        // Confidence variants
        case 'v7-conf-75':
        case 'v7-conf-85':
        case 'v25-conf-75':
        case 'v25-conf-80':
        case 'v25-conf-85':
        case 'v26-conf-80':
        case 'v26-conf-85': {
            // All use standard 1-tick offset
            entryPrice = direction === 'long'
                ? bar.high + 1 * tickSize
                : bar.low - 1 * tickSize;
            stopPrice = direction === 'long'
                ? bar.low - 1 * tickSize
                : bar.high + 1 * tickSize;
            // Check for version-specific target RR ratio
            const targetRatios = cfg.version_target_ratios || {};
            targetRR = targetRatios[version] || 2;
            break;
        }

        default:
            return null;
    }

    // Take profit: computed from risk and target RR
    const risk = Math.abs(entryPrice - stopPrice);
    
    // v34/v37: Override target to measured move projection from spike-and-channel
    // Brooks Ch 4: "Measured Move" projects spike height from channel breakout
    if ((version === 'v34-measured-move-target' || version === 'v37-wr-stack-all' || version === 'v37-wr-stack-all-conf-85') && risk > 0) {
        // Try to compute a measured move target from leg analysis metadata
        if (signal.metadata && signal.metadata.legAnalysis && signal.metadata.legAnalysis.leg1) {
            try {
                const leg1Price = signal.metadata.legAnalysis.leg1.price;
                const leg1Bar = signal.metadata.legAnalysis.leg1.bar;
                const leg2Bar = signal.metadata.legAnalysis.leg2?.bar;
                if (leg1Price && leg1Bar && leg2Bar) {
                    // Leg height = absolute price difference between leg 1 and leg 2 bars
                    const legHeight = Math.abs(
                        (leg2Bar.close || leg2Bar.high) - (leg1Bar.close || leg1Bar.low)
                    );
                    if (legHeight > risk * 0.5) {
                        targetRR = Math.max(2, legHeight / risk);
                    } else {
                        targetRR = 2;
                    }
                } else {
                    targetRR = 2;
                }
            } catch (e) {
                targetRR = 2;
            }
        } else {
            // Fall back to 2R if no measured move data available
            targetRR = 2;
        }
    }

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
        this.activeVersions = [
            'v7-conf-only',                   // 1. Baseline: confidence + HL count + opposition (mask 67)
            'v19-gate-3-pb-resolve',          // 2. Adds pullback resolution (mask 71)
            'v25-signal-quality-filter',      // 3. Adds signal quality + climax + pullback type (mask 579)
            'v26-chapter-full',               // 4. All 11 gates (mask 2687)
            'v23-2hm-boost',                  // 5. 2HM confidence boost (mask 67)
            'v24-m2-boost',                   // 6. M2B/M2S confidence boost (mask 67)
            'v31-mid-session-trap-boost',     // 7. Mid-session trap +10 (mask 579)
            'v32-wedge-boost',                // 8. Wedge/three-push +15 (mask 579)
            'v36-m2-ema-origin-boost',        // 9. M2 at EMA +8 (mask 579)
            'v37-wr-stack-all',               // 10. All 6 boosts + fix TP (mask 579)
        ];
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
    evaluateSignal(bar, instrumentConfig, externalTrendState, requestedVersion = null) {
        const instrumentKey = instrumentConfig.instrument_key || 'default';
        const cfg = loadBrooksConfig(instrumentConfig);

        if (!cfg.enabled) return null;

        // Determine which version(s) to process
        const versionsToProcess = [];
        if (requestedVersion) {
            // Single version mode (backtesting) — only process this version
            if (cfg.version_gate_masks && cfg.version_gate_masks[requestedVersion] !== undefined) {
                versionsToProcess.push(requestedVersion);
            } else {
                return null; // Version not found in config
            }
        } else {
            // Legacy mode (live) — process all active versions
            versionsToProcess.push(...(cfg.active_versions || []));
        }

        // Build per-version state keys (isolated per instrument+version pair)
        const stateKey = requestedVersion
            ? `${instrumentKey}::${requestedVersion}`
            : instrumentKey;
        const histKey = requestedVersion
            ? `${instrumentKey}::${requestedVersion}`
            : instrumentKey;
        const ptKey = requestedVersion
            ? `${instrumentKey}::${requestedVersion}`
            : instrumentKey;

        // Track bar (per-version bar history)
        this.addBar(histKey, bar);
        const bars = this.getBarHistory(histKey);

        // Load prior state (per-version state)
        let priorState = this.states[stateKey] || null;
        if (!priorState && externalTrendState && !requestedVersion) {
            priorState = externalTrendState;
        }

        // Compute EMA series
        const emaSeries = computeEMASeries(bars, cfg.ema_period);

        // Assess trend state
        const trendAssessment = assessTrendState(bars, emaSeries, cfg, priorState);

        // Update state if trend changed significantly (per-version state)
        if (!priorState || trendAssessment.state !== priorState.state) {
            this.states[stateKey] = {
                state: trendAssessment.state,
                details: trendAssessment.details,
                updatedAt: bar.timestamp || bar.time || Date.now(),
                swings: trendAssessment.swings,
                bullTL: trendAssessment.bullTL,
                bearTL: trendAssessment.bearTL
            };
        }

        const currentState = this.states[stateKey] || trendAssessment;
        if (!currentState) return null;

        // ================================================================
        // BROOKS-COMPLIANT GATING & SIGNAL SELECTION (Chapters 1-4)
        // ================================================================
        const latestIdx = bars.length - 1;
        const trendStateStr = currentState.state;
        const isBullTrend = trendStateStr.includes('bull');
        const isBearTrend = trendStateStr.includes('bear');
        const trendDirection = isBullTrend ? 'long' : (isBearTrend ? 'short' : null);

        // --- Initialize per-version pullback tracking ---
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

        // ===============================================================
        // VERSION-AWARE GATING (bitmask per version)
        // Bit layout: Gate1=1, Gate2=2, Gate3=4, Gate4=8, Gate5=16, Gate6=32, Gate7=64, Gate8=128
        // ===============================================================
        const GATE_BIT = {
            CONFIDENCE: 1,      // Gate 1: Minimum confidence threshold
            HL_COUNT: 2,        // Gate 2: High/Low count > 4 suppression
            PULLBACK_RESOLVE: 4,// Gate 3: One signal per pullback type per extreme
            FIRST_PER_TYPE: 8,  // Gate 4: Hierarchical pullback type suppression
            STATE_RESTRICT: 16, // Gate 5: Trend state restriction
            STEEP_LEG: 32,      // Gate 6: H2/L2 requires steep first leg
            OPPOSITION: 64,     // Gate 7: Opposition pattern suppression
            BARB_WIRE: 128,     // Gate 8: Barb Wire confidence reduction
            SIGNAL_QUALITY: 512,// Gate 9: Signal bar quality assessment (trend bar, reversal bar, doji)
            EMOTIONAL_SURGE: 1024, // Gate 10: Emotional surge / climax rejection (hard reject)
            PULLBACK_QUALITY: 2048 // Gate 11: Pullback quality — must be recognized Brooks type
        };

        // Gather gate configs for all versions
        const versionGateMasks = cfg.version_gate_masks || {};
        const versionConfThresholds = cfg.version_confidence_thresholds || {};

        // --- Run ALL pattern detectors (same for all versions) ---
        const detectors = [
            () => detectBarPullback(bars, emaSeries, currentState, cfg),
            () => detectMinorTrendlinePullback(bars, emaSeries, currentState, cfg),
            () => detectEMAPullback(bars, emaSeries, currentState, cfg),
            () => detectEMAGapBar(bars, emaSeries, currentState, cfg),
            () => detectMajorTrendlinePullback(bars, emaSeries, currentState, cfg),
            () => detectDoubleBottomBullFlag(bars, emaSeries, currentState, cfg),
            () => detectDoubleTopBearFlag(bars, emaSeries, currentState, cfg),
            () => detect2HM(bars, emaSeries, currentState, cfg),
            () => detectMidSessionTrap(bars, emaSeries, currentState, cfg, instrumentConfig),
            () => detectThreePushPullback(bars, emaSeries, currentState, cfg),
            () => detectFailedReversal(bars, emaSeries, currentState, cfg),
            () => detectOutsideBarTrap(bars, emaSeries, currentState, cfg),
            () => detectFailedFinalFlag(bars, emaSeries, currentState, cfg),
            () => detectSpikeAndChannelReversal(bars, emaSeries, currentState, cfg),
            () => detectTrendResumption(bars, emaSeries, currentState, cfg, priorState),
        ];

        const allDetectedSignals = [];
        for (const detector of detectors) {
            const signal = detector();
            if (!signal || !signal.detected || signal.informational) continue;
            allDetectedSignals.push(signal);
        }

        if (allDetectedSignals.length === 0) return null;

        // --- State context (shared across versions) ---
        const isStrong = trendStateStr === TREND_STATE.BULL_TREND_STRONG || trendStateStr === TREND_STATE.BEAR_TREND_STRONG;
        const isWeak = trendStateStr.includes('weakening');
        const isTradingRange = trendStateStr === TREND_STATE.TRADING_RANGE || trendStateStr === TREND_STATE.UNDEFINED;

        // --- Version-aware filtering ---
        const versionedResults = {};

        for (const [version, gateMask] of Object.entries(versionGateMasks)) {
            // Skip versions not in the requested set — prevents cross-version pollution of pt
            if (versionsToProcess.length > 0 && !versionsToProcess.includes(version)) continue;
            const confThreshold = versionConfThresholds[version] || 80;
            const passingSignals = [];

            for (let i = 0; i < allDetectedSignals.length; i++) {
                const signal = { ...allDetectedSignals[i] }; // clone to avoid mutation
                let pass = true;

                // Gate 1: Minimum Confidence (bit 1)
                if (gateMask & GATE_BIT.CONFIDENCE) {
                    if (signal.confidence < confThreshold) pass = false;
                }

                // Gate 2: High/Low count > 4 (bit 2) — shared across versions
                if (pass && (gateMask & GATE_BIT.HL_COUNT)) {
                    if (signal.setupType && (signal.setupType.includes('High') || signal.setupType.includes('Low'))) {
                        const hlMatch = signal.setupType.match(/(High|Low)\s*(\d+)/);
                        if (hlMatch && parseInt(hlMatch[2]) > cfg.max_hl_count) pass = false;
                    }
                }

                // Gate 3: Pullback Resolution — one signal per type per extreme (bit 4)
                if (pass && (gateMask & GATE_BIT.PULLBACK_RESOLVE)) {
                    const pbType = signal.pullbackType || signal.setupType;
                    if (pt.pullbackTypesFired.has(pbType)) pass = false;
                    if (pt.highestConfidenceSinceExtreme > 0 && signal.confidence < pt.highestConfidenceSinceExtreme) pass = false;
                }

                // Gate 4: First Pullback Per Type hierarchy (bit 8)
                if (pass && (gateMask & GATE_BIT.FIRST_PER_TYPE)) {
                    const pbType = signal.pullbackType || signal.setupType;
                    const pullbackFamily = pbType.split('_')[0] || pbType;
                    if (pullbackFamily === 'bar' && pt.pullbackTypesFired.has('minor_trendline')) pass = false;
                    if (pullbackFamily === 'minor' && pt.pullbackTypesFired.has('ema')) pass = false;
                    if (pullbackFamily === 'bar' && pt.pullbackTypesFired.has('ema')) pass = false;
                }

                // Gate 5: Trend State Restriction (bit 16)
                if (pass && (gateMask & GATE_BIT.STATE_RESTRICT)) {
                    if (isStrong) {
                        if (signal.pullbackType !== 'bar_pullback' && signal.pullbackType !== 'ema_gap' && signal.pullbackType !== '2hm') pass = false;
                    } else if (isWeak) {
                        if (signal.pullbackType !== 'ema' && signal.pullbackType !== 'ema_gap' &&
                            !signal.setupType.includes('Double Top') && !signal.setupType.includes('Double Bottom') &&
                            signal.pullbackType !== 'wedge_three_push') pass = false;
                    } else if (isTradingRange) {
                        if (!signal.setupType.includes('Double Top') && !signal.setupType.includes('Double Bottom') &&
                            signal.pullbackType !== 'failed_final_flag') pass = false;
                    }
                }

                // Gate 6: H2/L2 Requires Steep First Leg (bit 32)
                if (pass && (gateMask & GATE_BIT.STEEP_LEG)) {
                    if (signal.setupType && (signal.setupType.includes('High 2') || signal.setupType.includes('Low 2'))) {
                        if (signal.metadata && signal.metadata.legAnalysis) {
                            const leg1 = signal.metadata.legAnalysis.leg1;
                            const leg2 = signal.metadata.legAnalysis.leg2;
                            if (leg1 && leg2) {
                                const leg1Bars = leg2.index - leg1.index;
                                if (leg1Bars <= 3) pass = false;
                            }
                        }
                    }
                }

                // Gate 7: Opposition Pattern Suppression (bit 64)
                if (pass && (gateMask & GATE_BIT.OPPOSITION)) {
                    if (pt.activeDoubleTopBearFlag && signal.direction === 'long') pass = false;
                    if (pt.activeDoubleBottomBullFlag && signal.direction === 'short') pass = false;
                }

                // Gate 8: Barb Wire confidence reduction (bit 128)
                if (pass && (gateMask & GATE_BIT.BARB_WIRE)) {
                    if ((isTradingRange || isWeak) && signal.confidence < 90) {
                        signal.confidence = Math.max(confThreshold - 5, signal.confidence - 5);
                        if (signal.confidence < confThreshold) pass = false;
                    }
                }

                // Gate 9: Signal Bar Quality (bit 512) — soft reject
                // Al Brooks Ch 1: Signal bars must be trend bars, reversal bars, or
                // dojis with directional close. Inside bars and ambiguous dojis are lower quality.
                if (pass && (gateMask & GATE_BIT.SIGNAL_QUALITY)) {
                    if (signal.signalBar) {
                        const sigBar = signal.signalBar;
                        const prevIdx = bars.findIndex(b => b === sigBar) - 1;
                        const prevBar = prevIdx >= 0 ? bars[prevIdx] : null;
                        const lookbackSlice = bars.slice(0, prevIdx >= 0 ? prevIdx + 1 : bars.length);
                        const sigQuality = classifySignalBar(sigBar, prevBar, lookbackSlice, signal.direction);
                        // Reject: doji bars without directional close, or very low-quality signals
                        if (sigQuality.type === BAR_TYPE.DOJI && sigQuality.quality < 20) {
                            pass = false;
                        }
                        // Directional mismatch (e.g., bear reversal bar on long signal)
                        if (!sigQuality.direction_match && sigQuality.quality < 40) {
                            pass = false;
                        }
                    }
                }

                // Gate 10: Emotional Surge / Climax Rejection (bit 1024) — HARD REJECT
                // Al Brooks Ch 4: After a climactic thrust (large expansion bar ≥ 2.5× avg body),
                // the counter-trend entry on the immediate next pullback is REJECTED.
                // This prevents fading climactic capitulation.
                if (pass && (gateMask & GATE_BIT.EMOTIONAL_SURGE)) {
                    const emaPeriod = cfg.ema_period || 20;
                    const hasEnoughBars = bars.length >= emaPeriod + 5;
                    if (hasEnoughBars) {
                        const lookback = Math.min(8, bars.length - 1 - emaPeriod);
                        const recentStart = Math.max(0, bars.length - 1 - lookback);
                        const recentBars = bars.slice(recentStart, bars.length);
                        const contextStart = Math.max(0, bars.length - 1 - 20);
                        const contextBars = bars.slice(contextStart, bars.length);
                        const avgBody = contextBars.reduce((s, b) => s + Math.abs(b.close - b.open), 0) / contextBars.length;
                        if (avgBody > 0) {
                            const climaxRatio = cfg.climax_body_ratio || 2.5;
                            // Find most recent climactic bar WITH the trend
                            let climaxFound = false;
                            let climaxDirection = null;
                            let climaxIdx = -1;
                            for (let j = recentBars.length - 1; j >= 0; j--) {
                                const b = recentBars[j];
                                const body = Math.abs(b.close - b.open);
                                if (body >= avgBody * climaxRatio) {
                                    const barDir = b.close > b.open ? 'bull' : 'bear';
                                    if (trendStateStr.includes('bear') && barDir === 'bear') {
                                        climaxFound = true; climaxDirection = 'bear';
                                        climaxIdx = j; break;
                                    }
                                    if (trendStateStr.includes('bull') && barDir === 'bull') {
                                        climaxFound = true; climaxDirection = 'bull';
                                        climaxIdx = j; break;
                                    }
                                }
                            }
                            if (climaxFound) {
                                const sigDir = signal.direction;
                                const isCounterTrend =
                                    (climaxDirection === 'bear' && sigDir === 'long') ||
                                    (climaxDirection === 'bull' && sigDir === 'short');
                                if (isCounterTrend) {
                                    // Count corrective legs after climax
                                    let correctiveLegs = 0;
                                    let lastSwingDir = climaxDirection;
                                    const realClimaxIdx = recentStart + climaxIdx;
                                    const afterClimax = bars.slice(realClimaxIdx + 1, bars.length);
                                    for (const ab of afterClimax) {
                                        const abd = ab.close > ab.open ? 'bull' : 'bear';
                                        if (abd !== lastSwingDir) {
                                            const abBody = Math.abs(ab.close - ab.open);
                                            const abRange = ab.high - ab.low;
                                            if (abRange > 0 && (abBody / abRange > 0.3 || abRange > avgBody)) {
                                                correctiveLegs++;
                                                lastSwingDir = abd;
                                            }
                                        }
                                    }
                                    if (correctiveLegs < 2) {
                                        pass = false; // HARD REJECT
                                    }
                                }
                            }
                        }
                    }
                }

                // Gate 11: Pullback Quality — Recognized Brooks Type (bit 2048) — soft reject
                // Al Brooks Ch 4: Pullbacks must be one of the recognized types:
                // bar, minor trendline, EMA, EMA gap, major trendline, DT/DB flag, etc.
                if (pass && (gateMask & GATE_BIT.PULLBACK_QUALITY)) {
                    const pbType = signal.pullbackType || signal.metadata?.pullbackType || null;
                    const recognized = [
                        'bar_pullback', 'minor_trendline', 'ema', 'ema_gap',
                        'major_trendline', '2hm', 'wedge_three_push',
                        'double_bottom_bull_flag', 'double_top_bear_flag',
                        'micro_trendline', 'failed_final_flag',
                        'bar', 'minor', 'ema_gap', 'wedge'
                    ];
                    const setupHasLegs =
                        signal.setupType.includes('High 2') ||
                        signal.setupType.includes('Low 2') ||
                        signal.setupType.includes('M2B') ||
                        signal.setupType.includes('M2S');
                    // If no recognized pullback type AND no H2/L2/M2 structure → reject
                    const hasType = pbType && recognized.some(t =>
                        pbType.toLowerCase().includes(t.toLowerCase())
                    );
                    if (!hasType && !setupHasLegs) {
                        // Check barb wire context
                        if (bars.length >= 5) {
                            const checkBars = bars.slice(Math.max(0, bars.length - 5), bars.length);
                            const rangeValues = checkBars.map(bb => bb.high - bb.low);
                            const bodyValues = checkBars.map(bb => Math.abs(bb.close - bb.open));
                            const avgR = rangeValues.reduce((s, v) => s + v, 0) / checkBars.length;
                            const avgBd = bodyValues.reduce((s, v) => s + v, 0) / checkBars.length;
                            if (avgR > 0) {
                                const dojiCount = checkBars.filter((bb, idx) => {
                                    const bd = bodyValues[idx];
                                    const rg = rangeValues[idx];
                                    return rg > 0 && bd / rg < 0.25;
                                }).length;
                                if (dojiCount >= 3 && avgBd / avgR < 0.35) {
                                    pass = false; // Barb wire without clear pullback = reject
                                }
                            }
                        }
                        if (pass) {
                            pass = false; // Unknown pullback type with no structural legs
                        }
                    }
                }

                // Boost: v23-2hm-boost — +5 confidence for 2HM signals (Brooks Ch 4: "2HM is high probability")
                if (pass && version === 'v23-2hm-boost' && signal.pullbackType === '2hm') {
                    signal.confidence = Math.min(100, signal.confidence + 5);
                }

                // Boost: v24-m2-boost — +5 confidence for M2B/M2S signals (Brooks Ch 4: "M2B/M2S is particularly reliable")
                if (pass && version === 'v24-m2-boost' && signal.setupType && (signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S'))) {
                    signal.confidence = Math.min(100, signal.confidence + 5);
                }

                // === NEW: WR Improvement Stack With Distinct Boost Logic ===
                // Each v31-v36 version applies a UNIQUE boost to a specific Brooks pattern.
                // V983-V988 (v31-mid-session-trap-boost through v36-m2-ema-origin-boost)
                // Base: mask=579 (Gates 1,2,7,9), conf=80 baseline

                // V983: v31-mid-session-trap-boost — +10 confidence for mid-session stop-run traps
                // Brooks Ch 4: "11:30 Stop Run Pullback to Trap You Out" — very high probability
                if (pass && version === 'v31-mid-session-trap-boost') {
                    const isTrapSignal = signal.setupType && (
                        signal.setupType.includes('Trap') ||
                        signal.setupType.includes('Stop Run')
                    );
                    if (isTrapSignal) {
                        signal.confidence = Math.min(100, signal.confidence + 10);
                    } else {
                        // Non-trap signals need to hit higher bar — reject if below 85
                        if (signal.confidence < 85) pass = false;
                    }
                }

                // V984: v32-wedge-boost — +8 confidence for wedge/three-push pullbacks
                // Brooks Ch 4: "Three Push Pullbacks" / Wedge — strong reversal pattern
                if (pass && version === 'v32-wedge-boost') {
                    const isWedgeSignal = signal.pullbackType === 'wedge_three_push' ||
                        (signal.setupType && signal.setupType.includes('High 3')) ||
                        (signal.setupType && signal.setupType.includes('Low 3')) ||
                        (signal.setupType && signal.setupType.includes('Three Push'));
                    if (isWedgeSignal) {
                        signal.confidence = Math.min(100, signal.confidence + 15);
                    } else {
                        // Non-wedge signals need higher bar
                        if (signal.confidence < 85) pass = false;
                    }
                }

                // V985: v33-barb-wire-second-boost — +5 confidence for second entries in barb wire
                // Brooks Ch 4: "Barb Wire after climax — second entry is better"
                if (pass && version === 'v33-barb-wire-second-boost') {
                    const isSecondEntry = signal.setupType &&
                        (signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
                         signal.setupType.includes('M2B') || signal.setupType.includes('M2S') ||
                         signal.setupType.includes('Gap 2'));
                    if (isSecondEntry) {
                        signal.confidence = Math.min(100, signal.confidence + 5);
                    }
                    // Check for barb wire context (tight range, multiple dojis)
                    if (bars.length >= 8) {
                        const checkBars = bars.slice(Math.max(0, bars.length - 8), bars.length);
                        const rangeValues = checkBars.map(bb => bb.high - bb.low);
                        const bodyValues = checkBars.map(bb => Math.abs(bb.close - bb.open));
                        const dojiCount = checkBars.filter((bb, idx) => {
                            const rg = rangeValues[idx];
                            return rg > 0 && bodyValues[idx] / rg < 0.25;
                        }).length;
                        if (dojiCount >= 4) {
                            // Barb wire + NOT second entry = reject
                            if (!isSecondEntry && signal.confidence < 88) pass = false;
                        }
                    }
                }

                // V986: v34-measured-move-target — TP = measured move of first leg
                // Brooks Ch 4: "Measured Move" projections from spike-and-channel
                if (pass && version === 'v34-measured-move-target') {
                    // Boost signals that have a clear measured move target (spike + channel)
                    const hasSpikeChannel = signal.setupType &&
                        (signal.setupType.includes('Channel') ||
                         signal.setupType.includes('Spike') ||
                         signal.pullbackType === 'major_trendline');
                    if (hasSpikeChannel) {
                        signal.confidence = Math.min(100, signal.confidence + 5);
                    }
                    // Note: actual TP targeting done in computeVersionedEntry via targetRR=0
                }

                // V987: v35-failed-flag-boost — +10 confidence for failed final flag patterns
                // Brooks Ch 4: "Failed Final Flag" — trap both sides, high probability
                if (pass && version === 'v35-failed-flag-boost') {
                    if (signal.setupType && signal.setupType.includes('Failed Final Flag')) {
                        signal.confidence = Math.min(100, signal.confidence + 10);
                    }
                }

                // V988: v36-m2-ema-origin-boost — +8 confidence for M2B/M2S at EMA
                // Brooks Ch 4: "M2B/M2S at EMA is particularly reliable"
                if (pass && version === 'v36-m2-ema-origin-boost') {
                    const isM2 = signal.setupType && (
                        signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S'));
                    if (isM2) {
                        signal.confidence = Math.min(100, signal.confidence + 8);
                    } else {
                        // Non-M2 signals need stricter bar
                        if (signal.confidence < 85) pass = false;
                    }
                }

                // V996/V997: WR-Stack-All — apply ALL 6 boosts cumulatively
                if (pass && (version === 'v37-wr-stack-all' || version === 'v37-wr-stack-all-conf-85')) {
                    let boostApplied = 0;
                    // Mid-session trap boost
                    if (signal.setupType && signal.setupType.includes('Trap')) {
                        signal.confidence = Math.min(100, signal.confidence + 10);
                        boostApplied++;
                    }
                    // Wedge/three-push boost
                    if (signal.pullbackType === 'wedge_three_push' ||
                        (signal.setupType && (signal.setupType.includes('High 3') || signal.setupType.includes('Low 3')))) {
                        signal.confidence = Math.min(100, signal.confidence + 15);
                        boostApplied++;
                    }
                    // Second entry boost
                    if (signal.setupType && (signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
                        signal.setupType.includes('M2B') || signal.setupType.includes('M2S') || signal.setupType.includes('Gap 2'))) {
                        signal.confidence = Math.min(100, signal.confidence + 5);
                        boostApplied++;
                    }
                    // Measured move boost
                    if (signal.setupType && (signal.setupType.includes('Channel') || signal.setupType.includes('Spike') ||
                        signal.pullbackType === 'major_trendline')) {
                        signal.confidence = Math.min(100, signal.confidence + 5);
                        boostApplied++;
                    }
                    // Failed flag boost
                    if (signal.setupType && signal.setupType.includes('Failed Final Flag')) {
                        signal.confidence = Math.min(100, signal.confidence + 10);
                        boostApplied++;
                    }
                    // M2 at EMA boost
                    if (signal.setupType && (signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S'))) {
                        signal.confidence = Math.min(100, signal.confidence + 8);
                        boostApplied++;
                    }
                    // If no boost applied at all, reject unless confidence is quite high
                    if (boostApplied === 0 && signal.confidence < 83) {
                        pass = false;
                    }
                }

                if (pass) {
                    passingSignals.push({
                        ...signal,
                        timestamp: bar.timestamp || bar.time || new Date().toISOString(),
                        _version: version,
                        _gateMask: gateMask,
                        _confThreshold: confThreshold
                    });
                }
            }

            if (passingSignals.length > 0) {
                // Pick highest confidence for this version
                passingSignals.sort((a, b) => b.confidence - a.confidence);
                versionedResults[version] = passingSignals[0];
            }
        }

        if (Object.keys(versionedResults).length === 0) return null;

        // --- Build per-version entry/exit ---
        const versionedEntries = {};
        let masterSignal = null; // Use the highest-confidence version's signal as master

        for (const [version, signal] of Object.entries(versionedResults)) {
            const entry = computeVersionedEntry(signal, cfg, version);
            if (entry) {
                versionedEntries[version] = entry;
            }
            // Master: pick the version with highest confidence
            if (!masterSignal || signal.confidence > masterSignal.confidence) {
                masterSignal = signal;
            }
        }

        // --- Update pullback tracking from master (best) signal ---
        if (masterSignal) {
            const bestPbType = masterSignal.pullbackType || masterSignal.setupType;
            pt.pullbackTypesFired.add(bestPbType);
            pt.highestConfidenceSinceExtreme = masterSignal.confidence;
            pt.lastSignalTimestamp = masterSignal.timestamp;
            if (masterSignal.setupType.includes('Double Top Bear Flag')) pt.activeDoubleTopBearFlag = true;
            if (masterSignal.setupType.includes('Double Bottom Bull Flag')) pt.activeDoubleBottomBullFlag = true;
        }

        return {
            signal: masterSignal.setupType,
            direction: masterSignal.direction,
            entryPrice: masterSignal.entryPrice,
            stopLoss: masterSignal.stopLoss,
            takeProfit: masterSignal.takeProfit,
            confidence: masterSignal.confidence,
            setupType: masterSignal.setupType,
            pullbackType: masterSignal.pullbackType || null,
            signalBar: masterSignal.signalBar,
            versionedEntries,
            trendState: currentState.state,
            timestamp: masterSignal.timestamp,
            strategy: this.name,
            metadata: masterSignal.metadata || {},
            filters: masterSignal.filters || []
        };
    }

    /**
     * Backtest-compatible evaluation — returns array of versioned signals
     */
    evaluateSignalForBacktest(bar, instrumentConfig, externalTrendState, requestedVersionParam = null) {
        // When called from a wrapper, use the single-version path
        // This ensures each version gets its OWN state, bar history, and pullback tracking
        const result = this.evaluateSignal(bar, instrumentConfig, externalTrendState, requestedVersionParam);
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