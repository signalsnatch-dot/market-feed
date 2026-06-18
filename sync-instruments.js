// sync_instruments.js - Automatic master contract token key resolver for Upstox June contracts

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Defined targets for high-volume derivative symbols and default continuous price action thresholds
const SYMBOL_THRESHOLDS = {
    // Indices (June Expiries)
    "NIFTY": { name: "Nifty 50 Future", volumePerBar: 5700, priceBarTicks: 8, exchange: "NSE_FO" },
    "BANKNIFTY": { name: "Nifty Bank Future", volumePerBar: 2600, priceBarTicks: 7, exchange: "NSE_FO" },
    "FINNIFTY": { name: "Fin Nifty Future", volumePerBar: 1800, priceBarTicks: 6, exchange: "NSE_FO" },
    "MIDCPNIFTY": { name: "Midcap Nifty Future", volumePerBar: 1400, priceBarTicks: 6, exchange: "NSE_FO" },

    // Stock Futures (Lot sizes and volume thresholds scaled for Indian F&O liquid names)
    "RELIANCE": { name: "Reliance Future", volumePerBar: 12500, priceBarTicks: 7, exchange: "NSE_FO" },
    "HDFCBANK": { name: "HDFC Bank Future", volumePerBar: 27500, priceBarTicks: 8, exchange: "NSE_FO" },
    "ICICIBANK": { name: "ICICI Bank Future", volumePerBar: 18000, priceBarTicks: 7, exchange: "NSE_FO" },
    "SBIN": { name: "SBI Future", volumePerBar: 45000, priceBarTicks: 7, exchange: "NSE_FO" },
    "TCS": { name: "TCS Future", volumePerBar: 4500, priceBarTicks: 8, exchange: "NSE_FO" },
    "INFY": { name: "Infosys Future", volumePerBar: 11200, priceBarTicks: 8, exchange: "NSE_FO" },
    "ITC": { name: "ITC Future", volumePerBar: 32000, priceBarTicks: 6, exchange: "NSE_FO" },
    "BHARTIARTL": { name: "Bharti Airtel Future", volumePerBar: 14000, priceBarTicks: 7, exchange: "NSE_FO" },
    "AXISBANK": { name: "Axis Bank Future", volumePerBar: 16000, priceBarTicks: 7, exchange: "NSE_FO" },
    "LT": { name: "L&T Future", volumePerBar: 6200, priceBarTicks: 8, exchange: "NSE_FO" },
    "TATASTEEL": { name: "Tata Steel Future", volumePerBar: 65000, priceBarTicks: 6, exchange: "NSE_FO" },
    "TATAMOTORS": { name: "Tata Motors Future", volumePerBar: 35000, priceBarTicks: 7, exchange: "NSE_FO" },
    "BAJFINANCE": { name: "Bajaj Finance Future", volumePerBar: 4800, priceBarTicks: 8, exchange: "NSE_FO" },
    "KOTAKBANK": { name: "Kotak Bank Future", volumePerBar: 11000, priceBarTicks: 7, exchange: "NSE_FO" },
    "SUNPHARMA": { name: "Sun Pharma Future", volumePerBar: 10500, priceBarTicks: 7, exchange: "NSE_FO" },
    "JSWSTEEL": { name: "JSW Steel Future", volumePerBar: 13500, priceBarTicks: 7, exchange: "NSE_FO" },
    "COALINDIA": { name: "Coal India Future", volumePerBar: 28000, priceBarTicks: 6, exchange: "NSE_FO" },
    "ADANIENT": { name: "Adani Enterprises Future", volumePerBar: 12000, priceBarTicks: 8, exchange: "NSE_FO" },
    "ADANIPORTS": { name: "Adani Ports Future", volumePerBar: 15000, priceBarTicks: 7, exchange: "NSE_FO" },
    "HINDALCO": { name: "Hindalco Future", volumePerBar: 24000, priceBarTicks: 7, exchange: "NSE_FO" },
    "APOLLOHOSP": { name: "Apollo Hospitals Future", volumePerBar: 3500, priceBarTicks: 8, exchange: "NSE_FO" },

    // MCX Commodities (Scaled for active continuous lot-based volumes)
    "NATURALGAS": { name: "Natural Gas Future", volumePerBar: 27000, priceBarTicks: 7, exchange: "MCX_FO" },
    "CRUDEOIL": { name: "Crude Oil Future", volumePerBar: 32000, priceBarTicks: 8, exchange: "MCX_FO" },
    "GOLD": { name: "Gold Future", volumePerBar: 1200, priceBarTicks: 6, exchange: "MCX_FO" },
    "SILVER": { name: "Silver Future", volumePerBar: 6000, priceBarTicks: 6, exchange: "MCX_FO" },
    "COPPER": { name: "Copper Future", volumePerBar: 25000, priceBarTicks: 7, exchange: "MCX_FO" }
};

const INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.csv.gz';

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
    let resolvedInstruments = [];
    let isFirstLine = true;

    // We target June 2026 Monthly Expiry
    const targetExpiry = '2026-06-25'; 
    const mcxExpiryPattern = '2026-06';

    console.log('🔍 Matching June 2026 monthly future contracts...');

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

        const segment = row.exchange; // e.g., NSE_FO or MCX_FO
        const instrumentType = row.instrument_type; // e.g. FUTSTK or FUTIDX
        const tradingSymbol = row.tradingsymbol || '';
        const expiry = row.expiry || '';

        if (segment === 'NSE_FO' && (instrumentType === 'FUTSTK' || instrumentType === 'FUTIDX')) {
            // Find base symbol (e.g., RELIANCE from RELIANCE26JUNFUT)
            const match = tradingSymbol.match(/^([A-Z-&]+)\d{2}[A-Z]{3}FUT$/);
            if (match) {
                const baseSymbol = match[1];
                if (SYMBOL_THRESHOLDS[baseSymbol] && expiry === targetExpiry) {
                    const setup = SYMBOL_THRESHOLDS[baseSymbol];
                    resolvedInstruments.push({
                        key: row.instrument_key,
                        name: setup.name,
                        priceBarTicks: setup.priceBarTicks,
                        volumePerBar: setup.volumePerBar,
                        exchange: segment,
                        notes: `Resolved token for June monthly contract. Expiry: ${expiry}. Lot size: ${row.lot_size || 'N/A'}`
                    });
                }
            }
        } else if (segment === 'MCX_FO' && instrumentType === 'FUTCOM') {
            // MCX Commodity Expiries
            const match = tradingSymbol.match(/^([A-Z]+)\d{2}[A-Z]{3}FUT$/);
            if (match) {
                const baseSymbol = match[1];
                if (SYMBOL_THRESHOLDS[baseSymbol] && expiry.startsWith(mcxExpiryPattern)) {
                    const setup = SYMBOL_THRESHOLDS[baseSymbol];
                    resolvedInstruments.push({
                        key: row.instrument_key,
                        name: setup.name,
                        priceBarTicks: setup.priceBarTicks,
                        volumePerBar: setup.volumePerBar,
                        exchange: segment,
                        notes: `MCX June Future. Expiry: ${expiry}. Lot size: ${row.lot_size || 'N/A'}`
                    });
                }
            }
        }
    }

    // Deduplicate any repeated contract listings
    const uniqueMap = new Map();
    resolvedInstruments.forEach(inst => uniqueMap.set(inst.name, inst));
    const finalConfigInstruments = Array.from(uniqueMap.values());

    const outConfig = {
        instruments: finalConfigInstruments,
        directories: {
            rawDataDir: "./raw_ticks_data",
            candlesDataDir: "./candles_data"
        }
    };

    const outPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(outPath, JSON.stringify(outConfig, null, 4), 'utf8');

    console.log(`\n🎉 Completed contract resolution!`);
    console.log(`✅ Saved ${finalConfigInstruments.length} matched June futures to ${outPath}`);
}

downloadAndResolve().catch(console.error);