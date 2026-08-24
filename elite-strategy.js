/**
 * ELITE META ENGINE - V4 (Optimized)
 * Preserves all logic: Decay, Late Crowding, Equality, Consensus, Rule 10.
 * Metadata Driven via config.json numeric floors.
 */

const activeRegistry = {
    "ELITE_PERFECT_RULE_7": {},
    "ELITE_POWERHOUSE_RULE_10": {}
};

const metaUtils = {
    filterSignals: (strategyName, ultraSignals, looseSignals, trendSignals, highTierSignals = [], candles) => {
        const registry = activeRegistry[strategyName];
        const results = [];
        
        // Track current bar's signal keys for cleanup
        const currentActiveKeys = new Set();
        [...ultraSignals, ...looseSignals, ...trendSignals, ...highTierSignals].forEach(s => {
            currentActiveKeys.add(s.instrument_key || s.key);
        });

        // --- STEP 1: MONITOR EXISTING REGISTRY ENTRIES (Decay & Late Crowding) ---
        Object.keys(registry).forEach(instKey => {
            const active = registry[instKey];
            if (active.status === "CANCELLED") return;

            const curUltra = ultraSignals.find(u => (u.instrument_key || u.key) === instKey);
            const curLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const instConfig = active.config;

            // CANCEL CONDITION A: RETURN DECAY (Worsening by 0.04% or more)
            if (curUltra && curUltra.return < (active.lastKnownReturn - 0.04)) {
                active.status = "CANCELLED";
                results.push({ ...active.signal, status: "CANCELLED", reason: "Decay (Worsening Performance)" });
                return; 
            }

            // CANCEL CONDITION B: LATE CROWDING 
            // If was entered as Stealth, but now V125 has arrived, and it's NOT a heavy stock
            if (active.metaReason === "Institutional Stealth" && curLoose && !instConfig.isHeavyStock) {
                active.status = "CANCELLED";
                results.push({ ...active.signal, status: "CANCELLED", reason: "Decay (Late V125 Entry Crowding)" });
                return; 
            }

            if (curUltra) active.lastKnownReturn = curUltra.return;
        });

        // --- STEP 2: EVALUATE NEW ENTRIES ---
        ultraSignals.forEach(sig => {
            const instKey = sig.instrument_key || sig.key;
            const instConfig = sig.instrumentConfig;
            
            if (registry[instKey] || !instConfig) return; 

            const matchLoose = looseSignals.find(l => (l.instrument_key || l.key) === instKey);
            const matchTrend = trendSignals.find(t => (t.instrument_key || t.key) === instKey);
            
            let pass = false;
            let metaReason = "";

            // 1. EQUALITY RULE (Synchronization)
            const isSynced = matchLoose && Math.abs(sig.return - matchLoose.return) < 0.015;
            if (isSynced && sig.return > -0.20) {
                pass = true;
                metaReason = "Equality Standard";
            } 
            // 2. CONSENSUS RULE (Veto for Volatile, Take for Heavy)
            else if (matchTrend && instConfig.isHeavyStock) {
                pass = true;
                metaReason = "Heavy Consensus";
            } 
            // 3. STEALTH RULE (Dynamic Numeric Floor from JSON)
            else if (!matchLoose && !matchTrend && sig.thresholdIndex >= instConfig.stealthThresholdFloor) {
                pass = true;
                metaReason = "Institutional Stealth";
            }

            if (pass) {
                const metaSig = { ...sig, metaReason, status: "ACTIVE", lastKnownReturn: sig.return };
                registry[instKey] = { signal: metaSig, metaReason, lastKnownReturn: sig.return, status: "ACTIVE", config: instConfig };
                results.push(metaSig);
            }
        });

        // RULE 10: High Tier Stealth Addition
        if (strategyName === "ELITE_POWERHOUSE_RULE_10") {
            highTierSignals.forEach(sig => {
                const instKey = sig.instrument_key || sig.key;
                if (registry[instKey]) return;

                const inUltra = ultraSignals.some(u => (u.instrument_key || u.key) === instKey);
                const inLoose = looseSignals.some(l => (l.instrument_key || l.key) === instKey);

                if (!inUltra && !inLoose && sig.thresholdIndex >= sig.instrumentConfig.stealthThresholdFloor) {
                    const metaSig = { ...sig, metaReason: "HT Scout Stealth", status: "ACTIVE", lastKnownReturn: sig.return };
                    registry[instKey] = { signal: metaSig, metaReason: "HT Scout Stealth", lastKnownReturn: sig.return, status: "ACTIVE", config: sig.instrumentConfig };
                    results.push(metaSig);
                }
            });
        }

        // --- STEP 3: REGISTRY CLEANUP ---
        // If instrument disappears from all source filters, clear it so it can be re-triggered
        Object.keys(registry).forEach(instKey => {
            if (!currentActiveKeys.has(instKey)) delete registry[instKey];
        });

        return results;
    }
};

module.exports = metaUtils;