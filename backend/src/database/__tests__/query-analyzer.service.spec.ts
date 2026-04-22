import { Test, TestingModule } from '@nestjs/testing';
import { QueryAnalyzerService, QueryAnalysis, SlowQuery } from '../query-analyzer.service';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { PrometheusService } from '../../metrics/prometheus.service';
import { ELKLoggerService } from '../../logging/elk-logger.service';

describe('QueryAnalyzerService', () => {
  let service: QueryAnalyzerService;
  let dataSource: jest.Mocked<DataSource>;
  let configService: jest.Mocked<ConfigService>;
  let appConfig: jest.Mocked<AppConfigService>;
  let prometheus: jest.Mocked<PrometheusService>;
  let logger: jest.Mocked<ELKLoggerService>;

  const mockAppConfig = {
    nodeEnv: 'test',
    database: {
      slowQueryThreshold: 1000,
      enableExplainAnalyze: true,
      enableQueryLogging: true,
      enableQueryCache: true,
      enableStatementTimeout: true,
      statementTimeout: 30000,
    },
  } as any;

  beforeEach(async () => {
    const mockDataSource = {
      query: jest.fn(),
      driver: {
        master: {
          pool: {
            numUsed: 5,
            numFree: 10,
            pendingRequests: 0,
          },
        },
      },
    } as any;

    const mockConfigService = {
      get: jest.fn(),
    } as any;

    const mockAppConfigService = {
      nodeEnv: 'test',
      database: mockAppConfig.database,
    } as any;

    const mockPrometheusService = {
      incrementDbQueries: jest.fn(),
      observeDbQueryDuration: jest.fn(),
      setDbConnectionsActive: jest.fn(),
    } as any;

    const mockLoggerService = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryAnalyzerService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AppConfigService,
          useValue: mockAppConfigService,
        },
        {
          provide: PrometheusService,
          useValue: mockPrometheusService,
        },
        {
          provide: ELKLoggerService,
          useValue: mockLoggerService,
        },
      ],
    }).compile();

    service = module.get<QueryAnalyzerService>(QueryAnalyzerService);
    dataSource = module.get(DataSource);
    configService = module.get(ConfigService);
    appConfig = module.get(AppConfigService);
    prometheus = module.get(PrometheusService);
    logger = module.get(ELKLoggerService);

    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeQuery', () => {
    it('should analyze a simple query', async () => {
      const query = 'SELECT * FROM users WHERE id = $1';
      const executionTime = 500;
      const parameters = [123];
      const rowCount = 1;

      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Index Scan' } }]);

      const result = await service.analyzeQuery(query, executionTime, parameters, rowCount);

      expect(result).toMatchObject({
        query,
        normalizedQuery: 'select * from users where id = $1',
        executionTime,
        timestamp: expect.any(Date),
        parameters,
        rowCount,
        queryType: 'SELECT',
        tables: ['users'],
        isSlow: false,
        isN1: true,
        suggestions: expect.any(Array),
      });

      expect(prometheus.incrementDbQueries).toHaveBeenCalledWith({
        query_type: 'SELECT',
        is_slow: 'false',
        is_n1: 'true',
        service: 'luminarytrade-backend',
      });

      expect(prometheus.observeDbQueryDuration).toHaveBeenCalledWith(0.5, {
        query_type: 'SELECT',
        is_slow: 'false',
        is_n1: 'true',
        service: 'luminarytrade-backend',
      });
    });

    it('should detect slow queries', async () => {
      const query = 'SELECT * FROM orders';
      const executionTime = 1500; // Above threshold

      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);

      const result = await service.analyzeQuery(query, executionTime);

      expect(result.isSlow).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith('Slow query detected', undefined, expect.objectContaining({
        query: 'select * from orders',
        executionTime: 1500,
      }));
    });

    it('should detect N+1 queries', async () => {
      const query = 'SELECT * FROM users WHERE id = $1';
      const executionTime = 200;

      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Index Scan' } }]);

      const result = await service.analyzeQuery(query, executionTime);

      expect(result.isN1).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith('Potential N+1 query detected', undefined, expect.objectContaining({
        query: 'select * from users where id = $1',
      }));
    });

    it('should generate suggestions for SELECT * queries', async () => {
      const query = 'SELECT * FROM users';
      const executionTime = 300;

      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);

      const result = await service.analyzeQuery(query, executionTime);

      expect(result.suggestions).toContain('Avoid SELECT *. Specify only needed columns.');
    });

    it('should handle query analysis errors gracefully', async () => {
      const query = 'INVALID QUERY';
      const executionTime = 100;

      dataSource.query.mockRejectedValue(new Error('Syntax error'));

      const result = await service.analyzeQuery(query, executionTime);

      expect(result.queryType).toBe('SELECT');
      expect(logger.error).toHaveBeenCalledWith('Failed to execute EXPLAIN ANALYZE', expect.any(Error), expect.any(Object));
    });
  });

  describe('getSlowQueries', () => {
    it('should return slow queries from the last hour', async () => {
      // First, add some slow queries
      await service.analyzeQuery('SELECT * FROM users', 1500);
      await service.analyzeQuery('SELECT * FROM orders', 2000);

      const slowQueries = service.getSlowQueries(1);

      expect(slowQueries).toHaveLength(2);
      expect(slowQueries[0]).toMatchObject({
        query: 'SELECT * FROM users',
        executionTime: 1500,
        suggestions: expect.any(Array),
      });
    });

    it('should return empty array when no slow queries', () => {
      const slowQueries = service.getSlowQueries(1);
      expect(slowQueries).toHaveLength(0);
    });

    it('should respect time filter', async () => {
      // Add a slow query
      await service.analyzeQuery('SELECT * FROM users', 1500);

      // Get queries from last 0 hours (should be empty)
      const slowQueries = service.getSlowQueries(0);
      expect(slowQueries).toHaveLength(0);
    });
  });

  describe('getQueryStats', () => {
    it('should return comprehensive query statistics', async () => {
      // Add some queries
      await service.analyzeQuery('SELECT * FROM users', 500);
      await service.analyzeQuery('SELECT * FROM users', 1500);
      await service.analyzeQuery('SELECT * FROM orders', 800);

      const stats = await service.getQueryStats();

      expect(stats).toMatchObject({
        totalQueries: 3,
        averageExecutionTime: expect.any(Number),
        slowQueriesCount: 1,
        n1QueriesCount: expect.any(Number),
        topQueriesByTime: expect.any(Array),
        topQueriesByFrequency: expect.any(Array),
        indexUsageStats: expect.any(Object),
      });

      expect(stats.slowQueriesCount).toBe(1); // Only the 1500ms query
    });

    it('should return empty stats when no queries', async () => {
      const stats = await service.getQueryStats();

      expect(stats).toMatchObject({
        totalQueries: 0,
        averageExecutionTime: 0,
        slowQueriesCount: 0,
        n1QueriesCount: 0,
        topQueriesByTime: [],
        topQueriesByFrequency: [],
        indexUsageStats: {},
      });
    });
  });

  describe('getConnectionPoolStatus', () => {
    it('should return connection pool status', async () => {
      const status = await service.getConnectionPoolStatus();

      expect(status).toMatchObject({
        totalConnections: expect.any(Number),
        activeConnections: expect.any(Number),
        idleConnections: expect.any(Number),
        queuedConnections: expect.any(Number),
        maxConnections: expect.any(Number),
        minConnections: expect.any(Number),
        utilization: expect.any(Number),
      });
    });

    it('should handle missing pool gracefully', async () => {
      dataSource.driver = { master: { pool: null } } as any;

      const status = await service.getConnectionPoolStatus();

      expect(status).toMatchObject({
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        queuedConnections: 0,
        utilization: 0,
      });
    });
  });

  describe('suggestIndexes', () => {
    it('should suggest indexes for sequential scans', async () => {
      // Add a query with sequential scan
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);
      await service.analyzeQuery('SELECT * FROM users WHERE email = $1', 800);

      const suggestions = await service.suggestIndexes();

      expect(suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: 'users',
            columns: expect.any(Array),
            reason: 'Sequential scan detected',
            estimatedImpact: expect.any(String),
          }),
        ])
      );
    });

    it('should return empty suggestions when no sequential scans', async () => {
      // Add a query with index scan
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Index Scan' } }]);
      await service.analyzeQuery('SELECT * FROM users WHERE id = $1', 200);

      const suggestions = await service.suggestIndexes();
      expect(suggestions).toHaveLength(0);
    });
  });

  describe('getExplainPlan', () => {
    it('should return query execution plan', async () => {
      const query = 'SELECT * FROM users WHERE id = $1';
      const mockPlan = {
        'Node Type': 'Index Scan',
        'Relation Name': 'users',
        'Total Cost': 8.28,
        'Actual Total Time': 0.05,
        'Actual Rows': 1,
      };

      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': [mockPlan] }]);

      const plan = await service.getExplainPlan(query, [123]);

      expect(plan).toMatchObject({
        planType: 'Index Scan',
        relation: 'users',
        cost: 8.28,
        actualTime: 0.05,
        rows: 1,
      });
    });

    it('should handle explain plan errors', async () => {
      const query = 'INVALID QUERY';

      dataSource.query.mockRejectedValue(new Error('Syntax error'));

      await expect(service.getExplainPlan(query)).rejects.toThrow('Syntax error');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to execute EXPLAIN ANALYZE',
        expect.any(Error),
        expect.any(Object)
      );
    });
  });

  describe('query normalization', () => {
    it('should normalize queries correctly', async () => {
      const queries = [
        'SELECT * FROM users',
        'select   *   from   users',
        'SELECT * FROM users   ',
        'SELECT * FROM users;',
      ];

      for (const query of queries) {
        dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);
        const result = await service.analyzeQuery(query, 100);
        
        expect(result.normalizedQuery).toBe('select * from users');
      }
    });
  });

  describe('query type detection', () => {
    const testCases = [
      ['SELECT * FROM users', 'SELECT'],
      ['INSERT INTO users VALUES (1)', 'INSERT'],
      ['UPDATE users SET name = $1', 'UPDATE'],
      ['DELETE FROM users WHERE id = $1', 'DELETE'],
      ['CREATE TABLE test (id INT)', 'CREATE'],
      ['DROP TABLE test', 'DROP'],
      ['ALTER TABLE test ADD COLUMN name TEXT', 'ALTER'],
    ];

    it.each(testCases)('should detect query type: %s', async (query, expectedType) => {
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);
      const result = await service.analyzeQuery(query, 100);
      
      expect(result.queryType).toBe(expectedType);
    });
  });

  describe('table extraction', () => {
    it('should extract tables from complex queries', async () => {
      const query = 'SELECT u.*, o.amount FROM users u JOIN orders o ON u.id = o.user_id WHERE u.status = $1';
      
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Hash Join' } }]);
      const result = await service.analyzeQuery(query, 100);
      
      expect(result.tables).toEqual(['users', 'orders']);
    });
  });

  describe('column extraction', () => {
    it('should extract columns from SELECT clause', async () => {
      const query = 'SELECT id, name, email FROM users';
      
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);
      const result = await service.analyzeQuery(query, 100);
      
      expect(result.columns).toEqual(['id', 'name', 'email']);
    });

    it('should handle table-qualified columns', async () => {
      const query = 'SELECT u.id, u.name FROM users u';
      
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);
      const result = await service.analyzeQuery(query, 100);
      
      expect(result.columns).toEqual(['id', 'name']);
    });
  });

  describe('performance metrics', () => {
    it('should record metrics for all queries', async () => {
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Index Scan' } }]);

      await service.analyzeQuery('SELECT * FROM users', 200);
      await service.analyzeQuery('SELECT * FROM users', 1500); // Slow
      await service.analyzeQuery('SELECT * FROM users WHERE id = $1', 100); // N+1

      expect(prometheus.incrementDbQueries).toHaveBeenCalledTimes(3);
      expect(prometheus.observeDbQueryDuration).toHaveBeenCalledTimes(3);
    });

    it('should record additional metrics for slow queries', async () => {
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);

      await service.analyzeQuery('SELECT * FROM users', 1500);

      expect(prometheus.incrementDbQueries).toHaveBeenCalledWith({
        query_type: 'SELECT',
        is_slow: 'true',
        is_n1: 'false',
        service: 'luminarytrade-backend',
      });
    });

    it('should record additional metrics for N+1 queries', async () => {
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Index Scan' } }]);

      await service.analyzeQuery('SELECT * FROM users WHERE id = $1', 100);

      expect(prometheus.incrementDbQueries).toHaveBeenCalledWith({
        query_type: 'SELECT',
        is_slow: 'false',
        is_n1: 'true',
        service: 'luminarytrade-backend',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty queries', async () => {
      const result = await service.analyzeQuery('', 100);
      
      expect(result.queryType).toBe('SELECT');
      expect(result.tables).toEqual([]);
      expect(result.columns).toEqual([]);
    });

    it('should handle queries with special characters', async () => {
      const query = "SELECT * FROM users WHERE name = 'O''Reilly'";
      
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);
      const result = await service.analyzeQuery(query, 100);
      
      expect(result.normalizedQuery).toContain("o'reilly");
    });

    it('should handle very long queries', async () => {
      const longQuery = 'SELECT ' + 'col1, '.repeat(100) + 'col100 FROM users';
      
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Seq Scan' } }]);
      const result = await service.analyzeQuery(longQuery, 100);
      
      expect(result.query).toBe(longQuery);
      expect(result.normalizedQuery).toBeDefined();
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent query analysis', async () => {
      dataSource.query.mockResolvedValue([{ 'QUERY PLAN': { 'Node Type': 'Index Scan' } }]);

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(service.analyzeQuery(`SELECT * FROM users WHERE id = ${i}`, 100));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, index) => {
        expect(result.query).toContain(`id = ${index}`);
      });
    });
  });
});
