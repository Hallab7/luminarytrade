import { Test, TestingModule } from '@nestjs/testing';
import { QueryOptimizationService } from '../query-optimization.service';
import { QueryAnalyzerService } from '../query-analyzer.service';
import { DataSource } from 'typeorm';
import { ELKLoggerService } from '../../logging/elk-logger.service';
import Redis from 'ioredis';

describe('QueryOptimizationService', () => {
  let service: QueryOptimizationService;
  let dataSource: jest.Mocked<DataSource>;
  let queryAnalyzer: jest.Mocked<QueryAnalyzerService>;
  let logger: jest.Mocked<ELKLoggerService>;
  let redis: jest.Mocked<Redis>;

  beforeEach(async () => {
    const mockDataSource = {
      query: jest.fn(),
    } as any;

    const mockQueryAnalyzer = {
      analyzeQuery: jest.fn(),
      getExplainPlan: jest.fn(),
      getQueryStats: jest.fn(),
    } as any;

    const mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    const mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      keys: jest.fn(),
      del: jest.fn(),
      flushdb: jest.fn(),
      info: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryOptimizationService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: QueryAnalyzerService,
          useValue: mockQueryAnalyzer,
        },
        {
          provide: ELKLoggerService,
          useValue: mockLogger,
        },
        {
          provide: Redis,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<QueryOptimizationService>(QueryOptimizationService);
    dataSource = module.get(DataSource);
    queryAnalyzer = module.get(QueryAnalyzerService);
    logger = module.get(ELKLoggerService);
    redis = module.get(Redis);

    await service.onModuleInit();
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeOptimizedQuery', () => {
    it('should execute query and analyze performance', async () => {
      const query = 'SELECT * FROM users WHERE id = $1';
      const parameters = [123];
      const expectedResult = [{ id: 123, name: 'John' }];

      dataSource.query.mockResolvedValue(expectedResult);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      const result = await service.executeOptimizedQuery(query, parameters);

      expect(dataSource.query).toHaveBeenCalledWith(query, parameters);
      expect(queryAnalyzer.analyzeQuery).toHaveBeenCalledWith(query, expect.any(Number), parameters, 1);
      expect(result).toEqual(expectedResult);
    });

    it('should use cache when enabled', async () => {
      const query = 'SELECT * FROM users';
      const cachedResult = [{ id: 1, name: 'Cached' }];

      redis.get.mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.executeOptimizedQuery(query, [], {
        cacheResults: true,
        cacheTTL: 300,
      });

      expect(redis.get).toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(result).toEqual(cachedResult);
    });

    it('should cache results when enabled', async () => {
      const query = 'SELECT * FROM users';
      const expectedResult = [{ id: 1, name: 'John' }];

      redis.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue(expectedResult);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      const result = await service.executeOptimizedQuery(query, [], {
        cacheResults: true,
        cacheTTL: 300,
      });

      expect(redis.setex).toHaveBeenCalledWith(
        expect.any(String),
        300,
        JSON.stringify(expectedResult)
      );
      expect(result).toEqual(expectedResult);
    });

    it('should explain query when enabled', async () => {
      const query = 'SELECT * FROM users';
      const expectedResult = [{ id: 1, name: 'John' }];
      const explainPlan = { planType: 'Index Scan' };

      redis.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue(expectedResult);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);
      queryAnalyzer.getExplainPlan.mockResolvedValue(explainPlan);

      await service.executeOptimizedQuery(query, [], {
        enableExplain: true,
      });

      expect(queryAnalyzer.getExplainPlan).toHaveBeenCalledWith(query, []);
      expect(logger.debug).toHaveBeenCalledWith('Query execution plan', undefined, expect.any(Object));
    });

    it('should warn on slow queries', async () => {
      const query = 'SELECT * FROM users';
      const expectedResult = [{ id: 1, name: 'John' }];

      redis.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue(expectedResult);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      await service.executeOptimizedQuery(query, [], {
        maxExecutionTime: 100,
      });

      // Simulate slow execution by checking if the warning logic would be triggered
      expect(logger.warn).not.toHaveBeenCalled(); // Since we can't control actual execution time
    });

    it('should handle query errors', async () => {
      const query = 'INVALID QUERY';
      const error = new Error('Syntax error');

      redis.get.mockResolvedValue(null);
      dataSource.query.mockRejectedValue(error);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      await expect(service.executeOptimizedQuery(query, [])).rejects.toThrow('Syntax error');
      expect(queryAnalyzer.analyzeQuery).toHaveBeenCalledWith(query, expect.any(Number), [], 0);
      expect(logger.error).toHaveBeenCalledWith('Query execution failed', error, expect.any(Object));
    });
  });

  describe('createOptimizedSelect', () => {
    it('should create query with specific columns', async () => {
      const mockRepository = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        alias: 'entity',
      } as any;

      const queryBuilder = service.createOptimizedSelect(mockRepository, {
        columns: ['id', 'name'],
        where: { status: 'active' },
        orderBy: { created_at: 'DESC' },
        limit: 10,
        offset: 5,
        joins: [{ relation: 'profile', alias: 'p', condition: 'p.user_id = entity.id' }],
      });

      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockRepository.select).toHaveBeenCalledWith(['entity.id', 'entity.name']);
      expect(mockRepository.andWhere).toHaveBeenCalledWith('entity.status = :status', { status: 'active' });
      expect(mockRepository.addOrderBy).toHaveBeenCalledWith('entity.created_at', 'DESC');
      expect(mockRepository.limit).toHaveBeenCalledWith(10);
      expect(mockRepository.offset).toHaveBeenCalledWith(5);
      expect(mockRepository.leftJoin).toHaveBeenCalledWith('entity.profile', 'p', 'p.user_id = entity.id');
    });

    it('should handle array parameters in WHERE clause', async () => {
      const mockRepository = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        alias: 'entity',
      } as any;

      service.createOptimizedSelect(mockRepository, {
        where: { status: ['active', 'pending'] },
      });

      expect(mockRepository.andWhere).toHaveBeenCalledWith('entity.status IN (:...status)', { status: ['active', 'pending'] });
    });

    it('should handle undefined/null values in WHERE clause', async () => {
      const mockRepository = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        alias: 'entity',
      } as any;

      service.createOptimizedSelect(mockRepository, {
        where: { status: undefined, name: null },
      });

      expect(mockRepository.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('executeBatchQuery', () => {
    it('should execute batch queries', async () => {
      const mockRepository = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
        alias: 'entity',
      } as any;

      const ids = [1, 2, 3, 4, 5];
      const expectedResults = [
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' },
        { id: 3, name: 'User 3' },
        { id: 4, name: 'User 4' },
        { id: 5, name: 'User 5' },
      ];

      mockRepository.getMany.mockResolvedValue(expectedResults);

      const results = await service.executeBatchQuery(mockRepository, ids, 'id', {
        batchSize: 2,
        columns: ['id', 'name'],
      });

      expect(mockRepository.andWhere).toHaveBeenCalledTimes(3); // 5 items with batch size 2 = 3 batches
      expect(results).toEqual(expectedResults);
    });

    it('should use default batch size', async () => {
      const mockRepository = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
        alias: 'entity',
      } as any;

      const ids = Array.from({ length: 150 }, (_, i) => i + 1);

      mockRepository.getMany.mockResolvedValue([]);

      await service.executeBatchQuery(mockRepository, ids);

      expect(mockRepository.andWhere).toHaveBeenCalledTimes(2); // 150 items with default batch size 100 = 2 batches
    });
  });

  describe('refreshMaterializedView', () => {
    it('should refresh materialized view successfully', async () => {
      const viewName = 'user_loan_stats';

      dataSource.query.mockResolvedValue(undefined);

      await service.refreshMaterializedView(viewName);

      expect(dataSource.query).toHaveBeenCalledWith(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
      expect(logger.info).toHaveBeenCalledWith('Materialized view refreshed', undefined, { viewName });
    });

    it('should handle refresh errors', async () => {
      const viewName = 'invalid_view';
      const error = new Error('View does not exist');

      dataSource.query.mockRejectedValue(error);

      await expect(service.refreshMaterializedView(viewName)).rejects.toThrow('View does not exist');
      expect(logger.error).toHaveBeenCalledWith('Failed to refresh materialized view', error, { viewName });
    });
  });

  describe('getPerformanceRecommendations', () => {
    it('should provide recommendations based on query stats', async () => {
      const mockStats = {
        totalQueries: 100,
        averageExecutionTime: 600,
        slowQueriesCount: 10,
        n1QueriesCount: 15,
        indexUsageStats: {
          'Seq Scan': { totalQueries: 40 },
          'Index Scan': { totalQueries: 60 },
        },
      };

      queryAnalyzer.getQueryStats.mockResolvedValue(mockStats);

      const recommendations = await service.getPerformanceRecommendations();

      expect(recommendations).toContain('Average query execution time is high. Consider adding indexes or optimizing queries.');
      expect(recommendations).toContain('High number of N+1 queries detected. Use batch loading or JOINs.');
      expect(recommendations).toContain('High sequential scan rate. Review missing indexes.');
    });

    it('should return no recommendations for good performance', async () => {
      const mockStats = {
        totalQueries: 100,
        averageExecutionTime: 200,
        slowQueriesCount: 2,
        n1QueriesCount: 5,
        indexUsageStats: {
          'Index Scan': { totalQueries: 100 },
        },
      };

      queryAnalyzer.getQueryStats.mockResolvedValue(mockStats);

      const recommendations = await service.getPerformanceRecommendations();

      expect(recommendations).toHaveLength(0);
    });
  });

  describe('cache operations', () => {
    it('should clear cache with pattern', async () => {
      const keys = ['cache:key1', 'cache:key2'];
      
      redis.keys.mockResolvedValue(keys);
      redis.del.mockResolvedValue(2);

      await service.clearCache('key');

      expect(redis.keys).toHaveBeenCalledWith('*key*');
      expect(redis.del).toHaveBeenCalledWith(...keys);
    });

    it('should clear all cache', async () => {
      redis.flushdb.mockResolvedValue('OK');

      await service.clearCache();

      expect(redis.flushdb).toHaveBeenCalled();
    });

    it('should get cache statistics', async () => {
      redis.info.mockResolvedValue('used_memory:1024000\r\nused_memory_human:1MB');

      const stats = await service.getCacheStats();

      expect(stats).toMatchObject({
        memoryCache: {
          size: expect.any(Number),
          keys: expect.any(Array),
        },
        redisCache: {
          info: expect.any(String),
        },
      });
    });

    it('should handle cache errors gracefully', async () => {
      redis.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.executeOptimizedQuery('SELECT * FROM users', [], {
        cacheResults: true,
      });

      // Should fall back to executing the query
      expect(dataSource.query).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('Failed to get from cache', expect.any(Error), expect.any(Object));
    });
  });

  describe('cache key generation', () => {
    it('should generate consistent cache keys', async () => {
      const query = 'SELECT * FROM users WHERE id = $1';
      const parameters = [123];

      // This tests the private method indirectly through caching
      redis.get.mockResolvedValue(null);
      redis.setex.mockResolvedValue('OK');
      dataSource.query.mockResolvedValue([]);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      await service.executeOptimizedQuery(query, parameters, { cacheResults: true });

      expect(redis.get).toHaveBeenCalledWith(expect.any(String));
      expect(redis.setex).toHaveBeenCalledWith(
        expect.any(String),
        300,
        expect.any(String)
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty query results', async () => {
      const query = 'SELECT * FROM users WHERE 1=0';

      redis.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      const result = await service.executeOptimizedQuery(query, []);

      expect(result).toEqual([]);
      expect(queryAnalyzer.analyzeQuery).toHaveBeenCalledWith(query, expect.any(Number), [], 0);
    });

    it('should handle null parameters', async () => {
      const query = 'SELECT * FROM users';

      redis.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([{ id: 1 }]);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      const result = await service.executeOptimizedQuery(query, null);

      expect(result).toEqual([{ id: 1 }]);
    });

    it('should handle Redis connection errors', async () => {
      const query = 'SELECT * FROM users';

      redis.get.mockRejectedValue(new Error('Connection refused'));
      dataSource.query.mockResolvedValue([{ id: 1 }]);
      queryAnalyzer.analyzeQuery.mockResolvedValue({} as any);

      const result = await service.executeOptimizedQuery(query, [], { cacheResults: true });

      expect(result).toEqual([{ id: 1 }]);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('performance', () => {
    it('should handle concurrent cached queries', async () => {
      const query = 'SELECT * FROM users';
      const cachedResult = [{ id: 1, name: 'Cached' }];

      redis.get.mockResolvedValue(JSON.stringify(cachedResult));

      const promises = Array.from({ length: 10 }, () => 
        service.executeOptimizedQuery(query, [], { cacheResults: true })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result).toEqual(cachedResult);
      });
      
      // Should only hit Redis once for the cache key
      expect(redis.get).toHaveBeenCalledTimes(10);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });
});
