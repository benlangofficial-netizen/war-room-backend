const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// All 66 tickers
const ALL_TICKERS = [
  "RCAT", "KTOS", "CEG", "OKLO", "PLTR", "QBTS", "AXON", "CRDO", "LDOS", "INOD",
  "VST", "FORM", "IREN", "CCJ", "RBRK", "CDNS", "IONQ", "AVGO", "LMT", "ANET",
  "HII", "ONTO", "PL", "CLS", "AMD", "BWXT", "ONDS", "INTC", "FTAI", "SLV",
  "WDC", "TSM", "STX", "VRT", "TER", "PWR", "DDOG", "USAR", "NNE", "AMZN",
  "HWM", "QCOM", "AAPL", "ORCL", "STRL", "CRWD", "LRCX", "TSLA", "ASTS", "INFQ",
  "ZS", "HUM", "CRWV", "APLD", "MU", "PANW", "BE", "LITE", "GLW", "ARM",
  "RKLB", "MRVL", "COHR", "NVTS", "NBIS", "GOOG"
];

const MACRO_TICKERS = ["SPY", "QQQ", "VOO"];
const FINNHUB_KEY = 'd82ac0hr01qmgc0fa6vgd82ac0hr01qmgc0fa700';

// Cache for market data
let cachedData = null;
let lastFetchTime = 0;
const CACHE_TTL = 300000; // 5 minutes

/**
 * Fetch price from Finnhub
 */
async function fetchFromFinnhub(symbol) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`, {
      timeout: 5000
    });
    const data = await res.json();
    return data?.c || null;
  } catch (e) {
    console.error(`Finnhub failed for ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Fetch all market data
 */
async function fetchAllData() {
  console.log('=== FETCHING MARKET DATA ===');
  
  // Fetch macros
  console.log('Fetching macros...');
  const macros = {};
  for (const ticker of MACRO_TICKERS) {
    const price = await fetchFromFinnhub(ticker);
    macros[ticker] = price;
    console.log(`  ${ticker}: ${price || 'null'}`);
  }
  
  // Fetch Fear & Greed
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await res.json();
    macros['FEAR_GREED'] = parseInt(data.data[0].value);
    console.log(`  FEAR_GREED: ${macros['FEAR_GREED']}`);
  } catch (e) {
    console.error('Fear & Greed fetch failed:', e.message);
    macros['FEAR_GREED'] = null;
  }
  
  // Fetch all tickers sequentially with rate limiting
  console.log(`Fetching ${ALL_TICKERS.length} tickers...`);
  const tickerPrices = {};
  let successCount = 0;
  
  for (let i = 0; i < ALL_TICKERS.length; i++) {
    const ticker = ALL_TICKERS[i];
    const price = await fetchFromFinnhub(ticker);
    tickerPrices[ticker] = price;
    
    if (price !== null) {
      successCount++;
      console.log(`  ✓ ${ticker}: $${price}`);
    } else {
      console.log(`  ✗ ${ticker}: null`);
    }
    
    // Rate limit: add delay between requests
    if ((i + 1) % 10 === 0) {
      console.log(`  (Rate limiting: waiting 500ms after ${i + 1} requests)`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  cachedData = {
    tickers: tickerPrices,
    macros,
    timestamp: Date.now(),
    stats: { 
      cachedSymbols: successCount,
      totalTickers: ALL_TICKERS.length
    }
  };
  
  lastFetchTime = Date.now();
  
  console.log('=== FETCH COMPLETE ===');
  console.log(`Tickers fetched: ${successCount}/${ALL_TICKERS.length}`);
  console.log(`Macros fetched: ${Object.values(macros).filter(v => v !== null).length}/${MACRO_TICKERS.length + 1}`);
  
  return cachedData;
}

/**
 * API endpoint: Get all market data
 */
app.get('/api/market-data', async (req, res) => {
  try {
    // Return cached data if fresh
    if (cachedData && (Date.now() - lastFetchTime) < CACHE_TTL) {
      console.log('Returning cached data');
      return res.json(cachedData);
    }
    
    console.log('Cache expired, fetching new data...');
    const data = await fetchAllData();
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    
    // Return partial cached data if available
    if (cachedData) {
      return res.json(cachedData);
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch data', 
      tickers: {}, 
      macros: {} 
    });
  }
});

/**
 * API endpoint: Get single quote
 */
app.get('/api/quote', async (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ error: 'symbol parameter required' });
    }
    
    const price = await fetchFromFinnhub(symbol.toUpperCase());
    
    if (price === null) {
      return res.status(404).json({ error: 'Failed to fetch price' });
    }
    
    res.json({ symbol: symbol.toUpperCase(), price, source: 'Finnhub' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    cached: cachedData ? true : false,
    lastFetch: lastFetchTime,
    cacheAge: Date.now() - lastFetchTime
  });
});

/**
 * Initialize data on startup
 */
async function startup() {
  console.log('Starting War Room Backend...');
  
  // Fetch initial data
  await fetchAllData();
  
  // Refresh every 5 minutes
  setInterval(fetchAllData, CACHE_TTL);
  
  console.log('Backend ready!');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startup();
});
