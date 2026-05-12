const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

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

// Cache
let cachedData = null;
let lastFetchTime = 0;
const CACHE_TTL = 300000; // 5 minutes

async function fetchTickerPriceYahoo(symbol) {
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}`,
      {
        params: { modules: 'price' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      }
    );
    
    const price = response.data?.quoteSummary?.result?.[0]?.price?.regularMarketPrice;
    if (price) {
      console.log(`✓ ${symbol}: $${price}`);
      return price;
    }
    return null;
  } catch (e) {
    console.log(`✗ Yahoo Finance failed for ${symbol}: ${e.message}`);
    return null;
  }
}

async function fetchTickerPriceAlpha(symbol) {
  try {
    // Fallback to Alpha Vantage or similar
    const response = await axios.get(
      `https://www.alphavantage.co/query`,
      {
        params: {
          function: 'GLOBAL_QUOTE',
          symbol: symbol,
          apikey: 'demo'
        },
        timeout: 8000
      }
    );
    
    const price = response.data?.['Global Quote']?.['05. price'];
    if (price && price !== '0') {
      console.log(`✓ Alpha ${symbol}: $${price}`);
      return parseFloat(price);
    }
    return null;
  } catch (e) {
    console.log(`✗ Alpha Vantage failed for ${symbol}: ${e.message}`);
    return null;
  }
}

async function fetchTickerPrice(symbol) {
  // Try Yahoo first
  let price = await fetchTickerPriceYahoo(symbol);
  if (price) return price;
  
  // Fallback to Alpha Vantage
  price = await fetchTickerPriceAlpha(symbol);
  if (price) return price;
  
  return null;
}

async function fetchFearAndGreed() {
  try {
    const response = await axios.get('https://api.alternative.me/fng/', { timeout: 8000 });
    const value = response.data?.data?.[0]?.value;
    if (value) {
      console.log(`✓ Fear & Greed: ${value}`);
      return parseInt(value);
    }
    return null;
  } catch (e) {
    console.log('✗ Failed to fetch Fear & Greed:', e.message);
    return null;
  }
}

async function fetchAllData() {
  const tickers = {};
  const macros = {};
  
  console.log('=== FETCHING MARKET DATA ===');
  console.log('Fetching macros...');
  
  // Fetch macros
  for (const macro of MACRO_TICKERS) {
    const price = await fetchTickerPrice(macro);
    macros[macro] = price;
    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }
  
  // Fetch Fear & Greed
  const fearGreed = await fetchFearAndGreed();
  macros['FEAR_GREED'] = fearGreed;
  
  console.log('Fetching tickers...');
  
  // Fetch tickers in batches
  for (let i = 0; i < ALL_TICKERS.length; i++) {
    const ticker = ALL_TICKERS[i];
    const price = await fetchTickerPrice(ticker);
    tickers[ticker] = price;
    
    // Add delay every 5 tickers to avoid rate limiting
    if ((i + 1) % 5 === 0) {
      await new Promise(r => setTimeout(r, 1000));
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  cachedData = {
    tickers,
    macros,
    timestamp: Date.now()
  };
  lastFetchTime = Date.now();
  
  console.log('=== FETCH COMPLETE ===');
  console.log(`Tickers fetched: ${Object.values(tickers).filter(v => v !== null).length}/${ALL_TICKERS.length}`);
  console.log(`Macros fetched: ${Object.values(macros).filter(v => v !== null).length}/${MACRO_TICKERS.length + 1}`);
  
  return cachedData;
}

app.get('/api/market-data', async (req, res) => {
  try {
    // Return cached data if fresh
    if (cachedData && (Date.now() - lastFetchTime) < CACHE_TTL) {
      console.log('Returning cached data');
      return res.json(cachedData);
    }
    
    console.log('Cache expired or empty, fetching new data...');
    // Fetch new data
    const data = await fetchAllData();
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    // Return partial cached data if available
    if (cachedData) {
      return res.json(cachedData);
    }
    res.status(500).json({ error: 'Failed to fetch data', tickers: {}, macros: {} });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', cached: cachedData ? true : false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
