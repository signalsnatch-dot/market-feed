/**
 * brooksChapterStrategy.js - Complete Brooks Price Action Strategy
 * 
 * Implements concepts from "Reading Price Charts Bar by Bar" Chapters 1-15:
 *   Ch 1: Price Action Fundamentals (bars, signal bars, setups, entries)
 *   Ch 2: Trendlines & Trend Channels (micro, minor, major, channel lines)
 *   Ch 3: Trends (trend types, signs of strength, state machine)
 *   Ch 4: Pullbacks (classification hierarchy, bar counting, patterns)
 *   Ch 5: Trading Ranges (tight ranges, barb wire, big-up-big-down)
 *   Ch 6: Breakouts (breakout pullbacks, tests, failed breakouts)
 *   Ch 7: Magnets (measured moves, thin/fat areas — informational)
 *   Ch 8: Trend Reversals (TL break→test→reversal sequence)
 *   Ch 9: Minor Reversals (failures, one-tick failed breakouts, traps)
 *   Ch 10: Day Trading (2-reasons rule, stop entry, scalping/swinging)
 *   Ch 11: First Hour (opening reversals, gap patterns, trend from open)
 *   Ch 12: Detailed Examples
 *   Ch 13: Daily/Weekly/Monthly Charts
 *   Ch 14: Options
 *   Ch 15: Best Trades (major reversals, minor scalps, trend pullbacks)
 *   Guidelines: 39 key rules
 * 
 * SELF-CONTAINED: No imports from V2, brooksCoreEngine, or brooksPullbackStrategy.
 * Three independent versions: v1-strict, v2-calibrated, v3-percentage.
 * Mandatory AND-gate filter pipeline: all filters must pass for trade to fire.
 */

// ============================================================================
// MODULE 1: CONFIGURATION LOADER
// ============================================================================

function loadBrooksConfig(instrumentConfig) {
    const defaults = {
        enabled: true,
        // HIGH PROBABILITY VERSIONS ONLY (11 unique)
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
            'v38-tiered-entry',               // 11. TIERED ENTRY: context-dependent stops/targets + per-version signal selection
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
            // NEW V38: Tiered entry — context-dependent stops/targets + per-version selection
            'v38-tiered-entry':         579,  // Same base as v25 but with different entry/stop logic
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
            // V38 TIERED ENTRY: 3-tier system (Bronze/Silver/Gold)
            'v38-tiered-entry':          70,   // Base minimum, but with tiered requirements
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
        // === NEW: Chapter 10 "2 Reasons to Enter" ===
        min_reasons_to_enter: 2,
        doji_body_ratio_threshold: 0.15,     // Default doji threshold
        commodity_doji_body_ratio: 0.20,     // Stricter for commodities (Ch 1, p.15)
        // === NEW: Chapter 11 Opening Reversal ===
        opening_reversal_bars: 6,            // First 30 min on 5-min chart
        // === NEW: Chapter 8 Reversal Sequence ===
        reversal_test_lookback_bars: 20,
        trendline_break_strength_threshold: 0.4,
        // === V38 TIERED ENTRY CONFIG ===
        tiered_entry: {
            enabled: true,
            // Bronze tier (conf 70-79): NO TRADE (observe only)
            bronze_max_conf: 79,
            // Silver tier (conf 80-89): partial position, needs 2+ reasons
            silver_min_conf: 80,
            silver_min_reasons: 2,
            silver_position_scale: 0.50,
            // Gold tier (conf 90-94): full position, needs 2+ reasons
            gold_min_conf: 90,
            gold_min_reasons: 2,
            gold_position_scale: 1.0,
            // Platinum tier (conf 95+): full position + swing, needs 3+ reasons
            platinum_min_conf: 95,
            platinum_min_reasons: 3,
            platinum_position_scale: 1.0,
            // Strong trend context: reduce reason requirement
            strong_trend_with_trend_min_reasons: 1,
            // Countertrend in strong trend: require MORE reasons
            strong_trend_countertrend_min_reasons: 3,
            // Partial profit model: scale out X% at 1R
            partial_profit_ratio: 0.50,    // Scale out 50% at 1R
            partial_profit_rr: 1.0,        // 1R target for partial
            // Swing portion: trail and hold for more
            swing_ratio: 0.20,             // Hold 20% for swing
        },
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
    cfg.tiered_entry = { ...defaults.tiered_entry, ...(cfg.tiered_entry || {}) };
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

function classifyBar(bar, medianBody, dojiRatio) {
    const body = Math.abs(bar.close - bar.open);
    const range = bar.high - bar.low;
    if (range === 0) return BAR_TYPE.DOJI;

    const bodyRatio = body / range;
    const isBull = bar.close > bar.open;
    const isBear = bar.close < bar.open;

    // Doji: configurable threshold (stricter for commodities per Ch 1, p.15)
    const dojiThreshold = dojiRatio || 0.15;
    if (bodyRatio < dojiThreshold || body === 0) {
        return BAR_TYPE.DOJI;
    }

    // Exhaustion: extremely large body relative to median
    if (medianBody && medianBody > 0 && body > medianBody * 2.5) {
        return BAR_TYPE.EXHAUSTION;
    }

    // Shaved bars (Ch 1, p.21)
    if (isBull && bar.low === bar.open && bar.high === bar.close) {
        return BAR_TYPE.SHAVED_BULL;
    }
    if (isBear && bar.high === bar.open && bar.low === bar.close) {
        return BAR_TYPE.SHAVED_BEAR;
    }

    // Reversal bars (Ch 1, p.13-14)
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
// MODULE 7: PATTERN DETECTORS (Chapters 1-15)
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
    // Brooks Ch 4: H2/L2 is the END of a two-legged correction. The
    // signal bar is THE CURRENT BAR completing the second leg. Not a bar
    // found by scanning back through history for the first High2/Low2.
    if (bars.length < 5) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];       // CURRENT BAR — must be the signal bar
    const prevBar = bars[latestIdx - 1];
    const ema = emaSeries[latestIdx];

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';

    // --- Step 1: Verification — is the CURRENT bar a High 2 (bull) or Low 2 (bear)? ---
    // Ch 4: "the first bar whose high is above the high of the prior bar is a High 1 …
    // the next occurrence is a High 2"
    const isHigh2Signal =
        direction === 'long' &&
        bar.high > prevBar.high;   // current bar's high breaks prior bar's high = High 2
    const isLow2Signal =
        direction === 'short' &&
        bar.low < prevBar.low;     // current bar's low breaks prior bar's low = Low 2

    if (!isHigh2Signal && !isLow2Signal) return { detected: false };

    // --- Step 2: Confirm a real two-legged correction ENDS at this bar ---
    // Find the most recent trend extreme (HH in bull, LL in bear) BEFORE this bar.
    // The pullback starts from that extreme.
    const swings = state.swings || [];
    const extremeSwings = swings.filter(s =>
        (isBullTrend && s.type === 'high') || (isBearTrend && s.type === 'low')
    );

    // Take the swing extreme AT or BEFORE (latestIdx - 1) — cannot be the current bar
    const priorExtremes = extremeSwings.filter(s => s.index < latestIdx);
    if (priorExtremes.length === 0) return { detected: false };
    const pullbackStart = priorExtremes[priorExtremes.length - 1].index;

    // Now check: from pullbackStart to latestIdx, does the current bar
    // represent a High 2 / Low 2 (second attempt to end the correction)?
    const checkDirection = direction === 'long' ? 'bull' : 'bear';
    const counter = countHighLow(bars, pullbackStart, checkDirection);

    // The CURRENT bar must be the SECOND occurrence (High 2 / Low 2),
    // NOT a High 1 and NOT a High 3+.
    if (counter.totalLegs < 2) return { detected: false };
    const lastHL = counter.results[counter.results.length - 1];
    if (lastHL.index !== latestIdx) return { detected: false };
    if (lastHL.count !== 2) return { detected: false };

    // --- Step 3: Validate trendline break between leg 1 and leg 2 ---
    const leg1 = counter.results[0];
    const leg2 = counter.results[1];
    if (cfg.require_trendline_break_for_H2L2) {
        const trendlineBroken = hasTrendlineBreakBetween(bars, leg1.index, leg2.index, swings);
        if (!trendlineBroken) return { detected: false };
    }

    // --- Step 4: Signal bar = CURRENT BAR ---
    const signalBar = bar;
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
        metadata: { legAnalysis: { leg1, leg2, totalLegs: counter.totalLegs } }
    };
}

function detectEMAPullback(bars, emaSeries, state, cfg) {
    // Pullback reaches EMA — M2B/M2S (if second entry at EMA)
    // Brooks Ch 4: The signal bar is THE CURRENT BAR, which must be both:
    // (a) at/touching the EMA, AND (b) a High 2 (bull) or Low 2 (bear)
    // that completes a two-legged correction.
    if (bars.length < cfg.ema_period + 5) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];       // CURRENT BAR — must be the signal bar
    const prevBar = bars[latestIdx - 1];
    const ema = emaSeries[latestIdx];
    if (ema === null) return { detected: false };

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';

    // --- Step 1: EMA touch by CURRENT bar ---
    const emaTouch = Math.abs(bar.low - ema) / ema < 0.002 ||
        Math.abs(bar.high - ema) / ema < 0.002 ||
        Math.abs(bar.close - ema) / ema < 0.002;
    if (!emaTouch) return { detected: false };

    // --- Step 2: Is CURRENT bar the second entry (High 2 / Low 2)? ---
    const isHigh2Signal =
        direction === 'long' && bar.high > prevBar.high;
    const isLow2Signal =
        direction === 'short' && bar.low < prevBar.low;
    if (!isHigh2Signal && !isLow2Signal) return { detected: false };

    // --- Step 3: Verify a two-legged correction from the last trend extreme ---
    const swings = state.swings || [];
    const extremeSwings = swings.filter(s =>
        (isBullTrend && s.type === 'high') || (isBearTrend && s.type === 'low')
    );
    const priorExtremes = extremeSwings.filter(s => s.index < latestIdx);
    if (priorExtremes.length === 0) return { detected: false };
    const pullbackStart = priorExtremes[priorExtremes.length - 1].index;

    const checkDirection = direction === 'long' ? 'bull' : 'bear';
    const counter = countHighLow(bars, pullbackStart, checkDirection);

    if (counter.totalLegs < 2) return { detected: false };
    const lastHL = counter.results[counter.results.length - 1];
    if (lastHL.index !== latestIdx) return { detected: false };
    if (lastHL.count !== 2) return { detected: false };

    // --- Step 4: Signal bar = CURRENT BAR ---
    const signalBar = bar;
    const leg1 = counter.results[0];
    const leg2 = counter.results[1];

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
        metadata: { legAnalysis: { leg1, leg2, totalLegs: counter.totalLegs }, emaTouch }
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
    // Brooks Ch 4: Double Bottom Bull Flag — the second bottom is found
    // via swing detection, but the SIGNAL is the CURRENT BAR confirming
    // the flag resolution by breaking above the intermediate swing high
    // between the two bottoms.
    if (bars.length < 8) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];       // CURRENT BAR — must be the confirmation bar

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

    // --- Step 1: Find the intermediate swing high between low1 and low2 ---
    // Double Bottom Bull Flag: market rallies from low1 to a swing high,
    // then sells off again to low2 (near low1). The signal bar is the CURRENT
    // BAR which must BREAK ABOVE that intermediate swing high.
    const barsBetween = bars.slice(low1.index + 1, low2.index);
    if (barsBetween.length < 1) return { detected: false };
    
    // Find the highest high between the two lows (the flag's high)
    const highBetween = Math.max(...barsBetween.map(b => b.high));
    const highBarIndex = low1.index + 1 + barsBetween.findIndex(b => b.high === highBetween);

    // --- Step 2: Current bar must break above the intermediate high ---
    // The flag is confirmed when price breaks above the rally high between
    // the two bottoms. The current bar must close above this level.
    if (bar.high <= highBetween) return { detected: false };
    if (bar.close <= highBetween) return { detected: false };

    // --- Step 3: Signal bar = CURRENT BAR ---
    // Entry = 1 tick above current bar's high (fresh signal)
    // Stop = 1 tick below low2 (the support level — Ch 4, p.104-105)
    const signalBar = bar;
    const entryPrice = signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = low2.bar.low - cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: 'Double Bottom Bull Flag',
        direction: 'long',
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 85,
        signalBar,
        metadata: { low1, low2, tolerance, priceDiff, highBetween, highBarIndex }
    };
}

function detectDoubleTopBearFlag(bars, emaSeries, state, cfg) {
    // Two near-equal highs in a bear pullback
    // Brooks Ch 4: Double Top Bear Flag — the second top is found
    // via swing detection, but the SIGNAL is the CURRENT BAR confirming
    // the flag resolution by breaking below the intermediate swing low
    // between the two tops.
    if (bars.length < 8) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];       // CURRENT BAR — must be the confirmation bar

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

    // --- Step 1: Find the intermediate swing low between high1 and high2 ---
    // Double Top Bear Flag: market sells off from high1 to a swing low,
    // then rallies again to high2 (near high1). The signal bar is the CURRENT
    // BAR which must BREAK BELOW that intermediate swing low.
    const barsBetween = bars.slice(high1.index + 1, high2.index);
    if (barsBetween.length < 1) return { detected: false };
    
    // Find the lowest low between the two highs (the flag's low)
    const lowBetween = Math.min(...barsBetween.map(b => b.low));
    const lowBarIndex = high1.index + 1 + barsBetween.findIndex(b => b.low === lowBetween);

    // --- Step 2: Current bar must break below the intermediate low ---
    // The flag is confirmed when price breaks below the selloff low between
    // the two tops. The current bar must close below this level.
    if (bar.low >= lowBetween) return { detected: false };
    if (bar.close >= lowBetween) return { detected: false };

    // --- Step 3: Signal bar = CURRENT BAR ---
    // Entry = 1 tick below current bar's low (fresh signal)
    // Stop = 1 tick above high2 (the resistance level — Ch 4, p.105)
    const signalBar = bar;
    const entryPrice = signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = high2.bar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: 'Double Top Bear Flag',
        direction: 'short',
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 85,
        signalBar,
        metadata: { high1, high2, tolerance, priceDiff, lowBetween, lowBarIndex }
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
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
    const barType = classifyBar(bar, medianBody(bars, 10), dojiThreshold);

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
    // Brooks Ch 4: Three Push / Wedge — the third push completes at the CURRENT BAR
    // Signal bar = CURRENT BAR (High 3 or Low 3)
    if (bars.length < 8) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];       // CURRENT BAR — must be the signal bar
    const prevBar = bars[latestIdx - 1];

    const trendState = state.state;
    const isBullTrend = trendState.includes('bull');
    const isBearTrend = trendState.includes('bear');
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'long' : 'short';

    // --- Step 1: Is CURRENT bar the THIRD push (High 3 / Low 3)? ---
    const swings = state.swings || [];
    const extremeSwings = swings.filter(s =>
        (isBullTrend && s.type === 'high') || (isBearTrend && s.type === 'low')
    );
    const priorExtremes = extremeSwings.filter(s => s.index < latestIdx);
    if (priorExtremes.length === 0) return { detected: false };
    const pullbackStart = priorExtremes[priorExtremes.length - 1].index;

    const checkDirection = direction === 'long' ? 'bull' : 'bear';
    const counter = countHighLow(bars, pullbackStart, checkDirection);

    if (counter.totalLegs < 3) return { detected: false };
    const lastHL = counter.results[counter.results.length - 1];
    if (lastHL.index !== latestIdx) return { detected: false };
    if (lastHL.count !== 3) return { detected: false };

    // --- Step 2: Check if third push is shrinking (wedge) ---
    const push1 = counter.results[0];
    const push3 = counter.results[2];
    const range1 = Math.abs(push1.bar.high - push1.bar.low);
    const range3 = Math.abs(push3.bar.high - push3.bar.low);
    const isShrinking = range3 < range1 * 0.8;

    // --- Step 3: Signal bar = CURRENT BAR ---
    const signalBar = bar;

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
        confidence: isShrinking ? 88 : 78,
        signalBar,
        pullbackType: 'wedge_three_push',
        metadata: { threePush: { pushes: [push1, counter.results[1], push3], isShrinking } }
    };
}

// ---- Chapter 1: Failed Reversal = Opposite Setup ----

function detectFailedReversal(bars, emaSeries, state, cfg) {
    // Brooks Ch 1: "Failed Bear Reversal in Strong Bull → Long"
    // A bear reversal bar is attempted but fails; the NEXT bar confirms the failure.
    // Signal bar = CURRENT BAR that confirms the failure.
    // Entry = above the failed reversal bar's high (not above current bar's high).
    if (bars.length < 4) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];       // CURRENT BAR — confirms failure
    const prevBar = bars[latestIdx - 1]; // Attempted reversal bar
    const barBeforePrev = bars[latestIdx - 2];

    const trendState = state.state;
    const isStrongBull = trendState === TREND_STATE.BULL_TREND_STRONG;
    const isStrongBear = trendState === TREND_STATE.BEAR_TREND_STRONG;
    if (!isStrongBull && !isStrongBear) return { detected: false };

    // The PREVIOUS bar is the attempted reversal bar; CURRENT bar confirms failure
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
    const prevType = classifyBar(prevBar, medianBody(bars.slice(0, latestIdx), 10), dojiThreshold);

    // FAILED BEAR REVERSAL IN STRONG BULL → LONG
    // prevBar was bear reversal or doji attempt, current bar closes above prevBar's close
    if (isStrongBull && (prevType === BAR_TYPE.REVERSAL_BEAR || prevType === BAR_TYPE.DOJI) && bar.close > prevBar.close) {
        // Entry = 1 tick above the FAILED reversal bar's high (not current bar's high)
        // Stop = 1 tick below the failed reversal bar's low
        const entryPrice = prevBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05;
        return {
            detected: true,
            setupType: 'Failed Bear Reversal → Long',
            direction: 'long',
            entryPrice,
            stopLoss: prevBar.low - cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 82,
            signalBar: bar,             // CURRENT BAR is the signal bar
            metadata: { prevType, reason: 'failed_reversal_bear_in_bull', failedBar: prevBar }
        };
    }

    // FAILED BULL REVERSAL IN STRONG BEAR → SHORT
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
            signalBar: bar,             // CURRENT BAR is the signal bar
            metadata: { prevType, reason: 'failed_reversal_bull_in_bear', failedBar: prevBar }
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
    // Brooks Ch 3: Trend Resumption Day — sideways midday action,
    // then breakout in original trend direction.
    // Entry = CURRENT BAR completing a High 2 / Low 2 pullback after
    // the trend resumption state is triggered.
    if (bars.length < 15) return { detected: false };

    const trendState = state.state;
    const isBullResumption = trendState === TREND_STATE.TREND_RESUMPTION_BULL;
    const isBearResumption = trendState === TREND_STATE.TREND_RESUMPTION_BEAR;
    if (!isBullResumption && !isBearResumption) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];       // CURRENT BAR — must be the signal bar
    const prevBar = bars[latestIdx - 1];
    const ema = emaSeries[latestIdx];
    const direction = isBullResumption ? 'long' : 'short';

    // --- Step 1: Is CURRENT bar a High 2 / Low 2? ---
    const isHigh2Signal =
        direction === 'long' && bar.high > prevBar.high;
    const isLow2Signal =
        direction === 'short' && bar.low < prevBar.low;
    if (!isHigh2Signal && !isLow2Signal) return { detected: false };

    // --- Step 2: Verify a two-legged correction from a recent extreme ---
    const swings = state.swings || [];
    const extremeSwings = swings.filter(s =>
        (isBullResumption && s.type === 'high') || (isBearResumption && s.type === 'low')
    );
    const priorExtremes = extremeSwings.filter(s => s.index < latestIdx);
    if (priorExtremes.length === 0) return { detected: false };
    const pullbackStart = priorExtremes[priorExtremes.length - 1].index;

    const checkDirection = direction === 'long' ? 'bull' : 'bear';
    const counter = countHighLow(bars, pullbackStart, checkDirection);

    if (counter.totalLegs < 2) return { detected: false };
    const lastHL = counter.results[counter.results.length - 1];
    if (lastHL.index !== latestIdx) return { detected: false };
    if (lastHL.count !== 2) return { detected: false };

    // --- Step 3: Signal bar = CURRENT BAR ---
    const signalBar = bar;
    const leg1 = counter.results[0];
    const leg2 = counter.results[1];

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
        metadata: { legAnalysis: { leg1, leg2, totalLegs: counter.totalLegs } }
    };
}

// ============================================================================
// MODULE 8: MAJOR PATTERN DETECTORS (NEW — Chapters 5-11 Concepts)
// ============================================================================

// ---- Chapter 1: Apply strict Brooks PDF-based filters ----
// These codify 7 critical Brooks concepts plus the NEW "2 Reasons" rule (Ch 10, p.275-276)
function applyBrooksStrictFilters(signal, bars, emaSeries, state, cfg, gateMask) {
    const failures = [];
    const reasons = [];  // COUNT of positive reasons for entry (Ch 10: "need 2 reasons")
    const latestIdx = bars.length - 1;
    const sigBar = signal.signalBar;
    if (!sigBar || latestIdx < 0) return { pass: true, reasons: [] };

    const trendState = state.state;
    const isStrongBull = trendState === 'bull_trend_strong';
    const isStrongBear = trendState === 'bear_trend_strong';
    const isStrongTrend = isStrongBull || isStrongBear;
    const direction = signal.direction;
    const isWithTrend = (direction === 'long' && (isStrongBull || trendState.includes('bull'))) ||
        (direction === 'short' && (isStrongBear || trendState.includes('bear')));

    // Get signal bar classification
    const sigMedBody = medianBody(bars, 10);
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
    const sigType = classifyBar(sigBar, sigMedBody, dojiThreshold);
    const sigBody = Math.abs(sigBar.close - sigBar.open);
    const sigRange = sigBar.high - sigBar.low;
    const ema = emaSeries[latestIdx];

    // ===== CHAPTER 10 (p.275-276): "Need 2 Reasons to Enter" =====
    // Brooks: "You need two reasons to take a With Trend trade or any trade in a trading range day."
    // 
    // Reason 1: Trend bar / reversal bar in entry direction (Ch 1, p.11)
    // Reason 2: EMA touch or gap bar (Ch 4, p.108-110)
    // Reason 3: Second entry (H2/L2) (Ch 4, p.118-126)
    // Reason 4: Prior trendline break for countertrend (Ch 8, p.175-184)
    // Reason 5: Failed breakout / trap pattern (Ch 9, p.221-226)
    // Reason 6: Wedge/three-push structure (Ch 4, p.131-135)
    // Reason 7: Strong trend state (Ch 3) — for With Trend only
    // Reason 8: Trading range reversal — small bar at extreme (Ch 5, p.137-148)
    // Reason 9: Opening reversal (Ch 11, p.313-317)
    // Reason 10: Double Top/Bottom Flag pattern

    const validReasons = [];

    // Reason 1: Trend bar / reversal bar in direction
    const isTrendBarInDirection = (direction === 'long') ?
        (sigType === 'trend_bull' || sigType === 'reversal_bull' || sigType === 'shaved_bull') :
        (sigType === 'trend_bear' || sigType === 'reversal_bear' || sigType === 'shaved_bear');
    if (isTrendBarInDirection) {
        validReasons.push('trend_bar_in_direction');
        reasons.push('trend_bar_in_direction');
    }

    // Reason 2: EMA touch or gap bar
    if (ema !== null) {
        const touchesEMA = Math.abs(sigBar.low - ema) / ema < 0.002 ||
            Math.abs(sigBar.high - ema) / ema < 0.002;
        if (touchesEMA) {
            validReasons.push('ema_touch');
            reasons.push('ema_touch');
        }
        // EMA gap
        if ((direction === 'long' && sigBar.high < ema) ||
            (direction === 'short' && sigBar.low > ema)) {
            validReasons.push('ema_gap');
            reasons.push('ema_gap');
        }
    }

    // Reason 3: Second entry (H2/L2 or M2B/M2S)
    const isSecondEntry = signal.setupType && (
        signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
        signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S') ||
        signal.setupType.includes('Gap 2')
    );
    if (isSecondEntry) {
        validReasons.push('second_entry');
        reasons.push('second_entry');
    }

    // Reason 4: Trendline break for countertrend
    if (isStrongBull && direction === 'short') {
        const bearTL = state.bearTL || null;
        const hasTLBreak = bearTL && detectTrendlineBreak(bearTL, sigBar, bars.indexOf(sigBar)).broken;
        if (hasTLBreak) {
            validReasons.push('trendline_break');
            reasons.push('trendline_break');
        }
    }
    if (isStrongBear && direction === 'long') {
        const bullTL = state.bullTL || null;
        const hasTLBreak = bullTL && detectTrendlineBreak(bullTL, sigBar, bars.indexOf(sigBar)).broken;
        if (hasTLBreak) {
            validReasons.push('trendline_break');
            reasons.push('trendline_break');
        }
    }

    // Reason 5: Failed breakout / trap pattern
    const isTrap = signal.setupType && (
        signal.setupType.includes('Trap') || signal.setupType.includes('Failed Final Flag') ||
        signal.setupType.includes('Outside Bar')
    );
    if (isTrap) {
        validReasons.push('trap_pattern');
        reasons.push('trap_pattern');
    }

    // Reason 6: Wedge/three-push structure
    const isWedge = signal.pullbackType === 'wedge_three_push' ||
        (signal.setupType && (signal.setupType.includes('High 3') || signal.setupType.includes('Low 3')));
    if (isWedge) {
        validReasons.push('wedge_three_push');
        reasons.push('wedge_three_push');
    }

    // Reason 7: Strong trend state (With Trend only)
    if (isWithTrend && isStrongTrend) {
        validReasons.push('strong_trend');
        reasons.push('strong_trend');
    }

    // Reason 8: Trading range reversal — small bar at extreme (Ch 5, p.143-144)
    if (trendState === TREND_STATE.TRADING_RANGE || trendState === TREND_STATE.UNDEFINED) {
        const barType = classifyBar(sigBar, sigMedBody, dojiThreshold);
        const isSmallBar = sigRange > 0 && sigRange < sigMedBody * 0.5;
        if (isSmallBar && (barType === BAR_TYPE.REVERSAL_BULL || barType === BAR_TYPE.REVERSAL_BEAR)) {
            validReasons.push('range_reversal');
            reasons.push('range_reversal');
        }
    }

    // Reason 9: Opening reversal (Ch 11, p.313-317) — first hour signal
    const barTime = sigBar.timestamp || sigBar.time || '';
    if (barTime) {
        try {
            const barDate = new Date(barTime);
            const minsSinceOpen = barDate.getUTCHours() * 60 + barDate.getUTCMinutes();
            const openBarCount = cfg.opening_reversal_bars || 6;
            const isFirstHour = bars.length <= openBarCount && minsSinceOpen < 90;
            if (isFirstHour) {
                validReasons.push('opening_hour');
                reasons.push('opening_hour');
            }
        } catch (e) {
            // Ignore time parse errors
        }
    }

    // Reason 10: Double Top/Bottom Flag pattern
    const isFlagPattern = signal.setupType && (
        signal.setupType.includes('Double Top') || signal.setupType.includes('Double Bottom') ||
        signal.setupType.includes('2HM')
    );
    if (isFlagPattern) {
        validReasons.push('flag_pattern');
        reasons.push('flag_pattern');
    }

    // ===== V38 TIERED ENTRY: CONTEXT-DEPENDENT REASON REQUIREMENTS =====
    // Brooks (Ch 10, p.275-276):
    //   - Strong trend + With Trend: 1 reason (trend bar is enough)
    //   - Strong trend + Countertrend: 3 reasons (TL break + reversal bar + second entry)
    //   - Trading range: 2 reasons
    //   - Weakening trend: 2 reasons
    const teCfg = cfg.tiered_entry || {};
    let contextMinReasons = teCfg.silver_min_reasons || 2; // Default: 2
    
    if (isStrongTrend && isWithTrend) {
        // Strong trend + With Trend: only need 1 reason
        contextMinReasons = teCfg.strong_trend_with_trend_min_reasons || 1;
        // Add "strong_trend" as an auto-reason for With Trend
        if (!validReasons.includes('strong_trend')) {
            validReasons.push('strong_trend');
            reasons.push('strong_trend');
        }
    } else if (isStrongTrend && !isWithTrend) {
        // Strong trend + Countertrend: need 3 reasons
        contextMinReasons = teCfg.strong_trend_countertrend_min_reasons || 3;
    }

    // Apply context-dependent minimum reasons
    if (validReasons.length < contextMinReasons) {
        failures.push(`need_${contextMinReasons}_reasons_have_${validReasons.length}`);
    }

    // ===== CHAPTER 1 (p.11): Trend bar check =====
    if (!isTrendBarInDirection) {
        failures.push('not_a_trend_bar');
    }

    // ===== CHAPTER 1 (p.15): Doji rejection =====
    if (sigType === 'doji') {
        failures.push('doji_signal_bar');
    }

    // ===== CHAPTER 1 (p.14-15): Reversal bar overlap =====
    if ((sigType === 'reversal_bull' || sigType === 'reversal_bear') && bars.length >= 2) {
        const prevIdx = bars.indexOf(sigBar) - 1;
        if (prevIdx >= 0) {
            const prevBar = bars[prevIdx];
            const overlapLow = Math.max(sigBar.low, prevBar.low);
            const overlapHigh = Math.min(sigBar.high, prevBar.high);
            if (overlapHigh > overlapLow) {
                const overlapPct = (overlapHigh - overlapLow) / sigRange;
                if (overlapPct > 0.7) {
                    failures.push('reversal_bar_excessive_overlap');
                }
            }
        }
    }

    // ===== CHAPTER 1 (p.14): Countertrend needs trendline break =====
    if (isStrongBull && direction === 'short') {
        const bearTL = state.bearTL || null;
        const hasTLBreak = bearTL && detectTrendlineBreak(bearTL, sigBar, bars.indexOf(sigBar)).broken;
        if (!hasTLBreak) {
            failures.push('countertrend_no_trendline_break');
        }
    }
    if (isStrongBear && direction === 'long') {
        const bullTL = state.bullTL || null;
        const hasTLBreak = bullTL && detectTrendlineBreak(bullTL, sigBar, bars.indexOf(sigBar)).broken;
        if (!hasTLBreak) {
            failures.push('countertrend_no_trendline_break');
        }
    }

    // ===== CHAPTER 1 (p.46-48): Second entry preference in strong trends =====
    if (isStrongTrend) {
        const isFirstEntry = signal.setupType && (
            signal.setupType.includes('High 1') || signal.setupType.includes('Low 1') ||
            signal.setupType === 'High 1 (Micro TL)' || signal.setupType === 'Low 1 (Micro TL)'
        );
        if (isFirstEntry) {
            failures.push('first_entry_in_strong_trend');
        }
    }

    // ===== CHAPTER 1 (p.36-38): Outside bar rejection =====
    const prevSigIdx = bars.indexOf(sigBar) - 1;
    if (prevSigIdx >= 0 && sigRange > 0) {
        const prevToSig = bars[prevSigIdx];
        const isOutside = sigBar.high > prevToSig.high && sigBar.low < prevToSig.low;
        if (isOutside) {
            failures.push('outside_bar_signal');
        }
    }

    // ===== CHAPTER 1 (p.21): Exhaustion/climax rejection =====
    const isExhaustion = sigType === 'exhaustion' ||
        (sigMedBody > 0 && sigBody > sigMedBody * (cfg.climax_body_ratio || 2.5));
    if (isExhaustion) {
        failures.push('exhaustion_signal_bar');
    }

    return {
        pass: failures.length === 0,
        reasons: failures,
        reasonCount: validReasons.length,
        validReasons
    };
}

// ---- NEW: Chapter 8 — Proper Reversal Sequence (TL break → test of extreme → reversal bar) ----
// Brooks Ch 8 (p.175-184): "Never even be thinking about trading against a trend until after
// there has been a break of a significant trendline. Wait for the TL break, then see if the test
// of the old extreme reverses or if the old trend resumes."
function detectMajorReversalSequence(bars, emaSeries, state, cfg) {
    if (bars.length < 15) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const trendState = state.state;
    const swings = state.swings || [];

    // Only look for reversal sequences in strong trends or reversal_transition state
    const isBullTrend = trendState === TREND_STATE.BULL_TREND_STRONG || 
                        trendState === TREND_STATE.REVERSAL_TRANSITION;
    const isBearTrend = trendState === TREND_STATE.BEAR_TREND_STRONG || 
                        trendState === TREND_STATE.REVERSAL_TRANSITION;
    if (!isBullTrend && !isBearTrend) return { detected: false };

    const direction = isBullTrend ? 'short' : 'long'; // Countertrend direction
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
    const sigType = classifyBar(bar, medianBody(bars, 10), dojiThreshold);

    // --- Step 1: Find the most recent trendline break ---
    // Look back for a trendline break with sufficient momentum
    const lookbackBars = cfg.reversal_test_lookback_bars || 20;
    const searchStart = Math.max(0, latestIdx - lookbackBars);
    let trendlineBreakFound = false;
    let trendlineBreakBarIdx = -1;

    for (let i = latestIdx; i >= searchStart; i--) {
        const checkBar = bars[i];
        if (isBullTrend) {
            // In bull trend, looking for bear TL break (strong down move)
            if (state.bearTL) {
                const breakResult = detectTrendlineBreak(state.bearTL, checkBar, i);
                if (breakResult.broken && breakResult.momentum >= (cfg.trendline_break_strength_threshold || 0.4)) {
                    trendlineBreakFound = true;
                    trendlineBreakBarIdx = i;
                    break;
                }
            }
        } else {
            // In bear trend, looking for bull TL break (strong up move)
            if (state.bullTL) {
                const breakResult = detectTrendlineBreak(state.bullTL, checkBar, i);
                if (breakResult.broken && breakResult.momentum >= (cfg.trendline_break_strength_threshold || 0.4)) {
                    trendlineBreakFound = true;
                    trendlineBreakBarIdx = i;
                    break;
                }
            }
        }
    }

    if (!trendlineBreakFound) return { detected: false };

    // --- Step 2: Verify that the market TESTED the old extreme AFTER the TL break ---
    // In a bull reversal: after TL break, market should have rallied back up to test the old high
    // In a bear reversal: after TL break, market should have sold off to test the old low
    const afterBreakBars = bars.slice(trendlineBreakBarIdx + 1, latestIdx + 1);
    if (afterBreakBars.length < 3) return { detected: false };

    let testFound = false;
    let testType = null; // 'overshoot' (higher high) or 'undershoot' (lower high)

    if (isBullTrend) {
        // Check if market tested old high range after bear trendline break
        const oldHighs = swings.filter(s => s.type === 'high').slice(-3);
        if (oldHighs.length > 0) {
            const highestOldHigh = Math.max(...oldHighs.map(s => s.price));
            const testBar = afterBreakBars[afterBreakBars.length - 1];
            if (testBar.high >= highestOldHigh * 0.997) {
                testFound = true;
                testType = testBar.high > highestOldHigh ? 'overshoot' : 'undershoot';
            }
        }
    } else {
        // Check if market tested old low range after bull trendline break
        const oldLows = swings.filter(s => s.type === 'low').slice(-3);
        if (oldLows.length > 0) {
            const lowestOldLow = Math.min(...oldLows.map(s => s.price));
            const testBar = afterBreakBars[afterBreakBars.length - 1];
            if (testBar.low <= lowestOldLow * 1.003) {
                testFound = true;
                testType = testBar.low < lowestOldLow ? 'overshoot' : 'undershoot';
            }
        }
    }

    if (!testFound) return { detected: false };

    // --- Step 3: Current bar must be a STRONG reversal bar at/near the test ---
    // The reversal bar must show conviction in the Countertrend direction
    const isReversalBar = (direction === 'long') ?
        (sigType === 'reversal_bull' || sigType === 'shaved_bull' || sigType === 'trend_bull') :
        (sigType === 'reversal_bear' || sigType === 'shaved_bear' || sigType === 'trend_bear');

    if (!isReversalBar) return { detected: false };

    // Check that the reversal bar's body is reasonably sized (at least 30% of range)
    const body = Math.abs(bar.close - bar.open);
    const range = bar.high - bar.low;
    if (range === 0 || body / range < 0.3) return { detected: false };

    // --- Step 4: Build signal ---
    const signalBar = bar;
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: direction === 'long'
            ? 'Major Reversal: TL Break → Test → Bull Reversal'
            : 'Major Reversal: TL Break → Test → Bear Reversal',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 90,
        signalBar,
        pullbackType: 'major_reversal_sequence',
        metadata: {
            trendlineBreakIdx: trendlineBreakBarIdx,
            testType,
            reversalType: sigType
        }
    };
}

// ---- NEW: Chapter 5 — Trading Range Breakout Fade ----
// Brooks Ch 5 (p.137-148): "Never enter on a breakout of an outside bar [or tight range].
// Fade the first clear breakout trend bar."
function detectRangeBreakoutFade(bars, emaSeries, state, cfg) {
    if (bars.length < 10) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const prevBar = bars[latestIdx - 1];
    const trendState = state.state;

    // Only look in trading ranges or weakening trends
    const isRangeOrSideways = trendState === TREND_STATE.TRADING_RANGE ||
        trendState === TREND_STATE.UNDEFINED ||
        trendState.includes('weakening');
    if (!isRangeOrSideways) return { detected: false };

    // --- Step 1: Detect tight trading range (Barb Wire pattern) ---
    const lookback = Math.min(8, bars.length - 1);
    const recentBars = bars.slice(-lookback);
    const ranges = recentBars.map(b => b.high - b.low);
    const bodies = recentBars.map(b => Math.abs(b.close - b.open));
    const maxRange = Math.max(...ranges);
    const minRange = Math.min(...ranges);
    const avgRange = ranges.reduce((s, v) => s + v, 0) / ranges.length;

    // Check for tight range (maxRange not much bigger than minRange)
    const isTightRange = avgRange > 0 && (maxRange - minRange) / avgRange < 0.8;
    if (!isTightRange) return { detected: false };

    // Count dojis in the range
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
    const dojiCount = recentBars.filter((b, idx) => {
        const rg = ranges[idx];
        return rg > 0 && bodies[idx] / rg < dojiThreshold;
    }).length;

    if (dojiCount < 3) return { detected: false }; // Need at least 3 dojis for Barb Wire

    // --- Step 2: Current bar must be a BREAKOUT bar from the tight range ---
    const rangeHigh = Math.max(...recentBars.map(b => b.high));
    const rangeLow = Math.min(...recentBars.map(b => b.low));
    const breakoutUp = bar.high > rangeHigh && bar.close > bar.open; // Bull breakout
    const breakoutDown = bar.low < rangeLow && bar.close < bar.open; // Bear breakout

    if (!breakoutUp && !breakoutDown) return { detected: false };

    // Check breakout bar is a strong trend bar
    const sigType = classifyBar(bar, medianBody(bars, 10), dojiThreshold);
    const isStrongBar = breakoutUp ?
        (sigType === 'trend_bull' || sigType === 'shaved_bull') :
        (sigType === 'trend_bear' || sigType === 'shaved_bear');
    if (!isStrongBar) return { detected: false };

    // --- Step 3: Fade direction = OPPOSITE to the breakout ---
    // Brooks Ch 5: "fade the first clear breakout trend bar"
    // Entry: 1 tick beyond the OPPOSITE side of the breakout bar
    const direction = breakoutUp ? 'short' : 'long'; // FADE direction

    // For a bull breakout fade (short): entry = 1 tick below breakout bar's low
    // For a bear breakout fade (long): entry = 1 tick above breakout bar's high
    const entryPrice = direction === 'long'
        ? bar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : bar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? bar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : bar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    return {
        detected: true,
        setupType: breakoutUp
            ? 'Range Breakout Fade (Bull Breakout → Short)'
            : 'Range Breakout Fade (Bear Breakout → Long)',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: 80,
        signalBar: bar,
        pullbackType: 'range_fade',
        metadata: {
            breakoutDirection: breakoutUp ? 'up' : 'down',
            rangeHigh,
            rangeLow,
            avgRange,
            dojiCount
        }
    };
}

// ---- NEW: Chapter 9 — One-Tick Failed Breakout & Breakout Pullback Chain ----
// Brooks Ch 9 (p.221-226): "One-Tick Failure is a reliable sign that the market is going the other way."
// Also Ch 6 (p.158-163): "The failure can fail, resulting in a resumption of the original move."
function detectBreakoutFailureChain(bars, emaSeries, state, cfg) {
    if (bars.length < 6) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const prevBar = bars[latestIdx - 1];
    const bar2Back = bars[latestIdx - 2];

    const trendState = state.state;
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;

    // --- Step 1: Look for one-tick failed breakout (Ch 9, p.222-226) ---
    // A one-tick failure occurs when the market pokes 1 tick beyond a prior bar's extreme
    // and immediately reverses. The current bar confirms the failure by closing
    // on the opposite side.

    // Bearish one-tick failure: bar poked above prior bar's high but closed below its midpoint
    const bearishFailure = prevBar.high > bar2Back.high + (bar2Back.high - bar2Back.low) * 0.02 &&
        prevBar.close < prevBar.high - (prevBar.high - prevBar.low) * 0.5 &&
        bar.low < prevBar.low;

    // Bullish one-tick failure: bar poked below prior bar's low but closed above its midpoint
    const bullishFailure = prevBar.low < bar2Back.low - (bar2Back.high - bar2Back.low) * 0.02 &&
        prevBar.close > prevBar.low + (prevBar.high - prevBar.low) * 0.5 &&
        bar.high > prevBar.high;

    if (!bearishFailure && !bullishFailure) return { detected: false };

    const direction = bullishFailure ? 'long' : 'short'; // Direction of the reversal

    // --- Step 2: Check for prior trend direction context ---
    // In strong trends, failed breakouts are With Trend entries
    // In trading ranges, they are reversal scalps
    const isStrongTrend = trendState === TREND_STATE.BULL_TREND_STRONG || 
                          trendState === TREND_STATE.BEAR_TREND_STRONG;

    // --- Step 3: Now check if this is actually a Breakout Pullback (Ch 6, p.158-163) ---
    // A "failed failure": the market broke out, the breakout failed, then the failure failed
    // This becomes a Breakout Pullback — a With Trend entry
    // Check if bar3back also exhibited breakout behavior
    let isBreakoutPullback = false;
    if (bars.length >= 5) {
        const bar3Back = bars[latestIdx - 3];
        // Check if bar3Back was a breakout attempt
        if (bullishFailure && bar3Back.low < bars[latestIdx - 4].low) {
            // Previous breakout down failed, now breaking back up = Breakout Pullback
            isBreakoutPullback = true;
        }
        if (bearishFailure && bar3Back.high > bars[latestIdx - 4].high) {
            // Previous breakout up failed, now breaking back down = Breakout Pullback
            isBreakoutPullback = true;
        }
    }

    const signalBar = bar;
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * 0.05
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * 0.05;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * 0.05
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * 0.05;

    const setupType = isBreakoutPullback
        ? (direction === 'long' ? 'Breakout Pullback Long' : 'Breakout Pullback Short')
        : (direction === 'long' ? 'One-Tick Failed Breakout → Long' : 'One-Tick Failed Breakout → Short');

    // Confidence: higher for breakout pullbacks (failed failures), lower for simple failures
    const confidence = isBreakoutPullback ? 88 : (isStrongTrend ? 75 : 80);

    return {
        detected: true,
        setupType,
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence,
        signalBar,
        pullbackType: isBreakoutPullback ? 'breakout_pullback' : 'one_tick_failure',
        metadata: {
            failureType: bullishFailure ? 'bullish' : 'bearish',
            isBreakoutPullback,
            trendContext: isStrongTrend ? 'strong_trend' : 'range'
        }
    };
}

// ---- NEW: Chapter 11 — Opening Reversal Detection ----
// Brooks Ch 11 (p.313-317): "On most days, either the high or low of the day is formed
// within the first hour or so. Once one of the day's extremes is formed,
// the market reverses toward what will become the other extreme."
function detectOpeningReversal(bars, emaSeries, state, cfg) {
    if (bars.length < 6 || bars.length > 15) return { detected: false };

    const latestIdx = bars.length - 1;
    const bar = bars[latestIdx];
    const openBar = bars[0];
    const openPrice = openBar.open;
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;

    // --- Step 1: Check if we're in the first hour ---
    const barTime = bar.timestamp || bar.time || '';
    let isFirstHour = false;
    if (barTime) {
        try {
            const barDate = new Date(barTime);
            const minsSinceSessionStart = barDate.getUTCHours() * 60 + barDate.getUTCMinutes();
            isFirstHour = minsSinceSessionStart < 90;
        } catch (e) {
            // Fall back to bar count if timestamp parsing fails
            isFirstHour = bars.length <= (cfg.opening_reversal_bars || 6) * 3;
        }
    } else {
        isFirstHour = bars.length <= 15; // Rough estimate
    }

    if (!isFirstHour) return { detected: false };

    // --- Step 2: Detect initial move away from open ---
    const firstFewBars = bars.slice(0, Math.min(cfg.opening_reversal_bars || 6, bars.length));
    const moveFromOpen = bar.close - openPrice;

    // Calculate the initial direction
    const firstBarIsBull = firstFewBars[0].close > firstFewBars[0].open;
    const initialDirection = firstBarIsBull ? 'up' : 'down';

    // The initial amplitude (how far did it go in the initial direction?)
    const maxHigh = Math.max(...firstFewBars.map(b => b.high));
    const minLow = Math.min(...firstFewBars.map(b => b.low));

    // --- Step 3: Detect reversal ---
    // In an opening reversal, the market moved one direction initially and then reversed
    // Current bar should be a strong reversal bar in the opposite direction
    const sigType = classifyBar(bar, medianBody(bars, 10), dojiThreshold);

    if (initialDirection === 'up') {
        // Initial move was up. Look for bearish reversal.
        // Current bar should be a bear trend/reversal bar
        const isBearReversalBar = sigType === 'reversal_bear' || sigType === 'trend_bear' || sigType === 'shaved_bear';
        if (!isBearReversalBar) return { detected: false };

        // Current bar should trade below the initial range
        if (bar.close > minLow + (maxHigh - minLow) * 0.5) return { detected: false };

        return {
            detected: true,
            setupType: 'Opening Reversal (Up→Down)',
            direction: 'short',
            entryPrice: bar.low - cfg.v1_strict.trigger_offset_ticks * 0.05,
            stopLoss: bar.high + cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 85,
            signalBar: bar,
            pullbackType: 'opening_reversal',
            metadata: { initialDirection, maxHigh, minLow, openPrice }
        };
    } else {
        // Initial move was down. Look for bullish reversal.
        const isBullReversalBar = sigType === 'reversal_bull' || sigType === 'trend_bull' || sigType === 'shaved_bull';
        if (!isBullReversalBar) return { detected: false };

        if (bar.close < maxHigh - (maxHigh - minLow) * 0.5) return { detected: false };

        return {
            detected: true,
            setupType: 'Opening Reversal (Down→Up)',
            direction: 'long',
            entryPrice: bar.high + cfg.v1_strict.trigger_offset_ticks * 0.05,
            stopLoss: bar.low - cfg.v1_strict.stop_offset_ticks * 0.05,
            takeProfit: null,
            confidence: 85,
            signalBar: bar,
            pullbackType: 'opening_reversal',
            metadata: { initialDirection, maxHigh, minLow, openPrice }
        };
    }
}

// ============================================================================
// MODULE 9: VERSIONED ENTRY/EXIT CALCULATORS
// ============================================================================

/**
 * V38 TIERED ENTRY: Context-dependent stop and target computation
 * 
 * Brooks (Ch 1-4): Different patterns require different stop placements:
 *   - Double Bottom Bull Flag (Ch 4): stop = below the second low
 *   - Double Top Bear Flag (Ch 4): stop = above the second high
 *   - Reversal Bar (Ch 1): stop = beyond the opposite side of the bar
 *   - EMA Gap (Ch 4): tighter stop = bar range * 1.5
 *   - 2HM (Ch 4): wider stop = 2 × bar range
 *   - Trend Pullback (H2/L2): normal stop = 1 tick beyond signal bar
 *   - Failed reversal (Ch 1): stop = beyond the failed reversal bar
 *   - Outside bar trap (Ch 1): wider stop = both extremes
 */
function computeContextStopTarget(signal, bars, tickSize, cfg) {
    const sigBar = signal.signalBar;
    if (!sigBar) return null;

    const direction = signal.direction;
    const signalRange = sigBar.high - sigBar.low;
    const setupType = signal.setupType || '';
    const pullbackType = signal.pullbackType || '';
    const metadata = signal.metadata || {};

    // Default: 1 tick beyond signal bar's extreme (standard Brooks)
    let entryPrice, stopPrice, targetRR;

    // ===== Context 1: Double Bottom Bull Flag (Ch 4, p.104-105) =====
    if (setupType.includes('Double Bottom Bull Flag')) {
        // Entry: 1 tick above signal bar's high (confirmation bar)
        entryPrice = sigBar.high + 1 * tickSize;
        // Stop: 1 tick below LOW2 (the support level — not below signal bar)
        if (metadata.low2 && metadata.low2.bar) {
            stopPrice = metadata.low2.bar.low - 1 * tickSize;
        } else {
            // Fallback: stop below signal bar
            stopPrice = sigBar.low - 1 * tickSize;
        }
        // Target: measured move = flag height (intermediate high - low2)
        if (metadata.highBetween && metadata.low2) {
            const flagHeight = metadata.highBetween - metadata.low2.price;
            targetRR = Math.max(2, flagHeight / Math.abs(entryPrice - stopPrice));
        } else {
            targetRR = 2;
        }
    }

    // ===== Context 2: Double Top Bear Flag (Ch 4, p.105) =====
    else if (setupType.includes('Double Top Bear Flag')) {
        entryPrice = sigBar.low - 1 * tickSize;
        if (metadata.high2 && metadata.high2.bar) {
            stopPrice = metadata.high2.bar.high + 1 * tickSize;
        } else {
            stopPrice = sigBar.high + 1 * tickSize;
        }
        if (metadata.lowBetween && metadata.high2) {
            const flagHeight = metadata.high2.price - metadata.lowBetween;
            targetRR = Math.max(2, flagHeight / Math.abs(entryPrice - stopPrice));
        } else {
            targetRR = 2;
        }
    }

    // ===== Context 3: Reversal Bar (Ch 1, p.13-14) =====
    else if (setupType.includes('Reversal') || pullbackType === 'major_reversal_sequence') {
        // Entry: 1 tick beyond signal bar's opposite extreme
        // Stop: beyond the OTHER side of the bar (the bar range IS the risk)
        if (direction === 'long') {
            entryPrice = sigBar.high + 1 * tickSize;
            stopPrice = sigBar.low - 1 * tickSize;
        } else {
            entryPrice = sigBar.low - 1 * tickSize;
            stopPrice = sigBar.high + 1 * tickSize;
        }
        // Reversal bars often have 2-3R potential
        targetRR = 2.5;
    }

    // ===== Context 4: EMA Gap Bar (Ch 4, p.108-110) =====
    else if (pullbackType === 'ema_gap') {
        // Tighter stop for EMA fades: 1.5 × bar range
        const tightStop = signalRange * 1.5;
        if (direction === 'long') {
            entryPrice = sigBar.high + 1 * tickSize;
            stopPrice = entryPrice - tightStop;
        } else {
            entryPrice = sigBar.low - 1 * tickSize;
            stopPrice = entryPrice + tightStop;
        }
        // Target: measured move to the trend extreme
        targetRR = 2;
    }

    // ===== Context 5: 2HM (Ch 4, p.110-112) =====
    else if (pullbackType === '2hm') {
        // Wider stop for 2HM: 2 × bar range (run stops are common)
        const wideStop = signalRange * 2;
        if (direction === 'long') {
            entryPrice = sigBar.high + 1 * tickSize;
            stopPrice = entryPrice - wideStop;
        } else {
            entryPrice = sigBar.low - 1 * tickSize;
            stopPrice = entryPrice + wideStop;
        }
        // 2HM has 2-3R potential in strong trends
        targetRR = 2.5;
    }

    // ===== Context 6: Trend Pullback (H2/L2 / M2B/M2S) =====
    else if (setupType.includes('High 2') || setupType.includes('Low 2') ||
             setupType.startsWith('M2B') || setupType.startsWith('M2S') ||
             setupType.includes('Gap 2')) {
        // Standard 1 tick offset but slightly wider to avoid noise
        if (direction === 'long') {
            entryPrice = sigBar.high + 1 * tickSize;
            stopPrice = sigBar.low - 1 * tickSize;
        } else {
            entryPrice = sigBar.low - 1 * tickSize;
            stopPrice = sigBar.high + 1 * tickSize;
        }
        // For H2/L2 with leg analysis: use measured move
        if (metadata.legAnalysis && metadata.legAnalysis.leg1 && metadata.legAnalysis.leg2) {
            const leg1 = metadata.legAnalysis.leg1;
            const leg2 = metadata.legAnalysis.leg2;
            try {
                const legHeight = Math.abs(leg1.price - leg2.price);
                if (legHeight > 0) {
                    const risk = Math.abs(entryPrice - stopPrice);
                    targetRR = Math.max(2, legHeight / (risk || 1));
                } else {
                    targetRR = 2;
                }
            } catch (e) {
                targetRR = 2;
            }
        } else {
            targetRR = 2;
        }
    }

    // ===== Context 7: Outside Bar Trap (Ch 1, p.40-42) =====
    else if (setupType.includes('Outside Bar')) {
        // Wider stop: the outside bar's full range + 1 tick
        if (direction === 'long') {
            entryPrice = sigBar.high + 1 * tickSize;
            stopPrice = sigBar.low - 1 * tickSize;
        } else {
            entryPrice = sigBar.low - 1 * tickSize;
            stopPrice = sigBar.high + 1 * tickSize;
        }
        targetRR = 2;
    }

    // ===== Context 8: Failed Reversal (Ch 1, p.22-23) =====
    else if (setupType.includes('Failed')) {
        // Entry = beyond the FAILED reversal bar (not the current bar)
        if (metadata.failedBar) {
            const failedBar = metadata.failedBar;
            if (direction === 'long') {
                entryPrice = failedBar.high + 1 * tickSize;
                stopPrice = failedBar.low - 1 * tickSize;
            } else {
                entryPrice = failedBar.low - 1 * tickSize;
                stopPrice = failedBar.high + 1 * tickSize;
            }
        } else {
            // Fallback to standard
            if (direction === 'long') {
                entryPrice = sigBar.high + 1 * tickSize;
                stopPrice = sigBar.low - 1 * tickSize;
            } else {
                entryPrice = sigBar.low - 1 * tickSize;
                stopPrice = sigBar.high + 1 * tickSize;
            }
        }
        targetRR = 2;
    }

    // ===== Context 9: Three Push/Wedge (Ch 4, p.131-135) =====
    else if (setupType.includes('High 3') || setupType.includes('Low 3') || pullbackType === 'wedge_three_push') {
        // Standard 1 tick offset
        if (direction === 'long') {
            entryPrice = sigBar.high + 1 * tickSize;
            stopPrice = sigBar.low - 1 * tickSize;
        } else {
            entryPrice = sigBar.low - 1 * tickSize;
            stopPrice = sigBar.high + 1 * tickSize;
        }
        // Wedges typically have 2-3R potential
        targetRR = 2.5;
    }

    // ===== Context 10: Default (all other patterns) =====
    else {
        // Standard 1 tick offset with 2R target
        if (direction === 'long') {
            entryPrice = sigBar.high + 1 * tickSize;
            stopPrice = sigBar.low - 1 * tickSize;
        } else {
            entryPrice = sigBar.low - 1 * tickSize;
            stopPrice = sigBar.high + 1 * tickSize;
        }
        targetRR = 2;
    }

    // Compute take profit
    const risk = Math.abs(entryPrice - stopPrice);
    const effectiveRisk = risk > 0 ? risk : (1 * tickSize);
    const takeProfit = direction === 'long'
        ? entryPrice + effectiveRisk * targetRR
        : entryPrice - effectiveRisk * targetRR;

    return {
        entryPrice,
        stopLoss: stopPrice,
        takeProfit,
        risk: effectiveRisk,
        reward: effectiveRisk * targetRR,
        targetRR
    };
}

function computeVersionedEntry(signal, cfg, version, tickSize) {
    if (!signal || !signal.detected || !signal.signalBar) return null;

    const bar = signal.signalBar;
    const direction = signal.direction;

    let entryPrice, stopPrice;

    let targetRR = 2; // default RR ratio

    // ===== V38 TIERED ENTRY: context-dependent stop/target =====
    if (version === 'v38-tiered-entry') {
        const contextEntry = computeContextStopTarget(signal, null, tickSize, cfg);
        if (contextEntry) {
            return {
                version,
                direction,
                entryPrice: contextEntry.entryPrice,
                stopLoss: contextEntry.stopLoss,
                takeProfit: contextEntry.takeProfit,
                risk: contextEntry.risk,
                reward: contextEntry.reward,
                targetRR: contextEntry.targetRR,
                _tier: signal._tier || null,
                _tierScale: signal._tierScale || 1.0,
                _partialProfit: signal._partialProfit || null,
                _swingRatio: signal._swingRatio || 0
            };
        }
    }

        // All versions use Brooks-compliant 1-tick offset with uniform entry/exit logic
        // Differences are in the GATING, not the entry/exit computation
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

        // --- v17-v38: all use standard 1-tick offset, 2R target (except v38) ---
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

    // Take profit: computed from risk; targetRR is 2 by default
    const risk = Math.abs(entryPrice - stopPrice);
    
    // Guard: If risk is zero (e.g., identical entry and stop due to 0 range),
    // cap it at a minimum risk (1 tick) — Brooks Ch 1: "always have a stop in the market"
    if (risk <= 0) {
        // Synthetic minimum risk: 1 tick
        const minRisk = 1 * tickSize;
        // Re-derive stop from entry using min risk
        // NOTE: This is a fallback; in practice range-zero bars should be skipped
        // but this prevents NaN/Infinity takeProfit.
    }
    const effectiveRisk = risk > 0 ? risk : (1 * tickSize);
    
    // v34/v37: Override target to measured move projection from spike-and-channel
    // Brooks Ch 4: "Measured Move" projects spike height from channel breakout
    if ((version === 'v34-measured-move-target' || version === 'v37-wr-stack-all' || version === 'v37-wr-stack-all-conf-85') && effectiveRisk > 0) {
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
                    if (legHeight > effectiveRisk * 0.5) {
                        targetRR = Math.max(2, legHeight / effectiveRisk);
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
        ? entryPrice + effectiveRisk * targetRR
        : entryPrice - effectiveRisk * targetRR;

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
        this.description = 'Brooks Chapters 1-15 Complete Price Action Strategy';
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
            'v38-tiered-entry',               // 11. TIERED ENTRY: context-dependent stops/targets + per-version signal selection
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

        // Extract instrument tickSize (Brooks Ch 1: "enter on a stop at 1 tick beyond the bar")
        // - instrumentConfig.tickSize (from config.json) provides the market's actual minimum tick
        // - Default to 0.05 if not specified (standard Emini tick)
        const tickSize = (instrumentConfig.tickSize !== undefined && instrumentConfig.tickSize !== null)
            ? Number(instrumentConfig.tickSize)
            : 0.05;

        // Detect if this is a commodity instrument (Ch 1, p.15: stricter doji threshold)
        const isCommodity = instrumentKey.includes('MCX') || 
            instrumentKey.includes('CRUDEOIL') || 
            instrumentKey.includes('NATURALGAS') ||
            instrumentKey.includes('GOLD') ||
            instrumentKey.includes('SILVER') ||
            instrumentKey.includes('COPPER');
        // FIX 4: Commodities get stricter filtering across the board
        if (isCommodity) {
            if (cfg.doji_body_ratio_threshold === 0.15) {
                cfg.doji_body_ratio_threshold = cfg.commodity_doji_body_ratio || 0.20;
            }
            // Commodities require MORE reasons (3 vs 2) and HIGHER confidence (+5)
            cfg.min_reasons_to_enter = Math.max(cfg.min_reasons_to_enter || 2, 3);
            // Boost all confidence thresholds by 5 for commodities
            const verConf = cfg.version_confidence_thresholds || {};
            for (const [v, thresh] of Object.entries(verConf)) {
                if (typeof thresh === 'number' && thresh < 90) {
                    verConf[v] = Math.min(95, thresh + 5);
                }
            }
        }

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
        // BROOKS-COMPLIANT GATING & SIGNAL SELECTION (Chapters 1-15)
        // ================================================================
        const latestIdx = bars.length - 1;
        const currentBar = bars[latestIdx]; // The bar that just closed
        const trendStateStr = currentState.state;
        const isBullTrend = trendStateStr.includes('bull');
        const isBearTrend = trendStateStr.includes('bear');
        const isStrongTrend = trendStateStr === TREND_STATE.BULL_TREND_STRONG || 
                              trendStateStr === TREND_STATE.BEAR_TREND_STRONG;
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
            // === NEW: Chapters 5-11 Detectors ===
            () => detectMajorReversalSequence(bars, emaSeries, currentState, cfg),
            () => detectRangeBreakoutFade(bars, emaSeries, currentState, cfg),
            () => detectBreakoutFailureChain(bars, emaSeries, currentState, cfg),
            () => detectOpeningReversal(bars, emaSeries, currentState, cfg),
        ];

        const allDetectedSignals = [];
        for (const detector of detectors) {
            const signal = detector();
            if (!signal || !signal.detected || signal.informational) continue;
            allDetectedSignals.push(signal);
        }

        if (allDetectedSignals.length === 0) return null;

        // --- State context (shared across versions) ---
        const isWeak = trendStateStr.includes('weakening');
        const isTradingRange = trendStateStr === TREND_STATE.TRADING_RANGE || trendStateStr === TREND_STATE.UNDEFINED;

        // --- Version-aware filtering: EACH VERSION PICKS ITS OWN BEST SIGNAL ---
        // FIX: Per-version signal selection (each version processes independently)
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
                    if (isStrongTrend) {
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
                if (pass && (gateMask & GATE_BIT.PULLBACK_QUALITY)) {
                    const pbType = signal.pullbackType || signal.metadata?.pullbackType || null;
                    const recognized = [
                        'bar_pullback', 'minor_trendline', 'ema', 'ema_gap',
                        'major_trendline', '2hm', 'wedge_three_push',
                        'double_bottom_bull_flag', 'double_top_bear_flag',
                        'micro_trendline', 'failed_final_flag',
                        'bar', 'minor', 'ema_gap', 'wedge',
                        // NEW pullback types from Chapters 5-11
                        'major_reversal_sequence', 'range_fade',
                        'breakout_pullback', 'one_tick_failure',
                        'opening_reversal'
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
                                const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
                                const dojiCount = checkBars.filter((bb, idx) => {
                                    const bd = bodyValues[idx];
                                    const rg = rangeValues[idx];
                                    return rg > 0 && bd / rg < dojiThreshold;
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

                // === V38 TIERED ENTRY PRE-PROCESSING ===
                if (pass && version === 'v38-tiered-entry') {
                    const teCfg = cfg.tiered_entry || {};

                    // Step 1: Determine tier based on confidence
                    let tier = null;
                    let tierScale = 1.0;
                    let tierMinReasons = 2;

                    if (signal.confidence >= (teCfg.platinum_min_conf || 95)) {
                        tier = 'platinum';
                        tierScale = teCfg.platinum_position_scale || 1.0;
                        tierMinReasons = teCfg.platinum_min_reasons || 3;
                    } else if (signal.confidence >= (teCfg.gold_min_conf || 90)) {
                        tier = 'gold';
                        tierScale = teCfg.gold_position_scale || 1.0;
                        tierMinReasons = teCfg.gold_min_reasons || 2;
                    } else if (signal.confidence >= (teCfg.silver_min_conf || 80)) {
                        tier = 'silver';
                        tierScale = teCfg.silver_position_scale || 0.50;
                        tierMinReasons = teCfg.silver_min_reasons || 2;
                    } else {
                        // Bronze: conf >= 70 but below silver — NO TRADE
                        // Brooks (Ch 15): "Focus on the absolute best trades"
                        pass = false;
                    }

                    // Step 2: Apply context-dependent reason requirements
                    const isWithTrend = (signal.direction === 'long' && trendStateStr.includes('bull')) ||
                        (signal.direction === 'short' && trendStateStr.includes('bear'));

                    if (pass && isStrongTrend && isWithTrend) {
                        // Strong trend + With Trend: needs only 1 reason (or tier min)
                        tierMinReasons = 1;
                    } else if (pass && isStrongTrend && !isWithTrend) {
                        // Strong trend + Countertrend: needs 3 reasons
                        tierMinReasons = Math.max(tierMinReasons, 
                            teCfg.strong_trend_countertrend_min_reasons || 3);
                    }

                    // Step 3: Check reason count against tier requirement
                    // Run strict filters FIRST to get reason count
                    const filterResult = applyBrooksStrictFilters(signal, bars, emaSeries, currentState, cfg, gateMask);
                    if (filterResult.reasonCount < tierMinReasons) {
                        pass = false;
                    }

                    // Step 4: Store tier metadata for entry calculator
                    signal._tier = tier;
                    signal._tierScale = tierScale;

                    // Step 5: Partial profit model for Silver and above
                    if (pass && tier !== null) {
                        signal._partialProfit = {
                            ratio: teCfg.partial_profit_ratio || 0.50,
                            targetRR: teCfg.partial_profit_rr || 1.0,
                            description: `Scale out ${(teCfg.partial_profit_ratio || 0.50) * 100}% at ${teCfg.partial_profit_rr || 1.0}R`
                        };
                        signal._swingRatio = teCfg.swing_ratio || 0.20;
                    }
                }

                // === WR Improvement Stack With Distinct Boost Logic ===
                // Each v31-v36 version applies a UNIQUE boost to a specific Brooks pattern.

                // V983: v31-mid-session-trap-boost — +10 confidence for mid-session stop-run traps
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
                        const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
                        const dojiCount = checkBars.filter((bb, idx) => {
                            const rg = rangeValues[idx];
                            return rg > 0 && bodyValues[idx] / rg < dojiThreshold;
                        }).length;
                        if (dojiCount >= 4) {
                            // Barb wire + NOT second entry = reject
                            if (!isSecondEntry && signal.confidence < 88) pass = false;
                        }
                    }
                }

                // V986: v34-measured-move-target — TP = measured move of first leg
                if (pass && version === 'v34-measured-move-target') {
                    const hasSpikeChannel = signal.setupType &&
                        (signal.setupType.includes('Channel') ||
                         signal.setupType.includes('Spike') ||
                         signal.pullbackType === 'major_trendline');
                    if (hasSpikeChannel) {
                        signal.confidence = Math.min(100, signal.confidence + 5);
                    }
                }

                // V987: v35-failed-flag-boost — +10 confidence for failed final flag patterns
                if (pass && version === 'v35-failed-flag-boost') {
                    if (signal.setupType && signal.setupType.includes('Failed Final Flag')) {
                        signal.confidence = Math.min(100, signal.confidence + 10);
                    }
                }

                // V988: v36-m2-ema-origin-boost — +8 confidence for M2B/M2S at EMA
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
                    if (signal.setupType && signal.setupType.includes('Trap')) {
                        signal.confidence = Math.min(100, signal.confidence + 10);
                        boostApplied++;
                    }
                    if (signal.pullbackType === 'wedge_three_push' ||
                        (signal.setupType && (signal.setupType.includes('High 3') || signal.setupType.includes('Low 3')))) {
                        signal.confidence = Math.min(100, signal.confidence + 15);
                        boostApplied++;
                    }
                    if (signal.setupType && (signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
                        signal.setupType.includes('M2B') || signal.setupType.includes('M2S') || signal.setupType.includes('Gap 2'))) {
                        signal.confidence = Math.min(100, signal.confidence + 5);
                        boostApplied++;
                    }
                    if (signal.setupType && (signal.setupType.includes('Channel') || signal.setupType.includes('Spike') ||
                        signal.pullbackType === 'major_trendline')) {
                        signal.confidence = Math.min(100, signal.confidence + 5);
                        boostApplied++;
                    }
                    if (signal.setupType && signal.setupType.includes('Failed Final Flag')) {
                        signal.confidence = Math.min(100, signal.confidence + 10);
                        boostApplied++;
                    }
                    if (signal.setupType && (signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S'))) {
                        signal.confidence = Math.min(100, signal.confidence + 8);
                        boostApplied++;
                    }
                    if (boostApplied === 0 && signal.confidence < 83) {
                        pass = false;
                    }
                }

                // === BROOKS STRICT PDF-BASED FILTERS (UNIVERSAL) ===
                // Skip for v38-tiered-entry since we already ran it above for reason counting
                if (pass && version !== 'v38-tiered-entry') {
                    const strictFilterResult = applyBrooksStrictFilters(signal, bars, emaSeries, currentState, cfg, gateMask);
                    if (!strictFilterResult.pass) {
                        pass = false;
                        signal.filters = (signal.filters || []).concat(
                            strictFilterResult.reasons.map(r => `strict_${r}`)
                        );
                    }
                } else if (pass && version === 'v38-tiered-entry') {
                    // V38 already ran filters in the tiered-entry section above
                    // But still need to check non-reason-based filters
                    const sigBar = signal.signalBar;
                    if (sigBar) {
                        const sigType = classifyBar(sigBar, medianBody(bars, 10), cfg.doji_body_ratio_threshold || 0.15);
                        
                        // Doji rejection
                        if (sigType === 'doji') {
                            pass = false;
                        }
                        
                        // Exhaustion rejection
                        const sigBody = Math.abs(sigBar.close - sigBar.open);
                        const sigMedBody = medianBody(bars, 10);
                        if (sigMedBody > 0 && sigBody > sigMedBody * (cfg.climax_body_ratio || 2.5)) {
                            pass = false;
                        }
                        
                        // Outside bar rejection
                        const prevIdx = bars.indexOf(sigBar) - 1;
                        if (prevIdx >= 0) {
                            const prevBar = bars[prevIdx];
                            const isOutside = sigBar.high > prevBar.high && sigBar.low < prevBar.low;
                            if (isOutside) {
                                pass = false;
                            }
                        }
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
                // FIX: Each version picks its OWN best signal
                passingSignals.sort((a, b) => b.confidence - a.confidence);
                versionedResults[version] = passingSignals[0];
            }
        }

        if (Object.keys(versionedResults).length === 0) return null;

        // --- Build per-version entry/exit ---
        const versionedEntries = {};
        let masterSignal = null; // Use the highest-confidence version's signal as master

        for (const [version, signal] of Object.entries(versionedResults)) {
            const entry = computeVersionedEntry(signal, cfg, version, tickSize);
            if (entry) {
                // FIX: signalBar IS the current bar (it just closed). Entry is above/below it.
                // These checks are sanity-only; the original was too aggressive for commodities.
                const valid = (() => {
                    if (entry.direction === 'long') {
                        if (entry.stopLoss >= entry.entryPrice) return false;
                        if (entry.takeProfit !== null && entry.takeProfit <= entry.entryPrice) return false;
                        return true;
                    } else {
                        if (entry.stopLoss <= entry.entryPrice) return false;
                        if (entry.takeProfit !== null && entry.takeProfit >= entry.entryPrice) return false;
                        return true;
                    }
                })();

                if (valid) {
                    versionedEntries[version] = entry;
                }
            }
            if (versionedEntries[version] && (!masterSignal || signal.confidence > masterSignal.confidence)) {
                masterSignal = signal;
            }
        }

        if (Object.keys(versionedEntries).length === 0 || !masterSignal) return null;

        // --- Update pullback tracking from master (best) signal ---
        const masterEntry = versionedEntries[Object.keys(versionedEntries)[0]];
        if (masterSignal) {
            const bestPbType = masterSignal.pullbackType || masterSignal.setupType;
            pt.pullbackTypesFired.add(bestPbType);
            pt.highestConfidenceSinceExtreme = masterSignal.confidence;
            pt.lastSignalTimestamp = masterSignal.timestamp;
            if (masterSignal.setupType.includes('Double Top Bear Flag')) pt.activeDoubleTopBearFlag = true;
            if (masterSignal.setupType.includes('Double Bottom Bull Flag')) pt.activeDoubleBottomBullFlag = true;
        }

        const masterVersion = Object.keys(versionedEntries)[0];
        const masterEntryData = versionedEntries[masterVersion];

        return {
            signal: masterSignal.setupType,
            direction: masterEntryData.direction,
            entryPrice: masterEntryData.entryPrice,
            stopLoss: masterEntryData.stopLoss,
            takeProfit: masterEntryData.takeProfit,
            confidence: masterSignal.confidence,
            setupType: masterSignal.setupType,
            pullbackType: masterSignal.pullbackType || null,
            signalBar: masterSignal.signalBar,
            versionedEntries,
            trendState: currentState.state,
            timestamp: masterSignal.timestamp,
            strategy: this.name,
            metadata: masterSignal.metadata || {},
            filters: masterSignal.filters || [],
            // V38-specific fields
            tier: masterSignal._tier || null,
            tierScale: masterSignal._tierScale || 1.0,
            partialProfit: masterSignal._partialProfit || null,
            swingRatio: masterSignal._swingRatio || 0
        };
    }

    /**
     * Backtest-compatible evaluation — returns array of versioned signals
     */
    evaluateSignalForBacktest(bar, instrumentConfig, externalTrendState, requestedVersionParam = null) {
        const result = this.evaluateSignal(bar, instrumentConfig, externalTrendState, requestedVersionParam);
        if (!result) return [];

        const versionedResults = [];
        for (const [version, entryData] of Object.entries(result.versionedEntries || {})) {
            versionedResults.push({
                ...result,
                version,
                entryPrice: entryData.entryPrice,
                stopLoss: entryData.stopLoss,
                takeProfit: entryData.takeProfit,
                risk: entryData.risk,
                reward: entryData.reward,
                // V38-specific
                tier: entryData._tier || result.tier || null,
                tierScale: entryData._tierScale || result.tierScale || 1.0,
                partialProfit: entryData._partialProfit || result.partialProfit || null,
                swingRatio: entryData._swingRatio || result.swingRatio || 0
            });
        }

        return versionedResults;
    }

    /**
     * Get current state for persistence
     */
    exportState() {
        return {
            states: this.states,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Import state
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