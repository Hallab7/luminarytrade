import { Injectable, Logger } from '@nestjs/common';
import { CacheManager } from '../cache/cache-manager.service';

const MARKET_PRICE_TTL = 10;    // 10 s — highly volatile
const PORTFOLIO_TTL = 60;       // 60 s — less volatile

@Injectable()
export class MarketCacheService {
  private readonly logger = new Logger(MarketCacheService.name);

  constructor(private readonly cache: CacheManager) {}

  // ── Market prices ──────────────────────────────────────────────────────────

  async getMarketPrice(pair: string): Promise<string | undefined> {
    return this.cache.get<string>(`market:price:${pair}`);
  }

  async setMarketPrice(pair: string, price: string): Promise<void> {
    await this.cache.set(`market:price:${pair}`, price, { ttl: MARKET_PRICE_TTL });
    this.logger.debug(`Cached market price for ${pair}`);
  }

  async invalidateMarketPrice(pair: string): Promise<void> {
    await this.cache.del(`market:price:${pair}`);
  }

  // ── User portfolios ────────────────────────────────────────────────────────

  async getPortfolio(userId: string): Promise<unknown | undefined> {
    return this.cache.get<unknown>(`portfolio:${userId}`);
  }

  async setPortfolio(userId: string, portfolio: unknown): Promise<void> {
    await this.cache.set(`portfolio:${userId}`, portfolio, { ttl: PORTFOLIO_TTL });
    this.logger.debug(`Cached portfolio for user ${userId}`);
  }

  async invalidatePortfolio(userId: string): Promise<void> {
    await this.cache.del(`portfolio:${userId}`);
  }

  // ── Cache-aside helpers ────────────────────────────────────────────────────

  async getOrFetchMarketPrice(
    pair: string,
    fetch: () => Promise<string>,
  ): Promise<string> {
    return this.cache.getOrSet(`market:price:${pair}`, fetch, { ttl: MARKET_PRICE_TTL });
  }

  async getOrFetchPortfolio(
    userId: string,
    fetch: () => Promise<unknown>,
  ): Promise<unknown> {
    return this.cache.getOrSet(`portfolio:${userId}`, fetch, { ttl: PORTFOLIO_TTL });
  }
}
