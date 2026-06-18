// public/signalsPanel.js
// Handles split layout (Volume vs Price), live state tracking, tick trigger evaluation, and exits.

class LiveTradeTracker {
    constructor(chartServer) {
        this.chartServer = chartServer;
        this.tradeSignals = [];
        this.activeTrades = new Map(); // key: `${instrument}_${bar_type}`
        
        this.initializeUI();
    }

    initializeUI() {
        // Find or create layout containers
        const signalsTodayContainer = document.getElementById('signals-container');
        if (!signalsFileContainer) {
            // If the element doesn't exist, we'll programmatically structure the sidebar signalsList container
            const container = document.getElementById('signalsList');
            if (container) {
                container.innerHTML = `
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
            .signal-item.pending {
                border-left: 4px solid #f9a825;
            }
            .signal-item.active {
                border-left: 4px solid #00bcd4;
                box-shadow: 0 0 6px rgba(0, 188, 212, 0.15);
                animation: active-glow 2s infinite alternate;
            }
            .signal-item.completed-win {
                border-left: 4px solid #26a69a;
            }
            .signal-item.completed-loss {
                border-left: 4px solid #ef5350;
            }
            .signal-item.cancelled {
                border-left: 4px solid #4a4e5a;
                opacity: 0.55;
            }
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
            
            .metric-row {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 4px;
                font-size: 11px;
                color: #b2b5be;
                margin-top: 6px;
            }
            .metric-val {
                color: #fff;
                font-weight: 600;
            }
            
            @keyframes active-glow {
                from { box-shadow: 0 0 4px rgba(0, 188, 212, 0.1); }
                to { box-shadow: 0 0 10px rgba(0, 188, 212, 0.3); }
            }
        `;
        document.head.appendChild(style);
    }

    renderSignals(signals) {
        this.tradeSignals = signals;
        this.activeTrades.clear();

        // Clear panel containers
        const volList = document.getElementById('volume-signals-list');
        const priceList = document.getElementById('price-signals-list');
        if (volList) volList.innerHTML = '';
        if (priceList) priceList.innerHTML = '';

        // Add back in chronological sorted blocks
        const sorted = [...signals].sort((a, b) => b.timestamp - a.timestamp);
        
        sorted.forEach(sig => {
            this.addCardToDOM(sig);
            if (sig.status === 'active') {
                const key = `${sig.instrument}_${sig.bar_type}`;
                this.activeTrades.set(key, sig);
            }
        });

        this.updateCounts();
    }

    handleIncomingSignal(sig) {
        // Prevent duplication checks
        const exists = this.tradeSignals.some(s => 
            s.instrument === sig.instrument &&
            s.bar_type === sig.bar_type &&
            s.barNumber === sig.barNumber &&
            s.type === sig.type
        );
        if (exists) return;

        this.tradeSignals.push(sig);
        this.addCardToDOM(sig);
        this.updateCounts();
    }

    handleStatusUpdate(update) {
        const match = this.tradeSignals.find(s => 
            s.instrument === update.instrument &&
            s.bar_type === update.bar_type &&
            s.barNumber === update.barNumber &&
            s.type === update.type
        );

        if (match) {
            match.status = update.status;
            if (update.exitReason) {
                match.exitReason = update.exitReason;
                match.exitPrice = update.exitPrice;
            }

            const key = `${match.instrument}_${match.bar_type}`;
            if (update.status === 'active') {
                this.activeTrades.set(key, match);
            } else {
                this.activeTrades.delete(key);
            }

            // Re-render to reflect modified status
            this.renderSignals(this.tradeSignals);
        }
    }

    handleTickPriceUpdate(instrument, barType, currentPrice) {
        const key = `${instrument}_${barType}`;
        const active = this.activeTrades.get(key);
        if (!active) return;

        // Calculate quantity based on standard 1% risk allocation (Capital: ₹100,000)
        const initialCapital = 100000;
        const riskAmount = initialCapital * 0.01; // ₹1,000 risk
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

        // Live update values inside DOM elements directly
        const cardId = `sig-${active.instrument.replace(/[^a-zA-Z0-9]/g, '_')}-${active.bar_type}-${active.barNumber}`;
        const pnlTextEl = document.getElementById(`${cardId}-live-pnl`);
        if (pnlTextEl) {
            const color = pnlAmount >= 0 ? '#26a69a' : '#ef5350';
            const sign = pnlAmount >= 0 ? '+' : '';
            pnlTextEl.style.color = color;
            pnlTextEl.textContent = `${sign}₹${pnlAmount.toFixed(2)} (${sign}${returnPct.toFixed(2)}%)`;
        }
    }

    addCardToDOM(sig) {
        const listId = sig.bar_type === 'volume' ? 'volume-signals-list' : 'price-signals-list';
        const container = document.getElementById(listId);
        if (!container) return;

        const cardId = `sig-${sig.instrument.replace(/[^a-zA-Z0-9]/g, '_')}-${sig.bar_type}-${sig.barNumber}`;
        
        // Remove existing element if present to avoid duplication
        const oldCard = document.getElementById(cardId);
        if (oldCard) oldCard.remove();

        const card = document.createElement('div');
        card.id = cardId;

        // Determine correct state style classes
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
            stateClass = 'cancelled';
            badgeHtml = '<span class="signal-badge badge-cancelled">CANCELLED</span>';
        }

        const isBuy = sig.type.toUpperCase().includes('BUY');
        const directionColor = isBuy ? '#26a69a' : '#ef5350';
        
        // Calculate RRR (Risk-to-Reward Ratio)
        const risk = Math.abs(sig.entry - sig.sl);
        const reward = Math.abs(sig.tp - sig.entry);
        const rrrVal = risk > 0 ? (reward / risk).toFixed(2) : '1.50';
        const rrrStr = `1 : ${rrrVal}`;

        // Compute quantity for floating or final metrics
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

        const overlapHtml = sig.overlapping 
            ? `<div style="color: #ff9100; font-size: 9px; font-weight: bold; margin-bottom: 2px;">⚠️ OVERLAPPING SIGNAL (ALT ENTRY)</div>`
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

        container.insertBefore(card, container.firstChild);
    }

    updateCounts() {
        const volCount = document.getElementById('volume-signals-count');
        const priceCount = document.getElementById('price-signals-count');
        
        if (volCount) {
            volCount.textContent = this.tradeSignals.filter(s => s.bar_type === 'volume').length;
        }
        if (priceCount) {
            priceCount.textContent = this.tradeSignals.filter(s => s.bar_type === 'price').length;
        }
    }
}