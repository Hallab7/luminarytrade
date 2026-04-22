import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { CacheManager } from './cache-manager.service';
import { CacheInvalidator } from './cache-invalidator.service';
import { CacheMetricsService } from './cache-metrics.service';
import { CacheController } from './cache.controller';
import { MarketCacheService } from './market-cache.service';

// Multi-level cache services
import { L1CacheService } from './l1-cache.service';
import { L2CacheService } from './l2-cache.service';
import { MultiLevelCacheService } from './multi-level-cache.service';
import { CacheStatsService } from './cache-stats.service';

@Global()
@Module({
  imports: [
    NestCacheModule.register({
      ttl: 300, // 5 minutes default TTL (in seconds)
      max: 1000, // Maximum number of items in cache
      isGlobal: true,
    }),
  ],
  controllers: [CacheController],
  providers: [
    // Standard cache services
    CacheManager,
    CacheInvalidator,
    CacheMetricsService,
    MarketCacheService,

    // Multi-level cache services
    L1CacheService,
    L2CacheService,
    MultiLevelCacheService,
    CacheStatsService,
  ],
  exports: [
    // Standard cache services
    CacheManager,
    CacheInvalidator,
    CacheMetricsService,
    MarketCacheService,

    // Multi-level cache services
    L1CacheService,
    L2CacheService,
    MultiLevelCacheService,
    CacheStatsService,
  ],
})
export class CacheModule {}
