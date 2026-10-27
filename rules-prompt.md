# Comprehensive Rulebook for the "Elite-Quintet & Anchor-Fading" Trading System (95% WR Configuration)

update -

oct 1st  based on sept analysis
### **Core Clarification on Trade & Outcome Determination**

1. **Cluster Result Independence:** `ELITE_UBER_ENGINE` trades (and all `META_*` trades) are strictly excluded from determining the cluster’s baseline outcome. A cluster’s original result is evaluated **exclusively by whether the real, completed Base Versions hit `take_profit` or `stop_loss`**.
2. **Engine Decision Outcomes:**
   * **`PICK` Decision:** Evaluated in the Original Signal direction $\rightarrow$ **WIN** if Base Versions hit `take_profit`; **LOSS** if Base Versions hit `stop_loss`.
   * **`REVERSE` Decision:** Evaluated in the Inverted direction $\rightarrow$ **WIN** if Base Versions hit `stop_loss` (reversal target reached); **LOSS** if Base Versions hit `take_profit` (stopped out by original move).
3. **`UBER_ENGINE` Role:** `UBER_ENGINE` serves purely as an **external structural indicator** (identifying whether exhaustion/momentum is confirmed or contradicted), not as the arbiter of cluster P&L.

---

# **1. Re-Evaluated Dynamic Pattern Scorecard (Full Month: Sep 1 – Sep 30)**

Evaluated across all **274 trade clusters** using strict Base-Version settlement:

| Pattern ID | Pattern Condition & Description | Verified Wins / Trades | Win Rate | Engine Action Classification |
| :--- | :--- | :---: | :---: | :--- |
| **P-GEN-1** | **`REVERSE (P1 or Base)` with `UBER_ENGINE` Presence on Reversal Setups**<br>*(Both `S_ULTRA` & `T_MED` absent + Base versions in exhaustion)* | **22 / 24 Wins** | **91.7%** | **`[TAKE IN FAVOUR]`** *(Execute REVERSE)* |
| **P1-OVERRIDE** | **`P1 REVERSE` Overrides `META_*` Signals**<br>*(S_ULTRA & T_MED absent + `Ref2` present + count $\ge 3$ + Uber presence vs Meta bias)* | **4 / 4 Wins** | **100.0%** | **`[TAKE IN FAVOUR]`** *(Execute REVERSE)* |
| **P-TH-1** | **Thursday Expiry Post-13:00 `PICK` (Full Stack)**<br>*(Expiry afternoon trend pinning in equities/futures)* | **11 / 13 Wins** | **84.6%** | **`[TAKE IN FAVOUR]`** *(Execute PICK)* |
| **P-TU-2** | **Tuesday Cash Equity (`NSE_EQ`) `PICK` Superiority**<br>*(Post-12:00 IST full-cluster picks on Cash Equities)* | **9 / 11 Wins** | **81.8%** | **`[TAKE IN FAVOUR]`** *(Execute PICK)* |
| **P-WE-1** | **Wednesday Mid-Day Trend Pivots (11:00–13:30 IST)**<br>*(Primary institutional repositioning window: PICK & P1-Reverse)* | **5 / 5 Wins** | **100.0%** | **`[TAKE IN FAVOUR]`** *(Execute as Generated)* |
| **P-GEN-3** | **Late-Evening (20:30+ IST) Multi-Contract MCX `PICK`**<br>*(Energy & Metals breakout with `S_ULTRA + T_MED`)* | **7 / 7 Wins** | **100.0%** | **`[TAKE IN FAVOUR]`** *(Execute PICK)* |
| **P-TH-2** | **Thursday Morning (Pre-12:30 IST) Equity/Index `PICK`**<br>*(Full stack during opening range decay/expansion)* | **0 / 7 Wins** | **0.0%** *(100% Loss)* | **`[TAKE AGAINST DECISION / INVERT]`** *(Invert to REVERSE)* |
| **P-FR-2** | **Base `REVERSE` (No P1/Ref2) vs `META_*` Aligned Trades**<br>*(Simple base reversal failing against Meta directional dominance)* | **0 / 8 Wins** | **0.0%** *(100% Loss)* | **`[TAKE AGAINST DECISION / INVERT]`** *(Overrule $\rightarrow$ Execute PICK)* |
| **P-FR-3** | **US Macro Economic Data Release Window (18:00–19:00 IST) Bullion**<br>*(High-impact US data sweeps Gold & Silver)* | **0 / 5 Wins** | **0.0%** *(100% Loss)* | **`[TAKE AGAINST DECISION / INVERT]`** *(Mandatory BLOCK)* |
| **P-GEN-2** | **Overextended Rapid Re-Entry `PICK` (<20 mins on same instrument)**<br>*(Momentum exhaustion chasing extended breakouts)* | **0 / 3 Wins** | **0.0%** *(100% Loss)* | **`[TAKE AGAINST DECISION / INVERT]`** *(Block Entry / Fade)* |

---

# **2. Detailed Operational Rules for LLM / Automated Decision-Maker**

---

## **PART A: High-Conviction Rules (> 80% Win Rate) $\rightarrow$ `[TAKE IN FAVOUR]`**

### **RULE 1.1: `P-GEN-1` — The Uber-Confirmed Structural Reversal Rule**
* **Win Rate:** **91.7%** (22 Wins / 24 Trades)
* **Directive:** **`[TAKE IN FAVOUR: EXECUTE REVERSE]`**
* **Trigger Conditions:**
  1. `S_ULTRA` (`ELITE_V945A_S_ULTRA`) is **ABSENT**.
  2. `T_MED` (`ELITE_V945A_T_MED`) is **ABSENT**.
  3. `UBER_ENGINE` trade is **PRESENT** in the cluster.
  4. Base Versions show trend exhaustion at key levels.
* **Execution Parameters:**
  * **Direction:** **OPPOSITE** to Original Signal direction (Execute `REVERSE`).
  * **Entry Price:** Original Signal Entry Price.
  * **Take Profit (TP):** Original Signal Stop Loss Price.
  * **Stop Loss (SL):** Original Signal Take Profit Price.

---

### **RULE 1.2: `P1-OVERRIDE` — The P1-Breadth Meta Invalidation Rule**
* **Win Rate:** **100.0%** (4 Wins / 4 Trades)
* **Directive:** **`[TAKE IN FAVOUR: EXECUTE REVERSE]`**
* **Trigger Conditions:**
  1. `S_ULTRA` and `T_MED` are **ABSENT**.
  2. `P1` conditions are **MET** (Cluster version count $\ge 3$ **AND** at least one `Ref2` version is present: `V935A_N_MED`, `V935A_T_MED`, or `V955A_N_LOOSE`).
  3. `UBER_ENGINE` is **PRESENT** in the cluster.
  4. `META_*` derived trades (`ELITE_META_2_0`, `ELITE_META_THURSDAY`) are present in the original signal direction.
* **Execution Parameters:**
  * **Direction:** **OPPOSITE** to Original Signal direction (Execute `REVERSE`).
  * **Target (TP):** Original SL.
  * **Stop (SL):** Original TP.
* **LLM Ingestion Logic:** Broad `P1` version cluster breadth combined with `UBER_ENGINE` invalidates institutional `META_*` alignment. Overrule Meta bias and execute `REVERSE`.

---

### **RULE 1.3: `P-TH-1` — Thursday Expiry Afternoon Trend Pinning**
* **Win Rate:** **84.6%** (11 Wins / 13 Trades)
* **Directive:** **`[TAKE IN FAVOUR: EXECUTE PICK]`**
* **Trigger Conditions:**
  1. **Day of Week:** `Thursday` (Weekly/Monthly Expiry).
  2. **Timestamp:** $\ge$ `13:00 IST` (through `15:30 IST`).
  3. **Segment:** Equities or Equity Derivatives (`NSE_EQ`, `NSE_FO`).
  4. `S_ULTRA` is **PRESENT** **OR** `T_MED` is **PRESENT**.
  5. Cluster contains `V125A_N_LOOSE` **OR** `TIER_HIGH` versions.
* **Execution Parameters:**
  * **Direction:** Original Signal direction (Execute `PICK`).
  * **Entry / SL / TP:** Standard Original Parameters.

---

### **RULE 1.4: `P-TU-2` — Tuesday Cash Equity Momentum Superiority**
* **Win Rate:** **81.8%** (9 Wins / 11 Trades)
* **Directive:** **`[TAKE IN FAVOUR: EXECUTE PICK]`**
* **Trigger Conditions:**
  1. **Day of Week:** `Tuesday`.
  2. **Timestamp:** $\ge$ `12:00 IST`.
  3. **Instrument Segment:** Cash Equity (`NSE_EQ`).
  4. `S_ULTRA` is **PRESENT** **OR** `T_MED` is **PRESENT**.
* **Execution Parameters:**
  * **Direction:** Original Signal direction (Execute `PICK`).
  * **Entry / SL / TP:** Standard Original Parameters.

---

### **RULE 1.5: `P-WE-1` — Wednesday Mid-Day Trend Pivot (11:00–13:30 IST)**
* **Win Rate:** **100.0%** (5 Wins / 5 Trades)
* **Directive:** **`[TAKE IN FAVOUR: EXECUTE AS GENERATED]`**
* **Trigger Conditions:**
  1. **Day of Week:** `Wednesday`.
  2. **Time Window:** Between `11:00 IST` and `13:30 IST`.
  3. Valid cluster setup:
     * If `S_ULTRA` / `T_MED` present $\rightarrow$ **Execute PICK**.
     * If `S_ULTRA` & `T_MED` absent with `P1` or `P2` criteria met $\rightarrow$ **Execute REVERSE**.
* **Execution Parameters:**
  * Standard `PICK` or `REVERSE` mapping as generated by the core engine.

---

### **RULE 1.6: `P-GEN-3` — Late-Evening MCX Commodity Breakout ($\ge$ 20:30 IST)**
* **Win Rate:** **100.0%** (7 Wins / 7 Trades)
* **Directive:** **`[TAKE IN FAVOUR: EXECUTE PICK]`**
* **Trigger Conditions:**
  1. **Timestamp:** $\ge$ `20:30 IST`.
  2. **Segment:** Commodities (`MCX_FO` — Energy & Metals).
  3. `S_ULTRA` is **PRESENT** **AND** `T_MED` is **PRESENT**.
* **Execution Parameters:**
  * **Direction:** Original Signal direction (Execute `PICK`).
  * **Entry / SL / TP:** Standard Original Parameters.

---

## **PART B: Low-Conviction Rules (< 20% Win Rate) $\rightarrow$ `[TAKE AGAINST DECISION / INVERT]`**

---

### **RULE 2.1: `P-TH-2` — Thursday Morning Expiry Range Decay Inversion**
* **Win Rate:** **0.0%** (0 Wins / 7 Trades $\rightarrow$ **100% Failure Rate**)
* **Directive:** **`[TAKE AGAINST DECISION: INVERT PICK TO REVERSE]`**
* **Trigger Conditions:**
  1. **Day of Week:** `Thursday`.
  2. **Timestamp:** `< 12:30 IST`.
  3. **Segment:** Equities & Equity Derivatives (`NSE_EQ`, `NSE_FO`).
  4. Core Engine generated a `PICK` (`S_ULTRA` or `T_MED` present).
* **Inverted Execution Parameters:**
  * **Action:** **DO NOT FOLLOW ORIGINAL DIRECTION.**
  * **Inverted Execution:** Execute **`REVERSE`** (Take opposite direction).
  * **Target (TP):** Original Signal Stop Loss.
  * **Stop Loss (SL):** Original Signal Take Profit.
  * *(Alternative Risk Protocol: Complete Trade `BLOCK`)*.

---

### **RULE 2.2: `P-FR-2` — Meta-Aligned Reversal Trap Overrule**
* **Win Rate:** **0.0%** (0 Wins / 8 Trades $\rightarrow$ **100% Failure Rate**)
* **Directive:** **`[TAKE AGAINST DECISION: OVERRULE REVERSE -> EXECUTE PICK]`**
* **Trigger Conditions:**
  1. Core Engine generated a `REVERSE` based on Base or P2 alone (`S_ULTRA` & `T_MED` absent).
  2. `P1` conditions are **NOT MET** (`Ref2` absent OR version count $< 3$).
  3. `META_*` derived trades (`ELITE_META_2_0`, `ELITE_META_THURSDAY`) are **PRESENT** aligned with the original signal direction.
* **Inverted Execution Parameters:**
  * **Action:** **CANCEL THE REVERSAL.**
  * **Inverted Execution:** Execute **`PICK`** (Follow Original Signal Direction).
  * **Entry / SL / TP:** Standard Original Parameters.

---

### **RULE 2.3: `P-FR-3` — US Macro Economic Data Release Blackout (18:00–19:00 IST)**
* **Win Rate:** **0.0%** (0 Wins / 5 Trades $\rightarrow$ **100% Failure Rate**)
* **Directive:** **`[TAKE AGAINST DECISION: MANDATORY SIGNAL CANCELLATION / BLOCK]`**
* **Trigger Conditions:**
  1. **Time Window:** Between `18:00 IST` and `19:00 IST`.
  2. **Segment:** MCX Bullion (`MCX_FO` — Gold, Gold Mini, Gold Petal, Silver, Silver Mini, Silver Micro).
  3. Any signal generated (`PICK` or `REVERSE`).
* **Execution Directive:**
  * **Action:** **`BLOCK / CANCEL TRADE`**.
  * **Do NOT execute any order.** High-impact US data triggers two-way stop sweeps on Base Versions.

---

### **RULE 2.4: `P-GEN-2` — Overextended Rapid Re-Entry Filter (< 20 Minutes)**
* **Win Rate:** **0.0%** (0 Wins / 3 Trades $\rightarrow$ **100% Failure Rate**)
* **Directive:** **`[TAKE AGAINST DECISION: BLOCK ENTRY / FADE AS EXHAUSTION]`**
* **Trigger Conditions:**
  1. A new signal fires on the **SAME INSTRUMENT** $< 20$ minutes after an immediate prior WIN (`take_profit` hit by Base Versions).
  2. The signal targets an overextended continuation price in the same direction.
* **Execution Directive:**
  * **Action:** **`BLOCK ENTRY`** (Do not chase).
  * *(Aggressive Protocol: Invert to `REVERSE` to scalp the exhaustion mean-reversion pullback)*.

---

# **3. Master Decision Flowchart for LLM Prompt Ingestion**

```text
====================================================================================================
LLM REAL-TIME DECISION FLOWCHART
====================================================================================================

[STEP 1: TIME & MACRO FILTERS (BLOCK / INVERT PROTOCOLS)]
  │
  ├──► IF (Time is 18:00–19:00 IST AND Segment is MCX Bullion)
  │        └──► ACTION: BLOCK TRADE (Rule 2.3: P-FR-3)
  │
  └──► IF (Signal is <20 min repeat on same instrument after Base Version WIN)
           └──► ACTION: BLOCK / FADE EXHAUSTION (Rule 2.4: P-GEN-2)

[STEP 2: REVERSAL ENGINE EVALUATION (S_ULTRA & T_MED ARE ABSENT)]
  │
  ├──► IF (UBER_ENGINE is PRESENT AND P1 is MET [Ref2 present & Count >= 3] AND META is PRESENT)
  │        └──► ACTION: [TAKE IN FAVOUR] -> EXECUTE REVERSE (Rule 1.2: P1-OVERRIDE [100% Win])
  │
  ├──► IF (UBER_ENGINE is PRESENT)
  │        └──► ACTION: [TAKE IN FAVOUR] -> EXECUTE REVERSE (Rule 1.1: P-GEN-1 [91.7% Win])
  │
  ├──► IF (META_* is PRESENT AND P1 is NOT MET)
  │        └──► ACTION: [TAKE AGAINST DECISION] -> OVERRULE TO PICK (Rule 2.2: P-FR-2 [100% Fade])
  │
  └──► ELSE
           └──► ACTION: EXECUTE STANDARD BASE REVERSE

[STEP 3: PICK ENGINE EVALUATION (S_ULTRA IS PRESENT OR T_MED IS PRESENT)]
  │
  ├──► IF (Day is Thursday AND Time < 12:30 IST AND Segment is NSE_EQ / NSE_FO)
  │        └──► ACTION: [TAKE AGAINST DECISION] -> INVERT TO REVERSE (Rule 2.1: P-TH-2 [100% Fade])
  │
  ├──► IF (Day is Thursday AND Time >= 13:00 IST AND Full Stack / Tier_High Present)
  │        └──► ACTION: [TAKE IN FAVOUR] -> EXECUTE PICK (Rule 1.3: P-TH-1 [84.6% Win])
  │
  ├──► IF (Day is Tuesday AND Time >= 12:00 IST AND Segment is NSE_EQ)
  │        └──► ACTION: [TAKE IN FAVOUR] -> EXECUTE PICK (Rule 1.4: P-TU-2 [81.8% Win])
  │
  ├──► IF (Day is Wednesday AND Time is 11:00–13:30 IST)
  │        └──► ACTION: [TAKE IN FAVOUR] -> EXECUTE PICK (Rule 1.5: P-WE-1 [100% Win])
  │
  ├──► IF (Time >= 20:30 IST AND Segment is MCX Commodities AND Both S_ULTRA & T_MED Present)
  │        └──► ACTION: [TAKE IN FAVOUR] -> EXECUTE PICK (Rule 1.6: P-GEN-3 [100% Win])
  │
  └──► ELSE
           └──► ACTION: EXECUTE STANDARD BASE PICK
====================================================================================================
```
----------------------------------------------------------------------------------------------

This document provides the formalized instructions for the **VP (Unanimity)** and **AP (Structural)** Rule Engines. Use these criteria to audit JSON trade data clusters grouped by instrument and timestamp.

---

### **0. Mandatory Pre-Filtering (Global Constraints)**
Before applying engine logic, all data must pass these three gates:
1.  **Bar Type Constraint:** Process **ONLY** entries where `"bar_type": "volume"`. If a cluster is based on `"bar_type": "price"`, categorize immediately as **VETO**.
2.  **Version Exclusion:** Completely ignore any version containing the strings `"META"` or `"UBER"`.
3.  **Primary Version Definitions:**
    *   **The Power Trio:** `ELITE_V935A_TIER_HIGH` (935HT), `ELITE_V955A_TIER_HIGH` (955HT), and `ELITE_V945A_S_ULTRA` (945S).
    *   **The Loose Logic:** Any version of `ELITE_V125A` (T_MED, TIER_LOW, N_LOOSE).
    *   **The Conflict Logic:** `ELITE_V945A_T_MED` (945T).

---

### **1. Rule Engine 1: VP (The Unanimity Engine)**
**Philosophy:** Market momentum is valid only when algorithms reach absolute mathematical parity.

#### **1.1 VP-PICK (Valid Entry)**
Must satisfy all four:
1.  **Full Trio Presence:** All 3 members (935HT, 955HT, 945S) must be present.
2.  **Confidence Parity:** All 3 Trio members must have the **exact same** `"confidence"` value.
3.  **Threshold Parity:** All 3 Trio members must have the **exact same** `"threshold"` value.
4.  **V125 Alignment:** If any `V125A` version is present, its `"entry"` price must be **mathematically identical** to the Trio. (If V125 is absent, this pillar is ignored).

#### **1.2 VP-REVERSAL (Confirmed Trap)**
1.  **Rule R-V1 (MCX Exhaustion):** Instrument is `MCX_FO` AND Trio `"confidence"` $\ge 75\%$.
2.  **Rule R-V2 (Solo V125A):** A `V125A` version triggers, but **no** 935HT or 955HT is present on the bar **AND** V125 `"confidence"` is $> 70\%$.
3.  **Rule R-V3 (The Divergence Trap):** The Full Trio is present, but a `V125A` version triggers at a **different entry price** (any decimal divergence) **AND** V125 `"confidence"` is $> 70\%$.
4.  **Rule R-V4 (Confidence Spread):** The Power Trio is present, but their `"confidence"` scores are not identical.

#### **1.3 VP-VETO (Noise Skip)**
1.  Incomplete Trio (missing one or more members).
2.  Divergence exists (Rule R-V2 or R-V3), but V125 `"confidence"` is $\le 70\%$.

---

### **2. Rule Engine 2: AP (The Structural Conflict Engine)**
**Philosophy:** Strategic entries based on instrument class behavior and version conflict.

#### **2.1 AP-PICK (Strategic Entry)**
1.  **Balanced Trio (NSE_FO):** Full Trio is present. A confidence spread of up to 5% is allowed only if the instrument is `NSE_FO`.
2.  **Balanced Trio (NSE_EQ):** Full Trio is present. Confidence spread must be 0%.
3.  **FO Momentum Clause:** If instrument is `NSE_FO`, a **Partial Trio** (at least 945S + one other member) is a PICK if `"confidence"` is strictly between **55% and 65%**.

#### **2.2 AP-REVERSAL (Structural Trap)**
1.  **Rule R-A1 (T_MED Conflict):** Power Trio triggers, but `ELITE_V945A_T_MED` is present with `"confidence"` $\ge 70\%$.
2.  **Rule R-A2 (Equity Confidence Cap):** Instrument is `NSE_EQ` AND `"confidence"` is $\ge 70\%$.
3.  **Rule R-A3 (Price Leadership):** A `V125A` version triggers at a **more aggressive price** (Lower for SELL, Higher for BUY) than the Trio **AND** its `"confidence"` is $\ge 70\%$.
4.  **Rule R-A4 (MCX Climax):** Instrument is `MCX_FO` AND `"confidence"` $\ge 75\%$.

#### **2.3 AP-VETO (Safety Skip)**
1.  Partial Trios on `NSE_EQ` (Cash).
2.  Any Divergence (Price/Conf) where Trio `"confidence"` is $\le 65\%$.

---

### **3. Order of Operations & Conflict Resolution**
When auditing a cluster, you must follow this hierarchy:
1.  **Pre-Filter Check:** If bar is "price", result is **VETO**.
2.  **VP Audit:** Run all VP rules first.
3.  **AP Audit:** Run all AP rules second.
4.  **Final Priority:** If the engines disagree, the **REVERSAL** status takes absolute precedence. 
    *   *Example:* If VP says PICK but AP says REVERSAL, the final action is **REVERSAL**.
    *   *Example:* If VP says VETO but AP says REVERSAL, the final action is **REVERSAL**.

---

### **4. Required Output Format**
For every analyzed cluster, provide the following output:

**[Instrument Name] | [Timestamp]**
*   **VP Decision:** [PICK / REVERSAL / VETO] -> [Cite Rule #]
*   **AP Decision:** [PICK / REVERSAL / VETO] -> [Cite Rule #]
*   **Logic Breakdown:** [Concise explanation of the version synchronization, confidence levels, and any price divergences noted].
*   **FINAL ACTION:** [The final definitive action based on the priority hierarchy].
*   **ACTUAL OUTCOME:** [TP / SL / Cancelled based on the JSON `exitReason` and `status`].


-------------------------------------------------------------------------------------------------------------------------
These two comprehensive rule engine definitions are designed for a Large Language Model (LLM) to act as a logic-gate auditor. They provide high-granularity instructions for processing trading data, identifying entries (PICK), anticipating failures (REVERSAL), and filtering noise (VETO).

---

# Rule Engine 1: VP (The Unanimity Engine)

### 1. Fundamental Philosophy
The VP Rule Engine operates on the principle of **Mathematical Parity**. It assumes that true market momentum is only captured when the underlying software algorithms (the Base Versions) reach a state of absolute consensus. Any minor divergence in decimal values, confidence scores, or volume thresholds is interpreted as "Software Hesitation," signaling an unreliable trade.

### 2. Operational Constraints
*   **Bar Type Constraint:** EXCLUSIVELY process `"bar_type": "volume"`. If the data entry contains `"bar_type": "price"`, it must be immediately discarded.
*   **Version Scope:** Only consider `ELITE_V935A_TIER_HIGH`, `ELITE_V955A_TIER_HIGH`, and `ELITE_V945A_S_ULTRA` as the "Power Trio."
*   **Exclusion List:** Ignore any JSON objects where the `"version"` contains the strings `META` or `UBER`.

### 3. Category: PICK (The Valid Entry)
For a set of trades at a specific `timestamp` and `instrument` to be classified as a **VP-PICK**, it must satisfy the **Four Pillars of Unanimity**:

#### 3.1. Pillar One: The Full Trio Presence
All three versions (`935HT`, `955HT`, and `945S`) must exist within the same timestamp group. If even one is missing, the unanimity is broken.

#### 3.2. Pillar Two: Confidence Parity
Every member of the Power Trio must report the exact same integer value for `"confidence"`. 
*   *Example:* If 935HT is 65%, 955HT is 65%, but 945S is 60%, this Pillar fails.

#### 3.3. Pillar Three: Threshold Parity
Every member of the Power Trio must report the exact same value for `"threshold"`. The threshold is the volume sensitivity; disagreement here suggests the versions are looking at different layers of liquidity.

#### 3.4. Pillar Four: The V125A Price Alignment
If any version of `ELITE_V125A` (e.g., `T_MED`, `TIER_LOW`, `N_LOOSE`) triggers on the same bar, its reported `"entry"` price must be **mathematically identical** to the entry price of the Power Trio versions.
*   *Note:* In VP, V125A is considered a "loose" version. If it triggers at even a 0.01 divergence from the "High" versions, it suggests the price action is messy and lacks clean momentum.

### 4. Category: REVERSAL (The Exhaustion Trap)
The VP Engine identifies a **REVERSAL** when the software signals are strong but structurally compromised. These are trades where an SL is 100% expected.

#### 4.1. Rule R1: MCX Exhaustion
Any trade where the `"instrument"` prefix is `MCX_FO` AND the `"confidence"` value is $\geq$ 75%. In the VP logic, high confidence on MCX signifies a "blow-off" volume climax rather than a sustainable pullback.

#### 4.2. Rule R2: Solo V125A Divergence
If a `V125A` version triggers, but **no** 935HT or 955HT version is present on that bar, it is a REVERSAL. This indicates the "Loose" logic is catching a falling knife that the "Elite" logic has correctly ignored. 

#### 4.3. Rule R3: The Divergence Trap
If the Power Trio triggers, but the `V125A` version triggers at a **different entry price** (even by the smallest tick), the VP engine reclassifies the entire cluster from PICK to REVERSAL.

#### 4.4. Rule R4: Confidence Spread
If the Power Trio is present but the `"confidence"` scores among them are not identical, this is a REVERSAL. This represents internal system conflict.

### 5. Category: VETO (The Noise Filter)
Any trade scenario that does not fit the strict mathematical sync of a PICK, nor the specific trap patterns of a REVERSAL, is a **VETO**. These are simply skipped as "no-man's-land" data.

---
---

# Rule Engine 2: AP (The Structural Conflict Engine)

### 1. Fundamental Philosophy
The AP Rule Engine operates on the principle of **Structural Harmony**. Unlike VP, which looks for identical numbers, AP looks for **Version Synergies** and **Instrument Class behaviors**. It acknowledges that Futures (FO) and Cash Equity (EQ) move differently. AP is designed to be more inclusive of winning trades by understanding momentum context, while using "Conflict Versions" to filter out losses.

### 2. Operational Constraints
*   **Bar Type Constraint:** EXCLUSIVELY process `"bar_type": "volume"`.
*   **Version Scope:** Primary focus on the "Power Trio" (`935HT`, `955HT`, `945S`), but incorporates `V945A_T_MED` as a specific conflict filter.
*   **Exclusion List:** Ignore `META` and `UBER` versions.

### 3. Category: PICK (The Strategic Entry)
A trade is classified as an **AP-PICK** under two distinct pathways:

#### 3.1. Pathway One: The Balanced Trio
The Power Trio (`935HT`, `955HT`, `945S`) triggers on the same bar. 
*   **Refinement:** Unlike VP, AP allows for a **Confidence Spread of up to 5%** (e.g., 70% and 65% are acceptable) **PROVIDED** the instrument is **NSE_FO (Futures)**. 
*   **Instrument Class Sensitivity:** If the instrument is **NSE_EQ (Cash)**, the Trio must have identical confidence.

#### 3.2. Pathway Two: The FO Momentum Clause
In **NSE_FO (Futures)** instruments only, a **Partial Trio** (2 out of 3 versions present) is an acceptable PICK if:
*   The reported `"confidence"` is strictly between **55% and 65%**.
*   **V945A_S_ULTRA** is one of the two present versions.

### 4. Category: REVERSAL (The Conflict & Price Climax)
AP defines a **REVERSAL** using "Conflict Logic." It looks for specific versions that, when paired with the Trio, signal a reversal.

#### 4.1. Rule R-AP1: The T_MED Conflict
If the Power Trio triggers, but **ELITE_V945A_T_MED** is also present on the *same volume bar* with a **Confidence score $\ge$ 70%**, the trade is a **REVERSAL**.
*   *Logic:* In the AP model, the `T_MED` version acts as a "climax detector." When it joins a high-confidence Trio move, it signifies that the pullback has turned into an exhaustion reversal.

#### 4.2. Rule R-AP2: The Equity Confidence Cap
If the instrument is **NSE_EQ (Cash)** AND the `"confidence"` is $\geq$ 70%, it is a **REVERSAL**.
*   *Logic:* High-value cash stocks cannot sustain the same volume intensity as futures. A 70%+ confidence volume spike in Cash EQ is almost always a liquidity trap for retail traders.

#### 4.3. Rule R-AP3: The V125 Price Leadership Trap
If `V125A` triggers at a "better" price (lower for SELL, higher for BUY) than the Trio, it is a **REVERSAL**. This is called "Aggressive Front-running." If the loose logic is leading the price, the move is structurally unsound.

#### 4.4. Rule R-AP4: MCX Climax
Identical to VP: Any `MCX_FO` trade with `"confidence"` $\geq$ 75% is a REVERSAL.

### 5. Category: VETO (The Safety Skip)
AP uses VETO for setups that are "Strong but Suspicious."
*   **Partial Trios on Cash:** Any incomplete Trio on an `NSE_EQ` instrument is a **VETO**.
*   **Low-Confidence Divergence:** If a Trio triggers with a price divergence but the Confidence is $< 55\%$, it is a **VETO** (too weak to even be a reversal).

---

# Comparison Summary for LLM Processing

| Feature | VP (Unanimity Engine) | AP (Structural Engine) |
| :--- | :--- | :--- |
| **Price Alignment** | Must be 100% Identical | Allows divergence in FO if R-AP3 is met |
| **Confidence** | Must be 100% Identical | Allows 5% spread in FO; Caps EQ at 70% |
| **Threshold** | Must be 100% Identical | Values can differ if versions agree on direction |
| **Partial Trios** | Always a VETO | Allowed for NSE_FO (55-65% Conf) |
| **Conflict Version**| Ignored | Uses `V945A_T_MED` as a Reversal Trigger |
| **Goal** | Zero-loss safety | High-volume capture with conflict filters |

**Final Instruction:** When provided with data, run the audit through **VP** first to find "Perfect Syncs," then run through **AP** to find "Strategic Syncs" and "Structural Traps." If a trade is a PICK in VP but a REVERSAL in AP, the **AP REVERSAL takes precedence**.

This prompt is designed to instruct an LLM to act as a **Trading Auditor**. It defines the core logic, the mandatory "Power Trio" version requirements, and the refinements that separate high-probability wins from traps.

***
# Prompt for Trading Audit Analysis

**Role:** You are a Professional Trading Strategy Auditor specializing in volume-based pullback analysis. Your goal is to process a JSON list of trades and categorize them into **PICK**, **REVERSAL**, or **VETO** based on strict synchronization rules between specific software versions.

### **Mandatory Context**
1. **Volume Bars Only:** Only analyze trades where `"bar_type": "volume"`. Ignore all "price" bar trades.
2. **The Power Trio:** The core of the strategy is the synchronization of three specific versions:
   - `ELITE_V935A_TIER_HIGH`
   - `ELITE_V955A_TIER_HIGH`
   - `ELITE_V945A_S_ULTRA`
3. **Versions to Ignore:** Completely ignore any version containing `META` or `UBER` in the name. They are not part of the base version analysis.

---

### **Category 1: PICK (High Probability Entry)**
A trade is classified as a **PICK** only if it meets all the following criteria:
1. **Full Trio Synchronization:** All three versions of the **Power Trio** must trigger on the same bar (same instrument and same timestamp).
2. **Confidence Unanimity:** Every member of the Power Trio must have the **exact same** `"confidence"` value.
3. **Threshold Unanimity:** Every member of the Power Trio must have the **exact same** `"threshold"` value.
4. **V125 Alignment:** If any `V125A` version triggers on the same bar, its `"entry"` price must be **mathematically identical** to the Power Trio's entry price.

---

### **Category 2: REVERSAL (Confirmed Trap - Avoid/Reverse)**
A trade is classified as a **REVERSAL** if it indicates a high-probability stop-loss for the initial direction. This is triggered by any of the following:
1. **MCX Exhaustion:** The instrument is an MCX commodity (`MCX_FO`) AND the `"confidence"` is $\geq 75\%$.
2. **Solo V125A:** A `V125A` version triggers, but **no** 935 or 955 version triggers at that same timestamp/price.
3. **Divergence Trap:** The Power Trio triggers, but the `V125A` version triggers at a **different `"entry"` price** (even by 1 tick). This signals that the "loose" logic is chasing a move that the "elite" logic hasn't fully confirmed.
4. **Confidence Spread:** The Power Trio triggers, but their `"confidence"` scores are **not identical** (e.g., one is 70% and another is 65%).

---

### **Category 3: VETO (No Action - Skip)**
A trade is classified as a **VETO** if it is neither a high-probability win nor a confirmed trap. Skip these:
1. **Incomplete Trio:** Any trade where one or more members of the **Power Trio** are missing from the trigger bar.
2. **Version Gaps:** Any trade triggered by solo versions that are not `V125A` (e.g., just a 955_N_LOOSE triggering alone).

---

### **Instructions for Processing:**
1. Scan the provided trade list for **Volume Bars** only.
2. Group trades by `timestamp` and `instrument`.
3. Check for the presence of the **Power Trio**.
4. Apply the **Refinements** (Unanimous Confidence/Threshold and V125 Price Sync).
5. Output the results in the following format for each identified scenario:
   - **Instrument Name:** 
   - **Timestamp:**
   - **Category:** (PICK / REVERSAL / VETO)
   - **Reason:** (Cite the specific rule/refinement, e.g., "R2.3 Divergence Trap")
   - **Outcome:** (TP / SL based on the `exitReason` in the log)


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