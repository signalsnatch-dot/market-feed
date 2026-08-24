/**
 * ELITE META ENGINE - V19 (VOLUME-DECOUPLED SUITE)
 * 
 * Rules 3 - 10: FLOORLESS. Allows all trades (p0-p9) based on strategy logic.
 * Rule 11: PERFECT WITH FLOOR (Copy of Rule 7 + JSON Level Filter).
 * Rule 12: POWERHOUSE WITH FLOOR (Copy of Rule 10 + JSON Level Filter).
 */

const activeRegistry = {}; 

const metaUtils = {
    getPotentials: (sig) => {
        const trigger = sig.triggerPrice;
        const reward = Math.abs(sig.takeProfit - trigger) / trigger;
        const risk = Math.abs(trigger - sig.stopLoss) / trigger;
        return { reward: reward * 100, risk: risk * 100 };
    },

    filterSignals: (ruleId, ultraSignals, looseSignals, trendSignals, highTierSignals = []) => {
        if (!activeRegistry[ruleId]) activeRegistry[ruleId] = {};
        const registry = activeRegistry[ruleId];
        const results = [];

        // --- PHASE 1: ACTIVE MONITORING (Decay Vetoes) ---
        Object.keys(registry).forEach(instKey => {
            const active = registry[instKey];
            const curUltra = ultraSignals.find(u => (u.instrument_key || u.key) === instKey);
            const curLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const instConfig = active.config;

            if (!curUltra) return;

            const curPot = metaUtils.getPotentials(curUltra);
            // VETO: Worsening Reward Potential
            if (curPot.reward < active.lastRewardPotential - 0.01) {
                results.push({ ...curUltra, status: "CANCELLED", reason: "Decay: Potential Dropped" });
                delete registry[instKey]; return;
            }
            // VETO: Late Crowding (Stealth -> Consensus transition for Non-Heavy)
            if (active.metaReason.includes("Stealth") && curLoose && !instConfig.isHeavyStock) {
                results.push({ ...curUltra, status: "CANCELLED", reason: "Decay: Late Crowding" });
                delete registry[instKey]; return;
            }
            active.lastRewardPotential = curPot.reward;
        });

        // --- PHASE 2: ENTRY GATING ---
        ultraSignals.forEach(sig => {
            const instKey = sig.instrument_key || sig.key;
            const instConfig = sig.instrumentConfig;
            if (registry[instKey] || !instConfig) return;

            const matchLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const matchTrend = trendSignals.find(t => (t.instrument_key || t.key) === instKey);
            const sigPot = metaUtils.getPotentials(sig);
            
            const isSync = matchLoose && Math.abs(sigPot.reward - metaUtils.getPotentials(matchLoose).reward) <= 0.05;
            const isHeavyConsensus = matchTrend && instConfig.isHeavyStock;
            const isStealth = !matchLoose && !matchTrend;
            
            // Logic: Rules 11 & 12 enforce Floor. Rules 3-10 use Level 0.
            const floor = (ruleId === "RULE_11" || ruleId === "RULE_12") ? instConfig.stealthThresholdFloor : 0;

            let pass = false;
            let metaReason = "";

            // Mapping requested logic for each Rule ID
            if (ruleId === "RULE_3" && isStealth) { pass = true; metaReason = "Stealth Only"; }
            if (ruleId === "RULE_4" && (isStealth || isSync)) { pass = true; metaReason = "Stealth or Sync"; }
            if (ruleId === "RULE_5" && (isStealth || isHeavyConsensus)) { pass = true; metaReason = "Stealth or Consensus"; }
            if (ruleId === "RULE_6" && (isStealth || isSync || isHeavyConsensus)) { pass = true; metaReason = "Sync+Consensus"; }
            if ((ruleId === "RULE_7" || ruleId === "RULE_11") && (isSync || isHeavyConsensus || isStealth)) { 
                if (sig.thresholdIndex >= floor) { pass = true; metaReason = "Perfect Protocol"; }
            }

            if (pass) {
                const metaSig = { ...sig, metaReason, status: "ACTIVE", rule: ruleId };
                registry[instKey] = { signal: metaSig, metaReason, lastRewardPotential: sigPot.reward, config: instConfig };
                results.push(metaSig);
            }
        });

        // --- PHASE 3: STEALTH SCOUTING (Rules 8, 9, 10, 12) ---
        if (["RULE_8", "RULE_9", "RULE_10", "RULE_12"].includes(ruleId)) {
            highTierSignals.forEach(sig => {
                const instKey = sig.instrument_key || sig.key;
                if (registry[instKey] || !sig.instrumentConfig) return;

                const inUltra = ultraSignals.some(u => (u.instrument_key || u.key) === instKey);
                const inLoose = looseSignals.some(l => (l.instrument_key || l.key) === instKey);
                const floor = (ruleId === "RULE_12") ? sig.instrumentConfig.stealthThresholdFloor : 0;

                if (!inUltra && !inLoose && sig.thresholdIndex >= floor) {
                    const metaSig = { ...sig, metaReason: "HT Scout Stealth", status: "ACTIVE", rule: ruleId };
                    registry[instKey] = { signal: metaSig, metaReason: "HT Scout Stealth", lastRewardPotential: metaUtils.getPotentials(sig).reward, config: sig.instrumentConfig };
                    results.push(metaSig);
                }
            });
        }
        return results;
    }
};

module.exports = metaUtils;