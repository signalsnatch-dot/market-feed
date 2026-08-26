/**
 * THE ELITE META-ENGINE 2.0 (VOL-PRICE PHYSICS)
 * TARGET WIN RATE: 95%
 * 
 * CORE ARCHITECTURE:
 * 1. Hierarchical Gating (Sync > Stealth > Heavy > HT Scout)
 * 2. Timing Supremacy (Bar-Lead Enforcement & 3-Min Recency)
 * 3. Live Physics Monitoring (Absorption & Crowding Registry)
 * 4. UBER ENGINE: Reversal of Law 2 Silence & Law 4 Absorption
 */

const activeRegistry = {}; 

const eliteMetaEngine = {
    /**
     * MATHEMATICAL DEFINITIONS:
     * Projected Reward %: abs(Target - Trigger) / Trigger
     * Projected Risk %: abs(Trigger - Stop) / Trigger
     */
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

    /**
     * VOLUME LEVEL DEFINITION:
     * The index (0-9) of the trigger within the volumePerBar array.
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

        // --- STEP 0: RECENCY & SYNC CONTEXT ---
        const allSigs = [...ultraSignals, ...looseSignals, ...trendSignals, ...highTierSignals];
        const maxTime = allSigs.length > 0 ? Math.max(...allSigs.map(s => s.timestamp || 0)) : 0;
        const TIME_WINDOW = 3 * 60 * 1000; 

        // --- STEP 1: LIVE MONITORING (EXIT VETOES & UBER ABSORPTION) ---
        Object.keys(registry).forEach(instKey => {
            const active = registry[instKey];
            const curUltra = ultraSignals.find(u => u.instrument === instKey);
            const curLoose = looseSignals.find(l => l.instrument === instKey);
            
            if (!curUltra && !highTierSignals.find(h => h.instrument === instKey)) {
                delete registry[instKey]; return;
            }

            const curPot = eliteMetaEngine.getPotentials(curUltra || active.originalSignal);
            const curLevel = eliteMetaEngine.deriveLevel(curUltra || active.originalSignal, active.config);

            /**
             * VETO 3: ABSORPTION RULE (Primary Protection)
             * Condition: Higher volume threshold hits, but Projected Reward % drops.
             */
            if (curLevel > active.lastLevel) {
                if (curPot.reward < (active.lastRewardPotential - 0.0001)) {
                    results.push({ ...curUltra, status: "CANCELLED", reason: "Veto 3: Volume Absorption" });
                    
                    // UBER INTEGRATION: Law 4 Reversal
                    if (ruleId === "UBER_ENGINE") {
                        const reversedType = curUltra.type.includes("BUY") ? "SELL_STOP" : "BUY_STOP";
                        results.push({ ...curUltra, type: reversedType, metaReason: "Uber Reversal: Absorption", status: "ACTIVE_UBER" });
                    }
                    delete registry[instKey]; return;
                }
            }

            /**
             * LATE CROWDING VETO
             * Condition: If Hidden Stealth becomes known to Retail (Loose), EXIT.
             */
            if (active.entryReason.includes("Stealth") && curLoose) {
                results.push({ ...curUltra, status: "CANCELLED", reason: "Veto: Late Retail Crowd" });
                delete registry[instKey]; return;
            }

            active.lastRewardPotential = curPot.reward;
            active.lastLevel = curLevel;
        });

        // --- STEP 2: UBER ENGINE LAW 2 (SILENCE REVERSAL) ---
        if (ruleId === "UBER_ENGINE") {
            const noiseSigs = [...looseSignals, ...trendSignals];
            noiseSigs.forEach(sig => {
                const instKey = sig.instrument;
                const ultraIsSilent = !ultraSignals.some(u => u.instrument === instKey && u.barNumber === sig.barNumber);

                if (ultraIsSilent && (maxTime - sig.timestamp <= TIME_WINDOW)) {
                    const reversedType = sig.type.includes("BUY") ? "SELL_STOP" : "BUY_STOP";
                    results.push({ ...sig, type: reversedType, metaReason: "Uber Logic: Law 2 Silence Reversal", status: "ACTIVE_UBER" });
                }
            });
            return results; 
        }

        // --- STEP 3: ENTRY GATING (S_ULTRA ANCHOR) ---
        ultraSignals.forEach(sig => {
            const instKey = sig.instrument;
            const instConfig = getInstConfig(sig);
            
            if (!instConfig || registry[instKey] || (maxTime - sig.timestamp > TIME_WINDOW)) return;

            const matchLoose = looseSignals.find(l => l.instrument === instKey && l.barNumber === sig.barNumber);
            const matchTrend = trendSignals.find(t => t.instrument === instKey && t.barNumber === sig.barNumber);
            
            const sigPot = eliteMetaEngine.getPotentials(sig);
            const currentLevel = eliteMetaEngine.deriveLevel(sig, instConfig);

            /**
             * VETO 2: LAGGED ENTRY
             * Skip if Loose led in a previous bar and reward magnitude is small.
             */
            const loosePrev = looseSignals.find(l => l.instrument === instKey && l.barNumber < sig.barNumber);
            if (loosePrev && sigPot.reward < 0.0020) return; 

            /**
             * GATE 1: THE SYNC MASTER
             * Same Bar + Reward/Risk Delta <= 0.05%
             */
            let isSynced = false;
            if (matchLoose) {
                const loosePot = eliteMetaEngine.getPotentials(matchLoose);
                const delta = Math.abs(sigPot.reward - loosePot.reward);
                if (delta <= 0.0005 && (sig.barNumber <= matchLoose.barNumber)) isSynced = true;
            }

            const isStealth = !matchLoose && !matchTrend;
            const isHeavy = instConfig.isHeavyStock === true || instConfig.exchange === "MCX_FO";
            const isHeavyConsensus = matchTrend && isHeavy;

            // ENFORCE RULE 11/12 FLOOR
            const floor = (ruleId === "RULE_11" || ruleId === "RULE_12") ? 5 : 0;

            let pass = false;
            let metaReason = "";

            if (isSynced) { pass = true; metaReason = "Gate 1: Sync Master"; }
            else if (isStealth && currentLevel >= floor) { pass = true; metaReason = "Gate 2: Institutional Stealth"; }
            else if (isHeavyConsensus && currentLevel >= floor) { pass = true; metaReason = "Gate 3: Heavy Weight"; }

            if (pass) {
                const metaSig = { ...sig, metaReason, status: "ACTIVE", derivedLevel: currentLevel, engineRule: ruleId };
                registry[instKey] = { originalSignal: sig, lastRewardPotential: sigPot.reward, lastLevel: currentLevel, config: instConfig, entryReason: metaReason };
                results.push(metaSig);
            }
        });

        // --- STEP 4: HIGH-TIER LAW 6 SCOUTING (RULE 10 & 12) ---
        if (ruleId === "RULE_10" || ruleId === "RULE_12") {
            highTierSignals.forEach(sig => {
                const instKey = sig.instrument;
                const instConfig = getInstConfig(sig);
                if (!instConfig || registry[instKey] || (maxTime - sig.timestamp > TIME_WINDOW)) return;

                const ultraSilent = !ultraSignals.some(u => u.instrument === instKey && u.barNumber === sig.barNumber);
                const looseSilent = !looseSignals.some(l => l.instrument === instKey && l.barNumber === sig.barNumber);

                if (ultraSilent && looseSilent) {
                    const currentLevel = eliteMetaEngine.deriveLevel(sig, instConfig);
                    const floor = (ruleId === "RULE_12") ? 5 : 0;
                    if (currentLevel >= floor) {
                        const metaSig = { ...sig, metaReason: "Law 6: HT Stealth Scouting", status: "ACTIVE", engineRule: ruleId };
                        registry[instKey] = { originalSignal: sig, lastRewardPotential: eliteMetaEngine.getPotentials(sig).reward, lastLevel: currentLevel, config: instConfig, entryReason: "HT Scout" };
                        results.push(metaSig);
                    }
                }
            });
        }

        return results;
    }
};

module.exports = eliteMetaEngine;