
// public/signalPanel.js
class LiveTradeTracker {
    constructor(chartServer) {
        this.chartServer = chartServer;
        this.allSignals = [];          
        this.activeTrades = new Map(); 

        this.filterVersion = "V1: Double Traps";
        this.filterInstrument = "ALL";
        this.filterBarType = "ALL";
        this.filterThreshold = "ALL";
        
        this.initializeUI();
    }

    initializeUI() {
        const container = document.getElementById('signalsList');
        if (container) {
            container.style.height = '100%';
            container.style.overflow = 'hidden';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.boxSizing = 'border-box';
            
            container.innerHTML = `
                <!-- Advanced Multi-Filter controls -->
                <div class="filter-controls-container" style="padding: 10px; background: #1e222d; border-bottom: 1px solid #2a2e39; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 10px; font-weight: bold; color: #b2b5be;">VERSION:</span>
                        <select id="filter-version-select" style="background: #2a2e39; border: 1px solid #4a4e5a; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer; width: 170px;"></select>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 10px; font-weight: bold; color: #b2b5be;">ASSET:</span>
                        <select id="filter-instrument-select" style="background: #2a2e39; border: 1px solid #4a4e5a; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer; width: 170px;"></select>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 10px; font-weight: bold; color: #b2b5be;">BAR TYPE:</span>
                        <select id="filter-bartype-select" style="background: #2a2e39; border: 1px solid #4a4e5a; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer; width: 170px;">
                            <option value="ALL">All Bar Types</option>
                            <option value="volume">Volume Bars</option>
                            <option value="price">Price Bars</option>
                        </select>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 10px; font-weight: bold; color: #b2b5be;">THRESHOLD:</span>
                        <select id="filter-threshold-select" style="background: #2a2e39; border: 1px solid #4a4e5a; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer; width: 170px;">
                            <option value="ALL">All Thresholds</option>
                        </select>
                    </div>
                </div>

                <!-- Dynamic Cumulative Metrics Widget -->
                <div id="stats-widget-container" style="padding: 10px; background: #141722; border-bottom: 2px solid #2a2e39; display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; box-sizing: border-box;">
                    <div style="border-right: 1px solid #2a2e39; padding-right: 4px;">
                        <div style="font-size: 9px; color: #787b86; text-transform: uppercase;">Total Trades</div>
                        <div id="metric-total-trades" style="font-size: 14px; font-weight: bold; color: #fff;">0</div>
                    </div>
                    <div style="padding-left: 4px;">
                        <div style="font-size: 9px; color: #787b86; text-transform: uppercase;">Win Rate</div>
                        <div id="metric-win-rate" style="font-size: 14px; font-weight: bold; color: #26a69a;">0.00%</div>
                    </div>
                    <div style="border-right: 1px solid #2a2e39; padding-right: 4px; border-top: 1px solid #2a2e39; padding-top: 4px;">
                        <div style="font-size: 9px; color: #787b86; text-transform: uppercase;">Cum. Return</div>
                        <div id="metric-cum-return" style="font-size: 14px; font-weight: bold; color: #26a69a;">+0.00%</div>
                    </div>
                    <div style="padding-left: 4px; border-top: 1px solid #2a2e39; padding-top: 4px;">
                        <div style="font-size: 9px; color: #787b86; text-transform: uppercase;">Avg. Return</div>
                        <div id="metric-avg-return" style="font-size: 14px; font-weight: bold; color: #26a69a;">+0.00%</div>
                    </div>
                    <div style="border-right: 1px solid #2a2e39; padding-right: 4px; border-top: 1px solid #2a2e39; padding-top: 4px;">
                        <div style="font-size: 9px; color: #787b86; text-transform: uppercase;">Avg MAFE</div>
                        <div id="metric-avg-mafe" style="font-size: 14px; font-weight: bold; color: #00bcd4;">0.00%</div>
                    </div>
                    <div style="padding-left: 4px; border-top: 1px solid #2a2e39; padding-top: 4px;">
                        <div style="font-size: 9px; color: #787b86; text-transform: uppercase;">Avg MAE</div>
                        <div id="metric-avg-mae" style="font-size: 14px; font-weight: bold; color: #ef5350;">0.00%</div>
                    </div>
                </div>
                
                <!-- Live Trades Feed -->
                <div id="filtered-signals-section" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;">
                    <div style="padding: 6px 12px; background: #2a2e39; font-size: 11px; font-weight: bold; color: #00bcd4; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e222d;">
                        <span>📡 STREAM FEED</span>
                        <span id="filtered-signals-count" style="color: #787b86;">0</span>
                    </div>
                    <div id="filtered-signals-list" style="flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px;"></div>
                </div>
            `;
        }
        this.injectCSS();
        this.setupEventHandlers();
    }

    injectCSS() {
        const styleId = 'live-tracker-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .signal-item {
                background: #1e222d;
                border: 1px solid #2a2e39;
                border-radius: 6px;
                padding: 10px;
                color: #d1d4dc;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                transition: all 0.25s ease;
                font-size: 12px;
                box-sizing: border-box;
            }
            .signal-item.pending { border-left: 4px solid #f9a825; }
            .signal-item.active {
                border-left: 4px solid #00bcd4;
                box-shadow: 0 0 6px rgba(0, 188, 212, 0.15);
                animation: active-glow 2s infinite alternate;
            }
            .signal-item.completed-win { border-left: 4px solid #26a69a; }
            .signal-item.completed-loss { border-left: 4px solid #ef5350; }
            .signal-item.cancelled { border-left: 4px solid #4a4e5a; opacity: 0.55; }
            .signal-item.overlapping { border-left: 4px solid #787b86; opacity: 0.45; }
            
            .signal-badge {
                font-size: 9px;
                font-weight: bold;
                padding: 2px 6px;
                border-radius: 3px;
                text-transform: uppercase;
                display: inline-block;
            }
            .badge-pending { background: #5d4037; color: #ffb74d; }
            .badge-active { background: #006064; color: #80deea; }
            .badge-win { background: #1b5e20; color: #a5d6a7; }
            .badge-loss { background: #b71c1c; color: #ef9a9a; }
            .badge-cancelled { background: #37474f; color: #b0bec5; }
            .badge-overlapping { background: #263238; color: #90a4ae; }
            
            .metric-row {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 4px;
                font-size: 11px;
                color: #b2b5be;
                margin-top: 6px;
            }
            .metric-val { color: #fff; font-weight: 600; }
            
            @keyframes active-glow {
                from { box-shadow: 0 0 4px rgba(0, 188, 212, 0.1); }
                to { box-shadow: 0 0 10px rgba(0, 188, 212, 0.3); }
            }
        `;
        document.head.appendChild(style);
    }

    setupEventHandlers() {
        document.getElementById('filter-version-select')?.addEventListener('change', (e) => {
            this.filterVersion = e.target.value;
            this.renderFilteredSignals();
        });
        document.getElementById('filter-instrument-select')?.addEventListener('change', (e) => {
            this.filterInstrument = e.target.value;
            this.updateThresholdOptions();
            this.renderFilteredSignals();
        });
        document.getElementById('filter-bartype-select')?.addEventListener('change', (e) => {
            this.filterBarType = e.target.value;
            this.updateThresholdOptions();
            this.renderFilteredSignals();
        });
        document.getElementById('filter-threshold-select')?.addEventListener('change', (e) => {
            this.filterThreshold = e.target.value;
            this.renderFilteredSignals();
        });
    }

    setupStrategyVersions(versions) {
        if (!Array.isArray(versions) || versions.length === 0) return;
        const select = document.getElementById('filter-version-select');
        if (select) {
            select.innerHTML = ''; 
            versions.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                select.appendChild(opt);
            });
            this.filterVersion = versions[0];
            select.value = this.filterVersion;
        }
    }

    renderSignals(signals) {
        this.allSignals = signals;
        this.updateFilterDropdowns();
        this.renderFilteredSignals();
    }

    updateFilterDropdowns() {
        // Instrument Select
        const instSelect = document.getElementById('filter-instrument-select');
        if (instSelect) {
            const uniqueInstruments = ["ALL", ...new Set(this.allSignals.map(s => s.instrument))].sort();
            const prevValue = instSelect.value;
            instSelect.innerHTML = '';
            uniqueInstruments.forEach(inst => {
                const opt = document.createElement('option');
                opt.value = inst;
                opt.textContent = inst === "ALL" ? "All Instruments" : inst.split('|')[1] || inst;
                instSelect.appendChild(opt);
            });
            if (uniqueInstruments.includes(prevValue)) {
                instSelect.value = prevValue;
                this.filterInstrument = prevValue;
            } else {
                this.filterInstrument = "ALL";
            }
        }
        this.updateThresholdOptions();
    }

    updateThresholdOptions() {
        const thresholdSelect = document.getElementById('filter-threshold-select');
        if (!thresholdSelect) return;

        let filteredSignals = this.allSignals;
        if (this.filterInstrument !== 'ALL') {
            filteredSignals = filteredSignals.filter(s => s.instrument === this.filterInstrument);
        }
        if (this.filterBarType !== 'ALL') {
            filteredSignals = filteredSignals.filter(s => s.bar_type === this.filterBarType);
        }

        const uniqueThresholds = ["ALL", ...new Set(filteredSignals.map(s => s.threshold).filter(t => t !== undefined))].sort((a, b) => a - b);
        
        const prevValue = thresholdSelect.value;
        thresholdSelect.innerHTML = '';
        uniqueThresholds.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t === "ALL" ? "All Thresholds" : t;
            thresholdSelect.appendChild(opt);
        });

        if (uniqueThresholds.includes(prevValue)) {
            thresholdSelect.value = prevValue;
            this.filterThreshold = prevValue;
        } else {
            this.filterThreshold = "ALL";
            thresholdSelect.value = "ALL";
        }
    }

    renderFilteredSignals() {
        this.activeTrades.clear();
        const listContainer = document.getElementById('filtered-signals-list');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        const filtered = this.allSignals.filter(sig => {
            const matchesVersion = (sig.version || "V1: Double Traps") === this.filterVersion;
            const matchesInstrument = this.filterInstrument === 'ALL' || sig.instrument === this.filterInstrument;
            const matchesBarType = this.filterBarType === 'ALL' || sig.bar_type === this.filterBarType;
            const matchesThreshold = this.filterThreshold === 'ALL' || String(sig.threshold) === String(this.filterThreshold);
            return matchesVersion && matchesInstrument && matchesBarType && matchesThreshold;
        });

        const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach(sig => {
            this.addCardToDOM(sig, listContainer);
            if (sig.status === 'active') {
                const key = `${sig.instrument}_${sig.bar_type}_${sig.threshold}_${sig.version || "V1: Double Traps"}`;
                this.activeTrades.set(key, sig);
            }
        });

        const countEl = document.getElementById('filtered-signals-count');
        if (countEl) countEl.textContent = sorted.length;

        this.calculateAndDisplayMetrics(filtered);
    }

    calculateAndDisplayMetrics(signals) {
        const completed = signals.filter(s => s.status === 'completed');
        const total = completed.length;

        const tradesEl = document.getElementById('metric-total-trades');
        const wrEl = document.getElementById('metric-win-rate');
        const crEl = document.getElementById('metric-cum-return');
        const arEl = document.getElementById('metric-avg-return');
        const mafeEl = document.getElementById('metric-avg-mafe');
        const maeEl = document.getElementById('metric-avg-mae');

        if (total === 0) {
            tradesEl.textContent = '0';
            wrEl.textContent = '0.00%';
            wrEl.style.color = '#787b86';
            crEl.textContent = '0.00%';
            crEl.style.color = '#fff';
            arEl.textContent = '0.00%';
            arEl.style.color = '#fff';
            mafeEl.textContent = '0.00%';
            maeEl.textContent = '0.00%';
            return;
        }

        let wins = 0;
        let cumulativeReturn = 0;
        let mafeSum = 0;
        let maeSum = 0;
        let validMafeCount = 0;
        let validMaeCount = 0;

        completed.forEach(s => {
            const isBuy = s.type.toUpperCase().includes('BUY');
            const entry = s.entry;
            const exit = s.exitPrice || (s.exitReason === 'take_profit' ? s.tp : s.sl);

            let tradeReturn = 0;
            if (isBuy) {
                tradeReturn = ((exit - entry) / entry) * 100;
            } else {
                tradeReturn = ((entry - exit) / entry) * 100;
            }

            cumulativeReturn += tradeReturn;
            if (s.exitReason === 'take_profit') wins++;

            if (s.mafePercentage !== undefined && s.mafePercentage !== null) {
                mafeSum += parseFloat(s.mafePercentage);
                validMafeCount++;
            }
            if (s.maePercentage !== undefined && s.maePercentage !== null) {
                maeSum += parseFloat(s.maePercentage);
                validMaeCount++;
            }
        });

        const wr = (wins / total) * 100;
        const avgReturn = cumulativeReturn / total;
        const avgMafe = validMafeCount > 0 ? (mafeSum / validMafeCount) : 0;
        const avgMae = validMaeCount > 0 ? (maeSum / validMaeCount) : 0;

        tradesEl.textContent = total;
        wrEl.textContent = `${wr.toFixed(2)}%`;
        wrEl.style.color = wr >= 50 ? '#26a69a' : '#ef5350';

        crEl.textContent = `${cumulativeReturn >= 0 ? '+' : ''}${cumulativeReturn.toFixed(2)}%`;
        crEl.style.color = cumulativeReturn >= 0 ? '#26a69a' : '#ef5350';

        arEl.textContent = `${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`;
        arEl.style.color = avgReturn >= 0 ? '#26a69a' : '#ef5350';

        mafeEl.textContent = `${avgMafe.toFixed(2)}%`;
        maeEl.textContent = `${avgMae.toFixed(2)}%`;
    }

    handleIncomingSignal(sig) {
        const sigVersion = sig.version || "V1: Double Traps";
        const exists = this.allSignals.some(s => 
            s.instrument === sig.instrument &&
            s.bar_type === sig.bar_type &&
            s.threshold === sig.threshold &&
            s.barNumber === sig.barNumber &&
            s.type === sig.type &&
            (s.version || "V1: Double Traps") === sigVersion
        );
        if (exists) return;

        this.allSignals.push(sig);
        this.updateFilterDropdowns();
        this.renderFilteredSignals();
    }

    handleStatusUpdate(update) {
        const updateVersion = update.version || "V1: Double Traps";
        const match = this.allSignals.find(s => 
            s.instrument === update.instrument &&
            s.bar_type === update.bar_type &&
            s.threshold === update.threshold &&
            s.barNumber === update.barNumber &&
            s.type === update.type &&
            (s.version || "V1: Double Traps") === updateVersion
        );

        if (match) {
            match.status = update.status;
            if (update.exitReason) {
                match.exitReason = update.exitReason;
                match.exitPrice = update.exitPrice;
            }
            
            const key = `${match.instrument}_${match.bar_type}_${match.threshold}_${updateVersion}`;
            if (update.status === 'active') {
                this.activeTrades.set(key, match);
            } else {
                this.activeTrades.delete(key);
            }
            this.renderFilteredSignals();
        }
    }

    handleTickPriceUpdate(instrument, barType, threshold, currentPrice) {
        const key = `${instrument}_${barType}_${threshold}_${this.filterVersion}`;
        const active = this.activeTrades.get(key);
        if (!active) return;

        const initialCapital = 100000;
        const riskAmount = initialCapital * 0.01; 
        const riskPerUnit = Math.abs(active.entry - active.sl);
        const quantity = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;

        let returnPct = 0;
        let pnlAmount = 0;

        if (active.type.toUpperCase().includes('BUY')) {
            returnPct = ((currentPrice - active.entry) / active.entry) * 100;
            pnlAmount = quantity * (currentPrice - active.entry);
        } else {
            returnPct = ((active.entry - currentPrice) / active.entry) * 100;
            pnlAmount = quantity * (active.entry - currentPrice);
        }

        const sigVersion = active.version || "V1: Double Traps";
        const cardId = `sig-${active.instrument.replace(/[^a-zA-Z0-9]/g, '_')}-${active.bar_type}-${active.threshold}-${active.barNumber}-${sigVersion.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const pnlTextEl = document.getElementById(`${cardId}-live-pnl`);
        if (pnlTextEl) {
            const color = pnlAmount >= 0 ? '#26a69a' : '#ef5350';
            const sign = pnlAmount >= 0 ? '+' : '';
            pnlTextEl.style.color = color;
            pnlTextEl.textContent = `${sign}₹${pnlAmount.toFixed(2)} (${sign}${returnPct.toFixed(2)}%)`;
        }
    }

    addCardToDOM(sig, container) {
        const sigVersion = sig.version || "V1: Double Traps";
        const cardId = `sig-${sig.instrument.replace(/[^a-zA-Z0-9]/g, '_')}-${sig.bar_type}-${sig.threshold}-${sig.barNumber}-${sigVersion.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        const card = document.createElement('div');
        card.id = cardId;

        let stateClass = 'pending';
        let badgeHtml = '<span class="signal-badge badge-pending">PENDING</span>';
        
        if (sig.status === 'active') {
            stateClass = 'active';
            badgeHtml = '<span class="signal-badge badge-active">ACTIVE</span>';
        } else if (sig.status === 'completed') {
            const isWin = sig.exitReason === 'take_profit';
            stateClass = isWin ? 'completed-win' : 'completed-loss';
            badgeHtml = isWin 
                ? '<span class="signal-badge badge-win">WIN</span>' 
                : '<span class="signal-badge badge-loss">LOSS</span>';
        } else if (sig.status === 'cancelled') {
            const isOverlapping = sig.exitReason === 'overlapping' || sig.overlapping;
            stateClass = isOverlapping ? 'overlapping' : 'cancelled';
            badgeHtml = isOverlapping
                ? '<span class="signal-badge badge-overlapping">OVERLAPPING</span>'
                : '<span class="signal-badge badge-cancelled">CANCELLED</span>';
        }

        const isBuy = sig.type.toUpperCase().includes('BUY');
        const directionColor = isBuy ? '#26a69a' : '#ef5350';
        
        const risk = Math.abs(sig.entry - sig.sl);
        const reward = Math.abs(sig.tp - sig.entry);
        const rrrVal = risk > 0 ? (reward / risk).toFixed(2) : '1.50';
        const rrrStr = `1 : ${rrrVal}`;

        const initialCapital = 100000;
        const riskAmount = initialCapital * 0.01;
        const quantity = risk > 0 ? riskAmount / risk : 0;

        let trackingHtml = '';
        if (sig.status === 'active') {
            trackingHtml = `
                <div style="grid-column: span 2; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #2a2e39;">
                    Live Return: <span id="${cardId}-live-pnl" style="font-weight: bold; color: #fff;">Evaluating Ticks...</span>
                </div>
            `;
        } else if (sig.status === 'completed') {
            let finalReturn = 0;
            let finalPnL = 0;
            const exitPrice = sig.exitPrice || (sig.exitReason === 'take_profit' ? sig.tp : sig.sl);

            if (isBuy) {
                finalReturn = ((exitPrice - sig.entry) / sig.entry) * 100;
                finalPnL = quantity * (exitPrice - sig.entry);
            } else {
                finalReturn = ((sig.entry - exitPrice) / sig.entry) * 100;
                finalPnL = quantity * (sig.entry - exitPrice);
            }
            
            const color = finalPnL >= 0 ? '#26a69a' : '#ef5350';
            const sign = finalPnL >= 0 ? '+' : '';

            trackingHtml = `
                <div style="grid-column: span 2; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #2a2e39; font-size: 11px;">
                    Result: <span style="font-weight: bold; color: ${color};">${sign}₹${finalPnL.toFixed(2)} (${sign}${finalReturn.toFixed(2)}%)</span> via <span style="text-transform: lowercase;">${sig.exitReason || 'close'}</span>
                </div>
            `;
        }

        const overlapHtml = sig.exitReason === 'overlapping' || sig.overlapping
            ? `<div style="color: #ff9100; font-size: 9px; font-weight: bold; margin-bottom: 2px;">⚠️ OVERLAPPING SETUP (NOT TRADED)</div>`
            : '';

        const timeStr = new Date(sig.timestamp).toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        card.className = `signal-item ${stateClass}`;
        card.innerHTML = `
            ${overlapHtml}
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-weight: bold; color: ${directionColor};">${sig.type}</span>
                <div style="display: flex; gap: 4px; align-items: center;">
                    ${badgeHtml}
                    <span style="font-size: 9px; color: #787b86;">#${sig.barNumber}</span>
                </div>
            </div>
            <div style="font-weight: 500; font-size: 13px; margin-bottom: 4px; color: #fff;">
                ${sig.name || sig.instrument.split('|')[1]} 
                <span style="font-size:10px; color:#787b86; font-weight:normal;">(T: ${sig.threshold})</span>
            </div>
            
            <div class="metric-row">
                <div>Entry: <span class="metric-val">${sig.entry.toFixed(2)}</span></div>
                <div>RRR: <span class="metric-val" style="color: #f9a825;">${rrrStr}</span></div>
                <div>SL: <span class="metric-val" style="color: #ef5350;">${sig.sl.toFixed(2)}</span></div>
                <div>TP: <span class="metric-val" style="color: #26a69a;">${sig.tp.toFixed(2)}</span></div>
                <div style="grid-column: span 2;">Conf: <span class="metric-val" style="color: #00bcd4;">${sig.confidence}%</span></div>
                ${trackingHtml}
            </div>
            <div style="font-size: 9px; color: #787b86; margin-top: 6px; font-style: italic; border-top: 1px solid #2a2e39; padding-top: 4px;">
                ${timeStr} | ${sig.reason || ''}
            </div>
        `;

        container.appendChild(card);
    }
}