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
        
        // Live Trade Lifecycle Tracking Module (ES6 Split-Layout Refactor)
        this.tracker = new LiveTradeTracker(this);

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
        let timestamp = candleData.startTime || candleData.timestamp || candleData.end_time;
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
            bottomValue = parseFloat(candleData.priceChanges) || parseFloat(candleData.transactions) || 0;
        } else {
            bottomValue = parseFloat(candleData.volume) || 0;
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

            // Delegate load of prior signals to live tracker module
            if (data.trade_signals) {
                this.tracker.renderSignals(data.trade_signals);
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

        // Delegate new trade setup events directly to live tracker
        this.socket.on('trade_signal', (signal) => {
            this.tracker.handleIncomingSignal(signal);
        });

        // Delegate execution state triggers or stop/limit fills directly to live tracker
        this.socket.on('trade_status_update', (update) => {
            this.tracker.handleStatusUpdate(update);
        });
        
        this.socket.on('disconnect', () => {
            document.getElementById('wsStatus').textContent = 'Disconnected';
            document.getElementById('wsStatus').className = 'status-badge disconnected';
        });
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

        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            priceScaleId: 'right'
        });

        this.bottomSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
            color: '#00bcd4',
            priceFormat: { type: 'volume' },
            priceScaleId: 'bottom'
        });

        this.indicators.initSeries();

        this.chart.priceScale('bottom').applyOptions({
            scaleMargins: { top: 0.75, bottom: 0.05 },
            borderColor: '#2a2e39',
            autoScale: true,
            entireTextOnly: true
        });

        this.isInitialized = true;

        const oldBottom = document.getElementById('bottom-chart');
        if (oldBottom) oldBottom.style.display = 'none';

        this.addBottomPaneLabel();
        this.addSmaToggleButtons();   
        
        this.drawings = new ChartDrawings(this);

        this.updateCharts();

        this.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            this.drawings?.render();
        });

        window.addEventListener('resize', () => {
            this.chart?.applyOptions({ width: chartElement.clientWidth });
            this.drawings?.render();
        });
    }

    addSmaToggleButtons() {
        let container = document.getElementById('indicator-toggles');
        if (!container) {
            const toolbar = document.querySelector('.draw-toolbar');
            if (toolbar) {
                container = document.createElement('div');
                container.id = 'indicator-toggles';
                container.style.cssText = 'display: inline-flex; gap: 8px; margin-left: 20px; align-items: center;';
                toolbar.appendChild(container);
            } else {
                const parent = document.querySelector('.draw-tools') || document.body;
                container = document.createElement('div');
                container.id = 'indicator-toggles';
                container.style.cssText = 'position: absolute; top: 10px; right: 10px; z-index: 20; display: flex; gap: 8px; background: #2a2e39; padding: 4px 8px; border-radius: 6px;';
                parent.appendChild(container);
            }
        }
        
        container.innerHTML = '';
        
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

    updateLiveCandle(normalizedCandle) {
        const ohlc = this.convertToChartCandle(normalizedCandle);
        if (!ohlc) return;

        // Feed live tick prices directly into our trade tracker module for real-time risk updates
        this.tracker.tracker.updateLivePrice(normalizedCandle.instrument, normalizedCandle.close, normalizedCandle.type);

        if (!this.isInitialized) return;

        // Merge live progress updates into candle array
        const lastIdx = this.candles.length - 1;
        if (lastIdx >= 0 && this.candles[lastIdx].time === ohlc.time) {
            this.candles[lastIdx] = ohlc;
        } else {
            this.candles.push(ohlc);
            if (this.candles.length > this.maxRecentCandlesPerInstrument) {
                this.candles.shift();
            }
        }

        this.candleSeries.update(ohlc);
        
        const volumeVal = (this.currentType === 'volume')
            ? (ohlc.priceChanges || ohlc.transactions || 0)
            : (ohlc.volume || 0);

        this.bottomSeries.update({
            time: ohlc.time,
            value: volumeVal,
            color: '#00bcd4'
        });

        const chartData = this.candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        }));

        this.indicators.setFullHistory(chartData);
        this.updateStatsPane(normalizedCandle);
    }

    updateStatsPane(candle) {
        const statsElem = document.getElementById('statsPane');
        if (!statsElem) return;

        const progress = candle.progress || 0;
        statsElem.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 6px; color: #fff;">${this.getInstrumentName(candle.instrument)}</div>
            <div style="font-size: 12px; margin-bottom: 4px;">Last Price: <span style="font-weight: bold; color: #00bcd4;">₹${candle.close.toFixed(2)}</span></div>
            <div style="font-size: 11px; color: #787b86;">Bar #${candle.barNumber} Progress: ${progress.toFixed(1)}%</div>
        `;
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
            candle.time = this.candles[existingIndex].time;
            this.candles[existingIndex] = candle;
        } else {
            const last = this.candles[this.candles.length - 1];
            if (last && candle.time <= last.time) {
                candle.time = last.time + 5;
            }
            this.candles.push(candle);
            this.candles.sort((a,b) => a.time - b.time);
        }
        if (this.candles.length > 500) this.candles = this.candles.slice(-500);
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
        const color = change >= 0 ? '🟢' : '🔴';
        const formattedType = candle.type ? candle.type.toUpperCase() : 'VOLUME';

        console.log(`🕯️ [${formattedType} BAR] Completed: Bar #${candle.barNumber} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} | Vol: ${candle.volume}`);
    }
}

module.exports = ChartServer;