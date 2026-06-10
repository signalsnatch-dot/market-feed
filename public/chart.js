// public/chart.js - Complete with IST timezone and dynamic bottom chart
class MarketChart {
    constructor() {
        this.currentInstrument = null;
        this.currentType = 'volume';
        this.candles = [];          // Array of formatted candle objects
        this.chart = null;
        this.candleSeries = null;
        this.bottomSeries = null;
        this.socket = null;
        this.instruments = new Map();
        this.isInitialized = false;
        this.userHasZoomed = false;      // True if user manually zoomed/panned
        this.initialDataLoaded = false;
        this.zoomTimeout = null;
        this.savedTimeRange = null;      // For restoring after data updates
        this.savedPriceRange = null;     // For restoring top pane price scale
        
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
        this.loadCandlesForCurrentInstrument();
        this.subscribeToCandles();
        this.updateBottomChartLabel();
    }
    
    convertToChartCandle(candleData) {
        let timestamp = candleData.timestamp || candleData.end_time;
        if (!timestamp) return null;
        if (typeof timestamp === 'string') timestamp = new Date(timestamp).getTime();
        let timeSec = Math.floor(timestamp / 1000);
        if (timeSec < 1577836800 || timeSec > 1893456000) return null;

        const open = parseFloat(candleData.open);
        const high = parseFloat(candleData.high);
        const low = parseFloat(candleData.low);
        const close = parseFloat(candleData.close);
        if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;

        // Preserve barNumber for identification
        const barNumber = candleData.barNumber || candleData.bar_number;

        return {
            time: timeSec,
            open, high, low, close,
            volume: parseFloat(candleData.volume || candleData.targetVolume || 0),
            barNumber: barNumber,
            progress: candleData.progress,
            priceChanges: candleData.priceChanges,
            transactions: candleData.transactions
        };
    }


    updateBottomChartLabel() {
        const bottomChartContainer = document.getElementById('bottom-chart');
        if (!bottomChartContainer) return;
        
        const label = this.currentType === 'volume' 
            ? '📊 Price Changes (per candle)' 
            : '💰 Traded Quantity (units)';
        
        // Add or update the label
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
            // Sort by time ascending
            this.candles.sort((a,b) => a.time - b.time);
            console.log(`Loaded ${this.candles.length} ${this.currentType} candles for ${this.currentInstrument}`);
            this.updateCharts();
        } else {
            this.candles = [];
            this.updateCharts();
        }
    }


    convertToChartCandle(candleData) {
        // Get timestamp (already in IST from server)
        let timestamp = candleData.timestamp || candleData.end_time;
        
        if (!timestamp) return null;
        
        if (typeof timestamp === 'string') {
            timestamp = new Date(timestamp).getTime();
        }
        
        // Timestamp is now in IST milliseconds, convert to seconds for chart
        const timeInSeconds = Math.floor(timestamp / 1000);
        
        if (timeInSeconds < 1577836800 || timeInSeconds > 1893456000) return null;
        
        const open = parseFloat(candleData.open);
        const high = parseFloat(candleData.high);
        const low = parseFloat(candleData.low);
        const close = parseFloat(candleData.close);
        
        if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;
        
        // For volume bars: show priceChanges (ticks) in bottom chart
        // For price bars: show volume (traded quantity) in bottom chart
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
            'MCX_FO|487465': 'Natural Gas Future',
            'NSE_FO|45450': 'Nifty 50 Future',
            'NSE_FO|66688': 'Nifty Bank Future'
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
           // Normalize instrument field in historical data
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
        });
        
        this.socket.on('live_candle_update', (liveCandle) => {
           // Normalize instrument field
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
           // Normalize instrument field
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
        
        this.socket.on('disconnect', () => {
            document.getElementById('wsStatus').textContent = 'Disconnected';
            document.getElementById('wsStatus').className = 'status-badge disconnected';
        });
    }
    updateProgressDisplay(progress, candle) {
        const progressBar = document.getElementById('candle-progress');
        if (!progressBar) {
            // Create progress bar if it doesn't exist
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
                
                // Check if already exists, update or append
                let existing = document.getElementById('candle-progress-container');
                if (existing) {
                    existing.remove();
                }
                statsBar.insertAdjacentHTML('afterend', progressHtml);
            }
        } else {
            // Update existing progress bar
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
            scaleMargins: { top: 0.05, bottom: 0.25 }  // 70% for candles
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

    // Configure bottom pane (20% of chart height)
    this.chart.priceScale('bottom').applyOptions({
        scaleMargins: { top: 0.75, bottom: 0.05 },
        borderColor: '#2a2e39',
        autoScale: true,
        entireTextOnly: true
    });

    // Track time scale (horizontal) zoom/pan
    this.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        this.userHasZoomed = true;
        this.savedTimeRange = this.chart.timeScale().getVisibleRange();
    });

    // Note: No direct event for price scale changes, but we'll save/restore price range before each data update.

    this.isInitialized = true;

    // Hide any old separate bottom chart
    const oldBottom = document.getElementById('bottom-chart');
    if (oldBottom) oldBottom.style.display = 'none';

    this.addBottomPaneLabel();

    this.updateCharts();

    window.addEventListener('resize', () => {
        this.chart?.applyOptions({ width: chartElement.clientWidth });
    });
}


// Update updateCharts method
    updateCharts() {
        if (!this.isInitialized || !this.candleSeries || !this.candles.length) return;

        // Save current zoom/pan state before updating data
        let savedTime = null;
        let savedPrice = null;
        if (this.userHasZoomed && this.chart) {
            try {
                savedTime = this.chart.timeScale().getVisibleRange();
                savedPrice = this.chart.priceScale('right').getVisibleRange();
            } catch(e) { /* ignore */ }
        }

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

        // Restore zoom/pan if user had interacted
        if (savedTime && this.userHasZoomed) {
            this.chart.timeScale().setVisibleRange(savedTime);
        }
        if (savedPrice && this.userHasZoomed) {
            this.chart.priceScale('right').setVisibleRange(savedPrice);
        } else if (!this.initialDataLoaded && chartData.length) {
            // First load: fit content horizontally, auto-scale price
            this.chart.timeScale().fitContent();
            this.chart.priceScale('right').applyOptions({ autoScale: true });
            this.initialDataLoaded = true;
            this.userHasZoomed = false;
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

    // Update addLiveCandle method to not reset zoom
    // Process a live candle update from WebSocket
    updateLiveCandle(liveCandle) {
        const newCandle = this.convertToChartCandle(liveCandle);
        if (!newCandle) return;

        const barNum = newCandle.barNumber;
        let existingIndex = -1;
        if (barNum !== undefined && barNum !== null) {
            existingIndex = this.candles.findIndex(c => c.barNumber === barNum);
        }

        if (existingIndex >= 0) {
            // Update existing candle in place
            this.candles[existingIndex] = newCandle;
            // Force a full redraw of all data – this eliminates off-screen update bugs
            this.updateCharts();
        } else {
            // New candle – append
            // Ensure strictly increasing time to avoid glitches
            const last = this.candles[this.candles.length - 1];
            if (last && newCandle.time <= last.time) {
                newCandle.time = last.time + 1;
            }
            this.candles.push(newCandle);
            if (this.candles.length > 500) this.candles = this.candles.slice(-500);
            this.updateCharts();
        }

        // Update progress bar and stats (keep your existing methods)
        this.updateProgressDisplay(liveCandle.progress || 0, liveCandle);
        this.updateStatsFromCandle(newCandle);
    }


    // Add method to manually reset zoom (optional - add a button in UI)
     resetZoom() {
        this.userHasZoomed = false;
        this.initialDataLoaded = false;
        if (this.chart && this.candles.length) {
            this.chart.timeScale().fitContent();
            this.chart.priceScale('right').applyOptions({ autoScale: true });
            this.initialDataLoaded = true;
        }
    }
    
     // Called when a candle is fully closed (finalized)
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

    // Add new method to reset zoom state after period of inactivity
    resetZoomState() {
        if (this.zoomTimeout) clearTimeout(this.zoomTimeout);
        this.zoomTimeout = setTimeout(() => {
            this.userHasZoomed = false;
        }, 5000); // Reset after 5 seconds of no zoom activity
    }
    
    
    updateStatsFromCandle(candle) {
        const statsBar = document.getElementById('statsBar');
        if (!statsBar) return;
        
        const change = candle.close - candle.open;
        const changePercent = (change / candle.open) * 100;
        const color = change >= 0 ? '#26a69a' : '#ef5350';
        
        // Format time in IST
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
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.marketChart = new MarketChart();
});