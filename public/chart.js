// public/chart.js
class MarketChart {
    constructor() {
        this.currentInstrument = null;
        this.currentType = 'volume';
        this.currentThreshold = null; 
        this.candles = [];          
        
        this.chart = null;
        this.candleSeries = null;
        this.bottomSeries = null;
        
        this.socket = null;
        this.instrumentsList = [];
        this.isInitialized = false;
        this.initialDataLoaded = false;
        this.lastSubscription = null;
        
        this.timeMap = new Map();
        this.indicators = new ChartIndicators(this);
        this.drawings = null; 
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
    
    async switchInstrument(key) {
        console.log("Switching to instrument: " + key);
        this.currentInstrument = key;
        this.setActiveInstrument(key);
        this.initialDataLoaded = false;
        this.timeMap.clear(); 
        
        this.updateThresholdSelector();
        await this.loadCandlesForCurrentInstrument();
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
            bottomChartContainer.parentNode.style.position = 'relative';
            bottomChartContainer.parentNode.appendChild(labelElement);
        }
        labelElement.textContent = label;
    }
    
    updateThresholdSelector() {
        const selector = document.getElementById('threshold-selector');
        if (!selector) return;

        const currentInstInfo = this.instrumentsList?.find(i => i.key === this.currentInstrument);
        if (!currentInstInfo) return;

        const thresholds = this.currentType === 'volume' 
            ? currentInstInfo.volumeThresholds 
            : currentInstInfo.priceThresholds;

        selector.innerHTML = '';
        if (thresholds && thresholds.length > 0) {
            thresholds.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                selector.appendChild(opt);
            });
            if (thresholds.includes(this.currentThreshold)) {
                selector.value = this.currentThreshold;
            } else {
                this.currentThreshold = thresholds[0];
                selector.value = this.currentThreshold;
            }
        } else {
            this.currentThreshold = null;
            const opt = document.createElement('option');
            opt.textContent = 'None';
            selector.appendChild(opt);
        }
    }

    showLoading() {
        const chartElement = document.getElementById('main-chart');
        if (!chartElement) return;
        
        let loader = document.getElementById('chart-loader-overlay');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'chart-loader-overlay';
            loader.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(30,34,45,0.75); display: flex; align-items: center; justify-content: center; z-index: 50; color: #00bcd4; font-family: monospace; font-size: 14px; font-weight: bold; pointer-events: none;';
            loader.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                    <div style="width: 32px; height: 32px; border: 3px solid #00bcd4; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s infinite linear;"></div>
                    <span>LOADING DATA...</span>
                </div>
            `;
            
            if (!document.getElementById('loader-animation')) {
                const style = document.createElement('style');
                style.id = 'loader-animation';
                style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
                document.head.appendChild(style);
            }
            
            chartElement.style.position = 'relative';
            chartElement.appendChild(loader);
        }
        loader.style.display = 'flex';
    }

    hideLoading() {
        const loader = document.getElementById('chart-loader-overlay');
        if (loader) loader.style.display = 'none';
    }

    async loadCandlesForCurrentInstrument() {
        if (!this.currentInstrument || !this.currentThreshold) return;

        this.showLoading(); // Display dynamic spinner overlay immediately

        try {
            const res = await fetch(`/api/recent/${this.currentType}?instrument=${encodeURIComponent(this.currentInstrument)}&threshold=${this.currentThreshold}`);
            if (res.ok) {
                const data = await res.json();
                this.candles = data.map(c => this.convertToChartCandle(c)).filter(c => null !== c);
                this.candles.sort((a, b) => a.time - b.time);
                this.updateCharts();
            }
        } catch (err) {
            console.error("Failed to load historical candles dynamically:", err);
            this.candles = [];
            this.updateCharts();
        } finally {
            this.hideLoading(); // Hide spinner when load completes
        }
    }

    convertToChartCandle(candleData) {
        const barNum = parseInt(candleData.barNumber);
        if (isNaN(barNum) || barNum <= 0) return null;

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

        const syntheticTime = 1600000000 + (barNum * 60);

        let realTime = candleData.startTime || candleData.timestamp || candleData.end_time;
        if (realTime) {
            if (typeof realTime === 'string') {
                realTime = new Date(realTime).getTime();
            }
            const d = new Date(realTime);
            const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            this.timeMap.set(syntheticTime, timeStr);
        }
        
        return {
            time: syntheticTime,
            open: open,
            high: high,
            low: low,
            close: close,
            volume: parseFloat(candleData.volume || candleData.targetVolume || 0),
            barNumber: barNum,
            progress: candleData.progress,
            bottomValue: bottomValue,
            priceChanges: candleData.priceChanges,
            transactions: candleData.transactions
        };
    }
    
    async loadHistoricalData() {
        try {
            const instRes = await fetch('/api/instruments');
            if (instRes.ok) {
                this.instrumentsList = await instRes.json();
                this.renderInstrumentSelector();
                
                if (this.instrumentsList.length > 0) {
                    this.currentInstrument = this.instrumentsList[0].key;
                    this.setActiveInstrument(this.currentInstrument);
                    this.updateThresholdSelector();
                    await this.loadCandlesForCurrentInstrument();
                    this.updateBottomChartLabel();
                }
            }
        } catch (error) {
            console.error('Failed to load historical data:', error);
        }
    }
    
    getInstrumentName(key) {
        if (this.instrumentsList && this.instrumentsList.length > 0) {
            const inst = this.instrumentsList.find(i => i.key === key);
            if (inst && inst.name) return inst.name;
        }
        const names = {
            'MCX_FO|538685': 'Natural Gas Future',
            'NSE_FO|62329': 'Nifty 50 Future',
            'NSE_FO|62326': 'Nifty Bank Future'
        };
        return names[key] || (key && key.includes('|') ? key.split('|')[1] : key);
    }
    
    renderInstrumentSelector() {
        const container = document.getElementById('instrumentSelector');
        if (!container) return;
        if (this.instrumentsList.length === 0) {
            container.innerHTML = '<span style="color: #787b86;">Loading instruments...</span>';
            return;
        }
        let html = '';
        this.instrumentsList.forEach(inst => {
            html += `<button class="instrument-btn" data-key="${inst.key}">${inst.name || inst.symbol}</button>`;
        });
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
            document.getElementById('wsStatus').textContent = 'Connected';
            document.getElementById('wsStatus').className = 'status-badge connected';
            this.subscribeToCandles();
        });
        
        this.socket.on('historical_candles', (data) => {
            if (data.instruments) {
                this.instrumentsList = data.instruments;
                this.renderInstrumentSelector();
                this.updateThresholdSelector();
            }

            if (this.currentInstrument) {
                this.loadCandlesForCurrentInstrument();
            }

            if (data.strategies) {
                this.tracker.setupStrategyVersions(data.strategies);
            }

            if (data.trade_signals) {
                this.tracker.renderSignals(data.trade_signals);
            }
        });
        
        this.socket.on('disconnect', () => {
            document.getElementById('wsStatus').textContent = 'Disconnected';
            document.getElementById('wsStatus').className = 'status-badge disconnected';
        });

        this.socket.on('trade_signal', (signal) => {
            this.tracker.handleIncomingSignal(signal);
        });

        this.socket.on('trade_status_update', (update) => {
            this.tracker.handleStatusUpdate(update);
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
                    if (this.timeMap && this.timeMap.has(time)) {
                        return this.timeMap.get(time);
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
        
        if (this.indicators.sma9Series) this.indicators.sma9Series.applyOptions({ title: '' });
        if (this.indicators.sma21Series) this.indicators.sma21Series.applyOptions({ title: '' });
        if (this.indicators.ema20Series) this.indicators.ema20Series.applyOptions({ title: '' });

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
        if (countElem) countElem.textContent = "Candles: " + chartData.length;
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

        this.tracker.handleTickPriceUpdate(normalizedCandle.instrument, normalizedCandle.type, normalizedCandle.threshold, normalizedCandle.close);

        if (!this.isInitialized) return;

        const lastIdx = this.candles.length - 1;
        if (lastIdx >= 0) {
            const lastCandle = this.candles[lastIdx];
            if (ohlc.time === lastCandle.time) {
                this.candles[lastIdx] = ohlc;
            } else if (ohlc.time > lastCandle.time) {
                this.candles.push(ohlc);
                if (this.candles.length > this.maxRecentCandlesPerInstrument) {
                    this.candles.shift();
                }
            } else {
                return;
            }
        } else {
            this.candles.push(ohlc);
        }

        try {
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
        } catch (e) {
            console.error("Charts live update exception avoided: " + e.message);
        }
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
                candle.time = last.time + 1;
            }
            this.candles.push(candle);
            this.candles.sort((a, b) => a.time - b.time);
        }
        if (this.candles.length > 500) this.candles = this.candles.slice(-500);
        this.updateCharts();
        this.updateStatsFromCandle(candle);
    }
    
    subscribeToCandles() {
        if (!this.socket || !this.currentInstrument || !this.currentThreshold) return;
        if (this.lastSubscription) {
            this.socket.emit('unsubscribe', this.lastSubscription);
            this.socket.off(`${this.lastSubscription.instrument}_${this.lastSubscription.type}_${this.lastSubscription.threshold}_live_candle`);
            this.socket.off(`${this.lastSubscription.instrument}_${this.lastSubscription.type}_${this.lastSubscription.threshold}_candle`);
        }
        
        this.lastSubscription = { 
            instrument: this.currentInstrument, 
            type: this.currentType, 
            threshold: this.currentThreshold 
        };
        
        this.socket.emit('subscribe', this.lastSubscription);

        const subscriptionKey = this.currentInstrument + '_' + this.currentType + '_' + this.currentThreshold;
        
        this.socket.on(`${subscriptionKey}_live_candle`, (liveCandle) => {
            const normalized = {
                ...liveCandle,
                instrument: liveCandle.instrument || liveCandle.instrument_key
            };
            if (normalized.instrument === this.currentInstrument && liveCandle.type === this.currentType && liveCandle.threshold == this.currentThreshold) {
                this.updateLiveCandle(normalized);
                this.updateProgressBar(normalized);
            }
        });

        this.socket.on(`${subscriptionKey}_candle`, (candle) => {
            const normalized = {
                ...candle,
                instrument: candle.instrument || candle.instrument_key
            };
            if (normalized.instrument === this.currentInstrument && candle.type === this.currentType && candle.threshold == this.currentThreshold && !candle.is_live) {
                const newCandle = this.convertToChartCandle(normalized);
                if (newCandle) this.addCompletedCandle(newCandle);
            }
        });
    }
    
    updateStatsFromCandle(candle) {
        const formattedType = candle.type ? candle.type.toUpperCase() : 'VOLUME';
        console.log(`|${formattedType} BAR| Completed: Bar #${candle.barNumber} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} | Vol: ${candle.volume}`);
    }
    
    setupEventListeners() {
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentType = btn.dataset.type;
                this.updateThresholdSelector();
                await this.loadCandlesForCurrentInstrument();
                this.subscribeToCandles();
                this.updateBottomChartLabel();
            });
        });

        document.getElementById('threshold-selector')?.addEventListener('change', async (e) => {
            this.currentThreshold = parseInt(e.target.value, 10);
            await this.loadCandlesForCurrentInstrument();
            this.subscribeToCandles();
        });

        document.getElementById('clear-drawings-btn')?.addEventListener('click', () => {
            this.drawings?.clearAll();
        });

        document.querySelectorAll('.draw-tool-btn').forEach(btn => {
            if (btn.id === 'clear-drawings-btn') return;
            btn.addEventListener('click', () => {
                this.drawings?.setTool(btn.dataset.tool);
            });
        });
    }

    updateProgressBar(candle) {
        const chartContainer = document.getElementById('main-chart');
        if (!chartContainer) return;

        let progressBarContainer = document.getElementById('chart-progress-bar-container');
        if (!progressBarContainer) {
            progressBarContainer = document.createElement('div');
            progressBarContainer.id = 'chart-progress-bar-container';
            progressBarContainer.style.cssText = 'height: 35px; background: #1e222d; border-top: 1px solid #2a2e39; border-bottom: 1px solid #2a2e39; display: flex; align-items: center; padding: 0 12px; font-family: monospace; font-size: 11px; color: #d1d4dc; box-sizing: border-box; justify-content: space-between;';
            chartContainer.parentNode.insertBefore(progressBarContainer, chartContainer.nextSibling);
        }

        const progress = candle.progress || 0;
        const isVolume = candle.type === 'volume';
        const label = isVolume ? 'VOLUME BAR' : 'PRICE TICK BAR';
        const current = isVolume ? (candle.volume || 0).toLocaleString() : (candle.currentTicks || 0);
        const target = isVolume ? (candle.targetVolume || 0).toLocaleString() : (candle.targetTicks || 0);
        const barColor = isVolume ? '#00bcd4' : '#26a69a';

        progressBarContainer.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; width: 45%;">
                <span style="font-weight: bold; color: ${barColor}; letter-spacing: 0.5px;">${label} #${candle.barNumber}</span>
                <div style="flex: 1; height: 6px; background: #2a2e39; border-radius: 3px; overflow: hidden; position: relative;">
                    <div style="width: ${Math.min(100, progress)}%; height: 100%; background: ${barColor}; border-radius: 3px; transition: width 0.2s ease;"></div>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 15px;">
                <span>Progress: <strong style="color: #fff;">${progress.toFixed(1)}%</strong></span>
                <span>Current: <strong style="color: #fff;">${current}</strong></span>
                <span>Target: <strong style="color: #fff;">${target}</strong></span>
            </div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.marketChart = new MarketChart();
});