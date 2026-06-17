/**
 * ChartIndicators Class
 * Handles mathematical calculations, visibility, and smooth rendering of technical overlays.
 */
class ChartIndicators {
    constructor(marketChart) {
        this.marketChart = marketChart;
        this.sma9Visible = true;
        this.sma21Visible = true;
        this.ema20Visible = true;
    }

    /**
     * Initializes the indicator series on the Lightweight Charts instance.
     */
    initSeries() {
        // SMA 9 Line
        this.sma9Series = this.marketChart.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#2962FF',
            lineWidth: 2,
            priceScaleId: 'right',
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            title: 'SMA 9',
            visible: this.sma9Visible
        });

        // SMA 21 Line
        this.sma21Series = this.marketChart.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#FF6D00',
            lineWidth: 2,
            priceScaleId: 'right',
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            title: 'SMA 21',
            visible: this.sma21Visible
        });

        // EMA 20 Line
        this.ema20Series = this.marketChart.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#E040FB',
            lineWidth: 2,
            priceScaleId: 'right',
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            title: 'EMA 20',
            visible: this.ema20Visible
        });
    }

    /**
     * Toggles indicator visibility cleanly using direct series configuration updates.
     */
    toggleVisibility(type) {
        if (type === 'sma9') {
            this.sma9Visible = !this.sma9Visible;
            this.sma9Series.applyOptions({ visible: this.sma9Visible });
        } else if (type === 'sma21') {
            this.sma21Visible = !this.sma21Visible;
            this.sma21Series.applyOptions({ visible: this.sma21Visible });
        } else if (type === 'ema20') {
            this.ema20Visible = !this.ema20Visible;
            this.ema20Series.applyOptions({ visible: this.ema20Visible });
        }
    }

    /**
     * Resets indicators with full historical datasets.
     */
    setFullHistory(chartData) {
        const sma9Data = this.calculateSMA(chartData, 9);
        const sma21Data = this.calculateSMA(chartData, 21);
        const ema20Data = this.calculateEMA(chartData, 20);

        this.sma9Series.setData(sma9Data);
        this.sma21Series.setData(sma21Data);
        this.ema20Series.setData(ema20Data);
    }

    /**
     * Updates only the latest indicator point for real-time sliding.
     */
    updateLatestPoint(chartData) {
        if (!chartData || chartData.length === 0) return;

        const sma9Data = this.calculateSMA(chartData, 9);
        const sma21Data = this.calculateSMA(chartData, 21);
        const ema20Data = this.calculateEMA(chartData, 20);

        if (sma9Data.length > 0) this.sma9Series.update(sma9Data[sma9Data.length - 1]);
        if (sma21Data.length > 0) this.sma21Series.update(sma21Data[sma21Data.length - 1]);
        if (ema20Data.length > 0) this.ema20Series.update(ema20Data[ema20Data.length - 1]);
    }

    /**
     * Calculates Simple Moving Average.
     */
    calculateSMA(data, period) {
        if (!Array.isArray(data) || data.length === 0 || period <= 0) return [];
        const sma = [];
        for (let i = period - 1; i < data.length; i++) {
            const sum = data.slice(i - period + 1, i + 1).reduce((acc, candle) => acc + candle.close, 0);
            sma.push({ time: data[i].time, value: sum / period });
        }
        return sma;
    }

    /**
     * Calculates Exponential Moving Average.
     */
    calculateEMA(data, period) {
        if (!Array.isArray(data) || data.length === 0 || period <= 0) return [];
        const emaData = [];
        const k = 2 / (period + 1);
        let prevEma = null;
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (i < period - 1) continue;
            if (i === period - 1) {
                const sum = data.slice(0, period).reduce((acc, candle) => acc + candle.close, 0);
                prevEma = sum / period;
                emaData.push({ time: item.time, value: prevEma });
                continue;
            }
            prevEma = (item.close - prevEma) * k + prevEma;
            emaData.push({ time: item.time, value: prevEma });
        }
        return emaData;
    }
}

window.ChartIndicators = ChartIndicators;