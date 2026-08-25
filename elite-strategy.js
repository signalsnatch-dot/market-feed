/**
 * ELITE META ENGINE - V30 (THE 95% PROTOCOL - FULL ROBUST SUITE)
 * 
 * Target WR: 93.9% (Meta 2.0)
 * Data Keys: instrument, entry, tp, sl, threshold, barNumber
 */

const activeRegistry = {}; 
const sectorBlacklist = new Set(); 

const eliteMetaEngine = {
    /**
     * CORE MATH: REWARD/RISK POTENTIAL (Protocol V15)
     * Measures the "Intent" of the trade to align different strategy settings.
     */
    getPotentials: (sig) => {
        const trigger = sig.entry || sig.triggerPrice || 0;
        const tp = sig.tp || sig.takeProfit || 0;
        const sl = sig.sl || sig.stopLoss || 0;
        if (trigger === 0) return { reward: 0, risk: 0 };
        return { 
            reward: (Math.abs(tp - trigger) / trigger) * 100,
            risk: (Math.abs(trigger - sl) / trigger) * 100
        };
    },

    /**
     * DYNAMIC LEVEL RECOVERY
     * Reconstructs the Volume Rank (p0-p9) from the raw threshold value.
     */
    deriveLevel: (sig, instConfig) => {
        if (!instConfig || !instConfig.volumePerBar) return 0;
        const val = sig.threshold;
        const idx = instConfig.volumePerBar.indexOf(val);
        return idx !== -1 ? idx : 0;
    },

    filterSignals: (ruleId, ultraSignals = [], looseSignals = [], trendSignals = [], highTierSignals = [], globalConfig) => {
        if (!activeRegistry[ruleId]) activeRegistry[ruleId] = {};
        const registry = activeRegistry[ruleId];
        const results = [];

        const getInstConfig = (sig) => {
            const id = sig.instrument || sig.instrument_key;
            return globalConfig?.instruments?.find(i => i.key === id);
        };

        // --- PHASE 1: SYSTEM-WIDE VETO UPDATES (Sector Shield) ---
        const currentActiveKeys = new Set();
        const allAvailableSignals = [...ultraSignals, ...looseSignals, ...trendSignals, ...highTierSignals];
        
        allAvailableSignals.forEach(s => {
            const key = s.instrument || s.instrument_key;
            if (key) currentActiveKeys.add(key);
            
            // LAW: SECTOR CONTAGION
            // If any base strategy reports a Stop Loss hit, blacklist that entire sector bucket.
            if (s.exitReason === 'stop_loss') {
                const cfg = getInstConfig(s);
                if (cfg && cfg.assetBucket) sectorBlacklist.add(cfg.assetBucket);
            }
        });

        // --- PHASE 2: MONITOR ACTIVE TRADES (Live Logical Vetoes) ---
        Object.keys(registry).forEach(instKey => {
            const active = registry[instKey];
            const curUltra = ultraSignals.find(u => (u.instrument || u.instrument_key) === instKey);
            const curLoose = looseSignals.find(l => (l.instrument || l.instrument_key) === instKey);
            
            if (!curUltra) return; // Signal temporarily gapped

            const curPot = eliteMetaEngine.getPotentials(curUltra);
            const curLevel = eliteMetaEngine.deriveLevel(curUltra, active.config);

            // 1. ABSORPTION VETO (Efficiency Check)
            // If volume index increases but reward potential shrinks -> EXIT
            if (curLevel > active.lastLevel) {
                if (curPot.reward < active.lastRewardPotential - 0.005) {
                    results.push({ ...curUltra, status: "CANCELLED", reason: "Veto: Volume Absorption" });
                    delete registry[instKey]; return; 
                }
            }

            // 2. LATE CROWDING VETO (Public Leak Check)
            // If non-heavy stealth entry is now visible to V125 -> EXIT
            if (active.metaReason === "Institutional Stealth" && curLoose && !active.config.isHeavyStock) {
                results.push({ ...curUltra, status: "CANCELLED", reason: "Veto: Late Retail Crowd" });
                delete registry[instKey]; return;
            }

            active.lastRewardPotential = curPot.reward;
            active.lastLevel = curLevel;
        });

        // --- PHASE 3: ENTRY GATING (Rule Specific Logic) ---
        ultraSignals.forEach(sig => {
            const instKey = sig.instrument || sig.instrument_key;
            const instConfig = getInstConfig(sig);
            
            // Basic Safety Check
            if (registry[instKey] || !instConfig) return;
            // Law: Sector Shield
            if (sectorBlacklist.has(instConfig.assetBucket)) return;

            const matchLoose = looseSignals.find(l => (l.instrument || l.instrument_key) === instKey);
            const matchTrend = trendSignals.find(t => (t.instrument || t.instrument_key) === instKey);
            
            const sigPot = eliteMetaEngine.getPotentials(sig);
            const currentLevel = eliteMetaEngine.deriveLevel(sig, instConfig);

            // Potential-Sync Calculation (V15 Protocol)
            let isSynced = false;
            if (matchLoose) {
                const loosePot = eliteMetaEngine.getPotentials(matchLoose);
                const potentialsMatch = Math.abs(sigPot.reward - loosePot.reward) <= 0.05;
                // LAW: BAR-LEAD (S_U must lead or be same bar)
                const timingMatch = sig.barNumber <= matchLoose.barNumber; 
                isSynced = potentialsMatch && timingMatch;
            }

            const isHeavyConsensus = matchTrend && (instConfig.isHeavyStock || instConfig.assetBucket === "INDEX_COMMODITY");
            const isStealth = !matchLoose && !matchTrend;
            
            // Rules 11 and 12 are the only ones enforcing the Config Floor.
            const floor = (ruleId === "RULE_11" || ruleId === "RULE_12") ? instConfig.stealthThresholdFloor : 0;

            let pass = false;
            let metaReason = "";

            // --- THE 10 RULE BRANCHES ---
            
            if (ruleId === "RULE_3") { // Stealth Only
                if (isStealth && currentLevel >= floor) { pass = true; metaReason = "Institutional Stealth"; }
            }
            else if (ruleId === "RULE_4") { // Stealth + Equal
                if (isStealth && currentLevel >= floor) { pass = true; metaReason = "Institutional Stealth"; }
                else if (isSynced) { pass = true; metaReason = "Equality Sync"; }
            }
            else if (ruleId === "RULE_5") { // Stealth + Heavy Veto
                if (isStealth && currentLevel >= floor) { pass = true; metaReason = "Institutional Stealth"; }
                else if (isHeavyConsensus) { pass = true; metaReason = "Heavy Consensus"; }
            }
            else if (ruleId === "RULE_6") { // Stealth + Equal + Veto
                if (isStealth && currentLevel >= floor) { pass = true; metaReason = "Institutional Stealth"; }
                else if (isSynced) { pass = true; metaReason = "Equality Sync"; }
                else if (isHeavyConsensus) { pass = true; metaReason = "Heavy Consensus"; }
            }
            else if (ruleId === "RULE_7" || ruleId === "RULE_11") { // Perfect Protocol
                // Note: Rule 7 uses floor 0, Rule 11 uses Config floor
                if (isSynced) { pass = true; metaReason = "Equality Sync"; }
                else if (isHeavyConsensus) { pass = true; metaReason = "Heavy Consensus"; }
                else if (isStealth && currentLevel >= floor) { pass = true; metaReason = "Institutional Stealth"; }
            }
            else if (ruleId === "RULE_10" || ruleId === "RULE_12") { // Powerhouse (Ultra Component)
                if (isSynced) { pass = true; metaReason = "Equality Sync"; }
                else if (isHeavyConsensus) { pass = true; metaReason = "Heavy Consensus"; }
                else if (isStealth && currentLevel >= floor) { pass = true; metaReason = "Institutional Stealth"; }
            }

            if (pass) {
                const metaSig = { ...sig, metaReason, status: "ACTIVE", ruleId, derivedLevel: currentLevel };
                registry[instKey] = { signal: metaSig, metaReason, lastRewardPotential: sigPot.reward, lastLevel: currentLevel, config: instConfig };
                results.push(metaSig);
            }
        });

        // --- PHASE 4: HIGH-TIER SCOUTING (Rules 8, 9, 10, 12) ---
        if (["RULE_8", "RULE_9", "RULE_10", "RULE_12"].includes(ruleId)) {
            highTierSignals.forEach(sig => {
                const instKey = sig.instrument || sig.instrument_key;
                const instConfig = getInstConfig(sig);
                if (registry[instKey] || !instConfig || sectorBlacklist.has(instConfig.assetBucket)) return;

                const inUltra = ultraSignals.some(u => (u.instrument || u.instrument_key) === instKey);
                const inLoose = looseSignals.some(l => (l.instrument || l.instrument_key) === instKey);
                const currentLevel = eliteMetaEngine.deriveLevel(sig, instConfig);
                const floor = (ruleId === "RULE_12") ? instConfig.stealthThresholdFloor : 0;

                // LAW: HT Scout is only valid if move is invisible to both Ultra and Loose (Clean Stealth)
                if (!inUltra && !inLoose && currentLevel >= floor) {
                    const metaSig = { ...sig, metaReason: "HT Scout Stealth", status: "ACTIVE", ruleId, derivedLevel: currentLevel };
                    registry[instKey] = { signal: metaSig, metaReason: "HT Scout Stealth", lastRewardPotential: eliteMetaEngine.getPotentials(sig).reward, lastLevel: currentLevel, config: instConfig };
                    results.push(metaSig);
                }
            });
        }

        // --- PHASE 5: REGISTRY CLEANUP ---
        // Clear instrument from registry if signals are no longer present in source
        Object.keys(registry).forEach(instKey => {
            if (!currentActiveKeys.has(instKey)) delete registry[instKey];
        });

        return results;
    }
};

module.exports = eliteMetaEngine;