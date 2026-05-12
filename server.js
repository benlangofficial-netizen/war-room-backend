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

async function fetchTickerPrice(symbol) {
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}`,
      {
        params: { modules: 'price' },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      }
    );
    
    return response.data?.quoteSummary?.result?.[0]?.price?.regularMarketPrice || null;
  } catch (e) {
    console.log(`Failed to fetch ${symbol}:`, e.message);
    return null;
  }
}

async function fetchFearAndGreed() {
  try {
    const response = await axios.get('https://api.alternative.me/fng/', { timeout: 5000 });
    return response.data?.data?.[0]?.value ? parseInt(response.data.data[0].value) : null;
  } catch (e) {
    console.log('Failed to fetch Fear & Greed:', e.message);
    return null;
  }
}

async function fetchAllData() {
  const tickers = {};
  const macros = {};
  
  // Fetch macros
  console.log('Fetching macros...');
  for (const macro of MACRO_TICKERS) {
    const price = await fetchTickerPrice(macro);
    macros[macro] = price;
    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }
  
  // Fetch Fear & Greed
  const fearGreed = await fetchFearAndGreed();
  
  // Fetch tickers
  console.log('Fetching tickers...');
  for (const ticker of ALL_TICKERS) {
    const price = await fetchTickerPrice(ticker);
    tickers[ticker] = price;
    await new Promise(r => setTimeout(r, 300)); // Rate limit
  }
  
  cachedData = {
    tickers,
    macros,
    fearGreed,
    timestamp: Date.now()
  };
  lastFetchTime = Date.now();
  
  return cachedData;
}

app.get('/api/market-data', async (req, res) => {
  try {
    // Return cached data if fresh
    if (cachedData && (Date.now() - lastFetchTime) < CACHE_TTL) {
      return res.json(cachedData);
    }
    
    // Fetch new data
    const data = await fetchAllData();
    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
