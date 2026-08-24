/**
 * ELITE META ENGINE - V22 (STRICT PROTOCOL MAPPING)
 * 
 * Rules 3-10: Floorless (p0+)
 * Rules 11-12: Config Floor Active
 * base ultra
 * base 935_high_tier
 * 3. base ultra (only stealth)
 * 4. base ultra stealth + 125 equal
 * base ultra stealth + 935 veto (trade for high, skip for low)
 * base ultra stealth + 125 equal + 935 veto
 * base ultra stealth + 125 equal + 935 veto + multiple threshold.
 * 935_high_tier stealth
 */

const activeRegistry = {}; 

const metaUtils = {
    getPotentials: (sig) => {
        if (!sig?.triggerPrice || !sig?.takeProfit || !sig?.stopLoss) return { reward: 0, risk: 0 };
        return { 
            reward: (Math.abs(sig.takeProfit - sig.triggerPrice) / sig.triggerPrice) * 100,
            risk: (Math.abs(sig.triggerPrice - sig.stopLoss) / sig.triggerPrice) * 100
        };
    },

    filterSignals: (ruleId, ultraSignals = [], looseSignals = [], trendSignals = [], highTierSignals = []) => {
        if (!activeRegistry[ruleId]) activeRegistry[ruleId] = {};
        const registry = activeRegistry[ru  leId];
        const results = [];

        // Track instruments in this bar for registry cleanup
        const currentActiveKeys = new Set();
        [...ultraSignals, ...looseSignals, ...trendSignals, ...highTierSignals].forEach(s => {
            if (s?.instrument_key || s?.key) currentActiveKeys.add(s.instrument_key || s.key);
        });

        // --- PHASE 1: ACTIVE MONITORING (Vetoes) ---
        Object.keys(registry).forEach(instKey => {
            const active = registry[instKey];
            const curUltra = ultraSignals.find(u => (u.instrument_key || u.key) === instKey);
            const curLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const instConfig = active.config;

            if (!curUltra || !instConfig) return;

            // ABSORPTION VETO (Specifically for Rules 7, 10, 11, 12)
            const hasAbsorptionLogic = ["RULE_7", "RULE_10", "RULE_11", "RULE_12"].includes(ruleId);
            if (hasAbsorptionLogic && curUltra.thresholdIndex > active.lastLevel) {
                const curReward = metaUtils.getPotentials(curUltra).reward;
                if (curReward < active.lastRewardPotential - 0.005) {
                    results.push({ ...curUltra, status: "CANCELLED", reason: "Absorption Veto" });
                    delete registry[instKey]; return;
                }
                active.lastRewardPotential = curReward;
            }

            // LATE CROWDING VETO (Applies to all Stealth entries)
            if (active.metaReason.includes("Stealth") && curLoose && !instConfig.isHeavyStock) {
                results.push({ ...curUltra, status: "CANCELLED", reason: "Late Crowding Veto" });
                delete registry[instKey]; return;
            }

            active.lastLevel = curUltra.thresholdIndex;
        });

        // --- PHASE 2: ENTRY GATING ---
        ultraSignals.forEach(sig => {
            const instKey = sig.instrument_key || sig.key;
            const instConfig = sig.instrumentConfig;
            if (registry[instKey] || !instConfig) return; 

            const matchLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const matchTrend = trendSignals.find(t => (t.instrument_key || t.key) === instKey);
            
            const sigPot = metaUtils.getPotentials(sig);

            // Sync Calculation (Used in Rules 4, 6, 7, 10, 11, 12)
            let isSynced = false;
            if (matchLoose) {
                const loosePot = metaUtils.getPotentials(matchLoose);
                isSynced = Math.abs(sigPot.reward - loosePot.reward) <= 0.05 && Math.abs(sigPot.risk - loosePot.risk) <= 0.05;
            }

            const isHeavyConsensus = matchTrend && instConfig.isHeavyStock;
            const isStealth = !matchLoose && !matchTrend;
            const floor = (ruleId === "RULE_11" || ruleId === "RULE_12") ? (instConfig.stealthThresholdFloor ?? 0) : 0;

            let pass = false;
            let metaReason = "";

            // LOGIC MAPPING
            switch(ruleId) {
                case "RULE_3": if (isStealth) pass = true; break;
                case "RULE_4": if (isStealth || isSynced) pass = true; break;
                case "RULE_5": if (isStealth || isHeavyConsensus) pass = true; break;
                case "RULE_6": if (isStealth || isSynced || isHeavyConsensus) pass = true; break;
                case "RULE_7": case "RULE_11":
                    if (isSynced) { pass = true; metaReason = "Equality Sync"; }
                    else if (isHeavyConsensus) { pass = true; metaReason = "Heavy Consensus"; }
                    else if (isStealth && sig.thresholdIndex >= floor) { pass = true; metaReason = "Institutional Stealth"; }
                    break;
            }

            if (pass) {
                if (!metaReason) metaReason = isSynced ? "Equality Sync" : isHeavyConsensus ? "Heavy Consensus" : "Institutional Stealth";
                const metaSig = { ...sig, metaReason, status: "ACTIVE", rule: ruleId };
                registry[instKey] = { signal: metaSig, metaReason, lastRewardPotential: sigPot.reward, lastLevel: sig.thresholdIndex, config: instConfig };
                results.push(metaSig);
            }
        });

        // --- PHASE 3: SCOUTING (Rules 8, 9, 10, 12) ---
        if (["RULE_8", "RULE_9", "RULE_10", "RULE_12"].includes(ruleId)) {
            highTierSignals.forEach(sig => {
                const instKey = sig.instrument_key || sig.key;
                if (registry[instKey] || !sig.instrumentConfig) return;

                const inUltra = ultraSignals.some(u => (u.instrument_key || u.key) === instKey);
                const inLoose = looseSignals.some(l => (l.instrument_key || l.key) === instKey);
                const floor = (ruleId === "RULE_12") ? (sig.instrumentConfig.stealthThresholdFloor ?? 0) : 0;

                if (!inUltra && !inLoose && sig.thresholdIndex >= floor) {
                    const metaSig = { ...sig, metaReason: "HT Scout Stealth", status: "ACTIVE", rule: ruleId };
                    registry[instKey] = { signal: metaSig, metaReason: "HT Scout Stealth", lastRewardPotential: metaUtils.getPotentials(sig).reward, lastLevel: sig.thresholdIndex, config: sig.instrumentConfig };
                    results.push(metaSig);
                }
            });
        }

        // --- PHASE 4: CLEANUP ---
        Object.keys(registry).forEach(instKey => {
            if (!currentActiveKeys.has(instKey)) delete registry[instKey];
        });

        return results;
    }
};

module.exports = metaUtils;