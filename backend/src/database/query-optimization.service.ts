import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { QueryAnalyzerService } from './query-analyzer.service';
import { ELKLoggerService } from '../logging/elk-logger.service';
import { Redis } from 'ioredis';

@Injectable()
export class QueryOptimizationService implements OnModuleInit {
  private queryCache = new Map<string, { data: any; timestamp: number; ttl: number }>();
  private redis: Redis;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly queryAnalyzer: QueryAnalyzerService,
    private readonly logger: ELKLoggerService
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  async onModuleInit() {
    // Clean up expired cache entries every 5 minutes
    setInterval(() => {
      this.cleanupExpiredCache();
    }, 5 * 60 * 1000);
  }

  /**
   * Execute an optimized query with caching and analysis
   */
  async executeOptimizedQuery<T>(
    query: string,
    parameters?: any[],
    options: {
      cacheResults?: boolean;
      cacheTTL?: number;
      enableExplain?: boolean;
      maxExecutionTime?: number;
    } = {}
  ): Promise<T[]> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(query, parameters);

    // Check cache first
    if (options.cacheResults) {
      const cached = await this.getFromCache<T[]>(cacheKey);
      if (cached !== null) {
        this.logger.debug('Query result retrieved from cache', undefined, {
          query: query.substring(0, 100),
          cacheKey,
        });
        return cached;
      }
    }

    try {
      // Execute query with analysis
      const result = await this.dataSource.query(query, parameters);
      const executionTime = Date.now() - startTime;

      // Analyze query performance
      await this.queryAnalyzer.analyzeQuery(query, executionTime, parameters, result?.length || 0);

      // Check execution time
      if (options.maxExecutionTime && executionTime > options.maxExecutionTime) {
        this.logger.warn('Query exceeded maximum execution time', undefined, {
          query: query.substring(0, 100),
          executionTime,
          maxExecutionTime: options.maxExecutionTime,
        });
      }

      // Cache result if enabled
      if (options.cacheResults && result) {
        await this.setCache(cacheKey, result, options.cacheTTL || 300);
      }

      // Explain query if requested
      if (options.enableExplain) {
        try {
          const explainPlan = await this.queryAnalyzer.getExplainPlan(query, parameters);
          this.logger.debug('Query execution plan', undefined, {
            query: query.substring(0, 100),
            plan: explainPlan,
          });
        } catch (error) {
          this.logger.warn('Failed to get explain plan', error, {
            query: query.substring(0, 100),
          });
        }
      }

      return result || [];
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // Analyze failed query
      await this.queryAnalyzer.analyzeQuery(query, executionTime, parameters, 0);
      
      this.logger.error('Query execution failed', error, {
        query: query.substring(0, 100),
        executionTime,
        parameters,
      });
      
      throw error;
    }
  }

  /**
   * Create an optimized SELECT query
   */
  createOptimizedSelect<T>(
    repository: Repository<T>,
    options: {
      columns?: string[];
      where?: Record<string, any>;
      orderBy?: Record<string, 'ASC' | 'DESC'>;
      limit?: number;
      offset?: number;
      joins?: Array<{
        relation: string;
        alias: string;
        condition?: string;
      }>;
    } = {}
  ): SelectQueryBuilder<T> {
    let queryBuilder = repository.createQueryBuilder();

    // Select specific columns to avoid SELECT *
    if (options.columns && options.columns.length > 0) {
      queryBuilder = queryBuilder.select(options.columns.map(col => `${queryBuilder.alias}.${col}`));
    }

    // Add WHERE conditions
    if (options.where) {
      Object.entries(options.where).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            queryBuilder = queryBuilder.andWhere(`${queryBuilder.alias}.${key} IN (:...${key})`, { [key]: value });
          } else {
            queryBuilder = queryBuilder.andWhere(`${queryBuilder.alias}.${key} = :${key}`, { [key]: value });
          }
        }
      });
    }

    // Add ORDER BY
    if (options.orderBy) {
      Object.entries(options.orderBy).forEach(([column, direction]) => {
        queryBuilder = queryBuilder.addOrderBy(`${queryBuilder.alias}.${column}`, direction);
      });
    }

    // Add LIMIT and OFFSET
    if (options.limit) {
      queryBuilder = queryBuilder.limit(options.limit);
    }
    if (options.offset) {
      queryBuilder = queryBuilder.offset(options.offset);
    }

    // Add JOINs
    if (options.joins) {
      options.joins.forEach(join => {
        queryBuilder = queryBuilder.leftJoin(
          `${queryBuilder.alias}.${join.relation}`,
          join.alias,
          join.condition
        );
      });
    }

    return queryBuilder;
  }

  /**
   * Execute a batch query to avoid N+1 problems
   */
  async executeBatchQuery<T>(
    repository: Repository<T>,
    ids: any[],
    idColumn: string = 'id',
    options: {
      batchSize?: number;
      columns?: string[];
      where?: Record<string, any>;
    } = {}
  ): Promise<T[]> {
    const batchSize = options.batchSize || 100;
    const results: T[] = [];

    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);
      
      const queryBuilder = this.createOptimizedSelect(repository, {
        columns: options.columns,
        where: {
          [idColumn]: batchIds,
          ...options.where,
        },
      });

      const batchResults = await queryBuilder.getMany();
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Refresh materialized views
   */
  async refreshMaterializedView(viewName: string): Promise<void> {
    try {
      await this.dataSource.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
      
      this.logger.info('Materialized view refreshed', undefined, {
        viewName,
      });
    } catch (error) {
      this.logger.error('Failed to refresh materialized view', error, {
        viewName,
      });
      throw error;
    }
  }

  /**
   * Get query performance recommendations
   */
  async getPerformanceRecommendations(): Promise<string[]> {
    const stats = await this.queryAnalyzer.getQueryStats();
    const recommendations: string[] = [];

    // Check for slow queries
    if (stats.averageExecutionTime > 500) {
      recommendations.push('Average query execution time is high. Consider adding indexes or optimizing queries.');
    }

    // Check for N+1 queries
    if (stats.n1QueriesCount > stats.totalQueries * 0.1) {
      recommendations.push('High number of N+1 queries detected. Use batch loading or JOINs.');
    }

    // Check sequential scan rate
    const sequentialScanRate = this.calculateSequentialScanRate(stats);
    if (sequentialScanRate > 30) {
      recommendations.push('High sequential scan rate. Review missing indexes.');
    }

    // Check slow query rate
    const slowQueryRate = stats.totalQueries > 0 ? (stats.slowQueriesCount / stats.totalQueries) * 100 : 0;
    if (slowQueryRate > 5) {
      recommendations.push('Slow query rate is above 5%. Implement query optimization.');
    }

    return recommendations;
  }

  /**
   * Generate cache key for query
   */
  private generateCacheKey(query: string, parameters?: any[]): string {
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();
    const paramString = parameters ? JSON.stringify(parameters) : '';
    return `query_cache:${Buffer.from(normalizedQuery + paramString).toString('base64')}`;
  }

  /**
   * Get result from cache
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    try {
      // Try Redis first
      const redisResult = await this.redis.get(key);
      if (redisResult) {
        return JSON.parse(redisResult);
      }

      // Fallback to in-memory cache
      const memoryResult = this.queryCache.get(key);
      if (memoryResult && Date.now() - memoryResult.timestamp < memoryResult.ttl * 1000) {
        return memoryResult.data;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get from cache', error, { key });
      return null;
    }
  }

  /**
   * Set result in cache
   */
  private async setCache(key: string, data: any, ttl: number): Promise<void> {
    try {
      // Set in Redis
      await this.redis.setex(key, ttl, JSON.stringify(data));

      // Set in memory cache as backup
      this.queryCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl,
      });
    } catch (error) {
      this.logger.warn('Failed to set cache', error, { key });
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.queryCache.entries()) {
      if (now - value.timestamp > value.ttl * 1000) {
        this.queryCache.delete(key);
      }
    }
  }

  /**
   * Calculate sequential scan rate
   */
  private calculateSequentialScanRate(stats: any): number {
    const totalScans = Object.values(stats.indexUsageStats).reduce((sum: number, stat: any) => sum + stat.totalQueries, 0);
    const sequentialScans = stats.indexUsageStats['Seq Scan']?.totalQueries || 0;
    
    return totalScans > 0 ? (sequentialScans / totalScans) * 100 : 0;
  }

  /**
   * Clear cache
   */
  async clearCache(pattern?: string): Promise<void> {
    try {
      if (pattern) {
        const keys = await this.redis.keys(`*${pattern}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } else {
        await this.redis.flushdb();
      }

      // Clear memory cache
      this.queryCache.clear();

      this.logger.info('Cache cleared', undefined, { pattern });
    } catch (error) {
      this.logger.error('Failed to clear cache', error, { pattern });
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    memoryCache: { size: number; keys: string[] };
    redisCache: { info: any };
  }> {
    try {
      const redisInfo = await this.redis.info('memory');
      const memoryCacheKeys = Array.from(this.queryCache.keys());

      return {
        memoryCache: {
          size: this.queryCache.size,
          keys: memoryCacheKeys,
        },
        redisCache: {
          info: redisInfo,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats', error);
      return {
        memoryCache: { size: 0, keys: [] },
        redisCache: { info: null },
      };
    }
  }
}
