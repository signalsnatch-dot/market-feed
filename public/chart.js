// public/chart.js - Complete with IST timezone and dynamic bottom chart
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
        this.isInitialized = false;
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
                .filter(c => c.instrument === this.currentInstrument || c.instrument_key === this.currentInstrument)
                .map(c => this.convertToChartCandle(c))
                .filter(c => c !== null);
            
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
    
    updateLiveCandle(liveCandle) {
        const newCandle = this.convertToChartCandle(liveCandle);
        if (!newCandle) return;
        
        const lastCandle = this.candles[this.candles.length - 1];
        
        if (lastCandle && lastCandle.barNumber === liveCandle.barNumber) {
            this.candles[this.candles.length - 1] = newCandle;
        } else {
            this.candles.push(newCandle);
        }
        
        if (this.candles.length > 500) this.candles = this.candles.slice(-500);
        this.updateCharts();
        this.updateStatsFromCandle(newCandle);
    }
    
    addCompletedCandle(candle) {
        const existingIndex = this.candles.findIndex(c => c.time === candle.time);
        if (existingIndex >= 0) {
            this.candles[existingIndex] = candle;
        } else {
            this.candles.push(candle);
        }
        
        this.candles.sort((a, b) => a.time - b.time);
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
    
    initCharts() {
        const chartElement = document.getElementById('main-chart');
        const bottomElement = document.getElementById('bottom-chart');
        
        if (!chartElement || typeof LightweightCharts === 'undefined') {
            setTimeout(() => this.initCharts(), 500);
            return;
        }
        
        // Main price chart
        this.chart = LightweightCharts.createChart(chartElement, {
            width: chartElement.clientWidth,
            height: 400,
            layout: { background: { color: '#1e222d' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#2f3c5c' }, horzLines: { color: '#2f3c5c' } },
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
            }
        });
        
        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#26a69a', downColor: '#ef5350', borderVisible: false
        });
        
        // Bottom chart (dynamic based on candle type)
        if (bottomElement) {
            const bottomChart = LightweightCharts.createChart(bottomElement, {
                width: bottomElement.clientWidth,
                height: 150,
                layout: { background: { color: '#1e222d' }, textColor: '#d1d4dc' },
                grid: { vertLines: { color: '#2f3c5c' }, horzLines: { color: '#2f3c5c' } },
                rightPriceScale: { 
                    visible: true,
                    borderColor: '#2f3c5c',
                    scaleMargins: { top: 0.1, bottom: 0.1 }
                },
                timeScale: { visible: false }
            });
            
            // Use HistogramSeries for bottom chart
            this.bottomSeries = bottomChart.addSeries(LightweightCharts.HistogramSeries, {
                color: '#00bcd4',
                priceFormat: { type: 'volume' }
            });
            
            // Link time scales
            bottomChart.timeScale().subscribeVisibleTimeRangeChange((range) => {
                this.chart.timeScale().setVisibleRange(range);
            });
            this.chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
                bottomChart.timeScale().setVisibleRange(range);
            });
        }
        
        this.isInitialized = true;
        this.updateCharts();
        
        window.addEventListener('resize', () => {
            this.chart?.applyOptions({ width: chartElement.clientWidth });
            if (bottomElement && this.bottomSeries) {
                const bottomChart = this.bottomSeries.chart();
                bottomChart?.applyOptions({ width: bottomElement.clientWidth });
            }
        });
    }
    
    updateCharts() {
        if (!this.isInitialized || !this.candleSeries || !this.candles.length) return;
        
        const chartData = [];
        const bottomData = [];
        
        for (const candle of this.candles) {
            chartData.push({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            });
            
            // Bottom chart data depends on candle type
            let bottomValue = 0;
            let bottomColor = '#00bcd4';
            
            if (this.currentType === 'volume') {
                // Volume bars: show price changes count
                bottomValue = candle.priceChanges || candle.transactions || 0;
                bottomColor = '#ff9800';
            } else {
                // Price bars: show traded volume
                bottomValue = candle.volume || 0;
                bottomColor = '#00bcd4';
            }
            
            bottomData.push({
                time: candle.time,
                value: bottomValue,
                color: bottomColor
            });
        }
        
        this.candleSeries.setData(chartData);
        if (this.bottomSeries) {
            this.bottomSeries.setData(bottomData);
            
            // Update right price scale formatting
            const priceScale = this.bottomSeries.priceScale();
            if (priceScale) {
                priceScale.applyOptions({
                    scaleMargins: { top: 0.1, bottom: 0.1 }
                });
            }
        }
        
        this.chart.timeScale().fitContent();
        document.getElementById('candleCount').textContent = `Candles: ${chartData.length}`;
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