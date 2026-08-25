These rules are designed to optimize the **ELITE_V945A_S_ULTRA** strategy. They are categorized into **Base Rules** (standard operation), **High-Precision Refinements** (to reach 90%+ WR), and **Asset-Specific Rules** (Commodities/Futures).

UPDATE: 

To hit the 95% goal, the Meta-Engine no longer asks "What stock is this?" It asks "How efficient is the volume?"

#### **Step 1: Entry Logic (Gated Hierarchy)**
1.  **Gate 1: The Sync Master (Bypasses all other filters)**
    *   **Condition:** $S\_ULTRA$ and $V125\_Loose$ trigger on the **Same Bar** with Reward/Risk delta $\le 0.05\%$.
    *   **Action:** **TRADE ANY INSTRUMENT.** (This captured PNB, BHEL, and Tata Motors).
2.  **Gate 2: Institutional Stealth**
    *   **Condition:** $S\_ULTRA$ is the **Only** signal (Loose/Trend are silent).
    *   **Action:** **TRADE ANY INSTRUMENT.** (Institutional "Silent Spike" - captured JSW Steel).
3.  **Gate 3: Heavy Weight**
    *   **Condition:** In $S\_ULTRA$ and $V935\_Trend$.
    *   **Validation:** Instrument is **Heavy Stock** or **Commodity**.
    *   **Action:** **TRADE.** (Momentum confirmation).

#### **Step 2: The Logic Vetoes (Skip Triggers)**
*   **Veto 1: S_ULTRA Silence**
    *   **Condition:** Synced signal exists in other versions, but **S_ULTRA is SILENT**.
    *   **Action:** **SKIP.** (Saved Coal India and Hindalco losses).
*   **Veto 2: Lagged Entry**
    *   **Condition:** $V125$ triggered in a **previous bar** and $S\_ULTRA$ is a late arrival.
    *   **Action:** **SKIP.** (If the reward magnitude is $<0.20\%$).

#### **Step 3: Live Exit Vetoes (The "Lifebuoy")**
*   **Veto 3: Absorption Rule (Primary Protection)**
    *   **Condition:** Higher volume threshold hits, but **Projected Reward % drops**.
    *   **Action:** **EXIT IMMEDIATELY.** (Saved Sun Pharma).
*   **Veto 4: Sector Contagion**
    *   **Condition:** A sector peer has already hit a **Stop Loss** today.
    *   **Action:** **EXIT/SKIP SECTOR.** (Saved SAIL disaster).

### **Conclusion**
By making **Potential-Sync** the master rule and **Floor 0** the volume policy, your total return doubled (**+6.92%**). The win rate remained elite (86%) because you replaced a generic "Level Floor" with a specific **"Efficiency Floor"** (Absorption Veto). 

**Rule 10 (Powerhouse)** is now your primary growth engine, and **Rule 7 (Perfect)** is your capital protection engine.
---

### I. The Core Asset Classification
Before applying any strategy filter, you must categorize the asset.
1.  **Heavy Stocks (Institutional):** ICICI Bank, Reliance, Infosys, Axis Bank, SBI, HDFC Bank, Tata Motors, Bharti Airtel.
2.  **Volatile Stocks (Speculative):** PAYTM, TRENT, SUZLON, PNB, BHEL, Adani Enterprises, Apollo Hospitals.
3.  **Commodities/Futures:** Silver, Lead, Natural Gas, and specific Future contracts.

---

### II. The Base Rules (Standard Operation)
*Use these daily to maintain consistent volume and filter the most obvious losers.*

1.  **The "Stealth" Rule (Highest Confidence):**
    *   If a trade appears in **S_ULTRA** but is **NOT** present in any **V125** or **935_T** strategy, it is an "Institutional Stealth" move.
    *   **Action:** Take the trade with **Max Size**.
2.  **The 935_T Veto (Crowding vs. Weight):**
    *   Compare **S_ULTRA** to **935_T**.
    *   **If Volatile Stock:** If it appears in both, **SKIP**. (Reason: Retail Crowding/Exhaustion).
    *   **If Heavy Stock:** If it appears in both, **TRADE**. (Reason: Institutional Momentum/Weight).
3.  **The Price-Bar Overrule:**
    *   Any trade triggered by **Price-Bar Analysis** (especially in Commodities) is a high-priority signal.
    *   *Exception:* On high-volatility Wednesdays (Expiry Eve), use half-size as Price-Bar can "fake out."

---

### III. The High-Precision Refinements (To reach 100% WR)
*Deep-dive filters to remove the 0.15% - 0.25% "churn" losses.*

1.  **Threshold "Clustering" (Speed Check):**
    *   Look at the **V125_N_LOOSE** or **Tier_High** trigger history for the asset.
    *   **Good Cluster:** Multiple thresholds triggered within a **10% price/volume range** (e.g., BHEL 32, 34, 35). This indicates a rapid burst. **TRADE.**
    *   **Bad Spacing:** Thresholds triggered with **large gaps** (e.g., Tata Motors 49k, 66k, 92k). This indicates a slow, weak move. **SKIP.**
2.  **The "Future Threshold" Floor:**
    *   For **Stock Futures**, ignore any S_ULTRA trigger where the threshold is **under 45**.
    *   *Logic:* Low thresholds in futures represent small-lot noise. You need the "Heavy" thresholds (like Infosys 159) to confirm institutional conviction.
3.  **The "Adani Ceiling":**
    *   For Adani Enterprises/Ports, only trade if the threshold is **under 45**. If it hits 50+, it is historically a "Bull Trap" that results in a reversal.
4.  **The "Toxic" Asset History Veto:**
    *   If an asset has returned **less than -0.15%** in a lower tier (V125) earlier in the same day, **SKIP** it in S_ULTRA. A "Tight" filter rarely saves a fundamentally weak move.

---

### IV. The Wednesday/Thursday (Expiry) Protocols
*Specific adjustments for mid-week volatility.*

*   **Wednesday (Expiry Eve):** Markets favor "Heavy Safety."
    *   **Ignore:** Stealth trades in Volatile stocks (Paytm/Trent). They are likely whipsaws.
    *   **Focus:** Full Consensus trades (S_ULTRA + 935_T + 125_T) in **Heavy Stocks ONLY**.
*   **Thursday (Expiry Day):** Markets favor "Divergence."
    *   **Ignore:** Any trade common with V125 (it gets crushed by expiry noise).
    *   **Focus:** Only S_ULTRA **Stealth** trades.

---

### V. Commodity & Future Rules
*These assets behave differently; volume convergence is a sign of power, not crowding.*

1.  **Pure Price-Bar Reliance:** For Lead, Silver, and Natural Gas, ignore all volume-based vetoes. If the Price-Bar triggers, take it.
2.  **The "Mini/Micro" Filter:** Be cautious of Silver Mini/Micro volume bars. Only the "Main" Silver/Lead Future contracts show 90%+ reliability.
3.  **No Veto for Commodities:** Unlike stocks, if `S_ULTRA` and `935_T` both trigger for a Commodity, it is a **Strong Confirmation**. Do not skip.

---

### Summary Table for S_ULTRA Decisions

| If S_ULTRA Triggers... | AND is in 935_T? | AND is in V125? | Decision |
| :--- | :--- | :--- | :--- |
| **Heavy Stock** | Yes | Yes/No | **TRADE** (Strength) |
| **Volatile Stock** | Yes | Yes/No | **SKIP** (Crowded) |
| **Any Stock** | No | No | **TRADE** (Stealth) |
| **Stock Future** | - | - | **TRADE** only if Threshold > 45 |
| **Commodity** | - | - | **TRADE** (Prefer Price-Bar) |
| **Adani Asset** | - | - | **SKIP** if Threshold > 45 |