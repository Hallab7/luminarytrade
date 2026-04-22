import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusService } from '../prometheus.service';
import { ConfigService } from '@nestjs/config';

describe('PrometheusService', () => {
  let service: PrometheusService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config = {
        'PROMETHEUS_ENABLED': 'true',
        'PROMETHEUS_PORT': '9090',
        'PROMETHEUS_PATH': '/metrics',
        'PROMETHEUS_PREFIX': 'test_',
        'PROMETHEUS_DEFAULT_METRICS_INTERVAL': '15000',
        'SERVICE_NAME': 'test-service',
        'SERVICE_VERSION': '1.0.0',
        'NODE_ENV': 'test',
        'SERVICE_INSTANCE_ID': 'test-1',
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrometheusService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<PrometheusService>(PrometheusService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    if (service) {
      await service.onModuleDestroy();
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Configuration', () => {
    it('should load configuration correctly', () => {
      expect(configService.get).toHaveBeenCalledWith('PROMETHEUS_ENABLED', 'true');
      expect(configService.get).toHaveBeenCalledWith('PROMETHEUS_PORT', '9090');
    });

    it('should be disabled when PROMETHEUS_ENABLED is false', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'PROMETHEUS_ENABLED') return 'false';
        return 'true';
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PrometheusService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      const disabledService = module.get<PrometheusService>(PrometheusService);
      await disabledService.onModuleInit();

      // Should not throw errors when disabled
      expect(disabledService).toBeDefined();
    });
  });

  describe('HTTP Metrics', () => {
    it('should increment HTTP requests counter', () => {
      const labels = {
        method: 'GET',
        route: '/test',
        status_code: '200',
        service: 'test-service',
      };

      expect(() => service.incrementHttpRequests(labels)).not.toThrow();
    });

    it('should observe HTTP request duration', () => {
      const duration = 0.123;
      const labels = {
        method: 'GET',
        route: '/test',
        status_code: '200',
        service: 'test-service',
      };

      expect(() => service.observeHttpRequestDuration(duration, labels)).not.toThrow();
    });

    it('should observe HTTP request size', () => {
      const size = 1024;
      const labels = {
        method: 'POST',
        route: '/test',
        service: 'test-service',
      };

      expect(() => service.observeHttpRequestSize(size, labels)).not.toThrow();
    });

    it('should observe HTTP response size', () => {
      const size = 2048;
      const labels = {
        method: 'GET',
        route: '/test',
        status_code: '200',
        service: 'test-service',
      };

      expect(() => service.observeHttpResponseSize(size, labels)).not.toThrow();
    });
  });

  describe('Database Metrics', () => {
    it('should increment database queries counter', () => {
      const labels = {
        operation: 'SELECT',
        table: 'users',
        service: 'test-service',
      };

      expect(() => service.incrementDbQueries(labels)).not.toThrow();
    });

    it('should observe database query duration', () => {
      const duration = 0.045;
      const labels = {
        operation: 'SELECT',
        table: 'users',
        service: 'test-service',
      };

      expect(() => service.observeDbQueryDuration(duration, labels)).not.toThrow();
    });

    it('should set database connections active', () => {
      const count = 10;
      const labels = {
        database: 'postgres',
        service: 'test-service',
      };

      expect(() => service.setDbConnectionsActive(count, labels)).not.toThrow();
    });

    it('should set database connections idle', () => {
      const count = 5;
      const labels = {
        database: 'postgres',
        service: 'test-service',
      };

      expect(() => service.setDbConnectionsIdle(count, labels)).not.toThrow();
    });
  });

  describe('Cache Metrics', () => {
    it('should increment cache hits', () => {
      const labels = {
        cache_type: 'redis',
        service: 'test-service',
      };

      expect(() => service.incrementCacheHits(labels)).not.toThrow();
    });

    it('should increment cache misses', () => {
      const labels = {
        cache_type: 'redis',
        service: 'test-service',
      };

      expect(() => service.incrementCacheMisses(labels)).not.toThrow();
    });

    it('should set cache hit ratio', () => {
      const ratio = 0.85;
      const labels = {
        cache_type: 'redis',
        service: 'test-service',
      };

      expect(() => service.setCacheHitRatio(ratio, labels)).not.toThrow();
    });

    it('should increment cache operations', () => {
      const labels = {
        operation: 'get',
        cache_type: 'redis',
        service: 'test-service',
      };

      expect(() => service.incrementCacheOperations(labels)).not.toThrow();
    });
  });

  describe('Job Queue Metrics', () => {
    it('should set job queue depth', () => {
      const depth = 150;
      const labels = {
        queue_name: 'high-priority',
        priority: 'high',
        service: 'test-service',
      };

      expect(() => service.setJobQueueDepth(depth, labels)).not.toThrow();
    });

    it('should observe job processing duration', () => {
      const duration = 2.5;
      const labels = {
        job_type: 'ScoreAgent',
        queue_name: 'high-priority',
        service: 'test-service',
      };

      expect(() => service.observeJobProcessingDuration(duration, labels)).not.toThrow();
    });

    it('should increment job processing total', () => {
      const labels = {
        job_type: 'ScoreAgent',
        status: 'completed',
        service: 'test-service',
      };

      expect(() => service.incrementJobProcessing(labels)).not.toThrow();
    });

    it('should increment job failures total', () => {
      const labels = {
        job_type: 'ScoreAgent',
        error_type: 'timeout',
        service: 'test-service',
      };

      expect(() => service.incrementJobFailures(labels)).not.toThrow();
    });
  });

  describe('AI Provider Metrics', () => {
    it('should increment AI provider requests', () => {
      const labels = {
        provider: 'openai',
        model: 'gpt-4',
        service: 'test-service',
      };

      expect(() => service.incrementAIProviderRequests(labels)).not.toThrow();
    });

    it('should observe AI provider response duration', () => {
      const duration = 1.2;
      const labels = {
        provider: 'openai',
        model: 'gpt-4',
        service: 'test-service',
      };

      expect(() => service.observeAIProviderResponseDuration(duration, labels)).not.toThrow();
    });

    it('should increment AI provider errors', () => {
      const labels = {
        provider: 'openai',
        model: 'gpt-4',
        error_type: 'rate_limit',
        service: 'test-service',
      };

      expect(() => service.incrementAIProviderErrors(labels)).not.toThrow();
    });
  });

  describe('Business Metrics', () => {
    it('should increment credit scores generated', () => {
      const labels = {
        score_range: '700-800',
        service: 'test-service',
      };

      expect(() => service.incrementCreditScoresGenerated(labels)).not.toThrow();
    });

    it('should increment fraud detections', () => {
      const labels = {
        risk_level: 'high',
        service: 'test-service',
      };

      expect(() => service.incrementFraudDetections(labels)).not.toThrow();
    });

    it('should increment blockchain submissions', () => {
      const labels = {
        network: 'stellar',
        service: 'test-service',
      };

      expect(() => service.incrementBlockchainSubmissions(labels)).not.toThrow();
    });

    it('should increment blockchain submission failures', () => {
      const labels = {
        network: 'stellar',
        error_type: 'network_error',
        service: 'test-service',
      };

      expect(() => service.incrementBlockchainSubmissionFailures(labels)).not.toThrow();
    });
  });

  describe('System Metrics', () => {
    it('should set active connections', () => {
      const count = 25;
      const labels = {
        type: 'http',
        service: 'test-service',
      };

      expect(() => service.setActiveConnections(count, labels)).not.toThrow();
    });
  });

  describe('Utility Methods', () => {
    it('should get registry', () => {
      const registry = service.getRegistry();
      expect(registry).toBeDefined();
    });

    it('should get metrics as string', async () => {
      const metrics = await service.getMetrics();
      expect(typeof metrics).toBe('string');
    });

    it('should create custom counter', () => {
      const counter = service.createCounter({
        name: 'test_counter',
        help: 'Test counter',
        labelNames: ['label1', 'label2'],
      });

      expect(counter).toBeDefined();
      expect(counter.inc).toBeDefined();
    });

    it('should create custom histogram', () => {
      const histogram = service.createHistogram({
        name: 'test_histogram',
        help: 'Test histogram',
        labelNames: ['label1'],
        buckets: [0.1, 0.5, 1, 2, 5],
      });

      expect(histogram).toBeDefined();
      expect(histogram.observe).toBeDefined();
    });

    it('should create custom gauge', () => {
      const gauge = service.createGauge({
        name: 'test_gauge',
        help: 'Test gauge',
        labelNames: ['label1'],
      });

      expect(gauge).toBeDefined();
      expect(gauge.set).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing labels gracefully', () => {
      expect(() => service.incrementHttpRequests({})).not.toThrow();
      expect(() => service.observeHttpRequestDuration(0.1, {})).not.toThrow();
    });

    it('should handle negative values appropriately', () => {
      expect(() => service.setJobQueueDepth(-1, {})).not.toThrow();
      expect(() => service.setCacheHitRatio(-0.5, {})).not.toThrow();
    });

    it('should handle very large values', () => {
      expect(() => service.setJobQueueDepth(Number.MAX_SAFE_INTEGER, {})).not.toThrow();
      expect(() => service.observeHttpRequestDuration(999999, {})).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle high-frequency metric updates without errors', () => {
      const labels = {
        method: 'GET',
        route: '/test',
        status_code: '200',
        service: 'test-service',
      };

      const startTime = Date.now();
      
      // Simulate high-frequency updates
      for (let i = 0; i < 1000; i++) {
        service.incrementHttpRequests(labels);
        service.observeHttpRequestDuration(0.1, labels);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});
