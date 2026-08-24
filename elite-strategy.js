/**
 * ELITE META ENGINE - V15 (POTENTIAL-SYNC PROTOCOL)
 * 
 * Logic uses:
 * - Expected Potential Reward (EPR%): (Target - Trigger) / Trigger
 * - Expected Potential Risk (EPRisk%): (Trigger - Stop) / Trigger
 */

const activeRegistry = {
    "ELITE_PERFECT_RULE_7": {},    
    "ELITE_POWERHOUSE_RULE_10": {}
};

const metaUtils = {
    // Utility to calculate projected potentials
    getPotentials: (sig) => {
        const trigger = sig.triggerPrice;
        const reward = Math.abs(sig.takeProfit - trigger) / trigger;
        const risk = Math.abs(trigger - sig.stopLoss) / trigger;
        return { reward: reward * 100, risk: risk * 100 }; // Returns as percentage
    },

    filterSignals: (strategyName, ultraSignals, looseSignals, trendSignals, highTierSignals = [], currentBar) => {
        const registry = activeRegistry[strategyName];
        const results = [];
        
        const currentActiveKeys = new Set();
        [...ultraSignals, ...looseSignals, ...trendSignals, ...highTierSignals].forEach(s => {
            currentActiveKeys.add(s.instrument_key || s.key);
        });

        // --- PHASE 1: MONITOR ACTIVE TRADES (Projected Potential Decay) ---
        Object.keys(registry).forEach(instKey => {
            const active = registry[instKey];
            const curUltra = ultraSignals.find(u => (u.instrument_key || u.key) === instKey);
            const curLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const instConfig = active.config;

            if (!curUltra) return;

            const curPot = metaUtils.getPotentials(curUltra);

            // 1. ABSORPTION VETO: Volume up but Potential Reward down
            // If the volume level increases, the Profit Potential % must not drop.
            if (curUltra.thresholdIndex > active.lastLevel) {
                if (curPot.reward < active.lastRewardPotential - 0.01) {
                    results.push({ 
                        ...curUltra, 
                        status: "CANCELLED", 
                        reason: `Decay: Absorption (Level ${curUltra.thresholdIndex} hit but Reward% dropped from ${active.lastRewardPotential.toFixed(3)}% to ${curPot.reward.toFixed(3)}%)` 
                    });
                    delete registry[instKey];
                    return;
                }
            }

            // 2. LATE CROWDING VETO (Non-Heavy/Non-Commodity only)
            const isCommodity = instConfig.stealthThresholdFloor === 0;
            if (active.metaReason === "Institutional Stealth" && curLoose && !instConfig.isHeavyStock && !isCommodity) {
                results.push({ 
                    ...curUltra, 
                    status: "CANCELLED", 
                    reason: "Decay: Stealth move now Crowded (V125 Entry detected)" 
                });
                delete registry[instKey];
                return;
            }

            active.lastRewardPotential = curPot.reward;
            active.lastLevel = curUltra.thresholdIndex;
        });

        // --- PHASE 2: NEW ENTRY VALIDATION (Potential-Sync Gates) ---
        ultraSignals.forEach(sig => {
            const instKey = sig.instrument_key || sig.key;
            const instConfig = sig.instrumentConfig;
            if (registry[instKey] || !instConfig) return; 

            const matchLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const matchTrend = trendSignals.find(t => (t.instrument_key || t.key) === instKey);
            
            let pass = false;
            let metaReason = "";

            // Calculate current signal potentials
            const sigPot = metaUtils.getPotentials(sig);

            // GATE 1: POTENTIAL SYNCHRONIZATION (Equality Rule)
            if (matchLoose) {
                const loosePot = metaUtils.getPotentials(matchLoose);
                // We compare both Profit% potential and Risk% potential
                const rewardSync = Math.abs(sigPot.reward - loosePot.reward) <= 0.05; // Tolerance: 5 basis points
                const riskSync = Math.abs(sigPot.risk - loosePot.risk) <= 0.05;

                if (rewardSync && riskSync) {
                    pass = true;
                    metaReason = "Equality Standard";
                }
            } 
            
            // GATE 2: HEAVY CONSENSUS (For Heavy Stocks/Commodities)
            if (!pass && matchTrend) {
                const isComm = instConfig.stealthThresholdFloor === 0;
                if (instConfig.isHeavyStock || isComm) {
                    pass = true;
                    metaReason = "Heavy Consensus";
                }
            } 

            // GATE 3: INSTITUTIONAL STEALTH (Filtered by Numeric Level Floor)
            if (!pass && !matchLoose && !matchTrend) {
                if (sig.thresholdIndex >= instConfig.stealthThresholdFloor) {
                    pass = true;
                    metaReason = "Institutional Stealth";
                }
            }

            if (pass) {
                const metaSig = { ...sig, metaReason, status: "ACTIVE", projectedReward: sigPot.reward, projectedRisk: sigPot.risk };
                registry[instKey] = { 
                    lastRewardPotential: sigPot.reward,
                    lastLevel: sig.thresholdIndex,
                    metaReason, 
                    config: instConfig,
                    signal: metaSig
                };
                results.push(metaSig);
            }
        });

        // Rule 10 Additions (High Tier unique stealth using numeric floor)
        if (strategyName === "ELITE_POWERHOUSE_RULE_10") {
            highTierSignals.forEach(sig => {
                const instKey = sig.instrument_key || sig.key;
                if (registry[instKey] || !sig.instrumentConfig) return;
                const inUltra = ultraSignals.some(u => (u.instrument_key || u.key) === instKey);
                const inLoose = looseSignals.some(l => (l.instrument_key || l.key) === instKey);

                if (!inUltra && !inLoose && sig.thresholdIndex >= sig.instrumentConfig.stealthThresholdFloor) {
                    const sigPot = metaUtils.getPotentials(sig);
                    const metaSig = { ...sig, metaReason: "HT Scout Stealth", status: "ACTIVE" };
                    registry[instKey] = { signal: metaSig, metaReason: "HT Scout Stealth", lastRewardPotential: sigPot.reward, lastLevel: sig.thresholdIndex, config: sig.instrumentConfig };
                    results.push(metaSig);
                }
            });
        }

        return results;
    }
};

module.exports = metaUtils;