// public/backtest-viewer.js
class BacktestViewer {
    constructor() {
        this.currentDate = null;
        this.currentInstrument = null;
        this.currentThreshold = null;
        this.currentVersion = 'ALL';
        
        this.candles = [];
        this.tradesData = null;
        this.tradeMarkers = [];
        this.chart = null;
        this.candleSeries = null;
        this.bottomSeries = null;
        this.ema20Series = null;
        this.timeMap = new Map();
        this.isInitialized = false;
        this.markerPrimitive = null; // LightweightCharts marker utility
        
        this.init();
    }

    async init() {
        this.initChart();
        await this.loadDates();
        this.setupEventListeners();
    }

    async fetchJSON(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async loadDates() {
        try {
            const dates = await this.fetchJSON('/api/backtest/dates');
            const select = document.getElementById('date-select');
            select.innerHTML = '<option value="">-- Select Date --</option>';
            dates.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d;
                const parts = d.split('-');
                opt.textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;
                select.appendChild(opt);
            });
            if (dates.length > 0) {
                select.value = dates[dates.length - 1];
                this.onDateChange();
            }
        } catch (err) {
            console.error('Failed to load dates:', err);
        }
    }

    async onDateChange() {
        const select = document.getElementById('date-select');
        this.currentDate = select.value;
        if (!this.currentDate) {
            this.disableSelect('instrument-select');
            this.disableSelect('threshold-select');
            return;
        }
        this.updateStatusBadge(`📅 ${this.currentDate}`);
        await this.loadInstruments();
    }

    async loadInstruments() {
        try {
            const instruments = await this.fetchJSON(`/api/backtest/instruments?date=${encodeURIComponent(this.currentDate)}`);
            const select = document.getElementById('instrument-select');
            select.innerHTML = '<option value="">-- Select Instrument --</option>';
            instruments.forEach(inst => {
                const opt = document.createElement('option');
                opt.value = inst.key;
                opt.textContent = inst.name || inst.key;
                select.appendChild(opt);
            });
            select.disabled = false;
            if (instruments.length > 0) {
                select.value = instruments[0].key;
                this.onInstrumentChange();
            }
        } catch (err) {
            console.error('Failed to load instruments:', err);
        }
    }

    async onInstrumentChange() {
        const select = document.getElementById('instrument-select');
        this.currentInstrument = select.value;
        if (!this.currentInstrument) {
            this.disableSelect('threshold-select');
            return;
        }
        document.getElementById('selection-details').innerHTML = 
            `Date: ${this.currentDate}<br>Instrument: ${this.currentInstrument}`;
        await this.loadThresholds();
    }

    async loadThresholds() {
        try {
            const thresholds = await this.fetchJSON(`/api/backtest/thresholds?date=${encodeURIComponent(this.currentDate)}&instrument=${encodeURIComponent(this.currentInstrument)}`);
            const select = document.getElementById('threshold-select');
            select.innerHTML = '<option value="">-- Select Threshold --</option>';
            thresholds.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                select.appendChild(opt);
            });
            select.disabled = false;
            if (thresholds.length > 0) {
                select.value = thresholds[0];
                this.onThresholdChange();
            }
        } catch (err) {
            console.error('Failed to load thresholds:', err);
        }
    }

    async onThresholdChange() {
        const select = document.getElementById('threshold-select');
        this.currentThreshold = select.value;
        if (!this.currentThreshold) return;

        document.getElementById('selection-details').innerHTML = 
            `Date: ${this.currentDate}<br>Instrument: ${this.currentInstrument}<br>Threshold: ${this.currentThreshold}`;
        
        await this.loadCandles();
        await this.loadTrades();
    }

    async loadCandles() {
        try {
            const rawCandles = await this.fetchJSON(`/api/backtest/candles?date=${encodeURIComponent(this.currentDate)}&instrument=${encodeURIComponent(this.currentInstrument)}&threshold=${encodeURIComponent(this.currentThreshold)}`);
            this.candles = rawCandles.map((c, idx) => this.parseCandle(c, idx)).filter(c => c !== null);
            this.renderCandles();
            document.getElementById('candleCount').textContent = `Candles: ${this.candles.length}`;
        } catch (err) {
            console.error('Failed to load candles:', err);
            this.candles = [];
            this.renderCandles();
        }
    }

    parseCandle(c, idx) {
        const barNum = parseInt(c.barNumber) || (idx + 1);
        const open = parseFloat(c.open);
        const high = parseFloat(c.high);
        const low = parseFloat(c.low);
        const close = parseFloat(c.close);
        const volume = parseFloat(c.volume) || 0;
        const transactions = parseInt(c.transactions) || 0;
        const priceChanges = parseInt(c.priceChanges) || 0;
        const startTime = c.startTime || c.timestamp || '';

        if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;

        const syntheticTime = 1600000000 + (barNum * 60);

        let timeStr = '';
        if (startTime) {
            try {
                const d = new Date(startTime);
                timeStr = d.toLocaleTimeString('en-IN', { 
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                    timeZone: 'Asia/Kolkata'
                });
            } catch (e) {
                timeStr = startTime;
            }
        }
        this.timeMap.set(barNum, { barNumber: barNum, startTime: timeStr, rawStartTime: startTime, synthTime: syntheticTime });

        return {
            time: syntheticTime,
            open: open,
            high: high,
            low: low,
            close: close,
            volume: volume,
            barNumber: barNum,
            transactions: transactions,
            priceChanges: priceChanges,
            bottomValue: transactions || priceChanges || 0
        };
    }

    async loadTrades() {
        const versionWrapper = document.getElementById('version-wrapper');
        versionWrapper.classList.add('hidden');

        try {
            this.tradesData = await this.fetchJSON(`/api/backtest/trades?date=${encodeURIComponent(this.currentDate)}&instrument=${encodeURIComponent(this.currentInstrument)}&threshold=${encodeURIComponent(this.currentThreshold)}`);
            
            const strategies = this.tradesData && this.tradesData.strategies;
            if (strategies && Object.keys(strategies).length > 0) {
                const versionSelect = document.getElementById('version-select');
                versionSelect.innerHTML = '<option value="ALL">All Versions</option>';
                Object.keys(strategies).forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v;
                    opt.textContent = v;
                    versionSelect.appendChild(opt);
                });
                versionSelect.value = this.currentVersion;
                versionWrapper.classList.remove('hidden');
                this.renderTradeMarkers();
                this.computeMetrics();
            } else {
                this.clearMarkers();
                this.clearMetrics();
                versionWrapper.classList.add('hidden');
            }
        } catch (err) {
            console.error('Failed to load trades:', err);
            this.clearMarkers();
            this.clearMetrics();
        }
    }

    onVersionChange() {
        const select = document.getElementById('version-select');
        this.currentVersion = select.value;
        this.renderTradeMarkers();
        this.computeMetrics();
    }

    getTradesForVersion(version) {
        if (!this.tradesData || !this.tradesData.strategies) return [];
        if (version === 'ALL') {
            const all = [];
            Object.values(this.tradesData.strategies).forEach(s => {
                if (s.results && s.results.trades) {
                    all.push(...s.results.trades);
                }
            });
            return all;
        }
        const strategy = this.tradesData.strategies[version];
        if (!strategy || !strategy.results || !strategy.results.trades) return [];
        return strategy.results.trades;
    }

    getAllTradesWithVersion() {
        if (!this.tradesData || !this.tradesData.strategies) return [];
        const all = [];
        Object.entries(this.tradesData.strategies).forEach(([version, s]) => {
            if (s.results && s.results.trades) {
                s.results.trades.forEach(t => {
                    all.push({ ...t, _version: version });
                });
            }
        });
        return all;
    }

    // Determine if a trade is BUY or SELL based on takeProfit relative to entry.
    // BUY:  TP > entry (profit comes from price going up)
    // SELL: TP < entry (profit comes from price going down)
    isTradeBuy(trade) {
        return trade.takeProfit > trade.entryPrice;
    }

    renderTradeMarkers() {
        this.tradeMarkers = [];
        let trades;
        if (this.currentVersion === 'ALL') {
            trades = this.getAllTradesWithVersion();
        } else {
            trades = this.getTradesForVersion(this.currentVersion);
        }

        // Deduplicate: when multiple versions have the same trade on the same bar with same direction,
        // only show one entry marker (they would overlap anyway).
        // Key by entryBar + direction to deduplicate.
        const seenEntryKeys = new Set();
        const markers = [];
        trades.forEach((trade, idx) => {
            const entryBar = trade.entryIndex;
            const exitBar = trade.exitIndex;
            
            const isBuy = this.isTradeBuy(trade);
            const isWin = trade.exitReason === 'take_profit';
            
            // Dedup key: entryBar + direction (buy/sell)
            const entryKey = entryBar + '_' + (isBuy ? 'B' : 'S');
            if (seenEntryKeys.has(entryKey)) return; // skip duplicate
            seenEntryKeys.add(entryKey);
            
            // Find synthetic time for this bar
            const entryInfo = this.timeMap.get(entryBar);
            const entryTime = entryInfo ? entryInfo.synthTime : (1600000000 + (entryBar * 60));
            
            // Determine color: green for win, red for loss, amber for cancelled/pending
            let markerColor;
            if (trade.exitReason === 'take_profit') markerColor = '#26a69a';
            else if (trade.exitReason === 'stop_loss') markerColor = '#ef5350';
            else markerColor = '#f9a825'; // cancelled/pending trades get amber
            
            // Entry marker
            markers.push({
                time: entryTime,
                position: isBuy ? 'belowBar' : 'aboveBar',
                shape: isBuy ? 'arrowUp' : 'arrowDown',
                color: markerColor,
                text: isBuy ? 'B' : 'S',
                size: 1,
                tradeData: trade
            });

            // Exit marker (only if different bar)
            if (exitBar && exitBar !== entryBar) {
                const exitInfo = this.timeMap.get(exitBar);
                const exitTime = exitInfo ? exitInfo.synthTime : (1600000000 + (exitBar * 60));
                markers.push({
                    time: exitTime,
                    position: 'aboveBar',
                    shape: 'square',
                    color: '#787b86',
                    text: 'X',
                    size: 1,
                    tradeData: trade,
                    isExit: true
                });
            }
        });

        this.tradeMarkers = markers;
        this.applyMarkers();
    }

    applyMarkers() {
        if (!this.isInitialized || !this.candleSeries) return;
        
        // LightweightCharts v5 uses createSeriesMarkers utility
        try {
            if (this.markerPrimitive) {
                this.markerPrimitive.setMarkers(this.tradeMarkers.map(m => ({
                    time: m.time,
                    position: m.position,
                    shape: m.shape,
                    color: m.color,
                    text: m.text,
                    size: m.size
                })));
            }
        } catch (e) {
            console.warn('Marker update error:', e.message);
        }
        this.markerData = this.tradeMarkers;
    }

    clearMarkers() {
        if (!this.isInitialized || !this.candleSeries) return;
        try {
            if (this.markerPrimitive) {
                this.markerPrimitive.setMarkers([]);
            }
        } catch (e) {}
        this.markerData = [];
    }

    computeEMA(closes, period) {
        if (closes.length === 0) return [];
        const k = 2 / (period + 1);
        const ema = [closes[0]];
        for (let i = 1; i < closes.length; i++) {
            ema.push(closes[i] * k + ema[i-1] * (1 - k));
        }
        return ema;
    }

    initChart() {
        const chartElement = document.getElementById('main-chart');
        if (!chartElement || typeof LightweightCharts === 'undefined') {
            setTimeout(() => this.initChart(), 500);
            return;
        }

        this.chart = LightweightCharts.createChart(chartElement, {
            layout: { 
                background: { color: '#1e222d' }, 
                textColor: '#d1d4dc' 
            },
            grid: { 
                vertLines: { color: '#2a2e39' }, 
                horzLines: { color: '#2a2e39' } 
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time) => {
                    for (const [barNum, info] of this.timeMap) {
                        if (info.synthTime === time) {
                            return info.startTime;
                        }
                    }
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
                }
            },
            rightPriceScale: {
                borderColor: '#2a2e39',
                scaleMargins: { top: 0.05, bottom: 0.25 }
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
        });

        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            priceScaleId: 'right'
        });

        // Create marker primitive using createSeriesMarkers
        this.markerPrimitive = LightweightCharts.createSeriesMarkers(this.candleSeries, []);

        // EMA 20 line
        this.ema20Series = this.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#f9a825',
            lineWidth: 1,
            priceScaleId: 'right',
            lastValueVisible: false,
            priceLineVisible: false
        });

        this.bottomSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
            color: '#00bcd4',
            priceFormat: { type: 'volume' },
            priceScaleId: 'bottom'
        });

        this.chart.priceScale('bottom').applyOptions({
            scaleMargins: { top: 0.75, bottom: 0.05 },
            borderColor: '#2a2e39',
            autoScale: true,
            entireTextOnly: true
        });

        this.isInitialized = true;

        this.chart.subscribeCrosshairMove((param) => {
            this.onCrosshairMove(param);
        });

        window.addEventListener('resize', () => {
            this.chart?.applyOptions({ width: chartElement.clientWidth });
        });
    }

    renderCandles() {
        if (!this.isInitialized || !this.candleSeries || !this.candles.length) return;

        const chartData = [];
        const bottomData = [];
        for (const c of this.candles) {
            chartData.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
            bottomData.push({ time: c.time, value: c.bottomValue, color: '#00bcd4' });
        }

        this.candleSeries.setData(chartData);
        this.bottomSeries.setData(bottomData);
        
        // Compute and set EMA 20
        const closes = this.candles.map(c => c.close);
        const emaValues = this.computeEMA(closes, 20);
        const emaData = [];
        for (let i = 0; i < this.candles.length; i++) {
            emaData.push({ time: this.candles[i].time, value: emaValues[i] });
        }
        this.ema20Series.setData(emaData);
        
        this.chart.timeScale().fitContent();
        
        // Reapply markers
        this.applyMarkers();
    }

    onCrosshairMove(param) {
        const tooltip = document.getElementById('tooltip');
        if (!param.time || !param.point) {
            tooltip.style.display = 'none';
            return;
        }

        const synthTime = param.time;
        
        // Find bar number from synthetic time
        let barNum = null;
        let candleInfo = null;
        for (const [bn, info] of this.timeMap) {
            if (info.synthTime === synthTime) {
                barNum = bn;
                candleInfo = info;
                break;
            }
        }
        if (barNum === null) {
            tooltip.style.display = 'none';
            return;
        }
        
        // Check if there's a marker at this bar
        const markersAtTime = this.markerData ? this.markerData.filter(m => {
            const mInfo = this.timeMap.get(this.getBarNumFromSynthTime(m.time));
            return m.time === synthTime && !m.isExit;
        }) : [];
        if (markersAtTime.length === 0) {
            tooltip.style.display = 'none';
            return;
        }

        const marker = markersAtTime[0];
        const trade = marker.tradeData;
        const versionLabel = trade._version ? trade._version : this.currentVersion;

        const isWin = trade.exitReason === 'take_profit';
        const isBuy = this.isTradeBuy(trade);
        const isCancelled = trade.exitReason !== 'take_profit' && trade.exitReason !== 'stop_loss';

        const resultClass = isWin ? 'tp-win' : 'tp-loss';
        const resultText = isWin ? '✅ WIN' : (isCancelled ? '⏹️ CANCELLED' : '❌ LOSS');

        let returnPct = 0;
        if (!isCancelled) {
            if (isBuy) {
                returnPct = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
            } else {
                returnPct = ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
            }
        }

        // Extract trade setup reason from version name (e.g. "V1: Double Traps" → "Double Traps")
        const setupReason = versionLabel.includes(':') ? versionLabel.split(':')[1].trim() : versionLabel;

        tooltip.innerHTML = `
            <div class="tp-row"><span class="tp-label">Version</span><span class="tp-value" style="font-size:10px;">${versionLabel}</span></div>
            <div class="tp-row"><span class="tp-label">Setup</span><span class="tp-value">${setupReason}</span></div>
            <div class="tp-row"><span class="tp-label">Bar #</span><span class="tp-value">${trade.entryIndex}</span></div>
            <div class="tp-row"><span class="tp-label">Time (IST)</span><span class="tp-value">${candleInfo ? candleInfo.startTime : '-'}</span></div>
            <div class="tp-row"><span class="tp-label">Direction</span><span class="tp-value" style="color: ${isBuy ? '#26a69a' : '#ef5350'};">${isBuy ? 'BUY' : 'SELL'}</span></div>
            <div class="tp-row"><span class="tp-label">Entry</span><span class="tp-value">${trade.entryPrice.toFixed(2)}</span></div>
            <div class="tp-row"><span class="tp-label">Exit</span><span class="tp-value">${trade.exitPrice.toFixed(2)}</span></div>
            <div class="tp-row"><span class="tp-label">Exit Bar</span><span class="tp-value">${trade.exitIndex}</span></div>
            <div class="tp-row"><span class="tp-label">Stop Loss</span><span class="tp-value" style="color: #ef5350;">${trade.stopLoss ? trade.stopLoss.toFixed(2) : '-'}</span></div>
            <div class="tp-row"><span class="tp-label">Take Profit</span><span class="tp-value" style="color: #26a69a;">${trade.takeProfit ? trade.takeProfit.toFixed(2) : '-'}</span></div>
            ${isCancelled ? '' : `<div class="tp-row"><span class="tp-label">Return</span><span class="tp-value ${returnPct >= 0 ? 'tp-win' : 'tp-loss'}">${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%</span></div>`}
            <div class="tp-row"><span class="tp-label">Result</span><span class="tp-value ${resultClass}">${resultText}</span></div>
            ${trade.exitReason ? `<div class="tp-row"><span class="tp-label">Exit Via</span><span class="tp-value">${trade.exitReason.replace(/_/g, ' ')}</span></div>` : ''}
            <div class="tp-row"><span class="tp-label">MAE</span><span class="tp-value">${(trade.maePercentage || 0).toFixed(2)}%</span></div>
            <div class="tp-row"><span class="tp-label">MAFE</span><span class="tp-value">${(trade.mafePercentage || 0).toFixed(2)}%</span></div>
        `;

        const chartRect = document.getElementById('main-chart').getBoundingClientRect();
        let left = param.point.x + 15;
        let top = param.point.y - 10;
        
        if (left + 220 > chartRect.width) left = param.point.x - 210;
        if (top < 10) top = 10;
        if (top + 200 > chartRect.height) top = chartRect.height - 210;

        tooltip.style.display = 'block';
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }

    getBarNumFromSynthTime(synthTime) {
        for (const [bn, info] of this.timeMap) {
            if (info.synthTime === synthTime) return bn;
        }
        return null;
    }

    computeMetrics() {
        const trades = this.currentVersion === 'ALL' 
            ? this.getAllTradesWithVersion() 
            : this.getTradesForVersion(this.currentVersion);

        const completed = trades.filter(t => t.exitReason === 'take_profit' || t.exitReason === 'stop_loss');
        const total = completed.length;

        if (total === 0) {
            this.clearMetrics();
            return;
        }

        let wins = 0;
        let cumulativeReturn = 0;
        let mafeSum = 0;
        let maeSum = 0;
        let mafeCount = 0;
        let maeCount = 0;

        completed.forEach(t => {
            const isBuy = this.isTradeBuy(t);
            let tradeReturn = 0;
            if (isBuy) {
                tradeReturn = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100;
            } else {
                tradeReturn = ((t.entryPrice - t.exitPrice) / t.entryPrice) * 100;
            }
            cumulativeReturn += tradeReturn;
            if (t.exitReason === 'take_profit') wins++;
            if (t.mafePercentage !== undefined && t.mafePercentage !== null) {
                mafeSum += parseFloat(t.mafePercentage);
                mafeCount++;
            }
            if (t.maePercentage !== undefined && t.maePercentage !== null) {
                maeSum += parseFloat(t.maePercentage);
                maeCount++;
            }
        });

        const wr = (wins / total) * 100;
        const avgReturn = cumulativeReturn / total;
        const avgMafe = mafeCount > 0 ? (mafeSum / mafeCount) : 0;
        const avgMae = maeCount > 0 ? (maeSum / maeCount) : 0;

        document.getElementById('metric-total-trades').textContent = total;
        
        const wrEl = document.getElementById('metric-win-rate');
        wrEl.textContent = `${wr.toFixed(2)}%`;
        wrEl.className = `metric-value ${wr >= 50 ? 'positive' : 'negative'}`;

        const crEl = document.getElementById('metric-cum-return');
        crEl.textContent = `${cumulativeReturn >= 0 ? '+' : ''}${cumulativeReturn.toFixed(2)}%`;
        crEl.className = `metric-value ${cumulativeReturn >= 0 ? 'positive' : 'negative'}`;

        const arEl = document.getElementById('metric-avg-return');
        arEl.textContent = `${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`;
        arEl.className = `metric-value ${avgReturn >= 0 ? 'positive' : 'negative'}`;

        const mafeEl = document.getElementById('metric-avg-mafe');
        mafeEl.textContent = `${avgMafe.toFixed(2)}%`;
        mafeEl.className = 'metric-value neutral';

        const maeEl = document.getElementById('metric-avg-mae');
        maeEl.textContent = `${avgMae.toFixed(2)}%`;
        maeEl.className = 'metric-value neutral';
    }

    clearMetrics() {
        document.getElementById('metric-total-trades').textContent = '0';
        document.getElementById('metric-win-rate').textContent = '0.00%';
        document.getElementById('metric-win-rate').className = 'metric-value neutral';
        document.getElementById('metric-cum-return').textContent = '0.00%';
        document.getElementById('metric-cum-return').className = 'metric-value neutral';
        document.getElementById('metric-avg-return').textContent = '0.00%';
        document.getElementById('metric-avg-return').className = 'metric-value neutral';
        document.getElementById('metric-avg-mafe').textContent = '0.00%';
        document.getElementById('metric-avg-mafe').className = 'metric-value neutral';
        document.getElementById('metric-avg-mae').textContent = '0.00%';
        document.getElementById('metric-avg-mae').className = 'metric-value neutral';
    }

    disableSelect(id) {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = true;
            el.innerHTML = '<option value="">-- Select --</option>';
        }
    }

    updateStatusBadge(text) {
        const badge = document.getElementById('statusBadge');
        if (badge) {
            badge.textContent = text;
            badge.className = 'status-badge loaded';
        }
    }

    setupEventListeners() {
        document.getElementById('date-select').addEventListener('change', () => this.onDateChange());
        document.getElementById('instrument-select').addEventListener('change', () => this.onInstrumentChange());
        document.getElementById('threshold-select').addEventListener('change', () => this.onThresholdChange());
        document.getElementById('version-select').addEventListener('change', () => this.onVersionChange());
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.backtestViewer = new BacktestViewer();
});