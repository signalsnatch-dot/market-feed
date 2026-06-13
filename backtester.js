// backtester.js - Standalone strategy backtesting system
const fs = require('fs');
const path = require('path');
const { twoLeggedPullback, runPriceActionBacktest, DEFAULT_PARAMS } = require('./priceActionStrategy');

class StrategyBacktester {
    constructor(config) {
        this.dataDir = config.dataDir || './candles_data';
        //this.strategies = new Map();
        this.resultsDir = './backtest_results';
        
        if (!fs.existsSync(this.resultsDir)) {
            fs.mkdirSync(this.resultsDir, { recursive: true });
        }
    }
    
    // Load candle data from CSV
    async loadCandleData(instrumentKey, candleType = 'volume') {
        const safeKey = instrumentKey.replace(/[^a-zA-Z0-9]/g, '_');
        const subdir = candleType === 'price' ? 'price_bars' : 'volume_bars';
        const candidates = [
            path.join(this.dataDir, subdir, `${safeKey}_${candleType}_bars.csv`),
            path.join(this.dataDir, `${safeKey}_${candleType}_bars.csv`)
        ];
        const filepath = candidates.find(p => fs.existsSync(p));

        if (!filepath) {
            console.error(`File not found. Tried:\n  ${candidates.join('\n  ')}`);
            return [];
        }
        
        const candles = [];
        const content = fs.readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        const headers = lines[0].split(',');
        
        const timestampIdx = headers.indexOf('timestamp');
        const openIdx = headers.indexOf('open');
        const highIdx = headers.indexOf('high');
        const lowIdx = headers.indexOf('low');
        const closeIdx = headers.indexOf('close');
        const volumeIdx = headers.indexOf('volume');
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = this.parseCSVLine(lines[i]);
            
            const candle = {
                timestamp: parseInt(values[timestampIdx]),
                open: parseFloat(values[openIdx]),
                high: parseFloat(values[highIdx]),
                low: parseFloat(values[lowIdx]),
                close: parseFloat(values[closeIdx]),
                volume: volumeIdx >= 0 ? parseFloat(values[volumeIdx]) : 0
            };
            candles.push(candle);
        }
        
        return candles;
    }
    
    parseCSVLine(line) {
        const result = [];
        let inQuotes = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else current += char;
        }
        result.push(current);
        return result;
    }
    
    // Built-in Strategies
    strategies = {
        // Simple Moving Average Crossover
        smaCrossover: (candles, params = {fast: 9, slow: 21 }) => {
            const signals = [];
            const fastSMA = this.calculateSMA(candles, params.fast);
            const slowSMA = this.calculateSMA(candles, params.slow);

            for (let i = 1; i < slowSMA.length; i++) {
                if (fastSMA[i].value > slowSMA[i].value && fastSMA[i-1].value <= slowSMA[i-1].value) {
                    signals.push({ index: fastSMA[i].index, type: 'BUY', price: candles[fastSMA[i].index].close });
                } else if (fastSMA[i].value < slowSMA[i].value && fastSMA[i-1].value >= slowSMA[i-1].value) {
                    signals.push({ index: fastSMA[i].index, type: 'SELL', price: candles[fastSMA[i].index].close });
                }
            }
            return signals;
        },

        smaCrossoverReverse: (candles, params = {fast: 9, slow: 21 }) => {
            const signals = [];
            const fastSMA = this.calculateSMA(candles, params.fast);
            const slowSMA = this.calculateSMA(candles, params.slow);

            for (let i = 1; i < slowSMA.length; i++) {
                if (fastSMA[i].value > slowSMA[i].value && fastSMA[i-1].value <= slowSMA[i-1].value) {
                    signals.push({ index: fastSMA[i].index, type: 'SELL', price: candles[fastSMA[i].index].close });
                } else if (fastSMA[i].value < slowSMA[i].value && fastSMA[i-1].value >= slowSMA[i-1].value) {
                    signals.push({ index: fastSMA[i].index, type: 'BUY', price: candles[fastSMA[i].index].close });
                }
            }
            return signals;
        },
        
        // RSI Mean Reversion
        rsiMeanReversion: (candles, params = { period: 14, oversold: 30, overbought: 70 }) => {
            const signals = [];
            const rsi = this.calculateRSI(candles, params.period);
            
            for (let i = 1; i < rsi.length; i++) {
                if (rsi[i].value < params.oversold && rsi[i-1].value >= params.oversold) {
                    signals.push({ index: rsi[i].index, type: 'BUY', price: candles[rsi[i].index].close, timestamp: candles[rsi[i].index].timestamp });
                } else if (rsi[i].value > params.overbought && rsi[i-1].value <= params.overbought) {
                    signals.push({ index: rsi[i].index, type: 'SELL', price: candles[rsi[i].index].close, timestamp: candles[rsi[i].index].timestamp });
                }
            }
            return signals;
        },
        
        // Bollinger Bands Breakout
        bollingerBreakout: (candles, params = { period: 20, stdDev: 2 }) => {
            const signals = [];
            const bb = this.calculateBollingerBands(candles, params.period, params.stdDev);
            
            for (let i = params.period; i < candles.length; i++) {
                const upper = bb.upper[i - params.period];
                const lower = bb.lower[i - params.period];
                
                if (candles[i].close > upper && candles[i-1].close <= upper) {
                    signals.push({ index: i, type: 'BUY', price: candles[i].close });
                } else if (candles[i].close < lower && candles[i-1].close >= lower) {
                    signals.push({ index: i, type: 'SELL', price: candles[i].close });
                }
            }
            return signals;
        },
        
        // Volume Spike Detection
        volumeSpike: (candles, params = { multiplier: 2, period: 20 }) => {
            const signals = [];
            const avgVolume = this.calculateSMA(candles.map(c => ({ value: c.volume })), params.period);
            
            for (let i = params.period; i < candles.length; i++) {
                const avgVol = avgVolume[i - params.period].value;
                if (candles[i].volume > avgVol * params.multiplier) {
                    const direction = candles[i].close > candles[i].open ? 'BUY' : 'SELL';
                    signals.push({ index: i, type: direction, price: candles[i].close });
                }
            }
            return signals;
        },

        // Price Action: 2-legged pullback to 20 EMA (Thomas Wade style, volume/price bars)
        twoLeggedPullback: (candles, params = {}) => {
            return twoLeggedPullback(candles, { ...DEFAULT_PARAMS, ...params });
        }
    };
    
    // Technical Indicators
    calculateSMA(data, period, field = 'close') {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + (b[field] || b.value), 0);
            result.push({ index: i, value: sum / period });
        }
        return result;
    }
    
/*************  ✨ Windsurf Command ⭐  *************/
    /**
     * Calculates the Relative Strength Index (RSI) for the given candles.
     * 
     * The RSI is a momentum indicator that measures the magnitude of recent price changes to determine overbought or oversold conditions.
     * 
     * It is calculated by dividing the average gain of up days by the average loss of down days, and subtracting the result from 100.
     * 
     * @param {Object[]} candles - The array of candle objects
     * @param {Number} [period=14] - The period over which to calculate the RSI
     * @returns {Object[]} - An array of objects with the index and RSI value
     */
/*******  944f277a-fb96-4bc7-bbed-41433204f3a2  *******/
    calculateRSI(candles, period = 14) {
        const result = [];
        let gains = 0, losses = 0;
        
        for (let i = 1; i < candles.length; i++) {
            const change = candles[i].close - candles[i-1].close;
            if (change >= 0) gains += change;
            else losses -= change;
            
            if (i >= period) {
                const avgGain = gains / period;
                const avgLoss = losses / period;
                const rs = avgGain / avgLoss;
                const rsi = 100 - (100 / (1 + rs));
                result.push({ index: i, value: rsi });
                
                const oldestChange = candles[i - period + 1].close - candles[i - period].close;
                if (oldestChange >= 0) gains -= oldestChange;
                else losses += oldestChange;
            }
        }
        return result;
    }
    
    calculateBollingerBands(candles, period = 20, stdDev = 2) {
        const upper = [];
        const lower = [];
        
        for (let i = period - 1; i < candles.length; i++) {
            const slice = candles.slice(i - period + 1, i + 1);
            const mean = slice.reduce((a, b) => a + b.close, 0) / period;
            const variance = slice.reduce((sum, d) => sum + Math.pow(d.close - mean, 2), 0) / period;
            const std = Math.sqrt(variance);
            const upperI = { index: i, value: mean + (stdDev * std) };
            const lowerI = { index: i, value: mean - (stdDev * std) };

            upper.push(upperI);
            lower.push(lowerI);
        }
        return { upper, lower };
    }
    
    usesPriceActionExits(signals) {
        return signals.length > 0 && signals.some(s => s.stopLoss != null && s.takeProfit != null);
    }

    // Backtest Engine — signal-only exits for classic strategies; stop/target bar simulation for price action
    runBacktest(candles, signals, initialCapital = 100000, tradeSize = 0.65) {
        if (this.usesPriceActionExits(signals)) {
            const { trades, finalEquity } = runPriceActionBacktest(candles, signals, initialCapital, tradeSize);
            return this.calculateMetrics(trades, initialCapital, finalEquity);
        }

        let equity = initialCapital;
        let position = null;
        const trades = [];

        for (let i = 0; i < signals.length; i++) {
            const signal = signals[i];
            const price = signal.price;

            if (signal.type === 'BUY' && !position) {
                const sizeFactor = (signal.confidence || 100) / 100;
                const quantity = (equity * tradeSize * sizeFactor) / price;
                position = { entry: price, quantity, index: i, entryIndex: signal.index, confidence: signal.confidence };
            } else if (signal.type === 'SELL' && position) {
                const pnl = (price - position.entry) / position.entry;
                const pnlAmount = position.quantity * price - position.quantity * position.entry;
                equity += pnlAmount;

                trades.push({
                    entryIndex: position.entryIndex,
                    exitIndex: signal.index,
                    entryPrice: position.entry,
                    exitPrice: price,
                    quantity: position.quantity,
                    pnl: pnl * 100,
                    pnlAmount: pnlAmount,
                    holdingPeriod: signal.index - position.entryIndex,
                    confidence: position.confidence
                });
                position = null;
            }
        }

        return this.calculateMetrics(trades, initialCapital, equity);
    }
    
    calculateMetrics(trades, initialCapital, finalEquity) {
        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl < 0);
        const totalPnl = finalEquity - initialCapital;
        
        // Calculate Sharpe Ratio
        const returns = trades.map(t => t.pnl);
        const avgReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const variance = returns.length ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
        const sharpe = Math.sqrt(variance) === 0 ? 0 : (avgReturn / Math.sqrt(variance)).toFixed(2);
        
        // Calculate Maximum Drawdown
        let peak = initialCapital;
        let maxDrawdown = 0;
        let runningEquity = initialCapital;
        
        for (const trade of trades) {
            runningEquity += trade.pnlAmount;
            if (runningEquity > peak) peak = runningEquity;
            const drawdown = (peak - runningEquity) / peak * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }
        
        const confidenceTrades = trades.filter(t => t.confidence != null);
        const avgConfidence = confidenceTrades.length
            ? (confidenceTrades.reduce((s, t) => s + t.confidence, 0) / confidenceTrades.length).toFixed(1)
            : null;
        const stopExits = trades.filter(t => t.exitReason === 'stop_loss').length;
        const targetExits = trades.filter(t => t.exitReason === 'take_profit').length;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: trades.length ? (winningTrades.length / trades.length * 100).toFixed(2) : 0,
            totalReturn: ((finalEquity - initialCapital) / initialCapital * 100).toFixed(2),
            totalPnl: totalPnl.toFixed(2),
            finalEquity: finalEquity.toFixed(2),
            avgWin: winningTrades.length ? (winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length).toFixed(2) : 0,
            avgLoss: losingTrades.length ? (losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length).toFixed(2) : 0,
            largestWin: winningTrades.length ? Math.max(...winningTrades.map(t => t.pnl)).toFixed(2) : 0,
            largestLoss: losingTrades.length ? Math.min(...losingTrades.map(t => t.pnl)).toFixed(2) : 0,
            sharpeRatio: sharpe,
            maxDrawdown: maxDrawdown.toFixed(2),
            profitFactor: (Math.abs(winningTrades.reduce((s, t) => s + t.pnl, 0)) /
                          Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0)) || 0).toFixed(2),
            avgConfidence,
            stopExits,
            targetExits,
            trades: trades
        };
    }
    
    // Run complete analysis
    async runCompleteAnalysis(options) {
        const {
            instrumentKey,
            candleType = 'volume',
            strategyName = 'smaCrossover',
            strategyParams = {},
            initialCapital = 100000,
            tradeSize = 0.65
        } = options;
        
        console.log(`\n📊 Running Backtest Analysis`);
        console.log(`   Instrument: ${instrumentKey}`);
        console.log(`   Candle Type: ${candleType}`);
        console.log(`   Strategy: ${strategyName}`);
        console.log(`   Period: Full historical\n`);
        
        // Load data
        const candles = await this.loadCandleData(instrumentKey, candleType);
        if (candles.length === 0) {
            console.error('No data loaded');
            return null;
        }
        
        console.log(`   Loaded ${candles.length} candles`);
        
        // Generate signals
        const strategy = this.strategies[strategyName];
        if (!strategy) {
            console.error(`Strategy ${strategyName} not found`);
            return null;
        }
        var signals;
        if (Object.keys(strategyParams).length === 0) {
            signals = strategy(candles);
        } else {
            signals = strategy(candles, strategyParams);
        }
        console.log(`   Generated ${signals.length} signals`);
        if (signals.length && signals[0].confidence != null) {
            const avgConf = signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length;
            console.log(`   Avg confidence: ${avgConf.toFixed(1)} | Range: ${Math.min(...signals.map(s => s.confidence))}-${Math.max(...signals.map(s => s.confidence))}`);
        }

        // Run backtest
        const results = this.runBacktest(candles, signals, initialCapital, tradeSize);

        // Save results
        const safeKey = instrumentKey.replace(/[^a-zA-Z0-9]/g, '_');
        const resultFile = path.join(this.resultsDir, `${safeKey}_${candleType}_${strategyName}_${Date.now()}.json`);
        fs.writeFileSync(resultFile, JSON.stringify({
            config: options,
            signalCount: signals.length,
            sampleSignals: signals.slice(0, 5),
            results,
            timestamp: Date.now()
        }, null, 2));
        
        console.log(`   Results saved to: ${resultFile}`);
        
        return results;
    }
    
    // Compare strategies across multiple instruments
    async compareStrategies(instruments, candleType = 'volume') {
        const allResults = [];
        
        for (const instrument of instruments) {
            for (const [strategyName, strategy] of Object.entries(this.strategies)) {
                console.log(`\nTesting ${strategyName} on ${instrument}...`);
                const candles = await this.loadCandleData(instrument, candleType);
                if (candles.length === 0) continue;
                
                const signals = strategy(candles);
                const results = this.runBacktest(candles, signals);
                
                allResults.push({
                    instrument,
                    strategy: strategyName,
                    winRate: results.winRate,
                    totalReturn: results.totalReturn,
                    sharpeRatio: results.sharpeRatio,
                    maxDrawdown: results.maxDrawdown,
                    totalTrades: results.totalTrades
                });
            }
        }
        
        // Sort by Sharpe Ratio
        allResults.sort((a, b) => parseFloat(b.sharpeRatio) - parseFloat(a.sharpeRatio));
        
        console.log('\n📈 Strategy Comparison Report');
        console.log('='.repeat(80));
        console.table(allResults);
        
        return allResults;
    }
    
    printResults(results) {
        console.log('\n📈 BACKTEST RESULTS');
        console.log('='.repeat(50));
        console.log(`Total Trades:     ${results.totalTrades}`);
        console.log(`Win Rate:         ${results.winRate}%`);
        console.log(`Total Return:     ${results.totalReturn}%`);
        console.log(`Sharpe Ratio:     ${results.sharpeRatio}`);
        console.log(`Max Drawdown:     ${results.maxDrawdown}%`);
        console.log(`Profit Factor:    ${results.profitFactor}`);
        console.log(`Final Equity:     ₹${parseFloat(results.finalEquity).toLocaleString()}`);
        if (results.avgConfidence != null) {
            console.log(`Avg Confidence:   ${results.avgConfidence}`);
            console.log(`Exit Mix:         ${results.targetExits} targets / ${results.stopExits} stops`);
        }
        console.log('='.repeat(50));

        if (results.trades && results.trades.length > 0) {
            console.log('\n📋 Last 5 Trades:');
            results.trades.slice(-5).forEach(trade => {
                const type = trade.pnl > 0 ? '✅ WIN' : '❌ LOSS';
                const conf = trade.confidence != null ? ` | Conf: ${trade.confidence}` : '';
                const exit = trade.exitReason ? ` | ${trade.exitReason}` : '';
                console.log(`   ${type} | Entry: ${trade.entryPrice} | Exit: ${trade.exitPrice} | PnL: ${trade.pnl.toFixed(2)}%${conf}${exit}`);
            });
        }
    }
}

// CLI Interface
if (require.main === module) {
    const backtester = new StrategyBacktester({ dataDir: './candles_data' });
    
    const args = process.argv.slice(2);
    const command = args[0];
    
    async function main() {
        switch(command) {
            case 'run-all':
                const instrumentKey = args[1] || 'MCX_FO|487465';
                const capital = parseFloat(args[4]) || 100000;
                for (const candleType of ['volume', 'price']) {
                    for (const [strategyName] of Object.entries(backtester.strategies)) {
                        console.log(`\nRunning strategy: ${strategyName} with candle type: ${candleType}`);
                        await backtester.runCompleteAnalysis({
                            instrumentKey: instrumentKey,
                            candleType: candleType,
                            strategyName: strategyName,
                            initialCapital: capital
                        });
                    }
                }
                break;
            case 'run':
                await backtester.runCompleteAnalysis({
                    instrumentKey: args[1] || 'MCX_FO|487465',
                    candleType: args[2] || 'volume',
                    strategyName: args[3] || 'smaCrossover',
                    initialCapital: parseFloat(args[4]) || 100000
                });
                break;
                
            case 'compare':
                const instruments = args[1] ? args[1].split(',') : ['MCX_FO|487465', 'NSE_FO|45450'];
                await backtester.compareStrategies(instruments, args[2] || 'volume');
                break;
                
            case 'list':
                console.log('\n📋 Available Strategies:');
                Object.keys(backtester.strategies).forEach(s => console.log(`   - ${s}`));
                console.log('\n📋 Available Candle Types: volume, price, minute');
                break;
                
            default:
                console.log(`
📊 Strategy Backtester CLI
Usage:
  node backtester.js run <instrument> <candleType> <strategy> <capital>
  node backtester.js compare <instruments> <candleType>
  node backtester.js list

Examples:
  node backtester.js run MCX_FO|504265 volume twoLeggedPullback 100000
  node backtester.js compare MCX_FO|504265,NSE_FO|62329 volume
  node backtester.js list
                `);
        }
    }
    
    main().catch(console.error);
}

module.exports = StrategyBacktester;