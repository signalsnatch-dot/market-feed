// public/signalPanel.js
class LiveTradeTracker {
    constructor(chartServer) {
        this.chartServer = chartServer;
        this.allSignals = [];          // Master signal cache across all versions
        this.currentVersion = "V1: Double Traps"; // Selected version
        this.activeTrades = new Map(); // key: `${instrument}_${bar_type}_${version}`
        
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
                <!-- Dropdown version selection panel -->
                <div id="strategy-selector-container" style="padding: 10px; background: #1e222d; border-bottom: 1px solid #2a2e39; display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 11px; font-weight: bold; color: #b2b5be;">ACTIVE STRATEGY:</span>
                    <select id="strategy-version-select" style="background: #2a2e39; border: 1px solid #4a4e5a; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer; font-weight: bold;">
                        <option value="V1: Double Traps">V1: Double Traps</option>
                        <option value="V2: EMA Pullback">V2: EMA Pullback</option>
                        <option value="V3: High Confidence">V3: High Confidence</option>
                        <option value="V4: Aggressive">V4: Aggressive</option>
                    </select>
                </div>
                
                <div id="volume-signals-section" style="height: 70%; display: flex; flex-direction: column; border-bottom: 2px solid #2a2e39; box-sizing: border-box; overflow: hidden;">
                    <div style="padding: 8px 12px; background: #2a2e39; font-size: 11px; font-weight: bold; color: #00bcd4; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e222d;">
                        <span>📊 VOLUME BARS (70%)</span>
                        <span id="volume-signals-count" style="color: #787b86;">0</span>
                    </div>
                    <div id="volume-signals-list" style="flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px;"></div>
                </div>
                <div id="price-signals-section" style="height: 30%; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden;">
                    <div style="padding: 8px 12px; background: #2a2e39; font-size: 11px; font-weight: bold; color: #26a69a; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e222d;">
                        <span>💰 PRICE BARS (30%)</span>
                        <span id="price-signals-count" style="color: #787b86;">0</span>
                    </div>
                    <div id="price-signals-list" style="flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px;"></div>
                </div>
            `;
            
            const select = document.getElementById('strategy-version-select');
            if (select) {
                select.value = this.currentVersion;
                select.addEventListener('change', (e) => {
                    this.currentVersion = e.target.value;
                    this.renderFilteredSignals();
                });
            }
        }
        this.injectCSS();
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

    renderSignals(signals) {
        this.allSignals = signals;
        this.renderFilteredSignals();
    }

    renderFilteredSignals() {
        this.activeTrades.clear();

        const volList = document.getElementById('volume-signals-list');
        const priceList = document.getElementById('price-signals-list');
        if (volList) volList.innerHTML = '';
        if (priceList) priceList.innerHTML = '';

        // Filter and sort signal cards sequentially (newest on top)
        const filtered = this.allSignals.filter(sig => sig.version === this.currentVersion);
        const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
        
        sorted.forEach(sig => {
            this.addCardToDOM(sig, 'append');
            if (sig.status === 'active') {
                const key = `${sig.instrument}_${sig.bar_type}_${sig.version}`;
                this.activeTrades.set(key, sig);
            }
        });

        this.updateCounts();
    }

    handleIncomingSignal(sig) {
        const exists = this.allSignals.some(s => 
            s.instrument === sig.instrument &&
            s.bar_type === sig.bar_type &&
            s.barNumber === sig.barNumber &&
            s.type === sig.type &&
            s.version === sig.version
        );
        if (exists) return;

        this.allSignals.push(sig);
        
        if (sig.version === this.currentVersion) {
            this.addCardToDOM(sig, 'prepend');
            this.updateCounts();
        }
    }

    handleStatusUpdate(update) {
        const match = this.allSignals.find(s => 
            s.instrument === update.instrument &&
            s.bar_type === update.bar_type &&
            s.barNumber === update.barNumber &&
            s.type === update.type &&
            s.version === update.version
        );

        if (match) {
            match.status = update.status;
            if (update.exitReason) {
                match.exitReason = update.exitReason;
                match.exitPrice = update.exitPrice;
            }

            const key = `${match.instrument}_${match.bar_type}_${match.version}`;
            if (update.status === 'active') {
                this.activeTrades.set(key, match);
            } else {
                this.activeTrades.delete(key);
            }

            this.renderFilteredSignals();
        }
    }

    handleTickPriceUpdate(instrument, barType, currentPrice) {
        const key = `${instrument}_${barType}_${this.currentVersion}`;
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

        const cardId = `sig-${active.instrument.replace(/[^a-zA-Z0-9]/g, '_')}-${active.bar_type}-${active.barNumber}-${active.version.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const pnlTextEl = document.getElementById(`${cardId}-live-pnl`);
        if (pnlTextEl) {
            const color = pnlAmount >= 0 ? '#26a69a' : '#ef5350';
            const sign = pnlAmount >= 0 ? '+' : '';
            pnlTextEl.style.color = color;
            pnlTextEl.textContent = `${sign}₹${pnlAmount.toFixed(2)} (${sign}${returnPct.toFixed(2)}%)`;
        }
    }

    addCardToDOM(sig, position = 'prepend') {
        const listId = sig.bar_type === 'volume' ? 'volume-signals-list' : 'price-signals-list';
        const container = document.getElementById(listId);
        if (!container) return;

        // Uniquely key the card ID using both bar numbers and version string to avoid collisions
        const cardId = `sig-${sig.instrument.replace(/[^a-zA-Z0-9]/g, '_')}-${sig.bar_type}-${sig.barNumber}-${sig.version.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        const oldCard = document.getElementById(cardId);
        if (oldCard) oldCard.remove();

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
            <div style="font-weight: 500; font-size: 13px; margin-bottom: 4px; color: #fff;">${sig.name || sig.instrument.split('|')[1]}</div>
            
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

        if (position === 'append') {
            container.appendChild(card);
        } else {
            container.insertBefore(card, container.firstChild);
        }
    }

    updateCounts() {
        const volCount = document.getElementById('volume-signals-count');
        const priceCount = document.getElementById('price-signals-count');
        
        if (volCount) {
            volCount.textContent = this.allSignals.filter(s => s.bar_type === 'volume' && s.version === this.currentVersion).length;
        }
        if (priceCount) {
            priceCount.textContent = this.allSignals.filter(s => s.bar_type === 'price' && s.version === this.currentVersion).length;
        }
    }
}