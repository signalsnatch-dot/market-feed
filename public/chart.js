// public/chart.js
class MarketChart {
    constructor() {
        this.currentInstrument = null;
        this.currentType = 'volume';
        this.candles = [];          
        
        this.chart = null;
        this.candleSeries = null;
        this.bottomSeries = null;
        
        this.socket = null;
        this.instruments = new Map();
        this.activeThresholds = new Map(); // Tracks current active thresholds from config.json
        this.isInitialized = false;
        this.initialDataLoaded = false;
        this.lastSubscription = null;
        
        // Shared translation map to resolve time duplication crashes
        this.timeMap = new Map();
        
        this.indicators = new ChartIndicators(this);
        this.drawings = null; 
        
        this.tracker = new LiveTradeTracker(this);

        this.init();
    }

    // Standardizes all incoming keys to prevent underscore vs. pipe duplication
    normalizeKey(key) {
        if (!key) return '';
        return key.replace(/_/g, '|');
    }

    async init() {
        await this.loadHistoricalData();
        this.setupWebSocket();
        this.setupEventListeners();
        this.initCharts();
    }

    setActiveInstrument(key) {
        const normalizedKey = this.normalizeKey(key);
        const buttons = document.querySelectorAll('.instrument-btn');
        buttons.forEach(btn => {
            if (this.normalizeKey(btn.dataset.key) === normalizedKey) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
    
    switchInstrument(key) {
        const normalizedKey = this.normalizeKey(key);
        console.log(`Switching to instrument: ${normalizedKey}`);
        this.currentInstrument = normalizedKey;
        this.setActiveInstrument(normalizedKey);
        this.initialDataLoaded = false;
        this.timeMap.clear(); // Flush key mappings on instrument swaps
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
            const currentKey = this.normalizeKey(this.currentInstrument);
            
            // Fetch the currently active configuration thresholds for this instrument
            const activeTargets = this.activeThresholds.get(currentKey);
            const targetLimit = activeTargets 
                ? (this.currentType === 'volume' ? activeTargets.volume : activeTargets.price) 
                : null;

            this.candles = this[cacheKey]
                .filter(c => {
                    const instKey = c.instrument || c.instrument_key;
                    const normalizedInstKey = instKey ? instKey.replace(/_/g, '|') : null;
                    if (normalizedInstKey !== currentKey) return false;
                    
                    // SCALE-GUARD FILTER: Dynamically discard any historical candles 
                    // built with older, different configurations to prevent chart rendering crashes
                    if (targetLimit !== null && targetLimit !== undefined) {
                        const candleTarget = this.currentType === 'volume'
                            ? (c.targetVolume || c.volume)
                            : (c.targetTicks || c.ticks);
                        
                        if (candleTarget !== undefined && candleTarget !== null) {
                            if (Array.isArray(targetLimit)) {
                                return targetLimit.includes(Number(candleTarget));
                            }
                            return Number(candleTarget) === Number(targetLimit);
                        }
                    }
                    return true;
                })
                .map(c => this.convertToChartCandle(c))
                .filter(c => null !== c);
                
            this.candles.sort((a,b) => a.time - b.time);
            console.log(`Loaded ${this.candles.length} ${this.currentType} candles for ${this.currentInstrument}`);
            this.updateCharts();
        } else {
            this.candles = [];
            this.updateCharts();
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

        // Construct a synthetic strictly increasing time to prevent duplicate epoch crashes
        const syntheticTime = 1600000000 + (barNum * 60);

        // Store the real timestamp translation inside our map
        let realTime = candleData.startTime || candleData.timestamp || candleData.end_time;
        if (realTime) {
            if (typeof realTime === 'string') {
                realTime = new Date(realTime).getTime();
            }
            const d = new Date(realTime);
            const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            
            const normalizedKey = this.normalizeKey(this.currentInstrument);
            this.instruments.set(`${normalizedKey}_${candleData.barNumber}`, timeStr);
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
            // 1. Fetch current active instruments directly from config.json via API
            const instRes = await fetch('/api/instruments');
            if (instRes.ok) {
                const activeInstruments = await instRes.json();
                activeInstruments.forEach(inst => {
                    const normalizedKey = this.normalizeKey(inst.key);
                    this.instruments.set(normalizedKey, {
                        key: normalizedKey,
                        name: inst.name,
                        exchange: inst.exchange || normalizedKey.split('|')[0]
                    });
                    
                    // Track both active volume and price bar targets for Scale-Guard filtering
                    this.activeThresholds.set(normalizedKey, {
                        volume: inst.volumePerBar,
                        price: inst.priceBarTicks
                    });
                });
            }

            // 2. Fetch volume candles
            const volumeRes = await fetch('/api/recent/volume?limit=500');
            if (volumeRes.ok) {
                const recentVolume = await volumeRes.json();
                this.volume_candles = recentVolume.map(c => {
                    const normKey = this.normalizeKey(c.instrument || c.instrument_key);
                    return {
                        ...c,
                        instrument: normKey,
                        instrument_key: normKey
                    };
                });
            }
            
            // 3. Fetch price candles
            const priceRes = await fetch('/api/recent/price?limit=500');
            if (priceRes.ok) {
                const recentPrice = await priceRes.json();
                this.price_candles = recentPrice.map(c => {
                    const normKey = this.normalizeKey(c.instrument || c.instrument_key);
                    return {
                        ...c,
                        instrument: normKey,
                        instrument_key: normKey
                    };
                });
            }
            
            this.renderInstrumentSelector();
            
            // Use active instruments to set current selection
            if (this.currentInstrument === null && this.instruments.size > 0) {
                this.currentInstrument = this.instruments.keys().next().value;
                this.setActiveInstrument(this.currentInstrument);
            }

            if (this.currentInstrument) {
                this.loadCandlesForCurrentInstrument();
                this.updateBottomChartLabel();
            }
        } catch (error) {
            console.error('Failed to load historical data:', error);
        }
    }
    
    getInstrumentName(key) {
        const normalizedKey = this.normalizeKey(key);
        const names = {
            'MCX_FO|538685': 'Natural Gas Future',
            'MCX_FO|520702': 'Crude Oil Future',
            'NSE_FO|62329': 'Nifty 50 Future',
            'NSE_FO|62326': 'Nifty Bank Future'
        };
        return names[normalizedKey] || normalizedKey.split('|')[1];
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
                this.volume_candles = data.volume_bars.map(c => {
                    const normKey = this.normalizeKey(c.instrument || c.instrument_key);
                    return {
                        ...c,
                        instrument: normKey,
                        instrument_key: normKey
                    };
                });
            }
            if (data.price_bars) {
                this.price_candles = data.price_bars.map(c => {
                    const normKey = this.normalizeKey(c.instrument || c.instrument_key);
                    return {
                        ...c,
                        instrument: normKey,
                        instrument_key: normKey
                    };
                });
            }
            if (this.currentInstrument) this.loadCandlesForCurrentInstrument();

            if (data.strategies) {
                this.tracker.setupStrategyVersions(data.strategies);
            }

            if (data.trade_signals) {
                this.tracker.renderSignals(data.trade_signals);
            }
        });
        
        this.socket.on('live_candle_update', (liveCandle) => {
            const normalizedKey = this.normalizeKey(liveCandle.instrument || liveCandle.instrument_key);
            const currentKey = this.normalizeKey(this.currentInstrument);
            
            if (normalizedKey === currentKey && liveCandle.type === this.currentType) {
                const candleCopy = {
                    ...liveCandle,
                    instrument: normalizedKey,
                    instrument_key: normalizedKey
                };
                this.updateLiveCandle(candleCopy);
                this.updateProgressBar(candleCopy);
            }
        });
        
        this.socket.on('candle_update', (candle) => {
            const normalizedKey = this.normalizeKey(candle.instrument || candle.instrument_key);
            const currentKey = this.normalizeKey(this.currentInstrument);
            
            if (normalizedKey === currentKey && candle.type === this.currentType && !candle.is_live) {
                const candleCopy = {
                    ...candle,
                    instrument: normalizedKey,
                    instrument_key: normalizedKey
                };
                const newCandle = this.convertToChartCandle(candleCopy);
                if (newCandle) this.addCompletedCandle(newCandle);
            }
        });

        this.socket.on('trade_signal', (signal) => {
            const normalizedSignal = {
                ...signal,
                instrument: this.normalizeKey(signal.instrument)
            };
            this.tracker.handleIncomingSignal(normalizedSignal);
        });

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

        this.tracker.handleTickPriceUpdate(normalizedCandle.instrument, normalizedCandle.type, normalizedCandle.close);

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
            console.error("Lightweight charts live update exception avoided:", e.message);
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
            
            // Insert after `#main-chart` as a block sibling
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