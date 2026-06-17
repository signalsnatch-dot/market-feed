// public/chart.js - Complete coordination engine managing candles, indicators, and canvas overlay updates

class MarketChart {
    constructor() {
        this.currentInstrument = null;
        this.currentType = 'volume';
        this.candles = [];          // local cache of formatted candle objects
        
        this.chart = null;
        this.candleSeries = null;
        this.bottomSeries = null;
        
        this.socket = null;
        this.instruments = new Map();
        this.isInitialized = false;
        this.initialDataLoaded = false;
        this.lastSubscription = null;
        
        // Modules
        this.indicators = new ChartIndicators(this);
        this.drawings = null; // initialized after LightweightCharts mounts
        
        this.init();
    }

    async init() {
        await this.loadHistoricalData();
        this.setupWebSocket();
        this.setupEventListeners();
        this.initCharts();
    }

    setActiveInstrument(key) {
        const buttons = document.querySelectorAll('.instrument-btn');
        buttons.forEach(btn => {
            if (btn.dataset.key === key) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
    
    switchInstrument(key) {
        console.log(`Switching to instrument: ${key}`);
        this.currentInstrument = key;
        this.setActiveInstrument(key);
        this.initialDataLoaded = false;
        this.loadCandlesForCurrentInstrument();
        this.subscribeToCandles();
        this.updateBottomChartLabel();
    }

    updateBottomChartLabel() {
        const bottomChartContainer = document.getElementById('bottom-chart');
        if (!bottomChartContainer) return;
        
        const label = this.currentType === 'volume' 
            ? '📊 Price Changes (per candle)' 
            : '💰 Traded Quantity (units)';
        
        let labelElement = document.getElementById('bottom-chart-label');
        if (!labelElement) {
            labelElement = document.createElement('div');
            labelElement.id = 'bottom-chart-label';
            labelElement.style.cssText = 'position: absolute; top: -20px; left: 10px; font-size: 11px; color: #787b86; z-index: 10;';
            bottomChartContainer.parentElement.style.position = 'relative';
            bottomChartContainer.parentElement.appendChild(labelElement);
        }
        labelElement.textContent = label;
    }
    
    loadCandlesForCurrentInstrument() {
        const cacheKey = `${this.currentType}_candles`;
        if (this[cacheKey]) {
            this.candles = this[cacheKey]
                .filter(c => (c.instrument === this.currentInstrument || c.instrument_key === this.currentInstrument))
                .map(c => this.convertToChartCandle(c))
                .filter(c => c !== null);
            this.candles.sort((a,b) => a.time - b.time);
            console.log(`Loaded ${this.candles.length} ${this.currentType} candles for ${this.currentInstrument}`);
            this.updateCharts();
        } else {
            this.candles = [];
            this.updateCharts();
        }
    }

    convertToChartCandle(candleData) {
        let timestamp = candleData.timestamp || candleData.end_time;
        if (!timestamp) return null;
        if (typeof timestamp === 'string') {
            timestamp = new Date(timestamp).getTime();
        }
        const timeInSeconds = Math.floor(timestamp / 1000);
        if (timeInSeconds < 1577836800 || timeInSeconds > 1893456000) return null;
        
        const open = parseFloat(candleData.open);
        const high = parseFloat(candleData.high);
        const low = parseFloat(candleData.low);
        const close = parseFloat(candleData.close);
        if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;
        
        let bottomValue = 0;
        if (this.currentType === 'volume') {
            bottomValue = candleData.priceChanges || candleData.transactions || 0;
        } else {
            bottomValue = candleData.volume || 0;
        }
        
        return {
            time: timeInSeconds,
            open: open,
            high: high,
            low: low,
            close: close,
            volume: parseFloat(candleData.volume || candleData.targetVolume || 0),
            barNumber: candleData.barNumber,
            progress: candleData.progress,
            bottomValue: bottomValue,
            priceChanges: candleData.priceChanges,
            transactions: candleData.transactions
        };
    }
    
    async loadHistoricalData() {
        try {
            const volumeRes = await fetch('/api/recent/volume?limit=500');
            if (volumeRes.ok) {
                this.volume_candles = await volumeRes.json();
                console.log(`Loaded ${this.volume_candles.length} volume candles`);
                this.volume_candles.forEach(candle => {
                    const instKey = candle.instrument || candle.instrument_key;
                    if (instKey && !this.instruments.has(instKey)) {
                        this.instruments.set(instKey, {
                            key: instKey,
                            name: candle.name || this.getInstrumentName(instKey),
                            exchange: instKey.split('|')[0]
                        });
                    }
                });
            }
            
            const priceRes = await fetch('/api/recent/price?limit=500');
            if (priceRes.ok) {
                this.price_candles = await priceRes.json();
                console.log(`Loaded ${this.price_candles.length} price candles`);
                this.price_candles.forEach(candle => {
                    const instKey = candle.instrument || candle.instrument_key;
                    if (instKey && !this.instruments.has(instKey)) {
                        this.instruments.set(instKey, {
                            key: instKey,
                            name: candle.name || this.getInstrumentName(instKey),
                            exchange: instKey.split('|')[0]
                        });
                    }
                });
            }
            
            this.renderInstrumentSelector();
            
            const firstInstrument = this.instruments.values().next().value;
            if (firstInstrument) {
                this.currentInstrument = firstInstrument.key;
                this.setActiveInstrument(this.currentInstrument);
                this.loadCandlesForCurrentInstrument();
                this.updateBottomChartLabel();
            }
        } catch (error) {
            console.error('Failed to load historical data:', error);
        }
    }
    
    getInstrumentName(key) {
        const names = {
            'MCX_FO|504265': 'Natural Gas Future',
            'NSE_FO|62329': 'Nifty 50 Future',
            'NSE_FO|62326': 'Nifty Bank Future'
        };
        return names[key] || key.split('|')[1];
    }
    
    renderInstrumentSelector() {
        const container = document.getElementById('instrumentSelector');
        if (!container) return;
        if (this.instruments.size === 0) {
            container.innerHTML = '<span style="color: #787b86;">Loading instruments...</span>';
            return;
        }
        let html = '';
        for (const [key, inst] of this.instruments) {
            html += `<button class="instrument-btn" data-key="${key}">${inst.name || key.split('|')[1]}</button>`;
        }
        container.innerHTML = html;
        document.querySelectorAll('.instrument-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchInstrument(btn.dataset.key));
        });
    }
    
    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.hostname}:3001`;
        this.socket = io(wsUrl, { transports: ['websocket'], reconnection: true });
        
        this.socket.on('connect', () => {
            console.log('WebSocket connected');
            document.getElementById('wsStatus').textContent = 'Connected';
            document.getElementById('wsStatus').className = 'status-badge connected';
            this.subscribeToCandles();
        });
        
        this.socket.on('historical_candles', (data) => {
            if (data.volume_bars) {
                this.volume_candles = data.volume_bars.map(c => ({
                    ...c,
                    instrument: c.instrument || c.instrument_key
                }));
            }
            if (data.price_bars) {
                this.price_candles = data.price_bars.map(c => ({
                    ...c,
                    instrument: c.instrument || c.instrument_key
                }));
            }
            if (this.currentInstrument) this.loadCandlesForCurrentInstrument();

            // Load and display pre-existing active trade signals
            if (data.trade_signals) {
                this.renderHistoricalSignals(data.trade_signals);
            }
        });
        
        this.socket.on('live_candle_update', (liveCandle) => {
            const normalizedCandle = {
                ...liveCandle,
                instrument: liveCandle.instrument || liveCandle.instrument_key
            };
            const candleInst = normalizedCandle.instrument;
            if (candleInst === this.currentInstrument && liveCandle.type === this.currentType) {
                this.updateLiveCandle(normalizedCandle);
            }
        });
        
        this.socket.on('candle_update', (candle) => {
            const normalizedCandle = {
                ...candle,
                instrument: candle.instrument || candle.instrument_key
            };
            const candleInst = normalizedCandle.instrument;
            if (candleInst === this.currentInstrument && candle.type === this.currentType && !candle.is_live) {
                const newCandle = this.convertToChartCandle(normalizedCandle);
                if (newCandle) this.addCompletedCandle(newCandle);
            }
        });

        this.socket.on('trade_signal', (signal) => {
            this.handleLiveSignal(signal);
        });
        
        this.socket.on('disconnect', () => {
            document.getElementById('wsStatus').textContent = 'Disconnected';
            document.getElementById('wsStatus').className = 'status-badge disconnected';
        });
    }

    renderHistoricalSignals(signals) {
        const listContainer = document.getElementById('signalsList');
        if (!listContainer) return;
        
        if (!signals || signals.length === 0) {
            listContainer.innerHTML = '<div style="color: #787b86; text-align: center; padding: 20px;">Waiting for signals...</div>';
            return;
        }
        
        listContainer.innerHTML = '';
        const sortedSignals = [...signals].sort((a, b) => b.timestamp - a.timestamp);
        sortedSignals.forEach(sig => {
            const el = this.createSignalElement(sig);
            listContainer.appendChild(el);
        });
    }

    handleLiveSignal(signal) {
        const listContainer = document.getElementById('signalsList');
        if (!listContainer) return;
        
        const emptyMsg = listContainer.querySelector('div');
        if (emptyMsg && emptyMsg.textContent.includes('Waiting for signals')) {
            listContainer.innerHTML = '';
        }
        
        const el = this.createSignalElement(signal);
        listContainer.insertBefore(el, listContainer.firstChild);
    }

    createSignalElement(sig) {
        const div = document.createElement('div');
        const isBuy = sig.type.toUpperCase().includes('BUY');
        div.className = `signal-item ${isBuy ? 'buy' : 'sell'}`;
        
        const timeStr = new Date(sig.timestamp).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-weight: bold; color: ${isBuy ? '#00bcd4' : '#ef5350'};">${sig.type}</span>
                <span class="signal-time">${timeStr}</span>
            </div>
            <div style="font-weight: 500; margin-bottom: 4px; font-size: 13px;">${sig.name || sig.instrument.split('|')[1]}</div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; font-size: 11px; color: #d1d4dc;">
                <div>Entry: <span style="color: #fff; font-weight: 600;">${sig.entry.toFixed(2)}</span></div>
                <div>SL: <span style="color: #ef5350; font-weight: 600;">${sig.sl.toFixed(2)}</span></div>
                <div>TP: <span style="color: #00bcd4; font-weight: 600;">${sig.tp.toFixed(2)}</span></div>
                <div>Conf: <span style="color: #f9a825; font-weight: 600;">${sig.confidence}%</span></div>
            </div>
            <div style="font-size: 10px; color: #787b86; margin-top: 4px; font-style: italic;">${sig.reason || ''}</div>
        `;
        return div;
    }

    updateProgressDisplay(progress, candle) {
        const progressBar = document.getElementById('candle-progress');
        if (!progressBar) {
            const statsBar = document.getElementById('statsBar');
            if (statsBar) {
                const progressHtml = `
                    <div id="candle-progress-container" style="margin-top: 8px; padding: 8px; background: #2a2e39; border-radius: 4px;">
                        <div style="font-size: 11px; color: #787b86; margin-bottom: 4px;">
                            Current Candle Progress: ${candle.type === 'volume' ? 'Volume' : 'Price Changes'}
                        </div>
                        <div style="background: #363c4b; border-radius: 4px; overflow: hidden;">
                            <div id="candle-progress-bar" style="width: ${progress}%; background: #00bcd4; height: 8px; transition: width 0.3s;"></div>
                        </div>
                        <div style="font-size: 12px; margin-top: 4px;">
                            ${progress.toFixed(1)}% complete
                            ${candle.type === 'volume' ? 
                                `(${candle.volume?.toLocaleString() || 0} / ${candle.targetVolume?.toLocaleString() || 0} units)` : 
                                `(${candle.currentTicks || 0} / ${candle.targetTicks || 0} price changes)`}
                        </div>
                    </div>
                `;
                let existing = document.getElementById('candle-progress-container');
                if (existing) existing.remove();
                statsBar.insertAdjacentHTML('afterend', progressHtml);
            }
        } else {
            const bar = document.getElementById('candle-progress-bar');
            if (bar) bar.style.width = `${progress}%`;
            const text = document.querySelector('#candle-progress-container div:last-child');
            if (text) {
                text.innerHTML = `${progress.toFixed(1)}% complete
                    ${candle.type === 'volume' ? 
                        `(${candle.volume?.toLocaleString() || 0} / ${candle.targetVolume?.toLocaleString() || 0} units)` : 
                        `(${candle.currentTicks || 0} / ${candle.targetTicks || 0} price changes)`}`;
            }
        }
    }
    
    initCharts() {
        const chartElement = document.getElementById('main-chart');
        if (!chartElement || typeof LightweightCharts === 'undefined') {
            setTimeout(() => this.initCharts(), 500);
            return;
        }

        this.chart = LightweightCharts.createChart(chartElement, {
            width: chartElement.clientWidth,
            height: 600,
            layout: { background: { color: '#1e222d' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#2a2e39' }, horzLines: { color: '#2a2e39' } },
            timeScale: {
                timeVisible: true,
                secondsVisible: true,
                tickMarkFormatter: (time) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                }
            },
            rightPriceScale: {
                borderColor: '#2a2e39',
                scaleMargins: { top: 0.05, bottom: 0.25 }
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
        });

        // Candlestick series (top pane)
        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            priceScaleId: 'right'
        });

        // Histogram series (bottom pane)
        this.bottomSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
            color: '#00bcd4',
            priceFormat: { type: 'volume' },
            priceScaleId: 'bottom'
        });

        // Initialize Indicator Series
        this.indicators.initSeries();

        // Configure bottom pane
        this.chart.priceScale('bottom').applyOptions({
            scaleMargins: { top: 0.75, bottom: 0.05 },
            borderColor: '#2a2e39',
            autoScale: true,
            entireTextOnly: true
        });

        this.isInitialized = true;

        // Hide old bottom chart element if exists
        const oldBottom = document.getElementById('bottom-chart');
        if (oldBottom) oldBottom.style.display = 'none';

        this.addBottomPaneLabel();
        this.addSmaToggleButtons();   // Add buttons for SMA visibility
        
        // Initialize Interactive Drawings Layer
        this.drawings = new ChartDrawings(this);

        this.updateCharts();

        // Safe drawing re-positioning during timescale changes (pans/zooms)
        this.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            this.drawings?.render();
        });

        window.addEventListener('resize', () => {
            this.chart?.applyOptions({ width: chartElement.clientWidth });
            this.drawings?.render();
        });
    }

    addSmaToggleButtons() {
        // Find or create a container for indicator toggles
        let container = document.getElementById('indicator-toggles');
        if (!container) {
            const toolbar = document.querySelector('.draw-toolbar');
            if (toolbar) {
                container = document.createElement('div');
                container.id = 'indicator-toggles';
                container.style.cssText = 'display: inline-flex; gap: 8px; margin-left: 20px; align-items: center;';
                toolbar.appendChild(container);
            } else {
                // fallback: append to drawing toolbar area
                const parent = document.querySelector('.draw-tools') || document.body;
                container = document.createElement('div');
                container.id = 'indicator-toggles';
                container.style.cssText = 'position: absolute; top: 10px; right: 10px; z-index: 20; display: flex; gap: 8px; background: #2a2e39; padding: 4px 8px; border-radius: 6px;';
                parent.appendChild(container);
            }
        }
        
        // Clear existing
        container.innerHTML = '';
        
        // SMA 9 toggle
        const btn9 = document.createElement('button');
        btn9.className = 'sma-toggle-btn';
        btn9.dataset.sma = '9';
        btn9.innerHTML = this.indicators.sma9Visible ? '👁️ SMA9' : '👁️‍🗨️ SMA9';
        btn9.style.cssText = 'background: #2a2e39; border: 1px solid #4a4e5a; color: #d1d4dc; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;';
        btn9.addEventListener('click', (e) => {
            e.stopPropagation();
            this.indicators.toggleVisibility('sma9');
            btn9.innerHTML = this.indicators.sma9Visible ? '👁️ SMA9' : '👁️‍🗨️ SMA9';
        });
        container.appendChild(btn9);
        
        // SMA 21 toggle
        const btn21 = document.createElement('button');
        btn21.className = 'sma-toggle-btn';
        btn21.dataset.sma = '21';
        btn21.innerHTML = this.indicators.sma21Visible ? '👁️ SMA21' : '👁️‍🗨️ SMA21';
        btn21.style.cssText = 'background: #2a2e39; border: 1px solid #4a4e5a; color: #d1d4dc; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;';
        btn21.addEventListener('click', (e) => {
            e.stopPropagation();
            this.indicators.toggleVisibility('sma21');
            btn21.innerHTML = this.indicators.sma21Visible ? '👁️ SMA21' : '👁️‍🗨️ SMA21';
        });
        container.appendChild(btn21);

        // EMA 20 toggle
        const btn20 = document.createElement('button');
        btn20.className = 'sma-toggle-btn';
        btn20.dataset.sma = '20';
        btn20.innerHTML = this.indicators.ema20Visible ? '👁️ EMA20' : '👁️‍🗨️ EMA20';
        btn20.style.cssText = 'background: #2a2e39; border: 1px solid #4a4e5a; color: #d1d4dc; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;';
        btn20.addEventListener('click', (e) => {
            e.stopPropagation();
            this.indicators.toggleVisibility('ema20');
            btn20.innerHTML = this.indicators.ema20Visible ? '👁️ EMA20' : '👁️‍🗨️ EMA20';
        });
        container.appendChild(btn20);
    }

    updateCharts() {
        if (!this.isInitialized || !this.candleSeries || !this.candles.length) return;

        const chartData = [];
        const bottomData = [];
        for (const c of this.candles) {
            chartData.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
            const val = (this.currentType === 'volume')
                ? (c.priceChanges || c.transactions || 0)
                : (c.volume || 0);
            bottomData.push({ time: c.time, value: val, color: '#00bcd4' });
        }

        // Set historical datasets
        this.candleSeries.setData(chartData);
        this.bottomSeries.setData(bottomData);
        this.indicators.setFullHistory(chartData);

        this.drawings?.render();

        if (!this.initialDataLoaded && chartData.length) {
            this.chart.timeScale().fitContent();
            this.chart.priceScale('right').applyOptions({ autoScale: true });
            this.initialDataLoaded = true;
        }

        const countElem = document.getElementById('candleCount');
        if (countElem) countElem.textContent = `Candles: ${chartData.length}`;
    }

    addBottomPaneLabel() {
        const existing = document.getElementById('bottom-pane-label');
        if (existing) existing.remove();
        const label = document.createElement('div');
        label.id = 'bottom-pane-label';
        label.style.cssText = 'position: absolute; bottom: 40px; right: 70px; font-size: 11px; color: #787b86; background: rgba(30,34,45,0.8); padding: 2px 8px; border-radius: 4px; z-index: 10; font-family: monospace;';
        label.textContent = this.currentType === 'volume' ? '📊 PRICE CHANGES' : '💰 TRADED VOLUME';
        const container = document.getElementById('main-chart');
        if (container) {
            container.style.position = 'relative';
            container.appendChild(label);
        }
    }

    updateLiveCandle(liveCandle) {
        const newCandle = this.convertToChartCandle(liveCandle);
        if (!newCandle) return;
        const barNum = newCandle.barNumber;
        let existingIndex = -1;
        if (barNum !== undefined && barNum !== null) {
            existingIndex = this.candles.findIndex(c => c.barNumber === barNum);
        }
        if (existingIndex >= 0) {
            this.candles[existingIndex] = newCandle;
        } else {
            const last = this.candles[this.candles.length - 1];
            if (last && newCandle.time <= last.time) {
                newCandle.time = last.time + 1;
            }
            this.candles.push(newCandle);
            if (this.candles.length > 500) this.candles = this.candles.slice(-500);
        }

        // Real-time continuous updating on the candle and bottom histogram
        this.candleSeries.update({
            time: newCandle.time,
            open: newCandle.open,
            high: newCandle.high,
            low: newCandle.low,
            close: newCandle.close
        });

        const bottomVal = (this.currentType === 'volume')
            ? (newCandle.priceChanges || newCandle.transactions || 0)
            : (newCandle.volume || 0);

        this.bottomSeries.update({
            time: newCandle.time,
            value: bottomVal,
            color: '#00bcd4'
        });

        // Performant sliding updates for indicator levels
        const chartData = this.candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        }));
        this.indicators.updateLatestPoint(chartData);

        this.drawings?.render();

        this.updateProgressDisplay(liveCandle.progress || 0, liveCandle);
        this.updateStatsFromCandle(newCandle);
    }

    resetZoom() {
        this.initialDataLoaded = false;
        if (this.chart && this.candles.length) {
            this.chart.timeScale().fitContent();
            this.chart.priceScale('right').applyOptions({ autoScale: true });
            this.initialDataLoaded = true;
        }
    }
    
    addCompletedCandle(candle) {
        const barNum = candle.barNumber;
        const existingIndex = barNum ? this.candles.findIndex(c => c.barNumber === barNum) : -1;
        if (existingIndex >= 0) {
            this.candles[existingIndex] = candle;
        } else {
            this.candles.push(candle);
            this.candles.sort((a,b) => a.time - b.time);
        }
        if (this.candles.length > 500) this.candles = this.candles.slice(-500);
        
        // Fully regenerate the indicators, candles and overlays on completed bar transitions
        this.updateCharts();
        this.updateStatsFromCandle(candle);
    }
    
    subscribeToCandles() {
        if (!this.socket || !this.currentInstrument) return;
        if (this.lastSubscription) {
            this.socket.emit('unsubscribe', this.lastSubscription);
        }
        this.lastSubscription = { instrument: this.currentInstrument, type: this.currentType };
        this.socket.emit('subscribe', this.lastSubscription);
    }
    
    updateStatsFromCandle(candle) {
        const statsBar = document.getElementById('statsBar');
        if (!statsBar) return;
        const change = candle.close - candle.open;
        const changePercent = (change / candle.open) * 100;
        const color = change >= 0 ? '#26a69a' : '#ef5350';
        const candleTime = new Date(candle.time * 1000);
        const timeStr = candleTime.toLocaleString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        let additionalStats = '';
        if (this.currentType === 'volume') {
            additionalStats = `<div class="stat"><span class="stat-label">Price Changes:</span><span class="stat-value">${candle.priceChanges || candle.transactions || 0}</span></div>`;
        } else {
            additionalStats = `<div class="stat"><span class="stat-label">Traded Qty:</span><span class="stat-value">${(candle.volume || 0).toLocaleString()}</span></div>`;
        }
        statsBar.innerHTML = `
            <div class="stat"><span class="stat-label">Time (IST):</span><span class="stat-value">${timeStr}</span></div>
            <div class="stat"><span class="stat-label">Open:</span><span class="stat-value">${candle.open.toFixed(2)}</span></div>
            <div class="stat"><span class="stat-label">High:</span><span class="stat-value">${candle.high.toFixed(2)}</span></div>
            <div class="stat"><span class="stat-label">Low:</span><span class="stat-value">${candle.low.toFixed(2)}</span></div>
            <div class="stat"><span class="stat-label">Close:</span><span class="stat-value">${candle.close.toFixed(2)}</span></div>
            ${additionalStats}
            <div class="stat"><span class="stat-label">Change:</span><span class="stat-value" style="color: ${color}">${changePercent.toFixed(2)}%</span></div>
            <div class="stat"><span class="stat-label">Bar #:</span><span class="stat-value">${candle.barNumber || '-'}</span></div>
        `;
    }
    
    setupEventListeners() {
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentType = btn.dataset.type;
                this.loadCandlesForCurrentInstrument();
                this.subscribeToCandles();
                this.updateBottomChartLabel();
            });
        });

        // Clear active drawings
        document.getElementById('clear-drawings-btn')?.addEventListener('click', () => {
            this.drawings?.clearAll();
        });

        // Set toolbars
        document.querySelectorAll('.draw-tool-btn').forEach(btn => {
            if (btn.id === 'clear-drawings-btn') return;
            btn.addEventListener('click', () => {
                this.drawings?.setTool(btn.dataset.tool);
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.marketChart = new MarketChart();
});