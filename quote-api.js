const axios = require('axios');

/**
 * Quote API - Server-side proxy for VIX, Brent, and other market data
 * Handles multi-source failover and caching
 */

class QuoteAPI {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = new Map();
    
    // API Keys
    this.apiKeys = {
      finnhub: process.env.FINNHUB_API_KEY || 'd82ac0hr01qmgc0fa6vgd82ac0hr01qmgc0fa700',
      alphaVantage: process.env.ALPHA_VANTAGE_API_KEY || 'demo'
    };
  }

  /**
   * Get cached price if valid
   */
  getCachedPrice(symbol) {
    if (!this.cache.has(symbol)) return null;
    
    const expiry = this.cacheExpiry.get(symbol);
    if (Date.now() > expiry) {
      this.cache.delete(symbol);
      this.cacheExpiry.delete(symbol);
      return null;
    }
    
    return this.cache.get(symbol);
  }

  /**
   * Set cached price with TTL
   */
  setCachedPrice(symbol, data, ttlMs = 300000) {
    this.cache.set(symbol, data);
    this.cacheExpiry.set(symbol, Date.now() + ttlMs);
  }

  /**
   * Fetch from Yahoo Finance
   */
  async fetchFromYahoo(symbol) {
    try {
      const res = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`,
        { timeout: 5000 }
      );
      
      const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) {
        return {
          symbol,
          price,
          source: 'Yahoo',
          stale: false,
          lastUpdated: Date.now()
        };
      }
    } catch (e) {
      console.error(`Yahoo fetch failed for ${symbol}:`, e.message);
    }
    
    return null;
  }

  /**
   * Fetch from Stooq
   */
  async fetchFromStooq(symbol) {
    try {
      const res = await axios.get(
        `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=json`,
        { timeout: 5000 }
      );
      
      if (res.data?.data?.[0]?.c) {
        const price = parseFloat(res.data.data[0].c);
        if (price) {
          return {
            symbol,
            price,
            source: 'Stooq',
            stale: false,
            lastUpdated: Date.now()
          };
        }
      }
    } catch (e) {
      console.error(`Stooq fetch failed for ${symbol}:`, e.message);
    }
    
    return null;
  }

  /**
   * Fetch VIX from FRED
   */
  async fetchVIXFromFRED() {
    try {
      const res = await axios.get(
        `https://api.stlouisfed.org/fred/series/data?series_id=VIXCLS&api_key=demo&limit=1&sort_order=desc`,
        { timeout: 5000 }
      );
      
      if (res.data?.observations?.[0]?.value) {
        const price = parseFloat(res.data.observations[0].value);
        if (price) {
          return {
            symbol: 'VIX',
            price,
            source: 'FRED',
            stale: false,
            lastUpdated: Date.now()
          };
        }
      }
    } catch (e) {
      console.error('FRED VIX fetch failed:', e.message);
    }
    
    return null;
  }

  /**
   * Fetch Brent from Alpha Vantage
   */
  async fetchBrentFromAlphaVantage() {
    try {
      const res = await axios.get(
        `https://www.alphavantage.co/query?function=BRENT&interval=daily&apikey=${this.apiKeys.alphaVantage}`,
        { timeout: 5000 }
      );
      
      if (res.data?.data?.[0]?.value) {
        const price = parseFloat(res.data.data[0].value);
        if (price) {
          return {
            symbol: 'BRENT',
            price,
            source: 'AlphaVantage',
            stale: false,
            lastUpdated: Date.now()
          };
        }
      }
    } catch (e) {
      console.error('Alpha Vantage Brent fetch failed:', e.message);
    }
    
    return null;
  }

  /**
   * Fetch VIX with multi-source failover
   */
  async fetchVIX() {
    // Check cache first
    const cached = this.getCachedPrice('VIX');
    if (cached && !cached.stale) {
      return cached;
    }

    console.log('Fetching VIX...');

    // Try Yahoo
    let result = await this.fetchFromYahoo('^VIX');
    if (result) {
      this.setCachedPrice('VIX', result);
      return result;
    }

    // Try Stooq
    result = await this.fetchFromStooq('^VIX');
    if (result) {
      this.setCachedPrice('VIX', result);
      return result;
    }

    // Try FRED
    result = await this.fetchVIXFromFRED();
    if (result) {
      this.setCachedPrice('VIX', result);
      return result;
    }

    // Fall back to cached value
    if (cached) {
      return { ...cached, stale: true };
    }

    // No data available
    return {
      symbol: 'VIX',
      price: null,
      source: 'Failed',
      stale: true,
      lastUpdated: null
    };
  }

  /**
   * Fetch Brent with multi-source failover
   */
  async fetchBrent() {
    // Check cache first
    const cached = this.getCachedPrice('BRENT');
    if (cached && !cached.stale) {
      return cached;
    }

    console.log('Fetching Brent...');

    // Try Yahoo
    let result = await this.fetchFromYahoo('BZ=F');
    if (result) {
      result.symbol = 'BRENT';
      this.setCachedPrice('BRENT', result);
      return result;
    }

    // Try Stooq
    result = await this.fetchFromStooq('SC.F');
    if (result) {
      result.symbol = 'BRENT';
      this.setCachedPrice('BRENT', result);
      return result;
    }

    // Try Alpha Vantage
    result = await this.fetchBrentFromAlphaVantage();
    if (result) {
      this.setCachedPrice('BRENT', result);
      return result;
    }

    // Fall back to cached value
    if (cached) {
      return { ...cached, stale: true };
    }

    // No data available
    return {
      symbol: 'BRENT',
      price: null,
      source: 'Failed',
      stale: true,
      lastUpdated: null
    };
  }

  /**
   * Main quote fetch method
   */
  async getQuote(symbol) {
    symbol = symbol.toUpperCase();

    if (symbol === 'VIX') {
      return this.fetchVIX();
    }

    if (symbol === 'BRENT') {
      return this.fetchBrent();
    }

    // For other symbols, use Finnhub
    try {
      const res = await axios.get(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${this.apiKeys.finnhub}`,
        { timeout: 5000 }
      );

      if (res.data?.c) {
        return {
          symbol,
          price: res.data.c,
          source: 'Finnhub',
          stale: false,
          lastUpdated: Date.now()
        };
      }
    } catch (e) {
      console.error(`Finnhub fetch failed for ${symbol}:`, e.message);
    }

    return {
      symbol,
      price: null,
      source: 'Failed',
      stale: true,
      lastUpdated: null
    };
  }
}

module.exports = QuoteAPI;
