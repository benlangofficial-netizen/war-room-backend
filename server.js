const express = require('express');
const cors = require('cors');
const PricingEngine = require('./pricing-engine');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize pricing engine
const pricingEngine = new PricingEngine();

// All tickers
const ALL_TICKERS = [
  "HII", "STRL", "LDOS", "FTAI", "AXON", "PANW", "CEG", "PLTR", "CCJ",
  "KTOS", "BWXT", "CRWD", "VST", "GLW", "TER", "ONTO", "VRT", "NNE",
  "RBRK", "FORM", "ZS", "ANET", "ASTS", "MU", "MRVL", "COHR", "OKLO",
  "INFQ", "SMR", "RCAT", "CRDO", "AAPL", "AMD", "PWR", "LRCX",
  "CRWV", "BE", "TSLA", "RKLB", "INTC", "NVTS", "PL", "HUM", "QCOM",
  "IREN", "DDOG", "USAR", "IONQ", "STX", "QBTS", "WDC", "AVGO", "HWM", "ORCL", "AMZN", "CDNS",
  "APLD", "ARM", "TSM", "NBIS", "CLS", "ONDS", "SLV", "LMT", "INOD"
];

const MACRO_TICKERS = ["SPY", "QQQ", "VOO", "^VIX", "BZ=F"];

// Cache for market data
let cachedData = null;
let lastFetchTime = 0;
const CACHE_TTL = 300000; // 5 minutes

/**
 * Fetch all market data
 */
async function fetchAllData() {
  console.log('=== FETCHING MARKET DATA ===');
  
  // Fetch macros
  console.log('Fetching macros...');
  const macros = {};
  for (const ticker of MACRO_TICKERS) {
    const data = await pricingEngine.fetchPrice(ticker);
    macros[ticker] = data?.price || null;
  }
  
  // Fetch Fear & Greed
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await res.json();
    macros['FEAR_GREED'] = parseInt(data.data[0].value);
  } catch (e) {
    console.error('Fear & Greed fetch failed:', e.message);
    macros['FEAR_GREED'] = null;
  }
  
  // Fetch all tickers in parallel
  console.log('Fetching tickers...');
  const tickers = await pricingEngine.fetchPrices(ALL_TICKERS);
  
  // Convert to simple price map
  const tickerPrices = {};
  for (const [symbol, data] of Object.entries(tickers)) {
    tickerPrices[symbol] = data?.price || null;
  }
  
  cachedData = {
    tickers: tickerPrices,
    macros,
    timestamp: Date.now(),
    stats: pricingEngine.getStats()
  };
  
  lastFetchTime = Date.now();
  
  console.log('=== FETCH COMPLETE ===');
  console.log(`Tickers fetched: ${Object.values(tickerPrices).filter(v => v !== null).length}/${ALL_TICKERS.length}`);
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
 * API endpoint: Get single ticker
 */
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await pricingEngine.fetchPrice(symbol.toUpperCase());
    
    if (!data) {
      return res.status(404).json({ error: 'Ticker not found' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

/**
 * API endpoint: Get multiple tickers
 */
app.post('/api/quotes', async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!Array.isArray(symbols)) {
      return res.status(400).json({ error: 'symbols must be an array' });
    }
    
    const data = await pricingEngine.fetchPrices(symbols);
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    cached: cachedData ? true : false,
    stats: pricingEngine.getStats()
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
