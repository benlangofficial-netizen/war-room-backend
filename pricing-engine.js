const axios = require('axios');

/**
 * Multi-Source Stock Pricing Engine with Automatic Failover & Caching
 * 
 * Priority Order:
 * 1. Polygon.io (primary)
 * 2. Finnhub (secondary)
 * 3. Twelve Data (tertiary)
 * 4. Alpha Vantage (analytics)
 * 5. Financial Modeling Prep (fundamentals)
 * 6. Yahoo Finance (emergency fallback)
 */

class PricingEngine {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.rateLimitStatus = new Map();
    
    // API Keys (use free tier keys - replace with your own)
    this.apiKeys = {
      polygon: process.env.POLYGON_API_KEY || 'YOUR_POLYGON_KEY',
      finnhub: process.env.FINNHUB_API_KEY || 'YOUR_FINNHUB_KEY',
      twelveData: process.env.TWELVE_DATA_API_KEY || 'YOUR_TWELVE_DATA_KEY',
      alphaVantage: process.env.ALPHA_VANTAGE_API_KEY || 'demo',
      fmp: process.env.FMP_API_KEY || 'YOUR_FMP_KEY'
    };
    
    // Cache TTL based on market hours
    this.getCacheTTL = () => {
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay();
      
      // Market closed (weekends, before 9:30 AM, after 4 PM)
      if (day === 0 || day === 6 || hour < 9 || hour >= 16) {
        return 3600000; // 1 hour
      }
      
      // Market hours (9:30 AM - 4 PM)
      if (hour >= 9 && hour < 16) {
        return 30000; // 30 seconds
      }
      
      // After hours (4 PM - 8 PM)
      return 300000; // 5 minutes
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
  setCachedPrice(symbol, data) {
    const ttl = this.getCacheTTL();
    this.cache.set(symbol, data);
    this.cacheExpiry.set(symbol, Date.now() + ttl);
  }

  /**
   * Check if provider is rate-limited
   */
  isRateLimited(provider) {
    if (!this.rateLimitStatus.has(provider)) return false;
    
    const { until } = this.rateLimitStatus.get(provider);
    if (Date.now() < until) return true;
    
    this.rateLimitStatus.delete(provider);
    return false;
  }

  /**
   * Mark provider as rate-limited
   */
  setRateLimited(provider, durationMs = 60000) {
    this.rateLimitStatus.set(provider, {
      until: Date.now() + durationMs
    });
  }

  /**
   * Normalize price response to unified structure
   */
  normalizePrice(data, provider) {
    return {
      symbol: data.symbol || data.ticker,
      price: data.price || data.c || data.last || data.regularMarketPrice,
      bid: data.bid || data.b,
      ask: data.ask || data.a,
      high: data.high || data.h,
      low: data.low || data.l,
      volume: data.volume || data.v,
      timestamp: data.timestamp || Date.now(),
      provider,
      stale: false
    };
  }

  /**
   * Polygon.io - Primary Source
   */
  async fetchFromPolygon(symbol) {
    try {
      if (this.isRateLimited('polygon')) return null;
      
      const res = await axios.get(
        `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`,
        {
          params: { apiKey: this.apiKeys.polygon },
          timeout: 5000
        }
      );
      
      if (!res.data?.results) return null;
      
      const quote = res.data.results.last_quote;
      return this.normalizePrice({
        symbol,
        price: quote?.ask || res.data.results.last_trade?.price,
        bid: quote?.bid,
        ask: quote?.ask,
        high: res.data.results.updated,
        timestamp: res.data.results.updated
      }, 'polygon');
    } catch (e) {
      if (e.response?.status === 429) {
        this.setRateLimited('polygon', 60000);
      }
      console.error(`Polygon failed for ${symbol}:`, e.message);
      return null;
    }
  }

  /**
   * Finnhub - Secondary Source
   */
  async fetchFromFinnhub(symbol) {
    try {
      if (this.isRateLimited('finnhub')) return null;
      
      const res = await axios.get(
        `https://finnhub.io/api/v1/quote`,
        {
          params: {
            symbol,
            token: this.apiKeys.finnhub
          },
          timeout: 5000
        }
      );
      
      if (!res.data?.c) return null;
      
      return this.normalizePrice({
        symbol,
        price: res.data.c,
        bid: res.data.bp,
        ask: res.data.ap,
        high: res.data.h,
        low: res.data.l,
        volume: res.data.v,
        timestamp: res.data.t * 1000
      }, 'finnhub');
    } catch (e) {
      if (e.response?.status === 429) {
        this.setRateLimited('finnhub', 60000);
      }
      console.error(`Finnhub failed for ${symbol}:`, e.message);
      return null;
    }
  }

  /**
   * Twelve Data - Tertiary Source
   */
  async fetchFromTwelveData(symbol) {
    try {
      if (this.isRateLimited('twelveData')) return null;
      
      const res = await axios.get(
        `https://api.twelvedata.com/quote`,
        {
          params: {
            symbol,
            apikey: this.apiKeys.twelveData
          },
          timeout: 5000
        }
      );
      
      if (!res.data?.price) return null;
      
      return this.normalizePrice({
        symbol,
        price: parseFloat(res.data.price),
        bid: parseFloat(res.data.bid),
        ask: parseFloat(res.data.ask),
        high: parseFloat(res.data.high),
        low: parseFloat(res.data.low),
        volume: parseInt(res.data.volume),
        timestamp: new Date(res.data.updated).getTime()
      }, 'twelveData');
    } catch (e) {
      if (e.response?.status === 429) {
        this.setRateLimited('twelveData', 60000);
      }
      console.error(`Twelve Data failed for ${symbol}:`, e.message);
      return null;
    }
  }

  /**
   * Alpha Vantage - Analytics Source
   */
  async fetchFromAlphaVantage(symbol) {
    try {
      if (this.isRateLimited('alphaVantage')) return null;
      
      const res = await axios.get(
        `https://www.alphavantage.co/query`,
        {
          params: {
            function: 'GLOBAL_QUOTE',
            symbol,
            apikey: this.apiKeys.alphaVantage
          },
          timeout: 5000
        }
      );
      
      if (!res.data?.['Global Quote']?.['05. price']) return null;
      
      const quote = res.data['Global Quote'];
      return this.normalizePrice({
        symbol,
        price: parseFloat(quote['05. price']),
        bid: parseFloat(quote['06. volume']),
        high: parseFloat(quote['03. high']),
        low: parseFloat(quote['04. low']),
        timestamp: Date.now()
      }, 'alphaVantage');
    } catch (e) {
      if (e.response?.status === 429) {
        this.setRateLimited('alphaVantage', 60000);
      }
      console.error(`Alpha Vantage failed for ${symbol}:`, e.message);
      return null;
    }
  }

  /**
   * Yahoo Finance - Emergency Fallback (via unofficial endpoint)
   */
  async fetchFromYahoo(symbol) {
    try {
      if (this.isRateLimited('yahoo')) return null;
      
      const res = await axios.get(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}`,
        {
          params: { modules: 'price' },
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 5000
        }
      );
      
      if (!res.data?.quoteSummary?.result?.[0]?.price) return null;
      
      const price = res.data.quoteSummary.result[0].price;
      return this.normalizePrice({
        symbol,
        price: price.regularMarketPrice,
        bid: price.bid,
        ask: price.ask,
        high: price.fiftyTwoWeekHigh,
        low: price.fiftyTwoWeekLow,
        timestamp: Date.now()
      }, 'yahoo');
    } catch (e) {
      if (e.response?.status === 429) {
        this.setRateLimited('yahoo', 120000); // Longer cooldown for Yahoo
      }
      console.error(`Yahoo failed for ${symbol}:`, e.message);
      return null;
    }
  }

  /**
   * Main fetch with automatic failover
   */
  async fetchPrice(symbol) {
    // Check cache first
    const cached = this.getCachedPrice(symbol);
    if (cached) {
      console.log(`✓ Cache hit for ${symbol}`);
      return cached;
    }

    console.log(`Fetching ${symbol}...`);

    // Failover chain
    const providers = [
      () => this.fetchFromPolygon(symbol),
      () => this.fetchFromFinnhub(symbol),
      () => this.fetchFromTwelveData(symbol),
      () => this.fetchFromAlphaVantage(symbol),
      () => this.fetchFromYahoo(symbol)
    ];

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result && result.price) {
          this.setCachedPrice(symbol, result);
          console.log(`✓ ${symbol}: $${result.price} (${result.provider})`);
          return result;
        }
      } catch (e) {
        console.error(`Provider error:`, e.message);
        continue;
      }
    }

    console.error(`✗ All providers failed for ${symbol}`);
    return null;
  }

  /**
   * Batch fetch with parallel requests
   */
  async fetchPrices(symbols) {
    const results = {};
    
    // Fetch in parallel with concurrency limit
    const concurrency = 5;
    for (let i = 0; i < symbols.length; i += concurrency) {
      const batch = symbols.slice(i, i + concurrency);
      const promises = batch.map(sym => 
        this.fetchPrice(sym).then(data => {
          results[sym] = data;
        })
      );
      
      await Promise.all(promises);
      
      // Rate limit delay between batches
      if (i + concurrency < symbols.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    return results;
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      cachedSymbols: this.cache.size,
      rateLimitedProviders: Array.from(this.rateLimitStatus.keys()),
      cacheSize: this.cache.size
    };
  }
}

module.exports = PricingEngine;
