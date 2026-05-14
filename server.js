const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// CACHE
let cache = {
  tickers: {},
  stale: {},
  macros: {},
  updated: null
};

// YOUR TICKERS
const TICKERS = [
'RCAT','KTOS','CEG','OKLO','PLTR','QBTS','AXON','CRDO','LDOS','INOD',
'VST','FORM','IREN','CCJ','RBRK','CDNS','IONQ','AVGO','LMT','ANET',
'HII','ONTO','PL','CLS','AMD','BWXT','ONDS','INTC','FTAI','SLV',
'WDC','TSM','STX','VRT','TER','PWR','DDOG','USAR','NNE','AMZN',
'HWM','QCOM','AAPL','ORCL','STRL','CRWD','LRCX','TSLA','ASTS','ZS',
'HUM','APLD','MU','PANW','BE','LITE','GLW','ARM','RKLB','MRVL',
'COHR','NVTS','NBIS','GOOG'
];

// MACROS
const MACROS = {
  SPY: 'SPY',
  QQQ: 'QQQ',
  VOO: 'VOO',
  VIX: '^VIX',
  BRENT: 'BZ=F'
};

// FETCH YAHOO
async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const res = await fetch(url);

    if (!res.ok) return null;

    const data = await res.json();

    const price =
      data?.chart?.result?.[0]?.meta?.regularMarketPrice;

    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}

// FETCH FEAR & GREED
async function fetchFearGreed() {
  try {
    // TEMP STATIC UNTIL CNN SCRAPER
    return 34;
  } catch {
    return cache.macros?.FEAR_GREED || null;
  }
}

// MAIN REFRESH
async function refreshData() {

  const fresh = {};
  const stale = {};

  // PROCESS IN SMALL BATCHES
  for (let i = 0; i < TICKERS.length; i += 5) {

    const batch = TICKERS.slice(i, i + 5);

    await Promise.all(batch.map(async (ticker) => {

      const price = await fetchYahoo(ticker);

      if (price) {
        fresh[ticker] = price;
        cache.tickers[ticker] = price;
        stale[ticker] = false;
      } else {

        // FALL BACK TO CACHE
        if (cache.tickers[ticker]) {
          fresh[ticker] = cache.tickers[ticker];
          stale[ticker] = true;
        }
      }
    }));

    // THROTTLE
    await new Promise(r => setTimeout(r, 1200));
  }

  // MACROS
  const spy = await fetchYahoo('SPY');
  const qqq = await fetchYahoo('QQQ');
  const voo = await fetchYahoo('VOO');
  const vix = await fetchYahoo('%5EVIX');
  const brent = await fetchYahoo('BZ=F');

  cache.macros = {
    SPY: spy || cache.macros.SPY || null,
    QQQ: qqq || cache.macros.QQQ || null,
    VOO: voo || cache.macros.VOO || null,
    '^VIX': vix || cache.macros['^VIX'] || null,
    'BZ=F': brent || cache.macros['BZ=F'] || null,
    FEAR_GREED: await fetchFearGreed()
  };

  cache.updated = new Date().toISOString();

  return {
    tickers: fresh,
    stale,
    macros: cache.macros,
    stats: {
      fresh: Object.keys(fresh).length,
      stale: Object.values(stale).filter(Boolean).length
    },
    updated: cache.updated
  };
}

// ROUTE
app.get('/api/market-data', async (req, res) => {

  try {

    const data = await refreshData();

    res.json(data);

  } catch (err) {

    res.json({
      tickers: cache.tickers || {},
      stale: cache.stale || {},
      macros: cache.macros || {},
      stats: {
        fresh: 0,
        stale: Object.keys(cache.tickers || {}).length
      },
      updated: cache.updated,
      error: true
    });
  }
});

// START
app.listen(PORT, () => {
  console.log(`WAR ROOM API RUNNING ON ${PORT}`);
});
