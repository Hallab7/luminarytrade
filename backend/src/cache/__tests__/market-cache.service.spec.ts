import { Test, TestingModule } from '@nestjs/testing';
import { MarketCacheService } from '../market-cache.service';
import { CacheManager } from '../cache-manager.service';

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  getOrSet: jest.fn(),
};

describe('MarketCacheService', () => {
  let service: MarketCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketCacheService,
        { provide: CacheManager, useValue: mockCache },
      ],
    }).compile();

    service = module.get(MarketCacheService);
    jest.clearAllMocks();
  });

  describe('market prices', () => {
    it('gets a cached price', async () => {
      mockCache.get.mockResolvedValue('1.23');
      expect(await service.getMarketPrice('XLM/USD')).toBe('1.23');
      expect(mockCache.get).toHaveBeenCalledWith('market:price:XLM/USD');
    });

    it('sets a price with 10 s TTL', async () => {
      await service.setMarketPrice('XLM/USD', '1.23');
      expect(mockCache.set).toHaveBeenCalledWith('market:price:XLM/USD', '1.23', { ttl: 10 });
    });

    it('invalidates a price', async () => {
      await service.invalidateMarketPrice('XLM/USD');
      expect(mockCache.del).toHaveBeenCalledWith('market:price:XLM/USD');
    });
  });

  describe('portfolios', () => {
    it('gets a cached portfolio', async () => {
      const portfolio = { assets: [] };
      mockCache.get.mockResolvedValue(portfolio);
      expect(await service.getPortfolio('user-1')).toEqual(portfolio);
    });

    it('sets a portfolio with 60 s TTL', async () => {
      const portfolio = { assets: [] };
      await service.setPortfolio('user-1', portfolio);
      expect(mockCache.set).toHaveBeenCalledWith('portfolio:user-1', portfolio, { ttl: 60 });
    });

    it('invalidates a portfolio', async () => {
      await service.invalidatePortfolio('user-1');
      expect(mockCache.del).toHaveBeenCalledWith('portfolio:user-1');
    });
  });

  describe('cache-aside', () => {
    it('returns cached value without calling fetch', async () => {
      mockCache.getOrSet.mockResolvedValue('1.23');
      const fetch = jest.fn();
      const result = await service.getOrFetchMarketPrice('XLM/USD', fetch);
      expect(result).toBe('1.23');
      expect(mockCache.getOrSet).toHaveBeenCalledWith('market:price:XLM/USD', fetch, { ttl: 10 });
    });
  });
});
