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
            // ISSUE #11: Brooks Ch 7 (p.165) — Measured moves are
            // "not reliable enough to be the basis for trading."
            // They are INFORMATIONAL ONLY — a guide to keep you trading
            // With Trend until approached, NOT profit targets.
            use_measured_move: false
        },
        v5_relaxed_pullback: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: false
        },
        v6_no_state_restrict: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: false
        },
        v7_conf_only: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: false
        },
        v8_all_gates_lower_conf: {
            trigger_offset_ticks: 1,
            stop_offset_ticks: 1,
            target_rr_ratio: 2,
            use_measured_move: false
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
            stop_offset_ticks: 2
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

// FORWARD BIAS FIX: medianBodyExcludingLast excludes the current bar from the
// median calculation.  When classifying/evaluating the current bar, we must
// compare it against the median of PRIOR bars only — otherwise the current
// bar's own size inflates (or deflates) the "average" and creates a self-
// referential bias. This is Brooks-compliant: a trader evaluating bar N sees
// only bars 0..N-1, never bar N itself, before the bar closes.
function medianBodyExcludingLast(bars, lookback) {
    if (bars.length <= 1) return medianBody(bars, lookback); // fallback when only 1 bar
    const prior = bars.slice(0, bars.length - 1);
    return medianBody(prior, lookback);
}

function classifySignalBar(bar, prevBar, lookbackBars, direction) {
    const medBody = medianBody(lookbackBars, 10);
    const type = classifyBar(bar, medBody);
    const inside = prevBar ? isInsideBar(bar, prevBar) : false;
    const outside = prevBar ? isOutsideBar(bar, prevBar) : null;

    let quality = 0;
    const details = { type, inside, outside };

    // Signal bar quality scoring (for filter gate)
    // CRITICAL FIX #2 — Brooks (Ch 1, p.11-13, Guidelines #27):
    // "A beginner trader should only enter when the signal bar is also a trend bar
    // in the direction of his trade."
    // "A doji bar is a one-bar trading range and therefore a terrible signal bar.
    // You will lose if you buy above a trading range in a bear or sell below one in a bull."
    // DOJI BARS GET ZERO QUALITY — categorically rejected as signal bars.
    // INSIDE BARS get zero quality (they are bars within a trading range).
    if (direction === 'long') {
        if (type === BAR_TYPE.REVERSAL_BULL || type === BAR_TYPE.TREND_BULL || type === BAR_TYPE.SHAVED_BULL) {
            quality += 40;
        } else if (type === BAR_TYPE.DOJI || type === BAR_TYPE.INSIDE) {
            // Brooks flat rule: doji = one-bar trading range → terrible signal bar. Categorically rejected.
            // Inside bars are also trading range bars and Brooks says avoid.
            quality += 0;
        } else {
            // Any other bar type: modest score but still direction_match check applies
            quality += 5;
        }
    } else if (direction === 'short') {
        if (type === BAR_TYPE.REVERSAL_BEAR || type === BAR_TYPE.TREND_BEAR || type === BAR_TYPE.SHAVED_BEAR) {
            quality += 40;
        } else if (type === BAR_TYPE.DOJI || type === BAR_TYPE.INSIDE) {
            // Brooks flat rule: doji / inside bar → terrible signal bar. Categorically rejected.
            quality += 0;
        } else {
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
    // MICRO TRENDLINE FORWARD BIAS FIX: endIdx must be bars.length - 2 (bar N-1).
    // Trendlines must be drawn using bars UP TO bar N-1. Bar N is the bar that
    // TESTS the line. Using bar N in the slope creates mathematical circularity.
    const endIdx = bars.length - 2;
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
    const tolerance = (bar.high - bar.low) * cfg.tickSize;

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
    // FIX #1: Swing-point based trend detection (Ch 3 Brooks price structure, not EMA score)
    // Brooks: "Trend = series of higher highs/higher lows (bull) or lower highs/lower lows (bear)"
    // EMA confirms visually — it DOES NOT define trend numerically.
    
    if (bars.length < cfg.ema_period + cfg.min_swing_bars * 2) {
        return { state: TREND_STATE.UNDEFINED, details: {}, trendQuality: 0, trendDirection: null };
    }

    const latestIdx = bars.length - 1;
    const latestBar = bars[latestIdx];
    const ema = emaSeries[latestIdx];
    if (ema === null) return { state: TREND_STATE.UNDEFINED, details: {}, trendQuality: 0, trendDirection: null };

    // --- Phase 1: Identify swing points (lookback only — no forward bias) ---
    const swings = detectSwingHighs(bars, cfg.min_swing_bars).concat(
        detectSwingLows(bars, cfg.min_swing_bars)
    );
    swings.sort((a, b) => a.index - b.index);

    const swingHighs = swings.filter(s => s.type === 'high');
    const swingLows  = swings.filter(s => s.type === 'low');

    // Use last 4 swing highs/lows for structure analysis
    const recentSH = swingHighs.slice(-4);
    const recentSL = swingLows.slice(-4);

    // --- Phase 2: Price structure pattern analysis (weighted scoring) ---
    let bullPoints = 0, bearPoints = 0;
    let higherHighs = true, higherLows = true, lowerHighs = true, lowerLows = true;
    let consecutiveHH = 0, consecutiveHL = 0, consecutiveLH = 0, consecutiveLL = 0;

    for (let i = 1; i < Math.max(recentSH.length, recentSL.length); i++) {
        if (i < recentSH.length) {
            if (recentSH[i].price > recentSH[i-1].price) { consecutiveHH++; lowerHighs = false; }
            else { consecutiveHH = 0; higherHighs = false; }
            if (recentSH[i].price < recentSH[i-1].price) { consecutiveLH++; higherHighs = false; }
            else { consecutiveLH = 0; lowerHighs = false; }
        }
        if (i < recentSL.length) {
            if (recentSL[i].price > recentSL[i-1].price) { consecutiveHL++; lowerLows = false; }
            else { consecutiveHL = 0; higherLows = false; }
            if (recentSL[i].price < recentSL[i-1].price) { consecutiveLL++; higherLows = false; }
            else { consecutiveLL = 0; lowerLows = false; }
        }
    }

    // Points from structure: HH+HL ≥ 2 each → strong bull. LH+LL ≥ 2 each → strong bear.
    if (higherHighs && higherLows && consecutiveHH >= 2 && consecutiveHL >= 2) {
        bullPoints += 60; bearPoints = 0;
    } else if (lowerHighs && lowerLows && consecutiveLH >= 2 && consecutiveLL >= 2) {
        bearPoints += 60; bullPoints = 0;
    } else if (higherHighs && higherLows) {
        bullPoints += 35;
    } else if (lowerHighs && lowerLows) {
        bearPoints += 35;
    } else {
        // Mixed signals: weak or trading range
        if (higherHighs) bullPoints += 10;
        if (higherLows) bullPoints += 10;
        if (lowerHighs) bearPoints += 10;
        if (lowerLows) bearPoints += 10;
    }

    // --- Phase 3: EMA CONFIRMATION (not definition) — max 25 pts ---
    // Compute EMA slope using bars up to latestIdx - 1 to avoid circularity
    const emaSlopeStart = emaSeries[Math.max(0, latestIdx - 10)];
    const emaSlope = emaSlopeStart !== null ? (ema - emaSlopeStart) / 10 : 0;

    if (emaSlope > 0.003) bullPoints += 25;
    else if (emaSlope > 0) bullPoints += 10;
    if (emaSlope < -0.003) bearPoints += 25;
    else if (emaSlope < 0) bearPoints += 10;

    // Bar position relative to EMA over last 10 bars
    const barsAbove = bars.slice(-10).filter((b, i) => {
        const realIdx = latestIdx - 9 + i;
        return emaSeries[realIdx] !== null && b.low > emaSeries[realIdx];
    }).length;
    const barsBelow = bars.slice(-10).filter((b, i) => {
        const realIdx = latestIdx - 9 + i;
        return emaSeries[realIdx] !== null && b.high < emaSeries[realIdx];
    }).length;

    if (barsAbove >= 7) bullPoints += 15;
    if (barsBelow >= 7) bearPoints += 15;

    // --- Phase 4: Trend quality score 0-100 and direction ---
    const totalPoints = bullPoints + bearPoints;
    let trendQuality = 0;
    let trendDirection = null;

    if (totalPoints > 0) {
        if (bullPoints > bearPoints) {
            trendQuality = Math.round((bullPoints / totalPoints) * 100);
            trendDirection = 'bull';
        } else {
            trendQuality = Math.round((bearPoints / totalPoints) * 100);
            trendDirection = 'bear';
        }
    }

    // --- Phase 5: Map to trend state strings ---
    let state = (prevState && typeof prevState === 'object' && prevState.state) 
        || (typeof prevState === 'string' ? prevState : null) 
        || TREND_STATE.UNDEFINED;

    // Brooks: "If you're wondering, it's probably not a strong trend"
    // Trading range if points are balanced or quality < 55
    const isStrong = trendQuality >= 65;
    const isWeak   = trendQuality >= 55 && trendQuality < 65;

    if (trendDirection === 'bull' && isStrong && latestBar.close > ema) {
        state = TREND_STATE.BULL_TREND_STRONG;
    } else if (trendDirection === 'bear' && isStrong && latestBar.close < ema) {
        state = TREND_STATE.BEAR_TREND_STRONG;
    } else if (trendDirection === 'bull' && isWeak) {
        state = TREND_STATE.BULL_TREND_WEAKENING;
    } else if (trendDirection === 'bear' && isWeak) {
        state = TREND_STATE.BEAR_TREND_WEAKENING;
    } else if (trendQuality < 55) {
        state = TREND_STATE.TRADING_RANGE;
    }

    // Trendline break for reversal transition
    const bullTL = drawTrendline(swings, 'low');
    const bearTL = drawTrendline(swings, 'high');
    if (state === TREND_STATE.BULL_TREND_STRONG && bearTL && detectTrendlineBreak(bullTL, latestBar, latestIdx).broken) {
        state = TREND_STATE.REVERSAL_TRANSITION;
    } else if (state === TREND_STATE.BEAR_TREND_STRONG && bullTL && detectTrendlineBreak(bearTL, latestBar, latestIdx).broken) {
        state = TREND_STATE.REVERSAL_TRANSITION;
    }

    const details = { 
        ema, emaSlope, barsAbove, barsBelow,
        higherHighs, higherLows, lowerHighs, lowerLows,
        bullPoints, bearPoints, trendQuality, trendDirection, isStrong, isWeak
    };

    // ================================================================
    // CRITICAL FIX #4: TREND FROM OPEN DETECTION (Ch 3, p.82; Ch 11, p.305-312)
    // ================================================================
    // Brooks teaches that Trend from Open is usually the STRONGEST trend pattern.
    // It must be detected EARLY (bars 1-3, not 12 bars/60 minutes later).
    //
    // Key characteristics (from Ch 3, p.82 and Ch 11):
    //   1. "The first bar of the day forms an extreme" — bar 1 high/low is often
    //      the day's extreme in this pattern.
    //   2. "You would have suspected it by the third bar" — visible by bar 3.
    //   3. Detected by PRICE ACTION STRUCTURE, not percentage thresholds:
    //      - Strong trend bars in one direction from the open
    //      - Bars staying predominantly on one side of the EMA
    //      - No significant pullback counter to the direction
    //   4. CRITICAL PATTERN (Ch 11, Fig 11.11): FIRST BAR TRAP
    //      - Bar 1 is a bull trend bar that traps longs
    //      - The market then reverses and trends bearish all day
    //      - Short entry at one tick below bar 1's low (trapped long exit)
    //      - This is a POWERFUL Trend from Open Bear variant
    //
    // Brooks: "After the first couple bars of every day, especially if there
    // is a large gap, you always have to consider the possibility that a Trend
    // from the Open might be forming and you must look for swing entries."
    // ================================================================

    if (bars.length >= 5) {
        const openPrice = bars[0].open;
        const first3 = bars.slice(0, 3);
        const first5 = bars.slice(0, Math.min(5, bars.length));

        // --- EARLY DETECTION VIA PRICE ACTION STRUCTURE (bar 3, not bar 12) ---
        const bar1 = bars[0];
        const bar2 = bars[1];
        const bar3 = bars[2];
        const latestPrice = latestBar.close;
        const ema5 = emaSeries[latestIdx] || (latestBar.close + latestBar.open) / 2;

        // Count how many of first 3 bars are trend bars in the same direction
        const first3BullBars = first3.filter(b => b.close > b.open && (b.close - b.open) > (b.high - b.low) * 0.4);
        const first3BearBars = first3.filter(b => b.close < b.open && (b.open - b.close) > (b.high - b.low) * 0.4);

        // Bars staying on correct side of EMA (Brooks: "trend bar stays on one side")
        const barsAboveEMA = first5.filter(b => b.low >= ema5 * 0.998).length;
        const barsBelowEMA = first5.filter(b => b.high <= ema5 * 1.002).length;

        // Bull Trend from Open: 3 strong criteria (at least 2 must be met)
        const bullCriteria = [
            first3BullBars.length >= 2,                                          // 2+ bull trend bars in first 3
            latestPrice > openPrice && (latestPrice - openPrice) / openPrice > 0.002, // sustained directional move
            barsAboveEMA >= 4,                                                    // bars staying above EMA
            first3.filter(b => (b.close - b.low) > (b.high - b.close) * 0.7).length >= 2 // strong bull closes
        ];
        const bullScore = bullCriteria.filter(c => c).length;

        if (bullScore >= 2 && latestPrice > openPrice) {
            state = TREND_STATE.TREND_FROM_OPEN_BULL;
        }

        // Bear Trend from Open: 3 strong criteria (at least 2 must be met)
        const bearCriteria = [
            first3BearBars.length >= 2,                                          // 2+ bear trend bars in first 3
            latestPrice < openPrice && (openPrice - latestPrice) / openPrice > 0.002, // sustained directional move
            barsBelowEMA >= 4,                                                    // bars staying below EMA
            first3.filter(b => (b.high - b.close) > (b.close - b.low) * 0.7).length >= 2 // strong bear closes
        ];
        const bearScore = bearCriteria.filter(c => c).length;

        if (bearScore >= 2 && latestPrice < openPrice) {
            state = TREND_STATE.TREND_FROM_OPEN_BEAR;
        }

        // ================================================================
        // FIRST BAR TRAP DETECTION (Ch 11, Fig 11.11)
        // ================================================================
        // Brooks: Bar 1 is a bull trend bar → market traps longs and reverses bearish
        // Great short opportunity at one tick below bar 1's low.
        //
        // Pattern signature:
        //   - Bar 1 is a bull trend bar (strong body, closing near high)
        //   - Bar 2-3 reverse sharply bearish (strong bear bars)
        //   - Price breaks below bar 1's low (trapped longs liquidate)
        //   - This often becomes a Trend from Open Bear all day
        //
        // Brooks: "Bar 1 provided a great opportunity to go short at one tick
        // below the low of the bull trend bar because this is where most of
        // those trapped longs will get out."
        // ================================================================

        const isBar1BullTrend = (bar1.close > bar1.open) &&
            ((bar1.close - bar1.open) > (bar1.high - bar1.low) * 0.5) &&  // strong body
            ((bar1.close - bar1.low) < (bar1.high - bar1.low) * 0.3);      // close near high

        const isBar1BearTrend = (bar1.close < bar1.open) &&
            ((bar1.open - bar1.close) > (bar1.high - bar1.low) * 0.5) &&  // strong body
            ((bar1.high - bar1.close) < (bar1.high - bar1.low) * 0.3);     // close near low

        // Bar-1 Bull Trap → Bear Trend from Open
        if (isBar1BullTrend && first3BearBars.length >= 1) {
            const brokeBar1Low = bars.slice(1, Math.min(5, bars.length)).some(b => b.low < bar1.low);
            if (brokeBar1Low && latestPrice < bar1.low) {
                state = TREND_STATE.TREND_FROM_OPEN_BEAR;
                details.firstBarTrap = 'bull_bar1_trap_bear_tfo';
            }
        }

        // Bar-1 Bear Trap → Bull Trend from Open
        if (isBar1BearTrend && first3BullBars.length >= 1) {
            const brokeBar1High = bars.slice(1, Math.min(5, bars.length)).some(b => b.high > bar1.high);
            if (brokeBar1High && latestPrice > bar1.high) {
                state = TREND_STATE.TREND_FROM_OPEN_BULL;
                details.firstBarTrap = 'bear_bar1_trap_bull_tfo';
            }
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

    return { state, details, swings, bullTL, bearTL, trendQuality, trendDirection };
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
    const signalBar = bars[latestIdx];
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

    // TRIGGER SUCCESS BIAS FIX (Ch 4): Removed bar.high > prevBar.high /
    // bar.low < prevBar.low as a required gate. Previously ONLY fired when
    // Bar N already broke the trigger, guaranteeing retroactive fill.
    // Now prevBar is evaluated as the SETUP (via countHighLow verification
    // in Step 2), and the backtester handles trigger fill on Bar N+1.

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
    const signalBar = bars[latestIdx];
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

    // TRIGGER SUCCESS BIAS FIX: Removed isHigh2Signal/isLow2Signal gate.
    // Previously ONLY fired when Bar N already broke trigger (retroactive).
    // Now countHighLow verifies prevBar is H2/L2 setup; backtester fills on N+1.

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
    const signalBar = bars[latestIdx];
    const leg1 = counter.results[0];
    const leg2 = counter.results[1];

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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
    const signalBar = bars[latestIdx];

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

    // CONFIRMATION BIAS FIX: Removed bar.high/close > highBetween gate.
    // Previously required the current bar to ALREADY break above the neckline
    // before calling it a signal (buying at top of spike). Now the double
    // bottom is detected by formation; entry = signal bar high + 1 tick.
    // The intermediate high is used only for measured move targets.

    // --- Step 3: Signal bar = CURRENT BAR ---
    // Entry = 1 tick above current bar's high (fresh signal)
    // Stop = 1 tick below low2 (the support level — Ch 4, p.104-105)
    const signalBar = bars[latestIdx];
    const entryPrice = signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = low2.bar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

    // CONFIRMATION BIAS FIX: Removed bar.low/close < lowBetween gate.
    // Previously required the current bar to ALREADY break below intermediate
    // low before calling it a signal (shorting at bottom of spike).
    // Now the double top is detected by formation; entry = signal bar low - 1 tick.

    // --- Step 3: Signal bar = CURRENT BAR ---
    // Entry = 1 tick below current bar's low (fresh signal)
    // Stop = 1 tick above high2 (the resistance level — Ch 4, p.105)
    const signalBar = bars[latestIdx];
    const entryPrice = signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = high2.bar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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
    const signalBar = bars[latestIdx];

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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
    const barType = classifyBar(bar, medianBodyExcludingLast(bars, 10), dojiThreshold);

    if (isBullTrend) {
        const isBearSpike = barType === BAR_TYPE.TREND_BEAR || barType === BAR_TYPE.EXHAUSTION;
        if (!isBearSpike) return { detected: false };

        return {
            detected: true,
            setupType: '11:30 Trap (Bull Trend Stop Run)',
            direction: 'long',
            entryPrice: bar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
            stopLoss: bar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
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
            entryPrice: bar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
            stopLoss: bar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
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
    const signalBar = bars[latestIdx];

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

    // CONFIRMATION BIAS FIX: Removed bar.close > prevBar.close outcome dependency.
    // Previously only fired when bar N had ALREADY closed above prevBar, confirming
    // the failure retroactively. Now: detect the structure (prevBar was a reversal attempt
    // in a strong trend where such attempts typically fail), not the outcome.
    // FAILED BEAR REVERSAL IN STRONG BULL → LONG
    // prevBar was bear reversal or doji attempt signaling a potential top
    if (isStrongBull && (prevType === BAR_TYPE.REVERSAL_BEAR || prevType === BAR_TYPE.DOJI)) {
        // BACK-DATING FIX: Entry = 1 tick above CURRENT bar's high (bar N), not prevBar.
        // The signal fires at bar N's close. Order placed for execution on bar N+1.
        // Stop = 1 tick below prevBar's low (the failed reversal bar's extreme)
        const entryPrice = bar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
        return {
            detected: true,
            setupType: 'Failed Bear Reversal → Long',
            direction: 'long',
            entryPrice,
            stopLoss: prevBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
            metadata: { prevType, reason: 'failed_reversal_bear_in_bull', failedBar: prevBar }
        };
    }

    // FAILED BULL REVERSAL IN STRONG BEAR → SHORT
    // prevBar was bull reversal or doji attempt signaling a potential bottom
    if (isStrongBear && (prevType === BAR_TYPE.REVERSAL_BULL || prevType === BAR_TYPE.DOJI)) {
        // Setup-dating FIX: Entry = 1 tick below current bar's low (bar N), not prevBar.
        // The signal fires at bar N's close. Order placed for execution on bar N+1.
        // Stop = prevBar's high (the failed reversal bar's extreme)
        const entryPrice = bar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
        return {
            detected: true,
            setupType: 'Failed Bull Reversal → Short',
            direction: 'short',
            entryPrice,
            stopLoss: prevBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
            takeProfit: null,
            confidence: 82,
            signalBar: bar, // CURRENT BAR is the signal bar
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
        const entryPrice = bar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
        return {
            detected: true,
            setupType: 'Outside Bar Bull Trap → Long',
            direction: 'long',
            entryPrice,
            stopLoss: bar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
            takeProfit: null,
            confidence: 85,
            signalBar: bar,
            metadata: { outsideType, reason: 'trapped_shorts_bull_outside' }
        };
    }

    if (isStrongBear && outsideType === BAR_TYPE.OUTSIDE_DOWN && prevBar.close > prevBar.open) {
        // Trapped longs — bear outside down bar
        const entryPrice = bar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
        return {
            detected: true,
            setupType: 'Outside Bar Bear Trap → Short',
            direction: 'short',
            entryPrice,
            stopLoss: bar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
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
            entryPrice: bar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
            stopLoss: bar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
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
            entryPrice: bar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
            stopLoss: bar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
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
    const signalBar = bars[latestIdx];

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

    // TRIGGER SUCCESS BIAS FIX: Removed isHigh2Signal/isLow2Signal gate.
    // Previously ONLY fired when Bar N already broke trigger (retroactive).
    // Now detect the setup; backtester handles trigger fill on N+1.

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
    const signalBar = bars[latestIdx];
    const leg1 = counter.results[0];
    const leg2 = counter.results[1];

    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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
    const sigMedBody = medianBodyExcludingLast(bars, 10);
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
    // FIX: Extended to ALL bull/bear trend states (not just isStrongBull/isStrongBear)
    // Brooks Guideline #7: countertrend BLOCKED without TL break in ANY trend state
    const isBullTrendState = trendState.includes('bull');
    const isBearTrendState = trendState.includes('bear');
    if (isBullTrendState && direction === 'short') {
        const bullTLForBreak = state.bullTL || null;
        const hasTLBreak = bullTLForBreak && detectTrendlineBreak(bullTLForBreak, sigBar, bars.indexOf(sigBar)).broken;
        if (hasTLBreak) {
            validReasons.push('trendline_break');
            reasons.push('trendline_break');
        } else {
            failures.push('countertrend_no_trendline_break_any_bull');
        }
    }
    if (isBearTrendState && direction === 'long') {
        const bearTLForBreak = state.bearTL || null;
        const hasTLBreak = bearTLForBreak && detectTrendlineBreak(bearTLForBreak, sigBar, bars.indexOf(sigBar)).broken;
        if (hasTLBreak) {
            validReasons.push('trendline_break');
            reasons.push('trendline_break');
        } else {
            failures.push('countertrend_no_trendline_break_any_bear');
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

    // ============================================================
    // CRITICAL FIX #1: COUNTER-TREND COMPLETE TRILOGY CHECK
    // ============================================================
    // Brooks Guidelines #7, #28, #29, Trading Guidelines p.382-385, Ch 8 (p.175-184):
    //
    // "There are no reliable Countertrend patterns, so never trade
    // Countertrend unless there first has been a break of a significant trendline."
    //
    // "You will not make money trading reversals until you wait for a
    // break of a significant trendline and then for a strong reversal bar
    // on a test of the trend's extreme."
    //
    // The complete Brooks trilogy for a legitimate countertrend entry:
    //   (a) SIGNIFICANT trendline break — price closes beyond the TL
    //   (b) Test of the old trend's extreme — price revisits the prior HH/LL
    //   (c) STRONG reversal bar at that test — trend bar in countertrend direction
    //
    // Brooks (Ch 9, Fig 9.27): "Smart traders would force themselves to take
    // every short and would not be taking longs" in a strong bear trend.
    //
    // IMPLEMENTATION: Rather than just checking TL break, we check all
    // three parts of the trilogy. Missing ANY part → BLOCK the countertrend.
    //
    // Two-tier severity:
    //   STRONG trend (magnitude >= 3): ALL countertrend BLOCKED unless
    //       complete trilogy satisfied (3 parts)
    //   MODERATE trend (magnitude 2): Countertrend requires at least
    //       2 of 3 parts + second entry
    //   WEAK/flat trend: old code behavior (just TL break check)
    // ============================================================

    // Determine trend magnitude for Countertrend gating
    const trendMagnitude = (() => {
        const details = state.details || {};
        const emaSlope = details.emaSlope || 0;
        const absSlope = Math.abs(emaSlope);
        if (absSlope > 0.02) return 4;       // Very strong
        if (absSlope > 0.015) return 3;      // Strong
        if (absSlope > 0.01) return 2;       // Moderate
        if (absSlope > 0.005) return 1;      // Weak
        return 0;                              // Flat/TR
    })();

    const isSignalCountertrend =
        (trendState.includes('bear') && direction === 'long') ||
        (trendState.includes('bull') && direction === 'short');

    if (isSignalCountertrend && trendMagnitude >= 2) {
        // COUNTER-TREND in a trend of at least moderate strength
        // Apply the Brooks trilogy check

        // Part (a): Significant trendline break
        let hasTLBreak = false;
        if (trendState.includes('bear') && direction === 'long') {
            const bearTL = state.bearTL || null;
            hasTLBreak = bearTL && detectTrendlineBreak(bearTL, sigBar, bars.indexOf(sigBar)).broken;
        } else if (trendState.includes('bull') && direction === 'short') {
            const bullTL = state.bullTL || null;
            hasTLBreak = bullTL && detectTrendlineBreak(bullTL, sigBar, bars.indexOf(sigBar)).broken;
        }

        // Part (b): Test of the old trend's extreme
        // Price must have revisited the prior HH (for bear trend) or LL (for bull trend)
        // within the last several bars before this signal
        let hasTestOfExtreme = false;
        const lookbackBars = 5; // check last 5 bars for test of extreme
        const swings = state.swings || [];
        if (trendState.includes('bear') && direction === 'long') {
            // For bear trend: test of old LOW extreme (potential bottom)
            // Find the lowest swing low in recent swing history
            const swingLows = swings.filter(s => s.type === 'low');
            if (swingLows.length > 0) {
                const lowestSwing = swingLows.reduce((min, s) => s.price < min.price ? s : min, swingLows[0]);
                const extremePrice = lowestSwing.price;
                const sigIdx = bars.indexOf(sigBar);
                for (let i = Math.max(0, sigIdx - lookbackBars); i <= sigIdx; i++) {
                    if (bars[i].low <= extremePrice * 1.005) {
                        hasTestOfExtreme = true;
                        break;
                    }
                }
            }
            // Also check: has price recently revisited near the lowest prior bar?
            if (!hasTestOfExtreme) {
                const recentBars = bars.slice(Math.max(0, latestIdx - 8), latestIdx + 1);
                const minPrice = Math.min(...recentBars.map(b => b.low));
                for (const b of recentBars) {
                    if (b.low <= minPrice * 1.003) { // within 0.3% of recent low
                        hasTestOfExtreme = true;
                        break;
                    }
                }
            }
        } else if (trendState.includes('bull') && direction === 'short') {
            // For bull trend: test of old HIGH extreme (potential top)
            const swingHighs = swings.filter(s => s.type === 'high');
            if (swingHighs.length > 0) {
                const highestSwing = swingHighs.reduce((max, s) => s.price > max.price ? s : max, swingHighs[0]);
                const extremePrice = highestSwing.price;
                const sigIdx = bars.indexOf(sigBar);
                for (let i = Math.max(0, sigIdx - lookbackBars); i <= sigIdx; i++) {
                    if (bars[i].high >= extremePrice * 0.995) {
                        hasTestOfExtreme = true;
                        break;
                    }
                }
            }
            if (!hasTestOfExtreme) {
                const recentBars = bars.slice(Math.max(0, latestIdx - 8), latestIdx + 1);
                const maxPrice = Math.max(...recentBars.map(b => b.high));
                for (const b of recentBars) {
                    if (b.high >= maxPrice * 0.997) {
                        hasTestOfExtreme = true;
                        break;
                    }
                }
            }
        }

        // Part (c): Strong reversal bar at the test
        // Signal bar must be a trend bar or strong reversal bar pointing countertrend
        const isStrongCounterTrendBar =
            (direction === 'long' && (sigType === BAR_TYPE.TREND_BULL || sigType === BAR_TYPE.REVERSAL_BULL || sigType === BAR_TYPE.SHAVED_BULL)) ||
            (direction === 'short' && (sigType === BAR_TYPE.TREND_BEAR || sigType === BAR_TYPE.REVERSAL_BEAR || sigType === BAR_TYPE.SHAVED_BEAR));

        // Count trilogy parts satisfied
        let trilogyParts = 0;
        const missingParts = [];
        if (hasTLBreak) trilogyParts++;
        else missingParts.push('tl_break');
        if (hasTestOfExtreme) trilogyParts++;
        else missingParts.push('test_of_extreme');
        if (isStrongCounterTrendBar) trilogyParts++;
        else missingParts.push('strong_reversal_bar');

        // SECOND ENTRY CHECK — Brooks requires second entry for Countertrend
        const isSecondEntry =
            signal.setupType && (
                signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
                signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S') ||
                signal.setupType.includes('Gap 2')
            );

        // Trilogged gating decision
        if (trendMagnitude >= 3) {
            // STRONG TREND: Block ALL countertrend unless COMPLETE trilogy (3/3) + second entry
            if (trilogyParts < 3 || !isSecondEntry) {
                failures.push(`countertrend_blocked_strong_trend_trilogy_${trilogyParts}/3_missing_${missingParts.join('+')}`);
                // Also block if we have trilogy but no second entry
                if (trilogyParts >= 3 && !isSecondEntry) {
                    failures.push('countertrend_no_second_entry_in_strong_trend');
                }
            }
        } else if (trendMagnitude === 2) {
            // MODERATE TREND: Require at least 2/3 trilogy parts + second entry
            if (trilogyParts < 2 || !isSecondEntry) {
                failures.push(`countertrend_blocked_moderate_trend_trilogy_${trilogyParts}/3_missing_${missingParts.join('+')}`);
                if (trilogyParts >= 2 && !isSecondEntry) {
                    failures.push('countertrend_no_second_entry_in_moderate_trend');
                }
            }
        } else {
            // WEAK trend (magnitude 1): Just require TL break (original behavior)
            if (!hasTLBreak) {
                failures.push('countertrend_no_trendline_break');
            }
        }

        // If trilogy passed, add as valid reasons
        if (hasTLBreak) {
            validReasons.push('trendline_break');
            reasons.push('trendline_break');
        }
        if (hasTestOfExtreme) {
            validReasons.push('test_of_extreme');
            reasons.push('test_of_extreme');
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
    const sigType = classifyBar(bar, medianBodyExcludingLast(bars, 10), dojiThreshold);

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

    // --- Step 4: SECOND ENTRY CHECK ---
    // Brooks (Ch 8, p.175-186; Trading Guidelines p.382-385): "The second
    // entry is the safest countertrend setup. The first entry after a TL
    // break often fails because the old trend tries to resume. Wait for the
    // second attempt to reverse." Check if this is an H2/L2 or M2B/M2S
    // second entry pattern completing at this bar.
    let isSecondEntry = false;
    let secondEntryType = null;
    const lookbackForSE = 15;
    const seStartIdx = Math.max(0, latestIdx - lookbackForSE);
    
    if (direction === 'long') {
        // Looking for L2: two push-downs to a low zone followed by bull reversal
        // Or M2S: two consecutive bull bars at the low
        let pushDownCount = 0;
        let lastLow = Infinity;
        for (let i = seStartIdx; i <= latestIdx; i++) {
            const b = bars[i];
            const isBearish = b.close < b.open && (b.close - b.open) / (b.high - b.low || 1) < -0.2;
            const touchesLow = b.low <= lastLow * 1.002;
            if (isBearish && b.low <= lastLow * 0.999) {
                pushDownCount++;
                lastLow = Math.min(lastLow, b.low);
                if (pushDownCount >= 2 && i === latestIdx) {
                    isSecondEntry = true;
                    secondEntryType = 'L2';
                }
            } else if (i === latestIdx && pushDownCount >= 2) {
                // Current bar not the second push-down itself but reversal bar
                // Check if the prior bar was the second push-down to the low
                const prevBar = bars[i - 1] || null;
                if (prevBar && prevBar.low <= lastLow * 1.003) {
                    isSecondEntry = true;
                    secondEntryType = 'L2_reversal';
                }
            }
        }
    } else {
        // Looking for H2: two push-ups to a high zone followed by bear reversal
        // Or M2B: two consecutive bear bars at the high
        let pushUpCount = 0;
        let lastHigh = -Infinity;
        for (let i = seStartIdx; i <= latestIdx; i++) {
            const b = bars[i];
            const isBullish = b.close > b.open && (b.close - b.open) / (b.high - b.low || 1) > 0.2;
            const touchesHigh = b.high >= lastHigh * 0.998;
            if (isBullish && b.high >= lastHigh * 1.001) {
                pushUpCount++;
                lastHigh = Math.max(lastHigh, b.high);
                if (pushUpCount >= 2 && i === latestIdx) {
                    isSecondEntry = true;
                    secondEntryType = 'H2';
                }
            } else if (i === latestIdx && pushUpCount >= 2) {
                // Current bar not the second push-up but reversal bar
                const prevBar = bars[i - 1] || null;
                if (prevBar && prevBar.high >= lastHigh * 0.997) {
                    isSecondEntry = true;
                    secondEntryType = 'H2_reversal';
                }
            }
        }
    }

    // Adjust confidence based on second entry status
    // Brooks: second entry = safest → 90+ confidence
    // First entry only = riskier → lower to 75
    const effectiveConfidence = isSecondEntry ? 90 : 75;

    // --- Step 5: Build signal ---
    const signalBar = bars[latestIdx];
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

    return {
        detected: true,
        setupType: direction === 'long'
            ? 'Major Reversal: TL Break → Test → Bull Reversal'
            : 'Major Reversal: TL Break → Test → Bear Reversal',
        direction,
        entryPrice,
        stopLoss: stopPrice,
        takeProfit: null,
        confidence: effectiveConfidence,
        signalBar,
        pullbackType: 'major_reversal_sequence',
        metadata: {
            trendlineBreakIdx: trendlineBreakBarIdx,
            testType,
            reversalType: sigType,
            isSecondEntry,
            secondEntryType,
            note: isSecondEntry
                ? 'Complete Brooks sequence: TL break → test → reversal bar → SECOND ENTRY (safest)'
                : 'TL break → test → reversal bar but FIRST ENTRY only — Brooks prefers second entry. Confidence reduced.'
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
    const sigType = classifyBar(bar, medianBodyExcludingLast(bars, 10), dojiThreshold);
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
        ? bar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : bar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? bar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : bar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

    // CONFIRMATION BIAS FIX: Removed bar.low < prevBar.low / bar.high > prevBar.high
    // Previously required the current bar (N) to ALREADY break through prevBar's extreme.
    // Now: detect the ONE-TICK FAILURE based on prevBar's structure ONLY.
    // prevBar (N-1) pokes beyond bar2Back and reverses (closes on opposite side).
    // The signal bar = CURRENT bar (N), entry above/below bar N's high/low.
    // Backtester fills on bar N+1.

    // Bearish one-tick failure: prevBar poked above bar2Back's high but closed below its midpoint
    const bearishFailure = prevBar.high > bar2Back.high + (bar2Back.high - bar2Back.low) * 0.02 &&
        prevBar.close < prevBar.high - (prevBar.high - prevBar.low) * 0.5;

    // Bullish one-tick failure: prevBar poked below bar2Back's low but closed above its midpoint
    const bullishFailure = prevBar.low < bar2Back.low - (bar2Back.high - bar2Back.low) * 0.02 &&
        prevBar.close > prevBar.low + (prevBar.high - prevBar.low) * 0.5;

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

    const signalBar = bars[latestIdx];
    const entryPrice = direction === 'long'
        ? signalBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize
        : signalBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize;
    const stopPrice = direction === 'long'
        ? signalBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize
        : signalBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize;

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

// ================================================================
// ISSUE #7 FIX: BARB WIRE DETECT & BLOCK (Ch 5, p.137-148)
// ================================================================
// Brooks (Ch 5, Trading Guidelines p.382-385):
//   "Barb Wire is a tight trading range with prominent tails and 
//    overlapping bodies. Don't touch Barb Wire, or you will be hurt."
//   "You will lose if you buy above a trading range in a bear or 
//    sell below one in a bull."
//
// CRITICAL: The old code only REDUCED confidence in Barb Wire context
// (Gate 8). Brooks teaches categorical avoidance of ALL entries when
// Barb Wire is present. This function detects Barb Wire with positional
// context (middle-of-day, middle-of-range) and returns a BLOCK signal.
//
// Additional context from Ch 5:
//   - Middle of the day + middle of the day's range = worst time to trade
//   - "If a market has been in a tight TR for 20+ bars, it is a breakout 
//     mode pattern" → only trade the breakout once it CLEARLY breaks
//   - "Barb Wire at the open or midday is especially dangerous"
function detectBarbWireBlock(bars, state, cfg, barIndex) {
    if (bars.length < 8) return { isBarbWire: false };

    // Check last 5-10 bars for tight range with overlapping bodies
    const lookback = Math.min(10, bars.length);
    const recentBars = bars.slice(-lookback);
    const ranges = recentBars.map(b => b.high - b.low);
    const bodies = recentBars.map(b => Math.abs(b.close - b.open));
    
    const avgRange = ranges.reduce((s, r) => s + r, 0) / recentBars.length;
    const maxRange = Math.max(...ranges);
    const minRange = Math.min(...ranges.filter(r => r > 0));

    if (avgRange <= 0) return { isBarbWire: false };

    // Barb Wire criterion 1: Tight range (max not much bigger than min)
    const rangeConsistency = (maxRange - minRange) / avgRange;
    const isTightRange = rangeConsistency < 0.8;

    // Barb Wire criterion 2: Many doji/small-body bars (overlapping bodies)
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
    const dojiBars = recentBars.filter((b, idx) => {
        const rg = ranges[idx];
        return rg > 0 && bodies[idx] / rg < dojiThreshold;
    });
    
    // Barb Wire criterion 3: Overlapping bodies (bodies share same price zone)
    let overlapCount = 0;
    for (let i = 1; i < recentBars.length; i++) {
        const prev = recentBars[i - 1];
        const curr = recentBars[i];
        const prevBodyLow = Math.min(prev.open, prev.close);
        const prevBodyHigh = Math.max(prev.open, prev.close);
        const currBodyLow = Math.min(curr.open, curr.close);
        const currBodyHigh = Math.max(curr.open, curr.close);
        // Bodies overlap if their body ranges intersect
        if (currBodyHigh > prevBodyLow && currBodyLow < prevBodyHigh) {
            overlapCount++;
        }
    }

    // Barb Wire criterion 4: Small average body relative to average range
    const avgBody = bodies.reduce((s, b) => s + b, 0) / recentBars.length;
    const bodyToRangeRatio = avgBody / avgRange;

    // ===== Barb Wire Detection =====
    const isBarbWire = isTightRange &&
        dojiBars.length >= Math.floor(lookback * 0.4) &&  // 40%+ doji bars
        overlapCount >= Math.floor(lookback * 0.5) &&      // 50%+ overlapping bodies
        bodyToRangeRatio < 0.4;                             // small bodies relative to ranges

    if (!isBarbWire) return { isBarbWire: false };

    // ===== Positional Context (middle-of-day, middle-of-range) =====
    // Determine if we're in the MIDDLE of the session (worst Barb Wire time)
    const trendState = state.state;
    const isTradingRange = trendState === TREND_STATE.TRADING_RANGE ||
        trendState === TREND_STATE.UNDEFINED;
    
    // Middle-of-range check: is price near midpoint of the day's range?
    let isMiddleOfRange = false;
    if (bars.length >= 20) {
        const dayBars = bars.slice(-Math.min(60, bars.length));
        const dayHigh = Math.max(...dayBars.map(b => b.high));
        const dayLow = Math.min(...dayBars.map(b => b.low));
        const dayMid = (dayHigh + dayLow) / 2;
        const dayRange = dayHigh - dayLow;
        if (dayRange > 0) {
            const currentBar = bars[barIndex !== undefined ? barIndex : bars.length - 1];
            const distFromMid = Math.abs(currentBar.close - dayMid) / dayRange;
            isMiddleOfRange = distFromMid < 0.2; // within 20% of midpoint
        }
    }

    // Middle-of-day temporal check
    let isMiddleOfDay = false;
    if (barIndex !== undefined && barIndex >= 0 && bars[barIndex]) {
        const barTime = bars[barIndex].timestamp || bars[barIndex].time || '';
        if (barTime) {
            try {
                const d = new Date(barTime);
                const minsSinceMidnight = d.getUTCHours() * 60 + d.getUTCMinutes();
                // For NSE: mid-day ~11:00-13:00 UTC (4:30-6:30 IST)
                // For MCX: mid-day ~09:00-14:00 UTC
                const isNSEMidDay = minsSinceMidnight >= 330 && minsSinceMidnight <= 390; // 5:30-6:30 UTC
                const isMCXMidDay = minsSinceMidnight >= 540 && minsSinceMidnight <= 840; // 9:00-14:00 UTC
                isMiddleOfDay = isNSEMidDay || isMCXMidDay;
            } catch (e) { /* ignore */ }
        }
    }

    // ===== Severity Assessment =====
    let severity = 'moderate'; // default: reduce confidence significantly
    if (isTradingRange && isMiddleOfRange) {
        severity = 'critical'; // middle of TR + middle of range = CATASTROPHIC — block all
    } else if (isTradingRange && isMiddleOfDay) {
        severity = 'high'; // TR + midday = BLOCK all except second entries
    } else if (isMiddleOfRange) {
        severity = 'high'; // middle of range always dangerous
    }

    return {
        isBarbWire: true,
        severity, // 'critical', 'high', or 'moderate'
        dojiCount: dojiBars.length,
        overlapCount,
        bodyToRangeRatio,
        avgRange,
        isTradingRange,
        isMiddleOfRange,
        isMiddleOfDay,
        rangeHigh: Math.max(...recentBars.map(b => b.high)),
        rangeLow: Math.min(...recentBars.map(b => b.low))
    };
}

// ---- NEW: Chapter 11 — Opening Reversal Detection (ENHANCED v99) ----
// Brooks Ch 11 (p.313-317): "On most days, either the high or low of the day is 
// formed within the first hour. Once one of the day's extremes is formed, the
// market reverses toward what will become the other extreme."
//
// This is Brooks' "easiest time to make money" (Guidelines #23):
// "The easiest time to make money is in the first 90 minutes, and some of the 
// easiest trades to spot are failed breakouts and breakout pullbacks of patterns 
// from the prior day."
//
// CRITICAL FIX #5: Detects 4 opening patterns (not just initial direction reversal):
//   (1) Failed breakout of prior day's high/low — Brooks' most reliable opening pattern
//   (2) Gap opening reversals (gap up that fails, gap down that reverses)  
//   (3) Yesterday's patterns breaking out or failing on the open
//   (4) Initial direction reversal (enhanced — requires sustained net move)
//   (5) Trend continuation after opening range fades
function detectOpeningReversal(bars, emaSeries, state, cfg) {
    if (bars.length < 3) return { detected: false };

    const latestIdx = bars.length - 1;
    const currentBar = bars[latestIdx];
    const openBarCount = cfg.opening_reversal_bars || 6;
    const firstHourBars = bars.slice(0, Math.min(openBarCount, bars.length));
    if (firstHourBars.length < 3) return { detected: false };

    // Brooks: "The easiest time to make money is in the first 90 minutes" (Guidelines #23)
    const isFirstHour = bars.length <= openBarCount;
    const isExtendedFirstHour = bars.length <= openBarCount * 1.5;

    const medianBodySize = medianBodyExcludingLast(bars, 10);
    const dojiThreshold = cfg.doji_body_ratio_threshold || 0.15;
    const signalRange = currentBar.high - currentBar.low;

    // Helper: is bar a strong reversal/trend bar in given direction?
    const isStrongBar = (bar, dir) => {
        const body = bar.close - bar.open;
        const range = bar.high - bar.low;
        if (range <= 0) return false;
        if (dir === 'long') {
            const upperWick = bar.high - bar.close;
            const closeNearHigh = upperWick / range < 0.3;
            return (body > 0 && body > medianBodySize * 0.6) && closeNearHigh;
        } else {
            const lowerWick = bar.close - bar.low;
            const closeNearLow = lowerWick / range < 0.3;
            return (body < 0 && Math.abs(body) > medianBodySize * 0.6) && closeNearLow;
        }
    };

    // ================================================================
    // PATTERN 1: FAILED BREAKOUT OF YESTERDAY'S HIGH/LOW (Ch 11, Fig 11.5-11.8)
    // Brooks: The single most reliable opening pattern (Guidelines #23)
    // Market breaks beyond prior day's extreme, then reverses — trapping breakout traders
    // ================================================================
    const priorDayHigh = cfg.yesterday_high || null;
    const priorDayLow = cfg.yesterday_low || null;

    if (priorDayHigh !== null && priorDayLow !== null) {
        let brokeAbove = false;
        let brokeBelow = false;
        for (const fb of firstHourBars) {
            if (fb.high > priorDayHigh) brokeAbove = true;
            if (fb.low < priorDayLow) brokeBelow = true;
        }

        // Failed breakout above yesterday's high → Bearish reversal
        // FORWARD BIAS FIX: Removed currentBar.close < priorDayHigh.
        // A strong bear bar NEAR prior day's high IS the reversal setup — 
        // don't wait for it to already close below the prior high to confirm.
        // Entry = 1 tick below current bar's low; fills on bar N+1.
        if (brokeAbove && isStrongBar(currentBar, 'short')) {
            return {
                detected: true, direction: 'short',
                setupType: 'Failed Breakout Above Yesterday\'s High (Opening)',
                confidence: 82,
                signalBar: currentBar,
                pullbackType: 'opening_reversal',
                entryPrice: currentBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                stopLoss: currentBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                takeProfit: null,
                metadata: { priorDayHigh, priorDayLow, reversalType: 'failed_breakout_yesterday_high', failedLevel: priorDayHigh }
            };
        }

        // Failed breakout below yesterday's low → Bullish reversal
        // FORWARD FAILURE FIX: Removed currentBar.close > priorDayLow.
        // A strong bull bar NEAR prior day's low IS the reversal setup.
        // Entry = 1 tick above current bar high; fills on bar N+1.
        if (brokeBelow && isStrongBar(currentBar, 'long')) {
            return {
                detected: true, direction: 'long',
                setupType: 'Failed Breakout Below Yesterday\'s Low (Opening)',
                confidence: 82,
                signalBar: currentBar,
                pullbackType: 'opening_reversal',
                entryPrice: currentBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                stopLoss: currentBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                takeProfit: null,
                metadata: { priorDayHigh, priorDayLow, reversalType: 'failed_breakout_yesterday_low', failedLevel: priorDayLow }
            };
        }

        // Breakout Pullback to yesterday's high (pullback TO extreme and bounce)
        const nearPriorHigh = Math.abs(currentBar.high - priorDayHigh) / (signalRange || 1) < 1.5;
        const nearPriorLow = Math.abs(currentBar.low - priorDayLow) / (signalRange || 1) < 1.5;

        if (nearPriorHigh && state.state.includes('bull') && isStrongBar(currentBar, 'long')) {
            return {
                detected: true, direction: 'long',
                setupType: 'Breakout Pullback to Yesterday\'s High (Opening)',
                confidence: 78,
                signalBar: currentBar,
                pullbackType: 'opening_reversal',
                entryPrice: currentBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                stopLoss: currentBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                takeProfit: null,
                metadata: { priorDayHigh, reversalType: 'pullback_to_yesterday_high' }
            };
        }
        if (nearPriorLow && state.state.includes('bear') && isStrongBar(currentBar, 'short')) {
            return {
                detected: true, direction: 'short',
                setupType: 'Breakout Pullback to Yesterday\'s Low (Opening)',
                confidence: 78,
                signalBar: currentBar,
                pullbackType: 'opening_reversal',
                entryPrice: currentBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                stopLoss: currentBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                takeProfit: null,
                metadata: { priorDayLow, reversalType: 'pullback_to_yesterday_low' }
            };
        }
    }

    // ================================================================
    // PATTERN 2: GAP OPENING REVERSALS (Ch 11, p.304-306)
    // Gap up that fails → Bearish; Gap down that reverses → Bullish
    // ================================================================
    const openPrice = firstHourBars[0].open;
    if (priorDayHigh !== null && priorDayLow !== null) {
        const gapUp = openPrice > priorDayHigh;
        const gapDown = openPrice < priorDayLow;

        if (gapUp) {
            let reversed = false;
            for (const fb of firstHourBars) {
                if (fb.low < priorDayHigh && fb.close < priorDayHigh) reversed = true;
            }
            if (reversed && isStrongBar(currentBar, 'short')) {
                return {
                    detected: true, direction: 'short',
                    setupType: 'Gap Up Failure (Opening Reversal)',
                    confidence: 80,
                    signalBar: currentBar,
                    pullbackType: 'opening_reversal',
                    entryPrice: currentBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                    stopLoss: currentBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                    takeProfit: null,
                    metadata: { gapType: 'up', reversalType: 'gap_failure' }
                };
            }
        }
        if (gapDown) {
            let reversed = false;
            for (const fb of firstHourBars) {
                if (fb.high > priorDayLow && fb.close > priorDayLow) reversed = true;
            }
            if (reversed && isStrongBar(currentBar, 'long')) {
                return {
                    detected: true, direction: 'long',
                    setupType: 'Gap Down Failure (Opening Reversal)',
                    confidence: 80,
                    signalBar: currentBar,
                    pullbackType: 'opening_reversal',
                    entryPrice: currentBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                    stopLoss: currentBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                    takeProfit: null,
                    metadata: { gapType: 'down', reversalType: 'gap_failure' }
                };
            }
        }
    }

    // ================================================================
    // PATTERN 3: INITIAL DIRECTION REVERSAL (enhanced — requires sustained net move)
    // Brooks: "On most days, either the high or low of the day is formed 
    // within the first hour"
    // ================================================================
    const firstThree = firstHourBars.slice(0, Math.min(3, firstHourBars.length));
    let upBars = 0, downBars = 0;
    for (let i = 1; i < firstThree.length; i++) {
        if (firstThree[i].close > firstThree[i - 1].close) upBars++;
        else if (firstThree[i].close < firstThree[i - 1].close) downBars++;
    }
    const initialUp = upBars >= 2;
    const initialDown = downBars >= 2;
    
    // Net move from open through first hour bars
    const netFirstHour = firstHourBars[firstHourBars.length - 1].close - firstHourBars[0].open;
    const sustainedUp = initialUp && netFirstHour > 0;
    const sustainedDown = initialDown && netFirstHour < 0;

    if (sustainedUp && isStrongBar(currentBar, 'short')) {
        return {
            detected: true, direction: 'short',
            setupType: 'Opening Reversal (Up→Down)',
            confidence: 75,
            signalBar: currentBar,
            pullbackType: 'opening_reversal',
            entryPrice: currentBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
            stopLoss: currentBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
            takeProfit: null,
            metadata: { initialDirection: 'up', reversalType: 'initial_direction_reversal', netFirstHourMove: netFirstHour }
        };
    }
    if (sustainedDown && isStrongBar(currentBar, 'long')) {
        return {
            detected: true, direction: 'long',
            setupType: 'Opening Reversal (Down→Up)',
            confidence: 75,
            signalBar: currentBar,
            pullbackType: 'opening_reversal',
            entryPrice: currentBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
            stopLoss: currentBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
            takeProfit: null,
            metadata: { initialDirection: 'down', reversalType: 'initial_direction_reversal', netFirstHourMove: netFirstHour }
        };
    }

    // ================================================================
    // PATTERN 4: TREND CONTINUATION AFTER OPENING RANGE FADE — With Trend
    // Active in extended first hour (bars 6-18), after initial reversal is done
    // ================================================================
    if (isExtendedFirstHour && !isFirstHour) {
        const st = state.state;
        if ((st.includes('bull') || st === 'bull_trend_strong') && isStrongBar(currentBar, 'long')) {
            return {
                detected: true, direction: 'long',
                setupType: 'Opening Trend Continuation (Bull)',
                confidence: 72,
                signalBar: currentBar,
                pullbackType: 'opening_reversal',
                entryPrice: currentBar.high + cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                stopLoss: currentBar.low - cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                takeProfit: null,
                metadata: { reversalType: 'trend_continuation_after_opening', trendState: st }
            };
        }
        if ((st.includes('bear') || st === 'bear_trend_strong') && isStrongBar(currentBar, 'short')) {
            return {
                detected: true, direction: 'short',
                setupType: 'Opening Trend Continuation (Bear)',
                confidence: 72,
                signalBar: currentBar,
                pullbackType: 'opening_reversal',
                entryPrice: currentBar.low - cfg.v1_strict.trigger_offset_ticks * cfg.tickSize,
                stopLoss: currentBar.high + cfg.v1_strict.stop_offset_ticks * cfg.tickSize,
                takeProfit: null,
                metadata: { reversalType: 'trend_continuation_after_opening', trendState: st }
            };
        }
    }

    return { detected: false };
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
    
    // ISSUE #11 FIX: Brooks Ch 7 (p.165) — Measured moves are
    // "not reliable enough to be the basis for trading." They are
    // INFORMATIONAL ONLY — a guide to keep trading With Trend until
    // approached. They must NOT be used as profit targets.
    //
    // For versions that previously used measured moves as targets
    // (v34-measured-move-target, v37-wr-stack-all), we compute the
    // measured move projection and store it as METADATA instead of
    // overriding the take-profit. The target stays at 2R.
    if ((version === 'v34-measured-move-target' || version === 'v37-wr-stack-all' || version === 'v37-wr-stack-all-conf-85') && effectiveRisk > 0) {
        // Compute the measured move projection as informational metadata
        let measuredMoveProjection = null;
        if (signal.metadata && signal.metadata.legAnalysis && signal.metadata.legAnalysis.leg1) {
            try {
                const leg1Price = signal.metadata.legAnalysis.leg1.price;
                const leg1Bar = signal.metadata.legAnalysis.leg1.bar;
                const leg2Bar = signal.metadata.legAnalysis.leg2?.bar;
                if (leg1Price && leg1Bar && leg2Bar) {
                    const legHeight = Math.abs(
                        (leg2Bar.close || leg2Bar.high) - (leg1Bar.close || leg1Bar.low)
                    );
                    if (legHeight > effectiveRisk * 0.5) {
                        measuredMoveProjection = {
                            legHeight,
                            projectionRR: Math.max(2, legHeight / effectiveRisk),
                            note: 'Informational only — Brooks Ch 7 p.165: "not reliable enough to be the basis for trading"'
                        };
                    }
                }
            } catch (e) {
                // Ignore — measured move is informational
            }
        }
        // Store as informational metadata on the return object
        // targetRR stays at 2 (standard Brooks 2:1 RR)
        signal._measuredMoveInfo = measuredMoveProjection;
        // Keep targetRR at default (2) — measured moves are NOT targets
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
        // ================================================================
        // CRITICAL FIX #3: BROOKS-PURE PATTERN RECOGNITION (not numeric scoring)
        // ================================================================
        // Brooks Guidelines #1, #2, #12, #20:
        //   "Everything is in gray fog. Close is close enough. If something
        //    looks like a reliable pattern, it will likely trade like a
        //    reliable pattern."
        //   "Simple is better. You don't need indicators. If you can't make
        //    money off a single chart with no indicators, adding more things
        //    to analyze will only make it more difficult."
        //
        // The old system used 11+ versions with different numeric gate masks,
        // confidence percentage thresholds (70/75/80/85/90), and tiered
        // entry levels — a quantitative scoring engine that replaced Brooks's
        // pattern recognition with numerical gating.
        //
        // Brooks explicitly rejects this approach. His method:
        //   1. See a recognizable pattern → take the trade
        //   2. Multiple confirming patterns = stronger, but ONE clear pattern is enough
        //   3. There are NO "confidence thresholds" — if the pattern is good, you take it
        //   4. If Barb Wire, you avoid it
        //
        // The fix replaces all variants with a SINGLE unified version that:
        //   - Keeps the strict Brooks hard rules (countertrend trilogy, doji ban,
        //     "2 reasons" rule, etc.) as primary gates
        //   - Uses pattern detection results as ENHANCING METADATA for signal
        //     ranking (not boolean gates)
        //   - Disables numeric confidence threshold entirely (confidence = 0 threshold)
        //   - All signals that pass Brooks hard rules fire. Confidence is used
        //     only to pick the BEST one when multiple signals fire simultaneously.
        // ================================================================
        this.activeVersions = [
            'v99-brooks-pure',   // Brooks-pure pattern recognition — no numeric confidence gating
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
        cfg.tickSize = tickSize;

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

        // ================================================================
        // ISSUE #10 FIX — ALWAYS IN / SWING MODE
        // Brooks (Ch 10, p.273-275; Guidelines #39):
        //   "A good alternative to scalping and occasionally swinging a
        //    portion of the trade is to try to stay in the market most of
        //    the day, exiting on the close."
        //   "Hold the position through repeated pullbacks unless the 
        //    protective stop is hit, even if the pullbacks are violent."
        //   "Work on increasing your position size rather than on the
        //    number of trades or the variety of setups that you use."
        //
        // Implementation:
        //   1. SIGNAL RANKING: After all detectors fire, rank remaining
        //      signals by Brooks criteria and emit only top 2-5 per day
        //   2. RE-ENTRY AFTER TRAP-OUT: When strong trend detected and
        //      we're trapped out, generate re-entry if valid pullback forms
        //   3. POSITION SCALING: Platinum-tier signals carry increased
        //      position size metadata (scale_up: 1.3x)
        // ================================================================
        
        // Part 1: Brooks Signal Ranking — see below (shared brooksRankScore)
        // ================================================================
        // FIX #2: WITH-TREND ONLY ENFORCEMENT
        // Brooks (Ch 3, "How to Trade a Trend"): "Never countertrend trade
        // in a strong trend." Trading against the trend is a LOW PROBABILITY
        // activity. In trends, only trade WITH the direction or WAIT.
        //
        // The old code only penalized counter-trend by -15 in ranking but
        // didn't BLOCK them. In a weak/weakening trend or trading range,
        // both long AND short signals passed through simultaneously and the
        // "best" was chosen by score — allowing losing countertrend entries.
        //
        // Now: When trendQuality >= 55 (from swing-point trend detection),
        // ALL counter-trend signals are blocked. Only Trading Range (quality
        // < 55) allows both directions.
        // ================================================================
        const trendQ = (currentState && typeof currentState.trendQuality === 'number') 
            ? currentState.trendQuality : 0;
        const trendDir = (currentState && currentState.trendDirection) || null;

        // Brooks rank score (shared across both branches)
        const brooksRankScore = (signal) => {
            let score = signal.confidence || 0;
            if (signal.setupType && (
                signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
                signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S') ||
                signal.setupType.includes('Gap 2') ||
                (signal.metadata && signal.metadata.isSecondEntry)
            )) score += 15;
            // With-trend bonus
            const isWithTrend = (signal.direction === 'long' && isBullTrend) ||
                (signal.direction === 'short' && isBearTrend);
            if (isWithTrend) score += 10;
            if (signal.pullbackType === 'ema' || signal.pullbackType === 'ema_gap' ||
                signal.pullbackType === '2hm') score += 8;
            if (signal.pullbackType === 'opening_reversal' &&
                signal.metadata && (signal.metadata.priorDayHigh || signal.metadata.priorDayLow)) score += 12;
            if (signal.pullbackType === 'major_reversal_sequence') score += 10;
            return score;
        };

        // When trend direction is confirmed (Q >= 55), block counter-trend
        let filteredSignals;
        const MAX_SIGNALS = 5;

        if (trendQ >= 55 && trendDir) {
            const allowedDirection = trendDir === 'bull' ? 'long' : 'short';
            filteredSignals = allDetectedSignals.filter(signal => signal.direction === allowedDirection);
        } else {
            // Trading range or undefined trend (Q < 55): allow both directions
            // with counter-trend requiring second entry + TL break
            filteredSignals = allDetectedSignals.filter(signal => {
                const isCountertrend = (isBearTrend && signal.direction === 'long') ||
                    (isBullTrend && signal.direction === 'short');
                if (!isCountertrend) return true;
                
                const isSecondEntry = signal.setupType && (
                    signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
                    signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S') ||
                    signal.setupType.includes('Gap 2') ||
                    (signal.metadata && signal.metadata.isSecondEntry)
                );
                if (!isSecondEntry) return false;
                
                const hasTLBreak = 
                    signal.pullbackType === 'major_reversal_sequence' ||
                    (signal.metadata && signal.metadata.trendline_break) ||
                    (signal.filters && signal.filters.length === 0);
                return hasTLBreak;
            });
        }

        if (!filteredSignals || filteredSignals.length === 0) return null;

        // Sort and cap to top 5
        filteredSignals.sort((a, b) => brooksRankScore(b) - brooksRankScore(a));
        filteredSignals = filteredSignals.slice(0, MAX_SIGNALS);

        let topSignals = filteredSignals;

        // Signal ranking info
        const signalRankingInfo = {
            totalSignalsDetected: filteredSignals.length,
            topSignalsKept: topSignals.length,
            maxSignalsPerBar: MAX_SIGNALS,
            rankScores: topSignals.map(s => ({
                setup: s.setupType,
                rankScore: brooksRankScore(s),
                direction: s.direction,
                confidence: s.confidence
            }))
        };
        
        // Replace allDetectedSignals with the ranked/filtered top signals
        // for versioned processing
        // NOTE: We keep allDetectedSignals as-is for versioned filtering
        // but add ranking metadata to the return
        
        // --- Part 2: Re-entry After Trap-Out metadata ---
        // If the trend is strong and we have a pullback setup, generate
        // re-entry hint for the trader/backtester
        let reEntrySignal = null;
        if (isStrongTrend) {
            const trendDir = isBullTrend ? 'long' : 'short';
            // Find the highest-ranked With Trend signal among topSignals
            const withTrendSignals = topSignals.filter(s =>
                s.direction === trendDir && s.confidence >= 70
            );
            if (withTrendSignals.length > 0) {
                const bestWT = withTrendSignals[0];
                reEntrySignal = {
                    recommendation: `Re-entry ${trendDir.toUpperCase()} on pullback — trend strong`,
                    direction: trendDir,
                    setupType: bestWT.setupType,
                    confidence: bestWT.confidence,
                    note: 'If stopped out, consider re-entering on the next pullback setup (Brooks Guideline #39)'
                };
            }
        }
        
        // --- Part 3: Position Scaling Metadata ---
        // Brooks: "Work on increasing your position size rather than on the 
        // number of trades." — embed scaling recommendations
        const positionScalingMetadata = {
            rule: 'Brooks Guideline #39: increase position size on best setups',
            signalRanking: signalRankingInfo,
            reEntrySignal,
            maxSignalsPerBar: MAX_SIGNALS
        };
        
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

                // Gate 8: Barb Wire detection & blocking (bit 128)
                // ISSUE #7 FIX: Brooks teaches categorical avoidance of Barb Wire.
                // Old code only reduced confidence — now BLOCKS based on severity.
                if (pass && (gateMask & GATE_BIT.BARB_WIRE)) {
                    const bwResult = detectBarbWireBlock(bars, currentState, cfg, latestIdx);
                    if (bwResult.isBarbWire) {
                        if (bwResult.severity === 'critical') {
                            // Middle of TR + middle of range = BLOCK ALL entries
                            pass = false;
                            signal.filters = (signal.filters || []).concat(['strict_barb_wire_critical_block']);
                        } else if (bwResult.severity === 'high') {
                            // TR + midday or middle-of-range = BLOCK all except second entries
                            const isSecondEntry = signal.setupType && (
                                signal.setupType.includes('High 2') || signal.setupType.includes('Low 2') ||
                                signal.setupType.startsWith('M2B') || signal.setupType.startsWith('M2S') ||
                                signal.setupType.includes('Gap 2')
                            );
                            if (!isSecondEntry || signal.confidence < 85) {
                                pass = false;
                                signal.filters = (signal.filters || []).concat(['strict_barb_wire_high_severity']);
                            }
                        } else {
                            // 'moderate': BINARY BLOCK — Brooks: "Don't touch Barb Wire or you will be hurt"
                            // Ch 5, Trading Guidelines p.382-385. ALL Barb Wire = do not trade.
                            // Previous logic reduced confidence but NEVER blocked with confThreshold=0.
                            // Now: moderate Barb Wire blocks ALL entries unconditionally.
                            pass = false;
                            signal.filters = (signal.filters || []).concat(['strict_barb_wire_moderate_block']);
                        }
                    } else if ((isTradingRange || isWeak) && signal.confidence < 90) {
                        // Original behavior for non-barb-wire but risky context
                        const safetyFloor2 = confThreshold > 0 ? (confThreshold - 5) : 15;
                        signal.confidence = Math.max(safetyFloor2, signal.confidence - 5);
                        if (signal.confidence < (confThreshold > 0 ? confThreshold : 20)) pass = false;
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

                // V986: v34-measured-move-target — Confidence boost for spike-and-channel
                // (Brooks: spike-and-channel patterns have directional conviction,
                // but the measured move projection is informational only, not a TP)
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
                        const sigType = classifyBar(sigBar, medianBodyExcludingLast(bars, 10), cfg.doji_body_ratio_threshold || 0.15);
                        
                        // Doji rejection
                        if (sigType === 'doji') {
                            pass = false;
                        }
                        
                        // Exhaustion rejection
                        const sigBody = Math.abs(sigBar.close - sigBar.open);
                        const sigMedBody = medianBodyExcludingLast(bars, 10);
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

        // ================================================================
        // ISSUE #8 FIX: BROOKS TRADE MANAGEMENT METADATA
        // Brooks' dynamic stop tightening sequence (Ch 10, p.276-279;
        // Guidelines #8, #30-33, #38; Trading Guidelines p.385):
        //   1. INITIAL STOP: 1 tick beyond signal bar extreme (already set)
        //   2. POST-ENTRY-BAR TIGHTENING: After entry bar closes, move stop
        //      to the entry bar's extreme (not signal bar's). Brooks: "once
        //      the entry bar closes, the market has proven that the signal 
        //      bar extreme is no longer the critical level"
        //   3. SCALP PARTIAL AT 1R: Scale out X% at 1× initial risk
        //      (Brooks: "always scalp part of your position")
        //   4. MOVE STOP TO BREAKEVEN AFTER PARTIAL: After partial scaled out,
        //      move stop to entry price on remaining position
        //   5. TRAILING STOP ON SWING PORTION: Use 2-bar swing trailing stop
        //      (Brooks: "trail the stop below the most recent Higher Low in 
        //       a bull trend or above the most recent Lower High in a bear")
        //
        // These are provided as METADATA so the backtester/live trader can
        // implement them. The strategy file doesn't manage positions itself;
        // it generates signals with trade management instructions.
        // ================================================================
        const tradeManagement = (() => {
            const sigBar = masterSignal.signalBar;
            if (!sigBar) return null;
            
            const dir = masterEntryData.direction;
            const entry = masterEntryData.entryPrice;
            const initialStop = masterEntryData.stopLoss;
            const initialRisk = Math.abs(entry - initialStop);
            
            // Step 2: Entry bar stop level (to be applied after entry bar closes)
            // CRITICAL: The entry bar (Bar N+1) has not formed yet. We cannot
            // pre-compute its stop because the stop must be based on the ENTRY BAR's
            // extreme, not the signal bar's. The backtester/live trader must compute
            // this dynamically once the entry bar closes.
            //
            // Brooks: "once the entry bar closes, move the stop to the
            // entry bar's extreme."
            //
            // We set entryBarStop to null with _pending:true to signal the
            // backtester that this must be computed from the actual entry bar.
            const entryBarStop = null;  // dynamic — computed by backtester after fill
            const entryBarStopPending = true;
            
            // Step 3: Scalp partial target (1R from initial risk)  
            const scalpTarget = dir === 'long'
                ? entry + initialRisk * 1.0
                : entry - initialRisk * 1.0;
            
            // Step 4: Breakeven stop level (entry price, after partial scaled out)
            const breakevenStop = entry;
            
            // Step 5: Trailing stop rule description (carried as metadata)
            // Brooks: "trail below most recent Higher Low (bull) or above 
            // most recent Lower High (bear) using 2-bar swing points"
            const trailingRule = dir === 'long'
                ? 'trail_below_higher_lows_2bar_swing'
                : 'trail_above_lower_highs_2bar_swing';
            
            // Scale-out config (default 50% at 1R if not already set by V38)
            const scaleOutRatio = masterSignal._partialProfit?.ratio || 0.50;
            const swingHoldRatio = masterSignal._swingRatio || 0.20;
            
            return {
                sequence: 'signal_bar_stop → entry_bar_tighten → partial_scaleout → breakeven → trail',
                initialStop,                    // 1 tick beyond signal bar extreme
                entryBarStop,                   // null — dynamic, computed by backtester after entry bar closes
                entryBarStopPending,            // true — backtester must compute from actual entry bar extreme
                entryBarStopRule: dir === 'long'
                    ? 'move_stop_to_entry_bar_low'
                    : 'move_stop_to_entry_bar_high',  // Brooks rule for backtester
                scalpTarget,                    // 1R partial target
                breakevenStop,                  // entry price after partial
                trailingRule,                   // 'trail_below_higher_lows' or 'trail_above_lower_highs'
                scaleOutAtRR: 1.0,              // scale out at 1R
                scaleOutRatio,                  // % of position to scale out (default 50%)
                swingHoldRatio,                 // % to hold for swing trail
                tightenAfterEntryBarCloses: true,
                moveToBreakevenAfterPartial: true
            };
        })();

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
            swingRatio: masterSignal._swingRatio || 0,
            // ISSUE #8: Brooks trade management (dynamic stop tightening sequence)
            tradeManagement,
            // ISSUE #10: Always In / Swing mode metadata
            // Brooks (Ch 10, p.273-275; Guidelines #39):
            //   "A good alternative is to stay in the market most of the day,
            //    exiting on the close. Hold through repeated pullbacks unless
            //    the stop is hit. Work on increasing position size rather than
            //    on the number of trades."
            positionScaling: positionScalingMetadata
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