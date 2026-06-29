// backtester.js - Standalone strategy backtesting system
const fs = require('fs');
const path = require('path');
const { STRATEGIES, runPriceActionBacktest, DEFAULT_PARAMS } = require('./priceActionStrategy');

const versionRegex = /^V([1-9]|[1-3]\d|4[0-3]):/;

class StrategyBacktester {
    constructor(config) {
        this.dataDir = config?.dataDir || './candles_data';
        this.versionResultsDir = './version-backtest-results';
        this.resultsDir = './backtest_results';
        
        if (!fs.existsSync(this.resultsDir)) {
            fs.mkdirSync(this.resultsDir, { recursive: true });
        }
        if (!fs.existsSync(this.versionResultsDir)) {
            fs.mkdirSync(this.versionResultsDir, { recursive: true });
        }

        // Merge class field strategies and dynamically enroll price action versions
        this.strategies = { ...this.strategies };
        if (STRATEGIES) {
            delete this.strategies.twoLeggedPullback; // Remove generic placeholder
            for (const [versionName, strategyFn] of Object.entries(STRATEGIES)) {
                this.strategies[versionName] = strategyFn;
            }
        }
    }
    
    // Load candle data from CSV (original method unchanged)
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
        
        return this._loadCandlesFromCSV(filepath);
    }
    
    // load candles from CSV (original method unchanged)
    async _loadCandlesFromCSV(filepath) {
        const candles = [];
        const content = fs.readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        if (lines.length < 2) return candles;
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
    
    // ======================== VERSIONED CANDLES SUPPORT ========================
    
    findVersionCandleFiles(rootDir = './candles') {
        const files = [];
        if (!fs.existsSync(rootDir)) return files;
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(rootDir, entry.name);
            if (entry.isDirectory()) {
                files.push(...this.findVersionCandleFiles(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('_candles.csv')) {
                files.push(fullPath);
            }
        }
        return files;
    }
    
    parseVersionCandlePath(filePath) {
        const parts = filePath.split(path.sep);
        if (parts.length < 3) return null;
        const thresholdStr = parts[parts.length - 2];
        const instrumentSafe = parts[parts.length - 3];
        const threshold = parseInt(thresholdStr, 10);
        if (isNaN(threshold)) return null;
        const baseName = path.basename(filePath, '_candles.csv');
        return {
            instrumentSafe,
            threshold,
            baseName,
            fullPath: filePath
        };
    }
    
    /**
     * Run all strategies on a single versioned candle file.
     * Aggregates average win rate, returns, and RRR metrics at the root.
     */
    async runBacktestOnVersionFile(filePath, options = {}) {
        const { initialCapital = 100000, tradeSize = 0.01, allowOverlappingTrades = false } = options;
        const meta = this.parseVersionCandlePath(filePath);
        if (!meta) {
            console.error(`Could not parse path: ${filePath}`);
            return null;
        }
        const candles = await this._loadCandlesFromCSV(filePath);
        if (candles.length === 0) return null;
        
        const resultsByStrategy = {};
        
        let totalWinRate = 0;
        let totalReturn = 0;
        let totalRRR = 0;
        let pActionStratCount = 0;

        for (const [strategyName, strategy] of Object.entries(this.strategies)) {
            const signals = strategy(candles);
            const results = this.runBacktest(candles, signals, initialCapital, {
                maxRiskPerTrade: tradeSize,
                allowOverlappingTrades: allowOverlappingTrades
            });
            
            resultsByStrategy[strategyName] = {
                signalCount: signals.length,
                results
            };

            // Calculate aggregations specifically for price action strategies
            if (strategyName.startsWith("V")) {
                totalWinRate += parseFloat(results.winRate) || 0;
                totalReturn += parseFloat(results.totalReturn) || 0;
                totalRRR += parseFloat(results.avgRRR) || 1.50;
                pActionStratCount++;
            }
        }
        
        // Compute aggregated metrics for each instrument/version file
        const averages = {
            avgWinRate: pActionStratCount > 0 ? parseFloat((totalWinRate / pActionStratCount).toFixed(2)) : 0,
            avgReturnPct: pActionStratCount > 0 ? parseFloat((totalReturn / pActionStratCount).toFixed(2)) : 0,
            avgRRR: pActionStratCount > 0 ? parseFloat((totalRRR / pActionStratCount).toFixed(2)) : 1.50
        };
        
        // Save aggregated results for this file
        const outFileName = `${meta.instrumentSafe}_${meta.threshold}_${meta.baseName}.json`;
        const outPath = path.join(this.versionResultsDir, outFileName);
        
        fs.writeFileSync(outPath, JSON.stringify({
            instrument: meta.instrumentSafe,
            threshold: meta.threshold,
            sourceFile: meta.baseName,
            candlesCount: candles.length,
            strategies: resultsByStrategy,
            averages: averages, 
            timestamp: Date.now()
        }, null, 2));
        
        return { meta, resultsByStrategy, averages };
    }
    
    async runAllVersions(initialCapital = 100000, tradeSize = 0.01, allowOverlappingTrades = false) {
        const files = this.findVersionCandleFiles('./candles');
        console.log(`\n📂 Found ${files.length} versioned candle files under ./candles`);
        if (files.length === 0) return;
        
        for (const filePath of files) {
            const meta = this.parseVersionCandlePath(filePath);
            if (!meta) continue;
            console.log(`\n📄 Processing: ${meta.instrumentSafe} | threshold ${meta.threshold} | ${meta.baseName}`);
            await this.runBacktestOnVersionFile(filePath, { initialCapital, tradeSize, allowOverlappingTrades });
        }
        console.log(`\n✅ All version backtest results saved to ${this.versionResultsDir}`);
    }
    
    compareVersions() {
        if (!fs.existsSync(this.versionResultsDir)) {
            console.log('No version results found. Run `run-all-versions` first.');
            return;
        }
        const resultFiles = fs.readdirSync(this.versionResultsDir).filter(f => f.endsWith('.json'));
        if (resultFiles.length === 0) {
            console.log('No version results found.');
            return;
        }
        
        const allResults = [];
        for (const file of resultFiles) {
            const data = JSON.parse(fs.readFileSync(path.join(this.versionResultsDir, file), 'utf8'));
            for (const [strategy, stratData] of Object.entries(data.strategies)) {
                allResults.push({
                    instrument: data.instrument,
                    threshold: data.threshold,
                    source: data.sourceFile,
                    strategy: strategy,
                    trades: stratData.results.totalTrades,
                    winRate: stratData.results.winRate,
                    returnPct: stratData.results.totalReturn,
                    sharpe: stratData.results.sharpeRatio,
                    maxDD: stratData.results.maxDrawdown,
                    avgRRR: stratData.results.avgRRR || 1.50
                });
            }
        }
        
        console.log('\n📊 VERSION BACKTEST COMPARISON');
        console.table(allResults);
        return allResults;
    }
    
    // ======================== END VERSIONED CANDLES SUPPORT ========================
    
    strategies = {
        smaCrossover: (candles, params = {fast: 9, slow: 21 }) => {
            const signals = [];
            const fastSMA = new Map(this.calculateSMA(candles, params.fast).map(item => [item.index, item.value]));
            const slowSMA = new Map(this.calculateSMA(candles, params.slow).map(item => [item.index, item.value]));
            
            for (let i = 1; i < candles.length; i++) {
                const currentFast = fastSMA.get(i);
                const currentSlow = slowSMA.get(i);
                const prevFast = fastSMA.get(i - 1);
                const prevSlow = slowSMA.get(i - 1);
                
                if (currentFast === undefined || currentSlow === undefined || prevFast === undefined || prevSlow === undefined) {
                    continue;
                }
                
                if (currentFast > currentSlow && prevFast <= prevSlow) {
                    signals.push({ index: i, type: 'BUY', price: candles[i].close });
                } else if (currentFast < currentSlow && prevFast >= prevSlow) {
                    signals.push({ index: i, type: 'SELL', price: candles[i].close });
                }
            }
            return signals;
        },
        smaCrossoverReverse: (candles, params = {fast: 9, slow: 21 }) => {
            const signals = [];
            const fastSMA = new Map(this.calculateSMA(candles, params.fast).map(item => [item.index, item.value]));
            const slowSMA = new Map(this.calculateSMA(candles, params.slow).map(item => [item.index, item.value]));
            
            for (let i = 1; i < candles.length; i++) {
                const currentFast = fastSMA.get(i);
                const currentSlow = slowSMA.get(i);
                const prevFast = fastSMA.get(i - 1);
                const prevSlow = slowSMA.get(i - 1);
                
                if (currentFast === undefined || currentSlow === undefined || prevFast === undefined || prevSlow === undefined) {
                    continue;
                }
                
                if (currentFast > currentSlow && prevFast <= prevSlow) {
                    signals.push({ index: i, type: 'SELL', price: candles[i].close });
                } else if (currentFast < currentSlow && prevFast >= prevSlow) {
                    signals.push({ index: i, type: 'BUY', price: candles[i].close });
                }
            }
            return signals;
        },
        rsiMeanReversion: (candles, params = { period: 14, oversold: 30, overbought: 70 }) => {
            const signals = [];
            const rsi = new Map(this.calculateRSI(candles, params.period).map(item => [item.index, item.value]));
            
            for (let i = 1; i < candles.length; i++) {
                const currentRSI = rsi.get(i);
                const prevRSI = rsi.get(i - 1);
                
                if (currentRSI === undefined || prevRSI === undefined) {
                    continue;
                }
                
                if (currentRSI < params.oversold && prevRSI >= params.oversold) {
                    signals.push({ index: i, type: 'BUY', price: candles[i].close, timestamp: candles[i].timestamp });
                } else if (currentRSI > params.overbought && prevRSI <= params.overbought) {
                    signals.push({ index: i, type: 'SELL', price: candles[i].close, timestamp: candles[i].timestamp });
                }
            }
            return signals;
        },
        bollingerBreakout: (candles, params = { period: 20, stdDev: 2 }) => {
            const signals = [];
            const bb = this.calculateBollingerBands(candles, params.period, params.stdDev);
            const upperMap = new Map(bb.upper.map(item => [item.index, item.value]));
            const lowerMap = new Map(bb.lower.map(item => [item.index, item.value]));
            
            for (let i = 1; i < candles.length; i++) {
                const currentUpper = upperMap.get(i);
                const currentLower = lowerMap.get(i);
                const prevUpper = upperMap.get(i - 1);
                const prevLower = lowerMap.get(i - 1);
                
                if (currentUpper === undefined || currentLower === undefined) {
                    continue;
                }
                
                if (candles[i].close > currentUpper && (prevUpper === undefined || candles[i-1].close <= prevUpper)) {
                    signals.push({ index: i, type: 'BUY', price: candles[i].close });
                } else if (candles[i].close < currentLower && (prevLower === undefined || candles[i-1].close >= prevLower)) {
                    signals.push({ index: i, type: 'SELL', price: candles[i].close });
                }
            }
            return signals;
        },
        volumeSpike: (candles, params = { multiplier: 2, period: 20 }) => {
            const signals = [];
            const avgVolume = new Map(this.calculateSMA(candles.map(c => ({ value: c.volume })), params.period).map(item => [item.index, item.value]));
            
            for (let i = 1; i < candles.length; i++) {
                const prevAvgVol = avgVolume.get(i - 1); 
                
                if (prevAvgVol === undefined) {
                    continue;
                }
                
                if (candles[i].volume > prevAvgVol * params.multiplier) {
                    const direction = candles[i].close > candles[i].open ? 'BUY' : 'SELL';
                    signals.push({ index: i, type: direction, price: candles[i].close });
                }
            }
            return signals;
        },
        twoLeggedPullback: (candles, params = {}) => {
            return STRATEGIES["V1: Double Traps"](candles, { ...DEFAULT_PARAMS, ...params });
        }
    };
    
    calculateSMA(data, period, field = 'close') {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + (b[field] || b.value), 0);
            result.push({ index: i, value: sum / period });
        }
        return result;
    }
    
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
                
                let rsi = 50; 
                if (avgLoss > 0) {
                    const rs = avgGain / avgLoss;
                    rsi = 100 - (100 / (1 + rs));
                } else if (avgGain > 0) {
                    rsi = 100;
                }
                
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
            upper.push({ index: i, value: mean + (stdDev * std) });
            lower.push({ index: i, value: mean - (stdDev * std) });
        }
        return { upper, lower };
    }
    
    usesPriceActionExits(signals) {
        return signals.length > 0 && signals.some(s => s.stopLoss != null && s.takeProfit != null);
    }
    
    runBacktest(candles, signals, initialCapital = 100000, tradeSizeOrParams = 0.65) {
        if (this.usesPriceActionExits(signals)) {
            const runParams = typeof tradeSizeOrParams === 'object' 
                ? tradeSizeOrParams 
                : { maxRiskPerTrade: tradeSizeOrParams };

            const { trades, finalEquity } = runPriceActionBacktest(candles, signals, initialCapital, runParams);
            return this.calculateMetrics(trades, initialCapital, finalEquity);
        }
        
        let equity = initialCapital;
        let position = null;
        const trades = [];
        const tradeSize = typeof tradeSizeOrParams === 'object' ? (tradeSizeOrParams.maxRiskPerTrade || 0.65) : tradeSizeOrParams;

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
        const winningTrades = trades.filter(t => t.pnlAmount > 0);
        const losingTrades = trades.filter(t => t.pnlAmount <= 0);
        const totalPnl = finalEquity - initialCapital;
        const returns = trades.map(t => t.pnlPercentage || t.pnl || 0);
        const avgReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const variance = returns.length ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
        const sharpe = Math.sqrt(variance) === 0 ? 0 : (avgReturn / Math.sqrt(variance)).toFixed(2);
        
        let peak = initialCapital;
        let maxDrawdown = 0;
        let runningEquity = initialCapital;
        for (const trade of trades) {
            runningEquity += trade.pnlAmount;
            if (runningEquity > peak) peak = runningEquity;
            const drawdown = (peak - runningEquity) / peak * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }

        // Structural RRR extraction algorithm
        let totalRRR = 0;
        let rrrCount = 0;
        for (const trade of trades) {
            if (trade.stopLoss != null && trade.takeProfit != null && trade.entryPrice != null) {
                const risk = Math.abs(trade.entryPrice - trade.stopLoss);
                const reward = Math.abs(trade.takeProfit - trade.entryPrice);
                if (risk > 0) {
                    totalRRR += (reward / risk);
                    rrrCount++;
                }
            }
        }
        const avgRRR = rrrCount > 0 ? parseFloat((totalRRR / rrrCount).toFixed(2)) : 1.50;

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
            avgWin: winningTrades.length ? (winningTrades.reduce((s, t) => s + (t.pnlPercentage || t.pnl || 0), 0) / winningTrades.length).toFixed(2) : 0,
            avgLoss: losingTrades.length ? (losingTrades.reduce((s, t) => s + (t.pnlPercentage || t.pnl || 0), 0) / losingTrades.length).toFixed(2) : 0,
            largestWin: winningTrades.length ? Math.max(...winningTrades.map(t => t.pnlPercentage || t.pnl || 0)).toFixed(2) : 0,
            largestLoss: losingTrades.length ? Math.min(...losingTrades.map(t => t.pnlPercentage || t.pnl || 0)).toFixed(2) : 0,
            sharpeRatio: sharpe,
            maxDrawdown: maxDrawdown.toFixed(2),
            profitFactor: (Math.abs(winningTrades.reduce((s, t) => s + (t.pnlPercentage || t.pnl || 0), 0)) /
                          Math.abs(losingTrades.reduce((s, t) => s + (t.pnlPercentage || t.pnl || 0), 0)) || 0).toFixed(2),
            avgConfidence,
            stopExits,
            targetExits,
            avgRRR, 
            trades: trades
        };
    }
    
    async runCompleteAnalysis(options) {
        const {
            instrumentKey,
            candleType = 'volume',
            strategyName = 'smaCrossover',
            strategyParams = {},
            initialCapital = 100000,
            tradeSize = 0.01,
            allowOverlappingTrades = false
        } = options;
        
        console.log(`\n📊 Running Backtest Analysis`);
        console.log(`   Instrument: ${instrumentKey}`);
        console.log(`   Candle Type: ${candleType}`);
        console.log(`   Strategy: ${strategyName}`);
        console.log(`   Overlapping Trades: ${allowOverlappingTrades ? 'Enabled' : 'Disabled'}`);
        console.log(`   Period: Full historical\n`);
        
        const candles = await this.loadCandleData(instrumentKey, candleType);
        if (candles.length === 0) {
            console.error('No data loaded');
            return null;
        }
        console.log(`   Loaded ${candles.length} candles`);
        
        const strategy = this.strategies[strategyName];
        if (!strategy) {
            console.error(`Strategy ${strategyName} not found`);
            return null;
        }
        const signals = Object.keys(strategyParams).length === 0 ? strategy(candles) : strategy(candles, strategyParams);
        console.log(`   Generated ${signals.length} signals`);
        if (signals.length && signals[0].confidence != null) {
            const avgConf = signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length;
            console.log(`   Avg confidence: ${avgConf.toFixed(1)} | Range: ${Math.min(...signals.map(s => s.confidence))}-${Math.max(...signals.map(s => s.confidence))}`);
        }
        
        const results = this.runBacktest(candles, signals, initialCapital, {
            maxRiskPerTrade: tradeSize,
            allowOverlappingTrades: allowOverlappingTrades
        });
        
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
                console.log(`   ${type} | Entry: ${trade.entryPrice} | Exit: ${trade.exitPrice} | PnL: ${trade.pnlPercentage.toFixed(2)}%${conf}${exit}`);
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
            case 'run-all-versions':
                const capital = parseFloat(args[1]) || 100000;
                const size = parseFloat(args[2]) || 0.01;
                const allowOverlap = args[3] === 'true';
                await backtester.runAllVersions(capital, size, allowOverlap);
                break;
            case 'compare-versions':
                backtester.compareVersions();
                break;
            case 'run-all':
                const instrumentKey = args[1] || 'MCX_FO|487465';
                const cap = parseFloat(args[4]) || 100000;
                for (const candleType of ['volume', 'price']) {
                    for (const [strategyName] of Object.entries(backtester.strategies)) {
                        console.log(`\nRunning strategy: ${strategyName} with candle type: ${candleType}`);
                        await backtester.runCompleteAnalysis({
                            instrumentKey: instrumentKey,
                            candleType: candleType,
                            strategyName: strategyName,
                            initialCapital: cap
                        });
                    }
                }
                break;
            case 'run':
                await backtester.runCompleteAnalysis({
                    instrumentKey: args[1] || 'MCX_FO|487465',
                    candleType: args[2] || 'volume',
                    strategyName: args[3] || 'twoLeggedPullback',
                    initialCapital: parseFloat(args[4]) || 100000,
                    tradeSize: parseFloat(args[5]) || 0.01,
                    allowOverlappingTrades: args[6] === 'true'
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
          node backtester.js run-all-versions [capital] [riskSize] [allowOverlapping]
          node backtester.js compare-versions
          node backtester.js run <instrument> <candleType> <strategy> <capital> <riskSize> [allowOverlapping]
          node backtester.js run-all <instrument> <capital>
          node backtester.js compare <instruments> <candleType>
          node backtester.js list

        Examples:
          node backtester.js run-all-versions 100000 0.01 false
          node backtester.js run-all-versions 100000 0.01 true
          node backtester.js compare-versions
          node backtester.js run MCX_FO|504265 volume twoLeggedPullback 100000 0.01 true
          node backtester.js run MCX_FO|504265 volume twoLeggedPullback 100000 0.01 false
          node backtester.js run-all MCX_FO|504265 100000
          node backtester.js compare MCX_FO|504265,NSE_FO|62329 volume
          node backtester.js list
                `);
        }
    }
    
    main().catch(console.error);
}

module.exports = StrategyBacktester;
