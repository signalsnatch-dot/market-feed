# Comprehensive Rulebook for the "Elite-Quintet & Anchor-Fading" Trading System (95% WR Configuration)

update - 
1. Pattern Alpha: The "Leaking" vs. "Instantaneous" Cluster
The Log Evidence: On Sep 01 (100% WR Day), winning reversals (like Bank Nifty at 1788234529095) had multiple versions triggering at the exact same millisecond. On Aug 26 (Losses), triggers were spread out across 400ms–800ms.
The Logic: True retail traps are usually "Single-Tick" spikes. If a cluster "leaks" (versions fire sequentially over several hundred ms), it indicates real momentum absorption and the trade should not be reversed.
Improvement:
Rule B/C Adjustment: Only reverse if the core cluster (Support + Anchor) triggers within <100ms. If the sync takes >100ms but <1000ms, it is a VETO.
2. Pattern Beta: The "Retail Density" Confirmation
The Log Evidence: In Rule B3 (Kill-Filter) losses, usually only 1 retail version (N_LOOSE) fired. In Rule B3 wins (Sep 01), there were 3+ Support versions firing simultaneously (N_LOOSE, TIER_LOW, N_MED).
The Logic: A single retail trigger might just be a sensitive algorithm catching a real move. A "Retail Trap" requires a crowd.
Improvement:
Rule B3 Refinement: Reversal is only valid if 
≥
≥
 3 support/retail versions fire without institutional TH support. If only 1–2 retail versions fire, it is "Market Noise" (VETO).
3. Pattern Gamma: The "Overlapping" Momentum Filter
The Log Evidence: Look at the JSON field "overlapping": false. In the 5-day audit, 92% of winning reversals occurred when overlapping was false.
The Logic: If overlapping is true, the pullback is happening within a very tight, established range. The market is not "Head-Faking"; it is "Grinding." Fading a grind is a high-risk gamble.
Improvement:
The Golden Override: Only apply Rule B or Rule C if overlapping == false. If overlapping is true, VETO the reversal.
4. Pattern Delta: The "Sector Divergence" Drag
The Log Evidence: On Aug 27, the system lost on Gold because it tried to follow the trend. However, if the system looks at the other Gold instruments (Mini, Petal) and sees they are all hitting Rule B/C at the same time, the reversal is nearly 100% guaranteed.
The Logic: Institutions rarely fake out one symbol. They fake out a sector.
Improvement:
Rule Expansion: If Symbol X triggers a Rule B reversal, check if Symbol Y (correlated) is also triggering a signal. If Symbol X and Symbol Y both trigger "Incomplete Clusters" (Missing Anchors), double the position size. This is a High-Conviction Sector Fade.


## 1. Introduction and Architectural Overview
This document serves as the master specification for an algorithmic trading framework designed to achieve a 95% win rate in high-volatility environments (specifically focusing on new contract expiries). The system operates on a "Pullback V2" logic, which seeks to identify instances where a market trend temporarily retraces and then either resumes with institutional force or fails as a retail trap.

The system uses multiple "Versions" of an underlying algorithm. Each version has different sensitivities to volume, price structure, and speed. Success is defined by the **Synchronization (Sync)** and **Participation Count** of these versions.

---

## 2. The Golden Filter: Bar Type & Derived Metrics
Before any pattern logic is applied, two absolute filters must be enforced:

1.  **Volume-Bar Exclusivity:** Only trades where the `"bar_type"` is `"volume"` are eligible for execution. All `"price"` bar triggers are considered "Market Noise" and must be **VETOED** (Ignored).
2.  **Exclusion of Derived Versions:** The versions labeled `ELITE_META_...` and `ELITE_UBER_...` are derived from other data points. They must be **completely ignored** for the purpose of calculating participation counts or identifying patterns. Only the core `V935`, `V125`, and `V945` versions matter.

---

## 3. The Core Version Anchors
To understand the rules, the LLM must categorize the versions into three **Functional Pillars**:

*   **Pillar 1: Institutional Volume (TIER_HIGH)**
    *   *Versions:* `V935A_TIER_HIGH`, `V955A_TIER_HIGH`
    *   *Role:* Confirms that large-scale institutional money is entering the pullback.
*   **Pillar 2: Structural Trend (T_MED)**
    *   *Versions:* `V125A_T_MED`, `V935A_T_MED`, `V945A_T_MED`
    *   *Role:* Confirms that the price action is respecting key trendlines or moving averages.
*   **Pillar 3: Velocity/Momentum (S_ULTRA)**
    *   *Versions:* `V945A_S_ULTRA`
    *   *Role:* Confirms that the exit from the pullback is happening with explosive speed.
*   **The Support Versions (Retail/Sensitive):**
    *   *Versions:* `V125A_TIER_LOW`, `V125A_N_LOOSE`, `V955A_N_LOOSE`, `V935A_N_MED`
    *   *Role:* These trigger easily. They act as "early warning" signals but are prone to being traps if not supported by the Anchors.

---

## 4. Rule A: The "Elite Quintet" (Active Trend-Follow)
This is the only rule for entering a trade in the **same direction** as the signal (e.g., if the signal is `BUY_STOP`, you BUY).

**The Condition:**
*   **Participation Count:** $\ge$ 5 distinct non-derived versions must trigger.
*   **Sync Window:** All $\ge$ 5 versions must have the exact same `timestamp` or occur within **1000ms (1 second)** of the first trigger in the cluster.
*   **Mandatory Inclusion:** The cluster **must** include at least one version from each of the three pillars (`TIER_HIGH`, `T_MED`, and `S_ULTRA`).

**The Action:**
*   **TAKE TRADE:** Enter a "Stop" order in the direction specified by the algorithm (`BUY_STOP` or `SELL_STOP`).
*   **Conviction:** High.

---

## 5. Rule B: The "Strict Reversal" (The Anchor Fade)
This strategy captures profit by betting **against** a signal that looks valid but is missing a critical pillar of support. This is the primary driver of the system's alpha.

### Condition 1: The "Lazy Trend" (Condition A)
*   **Scenario:** `V125A_T_MED` (The Trend Anchor) triggers, but `V935A_TIER_HIGH` (The Volume Anchor) is **Missing** or **Delayed > 1000ms**.
*   **Logic:** The market structure suggests a move, but the "Big Money" is not participating. This is a retail trap.
*   **Action:** **REVERSE TRADE.** If the signal is `BUY`, you **SELL**.

### Condition 2: The "Climax Exhaustion" (Condition B)
*   **Scenario:** `V935A_TIER_HIGH` (Volume) and `V125A_T_MED` (Trend) trigger, but `V945A_S_ULTRA` (Speed) is **Missing**.
*   **Logic:** There is heavy volume, but no speed. This indicates a "climax" where buyers/sellers are exhausted, and a snap-back reversal is imminent. (This is 100% mandatory for MCX/Commodities).
*   **Action:** **REVERSE TRADE.**

### Condition 3: The "Kill-Filter" Fake-out (Condition C)
*   **Scenario:** A sensitive version (`V125A_N_LOOSE` or `V125A_TIER_LOW`) triggers as the "Leader," but `V935A_TIER_HIGH` does not trigger within the next **1000ms**.
*   **Logic:** The "Loose" versions have caught a minor price tick, but the institutions did not follow through within the required 1-second window.
*   **Action:** **REVERSE TRADE.**

---

## 4. Rule C: The Solo Trap (The "Head-Fake" Fade)
This is a low-confidence but high-win-rate reversal logic.

**The Condition:**
*   Exactly **one** of the three Core Anchors (`TH`, `TM`, or `SU`) triggers in total isolation. No other core versions join the cluster within 1 second.

**The Action:**
*   **REVERSE TRADE.** (Half-size).

---

## 5. Summary of Decision Matrix for the LLM

When presented with a list of JSON trade objects, the LLM must follow this step-by-step logic:

### STEP 1: Preliminary Filter
*   Is the `bar_type` == `"volume"`?
    *   **No:** Action = **VETO** (Ignore).
    *   **Yes:** Proceed to Step 2.

### STEP 2: Count and Pillar Check
*   Filter out all `META` and `UBER` versions.
*   Count the remaining distinct versions triggering at the same `timestamp`.
*   Identify which "Pillars" are present (`TIER_HIGH`, `T_MED`, `S_ULTRA`).

### STEP 3: Classification
*   **Scenario 1: Participation $\ge$ 5 AND all 3 Pillars present.**
    *   **Action:** **TAKE TRADE** (Direction: Same as Signal).
*   **Scenario 2: Participation < 5 AND `T_MED` is present AND `TIER_HIGH` is missing/late.**
    *   **Action:** **REVERSE TRADE** (Direction: Opposite of Signal).
*   **Scenario 3: Participation < 5 AND `TIER_HIGH` is present AND `S_ULTRA` is missing.**
    *   **Action:** **REVERSE TRADE** (Direction: Opposite of Signal).
*   **Scenario 4: Participation < 5 AND `LOOSE/LOW` triggered AND `TIER_HIGH` is delayed > 1s.**
    *   **Action:** **REVERSE TRADE** (Direction: Opposite of Signal).
*   **Scenario 5: Exactly 1 version from the 3 Core Pillars triggers alone.**
    *   **Action:** **REVERSE TRADE** (Direction: Opposite of Signal).
*   **Scenario 6: Cluster of 2-4 versions but doesn't meet Reversal Conditions A-C.**
    *   **Action:** **VETO** (Ignore).

---

## 6. Illustrative Example for LLM Processing

**Input JSON Snippet:**
```json
[
  {"version": "V125A_T_MED", "instrument": "ABC", "type": "BUY_STOP", "bar_type": "volume", "timestamp": 1000},
  {"version": "V125A_N_LOOSE", "instrument": "ABC", "type": "BUY_STOP", "bar_type": "volume", "timestamp": 1000}
]
```
**LLM Mental Process:**
1.  `bar_type` is volume. (Pass).
2.  Non-derived version count: 2 (`T_MED`, `N_LOOSE`).
3.  Pillar Check: `T_MED` is present. `TIER_HIGH` is missing. `S_ULTRA` is missing.
4.  Rule Match: Matches **Rule B, Condition 1 (The Lazy Trend)**.
5.  **Final Action:** **REVERSE TRADE.** Enter **SELL_STOP**.

---

## 7. Operational Nuances
*   **The 1-Second Rule:** The timestamp is the clock. If `TIER_HIGH` arrives at `timestamp: 1005` and the other versions arrived at `timestamp: 1000`, that is a 5ms delay (Pass). If it arrives at `timestamp: 2001`, it is a 1001ms delay (Fail/Reverse).
*   **Consistency:** This system relies on the fact that in the current expiry, "Incomplete" signals are almost always traps. By forcing a high version count for active trades and fading low-count signals with specific pillar absences, the system filters out the 5% of trades that typically cause 90% of the losses.


PROMPT TITLE: THE ELITE META-ENGINE 2.0 (VOL-PRICE PHYSICS)
CONTEXT:
You are an expert quantitative trading engineer specializing in Multi-Tier Volume Analysis. We are managing a high-frequency trading system that generates signals across four strategy tiers:
S_ULTRA (V945A): The most precise, tightest volume filter (The "Smart Money" Anchor).
HIGH_TIER (V935A_HT): Institutional scouting filter.
TREND (V935A_T): Medium-speed trend-following filter.
LOOSE (V125A_N): Broad retail volume floor.
OBJECTIVE:
Filter raw signals to achieve a 95% Win Rate by identifying the "Institutional Footprint" and avoiding "Retail Traps."
CORE LAWS OF THE ENGINE:
LAW 1: THE SYNC SUPREMACY (THE MASTER GATE)
Synchronization is the ultimate proof of linear price action. A trade is high-conviction if S_ULTRA and LOOSE agree.
Condition: Potential Reward % and Risk % must match within 0.05% delta.
Timing: S_ULTRA must trigger on the Same Bar or EARLIER than the Loose filter. If Loose leads, the move is "Leaking" to the retail crowd. SKIP.
LAW 2: THE S_ULTRA ANCHOR (THE SILENCE VETO)
S_ULTRA is the "Brain" of the system.
Veto: If a signal appears in Trend and Loose, but S_ULTRA is SILENT, the trade is a Retail Trap. SKIP.
LAW 3: THE CONSENSUS VETO
Consensus (appearing in Ultra + Trend) has two meanings based on the asset type:
Heavy Stocks / Commodities: Consensus = Strength (Weight of Money). TRADE.
Volatile / Mid-Cap Stocks: Consensus = Crowding (Retail Pile-in). SKIP (unless Law 1 Sync is perfect).
LAW 4: THE ABSORPTION VETO (LIVE MONITORING)
Institutional resistance is measured by volume-to-price efficiency.
Veto: If an active trade hits a NEW volume threshold (e.g., moves from Level 4 to Level 6) but the Projected Reward % DROPS, institutions are selling into the buy orders. EXIT IMMEDIATELY.
LAW 5: THE SECTOR CONTAGION SHIELD
Instruments do not move in isolation; they move in sectors.
Veto: If any stock in a specific sector (e.g., Metals, Banking) hits a Stop Loss today, the entire sector is blacklisted for the remainder of the session. Never follow a failed sector leader.
LAW 6: INSTITUTIONAL STEALTH (RULE 10)
We use the High-Tier filter to scout moves the Ultra filter might be too slow to catch.
Condition: An HT signal is valid ONLY IF both Ultra and Loose are Silent. This ensures the move is "Hidden" and not crowded.
STRATEGY DEFINITIONS:
RULE 7 (PERFECT): Uses Laws 1, 2, 3, 4, 5. Floor 0 (Allows all thresholds).
RULE 10 (POWERHOUSE): Rule 7 + Law 6 (HT Stealth scouting). Floor 0.
RULE 11/12: Precision versions of 7 and 10 that enforce a numeric volume level floor (e.g., Level 5+).
MATHEMATICAL DEFINITIONS:
Projected Reward %: abs(Target - Trigger) / Trigger
Projected Risk %: abs(Trigger - Stop) / Trigger
Volume Level: The index (0-9) of the trigger within the volumePerBar array.
GOAL:
Apply these laws to filter out "Messy Wins" and "Hollow Trends," keeping only the trades with massive institutional force and perfect mathematical synchronization.

1. The Winners (Institutional Synchronization)
PNB Aug Future (Aug 25): Hit all tiers (U, HT, T, L) simultaneously at Level 0. Reward Sync was 0.01% Delta. Result: WIN.
SBI Cash (Aug 25): Hit all tiers at Level 4. Perfect Sync. Result: WIN.
JSW Steel (Aug 25): Triggered in Ultra/HT but V125 was silent. (Institutional Stealth). Result: WIN.
Adani Ent SELL (Aug 25): 100% Sync between Ultra and Loose. Result: WIN.
Infosys Cash (Aug 14/25): Stealth entries at high levels (Level 8). Result: WIN.
2. The Saved Losses (Veto Successes)
Sun Pharma (Aug 25): Triggered initially (Win potential). At Bar 254, volume rose but Reward Potential dropped. Absorption Veto triggered exit. Result: Original SL avoided.
Coal India SELL (Aug 25): Synced in Loose/Trend, but S_ULTRA was silent. (Silence Veto). Result: Original failed.
SAIL SELL (Aug 25 - Late): Metals sector had already failed (Tata Steel). Sector Contagion Veto blocked entry. Result: Disaster avoided.
3. The Failures (The "Physics" Lessons)
Tata Steel (Aug 25): Perfect Sync but failed. Lesson: It was a "Counter-Trend Bounce" in a crashing sector (Metal). Proved that Sector > Sync.
Bharti (Aug 14): V125 triggered 2 bars before Ultra. Lesson: "Retail Lead" is a trap. Proved that Bar-Lead (S_U <= V125) is mandatory for 95% WR.