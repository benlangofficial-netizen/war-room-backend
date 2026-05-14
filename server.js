const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

const MACRO_TICKERS = ["SPY", "QQQ", "VOO", "^VIX", "BZ=F"];
const FINNHUB_KEY = 'd82ac0hr01qmgc0fa6vgd82ac0hr01qmgc0fa700';

// Persistent price cache (file-based)
const CACHE_FILE = '/tmp/war-room-prices.json';
let priceCache = {};
let priceFreshness = {}; // Track if price is fresh or stale

// Load persistent cache on startup
function loadPersistentCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      priceCache = data.prices || {};
      priceFreshness = data.freshness || {};
      console.log(`Loaded ${Object.keys(priceCache).length} prices from cache`);
    }
  } catch (e) {
    console.error('Failed to load cache:', e.message);
  }
}

// Save persistent cache
function savePersistentCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ prices: priceCache, freshness: priceFreshness }, null, 2));
  } catch (e) {
    console.error('Failed to save cache:', e.message);
  }
}

// Sleep utility
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch from Finnhub (single ticker)
 */
async function fetchFromFinnhub(symbol) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`, {
      timeout: 8000
    });
    const data = await res.json();
    if (data?.c) {
      console.log(`    [Finnhub] ${symbol}: $${data.c}`);
      return data.c;
    }
    console.log(`    [Finnhub] ${symbol}: no price in response`);
    return null;
  } catch (e) {
    console.log(`    [Finnhub] ${symbol}: ${e.message}`);
    return null;
  }
}

/**
 * Fetch from Yahoo Finance
 */
async function fetchFromYahoo(symbol) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    const data = await res.json();
    const price = data?.quoteSummary?.result?.[0]?.price?.regularMarketPrice;
    if (price) {
      console.log(`    [Yahoo] ${symbol}: $${price}`);
      return price;
    }
    console.log(`    [Yahoo] ${symbol}: no price in response`);
    return null;
  } catch (e) {
    console.log(`    [Yahoo] ${symbol}: ${e.message}`);
    return null;
  }
}

/**
 * Fetch from Alpha Vantage
 */
async function fetchFromAlphaVantage(symbol) {
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=demo`,
      { timeout: 8000 }
    );
    const data = await res.json();
    const price = parseFloat(data?.['Global Quote']?.['05. price']);
    if (price && price > 0) {
      console.log(`    [Alpha Vantage] ${symbol}: $${price}`);
      return price;
    }
    console.log(`    [Alpha Vantage] ${symbol}: no price in response`);
    return null;
  } catch (e) {
    console.log(`    [Alpha Vantage] ${symbol}: ${e.message}`);
    return null;
  }
}

/**
 * Fallback prices for tickers that consistently fail
 */
const FALLBACK_PRICES = {
  'ASTS': 65.00,
  'INFQ': 11.00,
  'ZS': 110.00,
  'HUM': 178.00,
  'CRWV': 75.00,
  'APLD': 22.00,
  '^VIX': 17.50,
  'BZ=F': 105.00
};

/**
 * Fetch single ticker with retry logic and fallback
 */
async function fetchTickerWithRetry(symbol, attempt = 1) {
  console.log(`  Fetching ${symbol} (attempt ${attempt})...`);

  // Try sources in order
  const sources = [
    () => fetchFromFinnhub(symbol),
    () => fetchFromYahoo(symbol),
    () => fetchFromAlphaVantage(symbol)
  ];

  for (const source of sources) {
    try {
      const price = await source();
      if (price && price > 0) {
        priceCache[symbol] = price;
        priceFreshness[symbol] = Date.now();
        return price;
      }
    } catch (e) {
      // Continue to next source
    }
  }

  // If first attempt failed, retry once after delay
  if (attempt === 1) {
    console.log(`  ${symbol} failed, retrying in 3s...`);
    await sleep(3000);
    return fetchTickerWithRetry(symbol, 2);
  }

  // If still no price, use cached price if available
  if (priceCache[symbol]) {
    console.log(`  ${symbol}: using cached price $${priceCache[symbol]} (stale)`);
    return priceCache[symbol];
  }

  // Use fallback price if available
  if (FALLBACK_PRICES[symbol]) {
    console.log(`  ${symbol}: using fallback price $${FALLBACK_PRICES[symbol]}`);
    priceCache[symbol] = FALLBACK_PRICES[symbol];
    priceFreshness[symbol] = Date.now() - 600000; // Mark as stale
    return FALLBACK_PRICES[symbol];
  }

  console.log(`  ${symbol}: FAILED - no price available`);
  return null;
}

/**
 * Fetch all market data with batching and throttling
 */
async function fetchAllData() {
  console.log('\n=== FETCHING MARKET DATA ===');
  
  // Fetch macros
  console.log('Fetching macros...');
  const macros = {};
  for (const ticker of MACRO_TICKERS) {
    let price = await fetchTickerWithRetry(ticker);
    // Force fallback for VIX and Brent if null
    if (price === null && FALLBACK_PRICES[ticker]) {
      price = FALLBACK_PRICES[ticker];
      console.log(`  Using fallback for ${ticker}: $${price}`);
    }
    macros[ticker] = price;
    await sleep(500);
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
  
  // Fetch all tickers in batches with throttling
  console.log(`\nFetching ${ALL_TICKERS.length} tickers in batches...`);
  const BATCH_SIZE = 8;
  const BATCH_DELAY = 1000; // 1 second between batches
  
  for (let i = 0; i < ALL_TICKERS.length; i += BATCH_SIZE) {
    const batch = ALL_TICKERS.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(ALL_TICKERS.length / BATCH_SIZE)}: ${batch.join(', ')}`);
    
    // Fetch batch in parallel
    await Promise.all(batch.map(ticker => fetchTickerWithRetry(ticker)));
    
    // Delay before next batch
    if (i + BATCH_SIZE < ALL_TICKERS.length) {
      console.log(`Waiting ${BATCH_DELAY}ms before next batch...`);
      await sleep(BATCH_DELAY);
    }
  }
  
  // Build response
  const tickerPrices = {};
  const tickerStale = {};
  let freshCount = 0;
  let staleCount = 0;
  
  for (const ticker of ALL_TICKERS) {
    const price = priceCache[ticker];
    tickerPrices[ticker] = price;
    
    if (price) {
      const freshness = priceFreshness[ticker];
      const age = Date.now() - freshness;
      const isStale = age > 300000; // 5 minutes
      
      if (isStale) {
        staleCount++;
        tickerStale[ticker] = true;
      } else {
        freshCount++;
      }
    }
  }
  
  const cachedData = {
    tickers: tickerPrices,
    stale: tickerStale,
    macros,
    timestamp: Date.now(),
    stats: { 
      fresh: freshCount,
      stale: staleCount,
      total: ALL_TICKERS.length
    }
  };
  
  // Save cache
  savePersistentCache();
  
  console.log('\n=== FETCH COMPLETE ===');
  console.log(`Fresh: ${freshCount}, Stale: ${staleCount}, Total: ${ALL_TICKERS.length}`);
  
  return cachedData;
}

let cachedData = null;
let lastFetchTime = 0;
const CACHE_TTL = 300000; // 5 minutes

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
    cachedData = await fetchAllData();
    lastFetchTime = Date.now();
    res.json(cachedData);
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
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    cached: cachedData ? true : false,
    lastFetch: lastFetchTime,
    cacheAge: Date.now() - lastFetchTime,
    cachedPrices: Object.keys(priceCache).length
  });
});

/**
 * Initialize data on startup
 */
async function startup() {
  console.log('Starting War Room Backend...');
  loadPersistentCache();
  
  // Fetch initial data
  cachedData = await fetchAllData();
  lastFetchTime = Date.now();
  
  // Refresh every 5 minutes
  setInterval(async () => {
    cachedData = await fetchAllData();
    lastFetchTime = Date.now();
  }, CACHE_TTL);
  
  console.log('Backend ready!');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startup();
});
