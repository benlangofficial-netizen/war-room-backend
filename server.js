const express = require('express');
const cors = require('cors');
const PricingEngine = require('./pricing-engine');
const QuoteAPI = require('./quote-api');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize pricing engine and quote API
const pricingEngine = new PricingEngine();
const quoteAPI = new QuoteAPI();

// All 66 tickers (65 + GOOG)
const ALL_TICKERS = [
  "RCAT", "KTOS", "CEG", "OKLO", "PLTR", "QBTS", "AXON", "CRDO", "LDOS", "INOD",
  "VST", "FORM", "IREN", "CCJ", "RBRK", "CDNS", "IONQ", "AVGO", "LMT", "ANET",
  "HII", "ONTO", "PL", "CLS", "AMD", "BWXT", "ONDS", "INTC", "FTAI", "SLV",
  "WDC", "TSM", "STX", "VRT", "TER", "PWR", "DDOG", "USAR", "NNE", "AMZN",
  "HWM", "QCOM", "AAPL", "ORCL", "STRL", "CRWD", "LRCX", "TSLA", "ASTS", "INFQ",
  "ZS", "HUM", "CRWV", "APLD", "MU", "PANW", "BE", "LITE", "GLW", "ARM",
  "RKLB", "MRVL", "COHR", "NVTS", "NBIS", "GOOG"
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
 * API endpoint: Get single quote with multi-source failover
 * Supports VIX, BRENT, and regular tickers
 */
app.get('/api/quote', async (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ error: 'symbol parameter required' });
    }
    
    const quote = await quoteAPI.getQuote(symbol.toUpperCase());
    res.json(quote);
  } catch (error) {
    console.error('Quote API error:', error);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

/**
 * API endpoint: Get single ticker (legacy)
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
