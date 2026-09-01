/**
 * THE ELITE META-ENGINE 2.0 (VOL-PRICE PHYSICS)
 * Logic: META_2_0 (Standard) | META_THURSDAY (Triple Sync) | UBER_ENGINE (Reversal)
 * Updates: Fixed Registry lockout, Restored Law 6 HT Scouting, Fixed Uber PnL.
 */

const activeRegistry = {}; 

const eliteMetaEngine = {
    getPotentials: (sig) => {
        const trigger = sig.entry || sig.triggerPrice || 0;
        const tp = sig.tp || sig.takeProfit || 0;
        const sl = sig.sl || sig.stopLoss || 0;
        if (trigger === 0 || tp === 0 || sl === 0) return { reward: 0, risk: 0 };
        return {
            reward: Math.abs(tp - trigger) / trigger,
            risk: Math.abs(trigger - sl) / trigger
        };
    },

    deriveLevel: (sig, instConfig) => {
        if (!instConfig || !instConfig.volumePerBar) return 0;
        const val = sig.threshold;
        if (val < 25) return val; 
        const idx = instConfig.volumePerBar.indexOf(val);
        return idx !== -1 ? idx : 0;
    },

    isNearStrike: (price, instConfig) => {
        if (!instConfig) return false;
        const step = (instConfig.exchange === "MCX_FO") ? 500 : 50;
        const remainder = price % step;
        const distance = Math.min(remainder, step - remainder);
        return (distance / price) <= 0.0015; 
    },

    filterSignals: (ruleId, ultraSignals = [], looseSignals = [], trendSignals = [], highTierSignals = [], globalConfig) => {
        if (!activeRegistry[ruleId]) activeRegistry[ruleId] = {};
        const registry = activeRegistry[ruleId];
        const results = [];

        const getInstConfig = (sig) => globalConfig?.instruments?.find(i => i.key === (sig.instrument || sig.instrument_key));

        const U = Array.isArray(ultraSignals) ? ultraSignals : [];
        const L = Array.isArray(looseSignals) ? looseSignals : [];
        const T = Array.isArray(trendSignals) ? trendSignals : [];
        const HT = Array.isArray(highTierSignals) ? highTierSignals : [];

        const allSigs = [...U, ...L, ...T, ...HT];
        const maxTime = allSigs.length > 0 ? Math.max(...allSigs.map(s => s.timestamp || 0)) : 0;
        const TIME_WINDOW = 3 * 60 * 1000; 

        // --- PHASE 1: LIVE MONITORING (ABSORPTION & CROWDING) ---
        Object.keys(registry).forEach(instKey => {
            const active = registry[instKey];
            const curUltra = U.find(u => u.instrument === instKey);
            const curLoose = L.find(l => l.instrument === instKey);
            
            // Purge registry if signal is gone so we can allow new entries later
            if (!curUltra && !HT.some(h => h.instrument === instKey)) {
                delete registry[instKey]; return;
            }

            const curPot = eliteMetaEngine.getPotentials(curUltra || active.originalSignal);
            const curLevel = eliteMetaEngine.deriveLevel(curUltra || active.originalSignal, active.config);

            // LAW 4: ABSORPTION VETO
            if (curLevel > active.lastLevel && curPot.reward < (active.lastRewardPotential - 0.0001)) {
                results.push({ ...curUltra, status: "CANCELLED", reason: "Veto 3: Volume Absorption" });
                delete registry[instKey]; return;
            }

            // LATE CROWDING VETO
            if (active.entryReason.includes("Stealth") && curLoose) {
                results.push({ ...curUltra, status: "CANCELLED", reason: "Veto: Late Retail Crowd" });
                delete registry[instKey]; return;
            }

            active.lastRewardPotential = curPot.reward;
            active.lastLevel = curLevel;
        });

        // --- PHASE 2: UBER ENGINE (CONTRARIAN REVERSAL) ---
        if (ruleId === "UBER_ENGINE") {
            [...L, ...T].forEach(sig => {
                const instKey = sig.instrument;
                const instConfig = getInstConfig(sig);
                const ultraIsSilent = !U.some(u => u.instrument === instKey && Math.abs(u.timestamp - sig.timestamp) <= TIME_WINDOW);
                const strikeVeto = eliteMetaEngine.isNearStrike(sig.entry, instConfig);

                if ((ultraIsSilent || strikeVeto) && (maxTime - sig.timestamp <= TIME_WINDOW)) {
                    results.push({
                        ...sig,
                        type: sig.type.includes("BUY") ? "SELL_STOP" : "BUY_STOP",
                        sl: sig.sl, // FIXED: Interchanged
                        tp: sig.tp, // FIXED: Interchanged
                        metaReason: ultraIsSilent ? "Uber Logic: Law 2 Silence" : "Uber Logic: Strike Reversal",
                        status: "ACTIVE_UBER"
                    });
                }
            });
            return results; 
        }

        // --- PHASE 3: INSTITUTIONAL GATING (ULTRA) ---
        U.forEach(sig => {
            const instKey = sig.instrument;
            const instConfig = getInstConfig(sig);
            // RE-ENTRY ALLOWED: Only block if an active trade is currently in registry
            if (!instConfig || registry[instKey] || (maxTime - sig.timestamp > TIME_WINDOW)) return;

            const matchL = L.find(l => l.instrument === instKey && Math.abs(l.timestamp - sig.timestamp) <= TIME_WINDOW);
            const matchT = T.find(t => t.instrument === instKey && Math.abs(t.timestamp - sig.timestamp) <= TIME_WINDOW);
            const matchH = HT.find(h => h.instrument === instKey && Math.abs(h.timestamp - sig.timestamp) <= TIME_WINDOW);
            
            const sigPot = eliteMetaEngine.getPotentials(sig);
            const currentLevel = eliteMetaEngine.deriveLevel(sig, instConfig);

            if (matchL && matchL.barNumber < sig.barNumber && sigPot.reward < 0.0020) return; // Veto 2

            let isSynced = matchL && Math.abs(sigPot.reward - eliteMetaEngine.getPotentials(matchL).reward) <= 0.0005 && (sig.barNumber <= matchL.barNumber);
            let isHeavy = matchT && (instConfig.isHeavyStock === true || instConfig.exchange === "MCX_FO");
            let isStealth = !matchL && !matchT;
            let strikeVeto = eliteMetaEngine.isNearStrike(sig.entry, instConfig);

            let pass = false;
            let reason = "";

            if (ruleId === "META_THURSDAY") {
                if (isSynced && matchH && !strikeVeto) { pass = true; reason = "Gate 1: Triple Sync"; }
            } else if (ruleId === "META_2_0") {
                if (isSynced) { pass = true; reason = "Gate 1: Sync Master"; }
                else if (isStealth) { pass = true; reason = "Gate 2: Institutional Stealth"; }
                else if (isHeavy) { pass = true; reason = "Gate 3: Heavy Weight"; }
            }

            if (pass) {
                results.push({ ...sig, metaReason: reason, status: "ACTIVE", derivedLevel: currentLevel });
                registry[instKey] = { originalSignal: sig, lastRewardPotential: sigPot.reward, lastLevel: currentLevel, config: instConfig, entryReason: reason };
            }
        });

        // --- PHASE 4: INSTITUTIONAL SCOUTING (LAW 6 - HT STEALTH) ---
        if (ruleId === "META_2_0" || ruleId === "META_THURSDAY") {
            HT.forEach(sig => {
                const instKey = sig.instrument;
                if (registry[instKey] || (maxTime - sig.timestamp > TIME_WINDOW)) return;

                const ultraSilent = !U.some(u => u.instrument === instKey && Math.abs(u.timestamp - sig.timestamp) <= TIME_WINDOW);
                const looseSilent = !L.some(l => l.instrument === instKey && Math.abs(l.timestamp - sig.timestamp) <= TIME_WINDOW);

                if (ultraSilent && looseSilent) {
                    results.push({ ...sig, metaReason: "Law 6: HT Stealth Scouting", status: "ACTIVE" });
                    registry[instKey] = { originalSignal: sig, lastRewardPotential: eliteMetaEngine.getPotentials(sig).reward, lastLevel: eliteMetaEngine.deriveLevel(sig, getInstConfig(sig)), config: getInstConfig(sig), entryReason: "HT Stealth" };
                }
            });
        }

        return results;
    }
};

module.exports = eliteMetaEngine;