// sync_instruments.js - Automatic master contract token key resolver for Upstox June contracts

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib'); // Import zlib for gzip decompression

// --- Configuration ---
const TARGET_EXPIRY_MONTH = 'JUN';
const TARGET_EXPIRY_YEAR = '26'; // 2026
const TARGET_EXPIRY_DATE = '2026-06-25'; // Specific date for comparison
const MCX_EXPIRY_PATTERN = '2026-06';

// Default thresholds for continuous price action candles and volume bars
const DEFAULT_THRESHOLDS = {
    // Indices (June Expiries)
    "NIFTY": { name: "Nifty 50 Future", volumePerBar: 5700, priceBarTicks: 8 },
    "BANKNIFTY": { name: "Nifty Bank Future", volumePerBar: 2600, priceBarTicks: 7 },
    "FINNIFTY": { name: "Fin Nifty Future", volumePerBar: 1800, priceBarTicks: 6 },
    "MIDCPNIFTY": { name: "Midcap Nifty Future", volumePerBar: 1400, priceBarTicks: 6 },

    // Top Liquid Stocks (June Expiries) - Adjusted Thresholds based on typical F&O Frequencies
    "RELIANCE": { name: "Reliance Future", volumePerBar: 12500, priceBarTicks: 7 },
    "HDFCBANK": { name: "HDFC Bank Future", volumePerBar: 27500, priceBarTicks: 8 },
    "ICICIBANK": { name: "ICICI Bank Future", volumePerBar: 18000, priceBarTicks: 7 },
    "SBIN": { name: "SBI Future", volumePerBar: 45000, priceBarTicks: 7 },
    "TCS": { name: "TCS Future", volumePerBar: 4500, priceBarTicks: 8 },
    "INFY": { name: "Infosys Future", volumePerBar: 11200, priceBarTicks: 8 },
    "ITC": { name: "ITC Future", volumePerBar: 32000, priceBarTicks: 6 },
    "BHARTIARTL": { name: "Bharti Airtel Future", volumePerBar: 14000, priceBarTicks: 7 },
    "AXISBANK": { name: "Axis Bank Future", volumePerBar: 16000, priceBarTicks: 7 },
    "LT": { name: "L&T Future", volumePerBar: 6200, priceBarTicks: 8 },
    "TATASTEEL": { name: "Tata Steel Future", volumePerBar: 65000, priceBarTicks: 6 },
    "TATAMOTORS": { name: "Tata Motors Future", volumePerBar: 35000, priceBarTicks: 7 },
    "BAJFINANCE": { name: "Bajaj Finance Future", volumePerBar: 4800, priceBarTicks: 8 },
    "KOTAKBANK": { name: "Kotak Bank Future", volumePerBar: 11000, priceBarTicks: 7 },
    "SUNPHARMA": { name: "Sun Pharma Future", volumePerBar: 10500, priceBarTicks: 7 },
    "JSWSTEEL": { name: "JSW Steel Future", volumePerBar: 13500, priceBarTicks: 7 },
    "COALINDIA": { name: "Coal India Future", volumePerBar: 28000, priceBarTicks: 6 },
    "ADANIENT": { name: "Adani Enterprises Future", volumePerBar: 12000, priceBarTicks: 8 },
    "ADANIPORTS": { name: "Adani Ports Future", volumePerBar: 15000, priceBarTicks: 7 },
    "HINDALCO": { name: "Hindalco Future", volumePerBar: 24000, priceBarTicks: 7 },
    "APOLLOHOSP": { name: "Apollo Hospitals Future", volumePerBar: 3500, priceBarTicks: 8 },

    // MCX Commodities (Scaled for active continuous lot-based volumes)
    "NATURALGAS": { name: "Natural Gas Future", volumePerBar: 27000, priceBarTicks: 7 },
    "CRUDEOIL": { name: "Crude Oil Future", volumePerBar: 32000, priceBarTicks: 8 },
    "GOLD": { name: "Gold Future", volumePerBar: 1200, priceBarTicks: 6 },
    "SILVER": { name: "Silver Future", volumePerBar: 6000, priceBarTicks: 6 },
    "COPPER": { name: "Copper Future", volumePerBar: 25000, priceBarTicks: 7 },

    // Additional high-traffic NSE stocks not covered above
    "HDFCLIFE": { name: "HDFC Life Future", volumePerBar: 8000, priceBarTicks: 7 },
    "MARUTI": { name: "Maruti Suzuki Future", volumePerBar: 3500, priceBarTicks: 8 },
    "HCLTECH": { name: "HCL Tech Future", volumePerBar: 5500, priceBarTicks: 8 },
    "TECHM": { name: "Tech Mahindra Future", volumePerBar: 3800, priceBarTicks: 7 },
    "ONGC": { name: "ONGC Future", volumePerBar: 21000, priceBarTicks: 7 }
};

// Minimum average traded volume to consider an instrument "active"
const MIN_AVERAGE_VOLUME_THRESHOLD = 100000; // Adjust as needed based on market conditions

const INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.csv.gz';
const CONFIG_OUTPUT_PATH = path.join(__dirname, 'build-version-config.json');

async function downloadAndResolve() {
    console.log('📡 Downloading master instrument file from Upstox...');
    
    let response;
    try {
        response = await axios({
            url: INSTRUMENTS_URL,
            method: 'GET',
            responseType: 'stream'
        });
    } catch (err) {
        console.error('❌ Failed to fetch Upstox instrument repository:', err.message);
        return;
    }

    const unzip = require('zlib').createGunzip();
    const instStream = response.data.pipe(unzip);
    const rl = readline.createInterface({ input: instStream, crlfDelay: Infinity });

    let headers = [];
    let foundInstruments = new Map(); // Use a Map to handle duplicates and prioritize futures
    let isFirstLine = true;

    console.log(`🔍 Filtering instruments for high traffic June ${TARGET_EXPIRY_YEAR} monthly contracts...`);

    for await (const line of rl) {
        if (isFirstLine) {
            headers = line.split(',');
            isFirstLine = false;
            continue;
        }

        const cols = line.split(',');
        if (cols.length < headers.length) continue;

        const row = {};
        headers.forEach((h, idx) => {
            row[h.trim()] = cols[idx] ? cols[idx].trim() : '';
        });

        const segment = row.exchange;
        const instrumentType = row.instrument_type;
        const tradingSymbol = row.tradingsymbol || '';
        const expiry = row.expiry || '';
        const instrumentKey = row.instrument_key;
        const avgTradedVolume = parseInt(row.average_traded_volume || '0');

        let baseSymbol = null;
        let isFuture = false;

        if (segment === 'NSE_FO' && (instrumentType === 'FUTSTK' || instrumentType === 'FUTIDX')) {
            const match = tradingSymbol.match(/^([A-Z-&]+)\d{2}[A-Z]{3}FUT$/);
            if (match) {
                baseSymbol = match[1];
                if (expiry === TARGET_EXPIRY_DATE && baseSymbol in SYMBOL_THRESHOLDS) {
                    isFuture = true;
                }
            }
        } else if (segment === 'MCX_FO' && instrumentType === 'FUTCOM') {
            const match = tradingSymbol.match(/^([A-Z]+)\d{2}[A-Z]{3}FUT$/);
            if (match) {
                baseSymbol = match[1];
                if (expiry.startsWith(MCX_EXPIRY_PATTERN) && baseSymbol in SYMBOL_THRESHOLDS) {
                    isFuture = true;
                }
            }
        } else if (segment === 'NSE_EQ' && tradingSymbol in SYMBOL_THRESHOLDS) {
             // Check if it's a stock and not already covered by a future
            baseSymbol = tradingSymbol;
            if (baseSymbol in SYMBOL_THRESHOLDS && !foundInstruments.has(baseSymbol) && instrumentType === 'EQ') {
                 // It's a stock, and we haven't found its future yet.
                 // We'll add it for now but prioritize futures if found later.
            }
        }

        if (baseSymbol && isFuture && avgTradedVolume > MIN_AVERAGE_VOLUME_THRESHOLD) {
            const setup = SYMBOL_THRESHOLDS[baseSymbol];
            // Prioritize futures: if we already have a stock entry, replace it with the future
            if (!foundInstruments.has(baseSymbol) || foundInstruments.get(baseSymbol).exchange !== 'NSE_EQ') {
                foundInstruments.set(baseSymbol, {
                    key: instrumentKey,
                    name: setup.name,
                    priceBarTicks: setup.priceBarTicks,
                    volumePerBar: setup.volumePerBar,
                    exchange: segment,
                    notes: `June ${instrumentType === 'FUTSTK' || instrumentType === 'FUTIDX' ? 'Future' : 'Commodity'}. Expiry: ${expiry}. Avg Volume: ${avgTradedVolume}`
                });
            }
        } else if (baseSymbol && !isFuture && baseSymbol in SYMBOL_THRESHOLDS && avgTradedVolume > MIN_AVERAGE_VOLUME_THRESHOLD) {
             // Add stock if it's active and we don't already have its future
            if (!foundInstruments.has(baseSymbol)) {
                const setup = SYMBOL_THRESHOLDS[baseSymbol];
                foundInstruments.set(baseSymbol, {
                    key: instrumentKey,
                    name: setup.name,
                    priceBarTicks: setup.priceBarTicks,
                    volumePerBar: setup.volumePerBar,
                    exchange: segment,
                    notes: `Stock - Avg Volume: ${avgTradedVolume}`
                });
            }
        }
    }

    const finalConfigInstruments = Array.from(foundInstruments.values());

    // Ensure the final count doesn't exceed 25, prioritizing futures and higher volume
    const sortedInstruments = finalConfigInstruments.sort((a, b) => {
        const volA = SYMBOL_THRESHOLDS[a.key.split('|')[1]]?.volumePerBar || 0;
        const volB = SYMBOL_THRESHOLDS[b.key.split('|')[1]]?.volumePerBar || 0;
        return volB - volA; // Sort by volume descending
    });

    const finalSelection = sortedInstruments.slice(0, 25);

    const outConfig = {
        instruments: finalSelection,
        directories: {
            rawDataDir: "./raw_ticks_data",
            candlesDataDir: "./candles_data"
        }
    };

    fs.writeFileSync(CONFIG_OUTPUT_PATH, JSON.stringify(outConfig, null, 4), 'utf8');

    console.log(`\n🎉 Completed contract resolution!`);
    console.log(`✅ Saved ${finalSelection.length} high-traffic instruments to ${CONFIG_OUTPUT_PATH}`);
    console.log(`   (Targeted June Expiry, Min Volume: ${MIN_AVERAGE_VOLUME_THRESHOLD.toLocaleString()}, Max Instruments: 25)`);
}

downloadAndResolve().catch(console.error);