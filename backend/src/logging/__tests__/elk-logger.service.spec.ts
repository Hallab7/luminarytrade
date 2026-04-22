import { Test, TestingModule } from '@nestjs/testing';
import { ELKLoggerService, LogLevel, LogContext } from '../elk-logger.service';
import { ConfigService } from '@nestjs/config';

describe('ELKLoggerService', () => {
  let service: ELKLoggerService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config = {
        'ELK_ENABLED': 'false', // Disabled for tests
        'LOG_LEVEL': 'info',
        'LOG_FORMAT': 'json',
        'LOG_CONSOLE': 'true',
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
        ELKLoggerService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ELKLoggerService>(ELKLoggerService);
    configService = module.get<ConfigService>(ConfigService);
    await service.onModuleInit();
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
      expect(configService.get).toHaveBeenCalledWith('ELK_ENABLED', 'true');
      expect(configService.get).toHaveBeenCalledWith('LOG_LEVEL', 'info');
    });

    it('should fallback to console logging when ELK is disabled', async () => {
      expect(service).toBeDefined();
      expect(service.getLogger()).toBeDefined();
    });
  });

  describe('Basic Logging', () => {
    it('should log debug messages', () => {
      const context: LogContext = {
        userId: 'user123',
        traceId: 'trace123',
        spanId: 'span123',
      };

      expect(() => service.debug('Debug message', context, { key: 'value' })).not.toThrow();
    });

    it('should log info messages', () => {
      const context: LogContext = {
        userId: 'user123',
        requestId: 'req123',
      };

      expect(() => service.info('Info message', context, { key: 'value' })).not.toThrow();
    });

    it('should log warning messages', () => {
      expect(() => service.warn('Warning message')).not.toThrow();
    });

    it('should log error messages', () => {
      const error = new Error('Test error');
      expect(() => service.error('Error message', error)).not.toThrow();
    });

    it('should log fatal messages', () => {
      const error = new Error('Fatal error');
      expect(() => service.fatal('Fatal message', error)).not.toThrow();
    });
  });

  describe('Structured Logging', () => {
    it('should log HTTP requests', () => {
      const req = {
        id: 'req123',
        traceId: 'trace123',
        spanId: 'span123',
        method: 'GET',
        url: '/api/test',
        headers: { 'user-agent': 'test-agent' },
        ip: '127.0.0.1',
      };

      const res = {
        statusCode: 200,
      };

      expect(() => service.logHttpRequest(req, res, 150)).not.toThrow();
    });

    it('should log database queries', () => {
      const query = 'SELECT * FROM users WHERE id = $1';
      const duration = 25;
      const context: LogContext = {
        traceId: 'trace123',
      };

      expect(() => service.logDatabaseQuery(query, duration, context)).not.toThrow();
    });

    it('should log job processing', () => {
      const jobType = 'ScoreAgent';
      const jobId = 'job123';
      const duration = 2000;
      const status = 'completed';

      expect(() => service.logJobProcessing(jobType, jobId, duration, status)).not.toThrow();
    });

    it('should log job processing failures', () => {
      const jobType = 'ScoreAgent';
      const jobId = 'job123';
      const duration = 1000;
      const status = 'failed';
      const error = new Error('Job failed');

      expect(() => service.logJobProcessing(jobType, jobId, duration, status, error)).not.toThrow();
    });

    it('should log AI provider calls', () => {
      const provider = 'openai';
      const model = 'gpt-4';
      const duration = 1500;
      const success = true;

      expect(() => service.logAIProviderCall(provider, model, duration, success)).not.toThrow();
    });

    it('should log AI provider call failures', () => {
      const provider = 'openai';
      const model = 'gpt-4';
      const duration = 500;
      const success = false;
      const error = new Error('API error');

      expect(() => service.logAIProviderCall(provider, model, duration, success, error)).not.toThrow();
    });

    it('should log cache operations', () => {
      const operation = 'get';
      const key = 'user:123';
      const hit = true;
      const context: LogContext = {
        traceId: 'trace123',
      };

      expect(() => service.logCacheOperation(operation, key, hit, context)).not.toThrow();
    });

    it('should log blockchain operations', () => {
      const network = 'stellar';
      const operation = 'submit';
      const txHash = 'tx123';
      const success = true;

      expect(() => service.logBlockchainOperation(network, operation, txHash, success)).not.toThrow();
    });

    it('should log blockchain operation failures', () => {
      const network = 'stellar';
      const operation = 'submit';
      const success = false;
      const error = new Error('Network error');

      expect(() => service.logBlockchainOperation(network, operation, undefined, success, error)).not.toThrow();
    });

    it('should log business events', () => {
      const event = 'loan_approved';
      const data = { loanId: 'loan123', amount: 10000 };
      const context: LogContext = {
        userId: 'user123',
      };

      expect(() => service.logBusinessEvent(event, data, context)).not.toThrow();
    });

    it('should log security events', () => {
      const event = 'suspicious_login';
      const severity = 'high' as const;
      const context: LogContext = {
        userId: 'user123',
        traceId: 'trace123',
      };
      const metadata = { ip: '192.168.1.1', userAgent: 'suspicious' };

      expect(() => service.logSecurityEvent(event, severity, context, metadata)).not.toThrow();
    });

    it('should log performance metrics', () => {
      const metric = 'response_time';
      const value = 150;
      const unit = 'ms';
      const context: LogContext = {
        traceId: 'trace123',
      };

      expect(() => service.logPerformanceMetric(metric, value, unit, context)).not.toThrow();
    });
  });

  describe('Utility Methods', () => {
    it('should get logger instance', () => {
      const logger = service.getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should check health status', async () => {
      const isHealthy = await service.isHealthy();
      expect(typeof isHealthy).toBe('boolean');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty context gracefully', () => {
      expect(() => service.info('Test message')).not.toThrow();
      expect(() => service.error('Error message', new Error('test'))).not.toThrow();
    });

    it('should handle null/undefined values', () => {
      expect(() => service.info('Test', null as any)).not.toThrow();
      expect(() => service.info('Test', undefined as any)).not.toThrow();
    });

    it('should handle circular objects in metadata', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      expect(() => service.info('Test', undefined, { data: circular })).not.toThrow();
    });

    it('should handle very long messages', () => {
      const longMessage = 'x'.repeat(10000);
      expect(() => service.info(longMessage)).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle high-frequency logging without errors', () => {
      const startTime = Date.now();
      
      // Simulate high-frequency logging
      for (let i = 0; i < 1000; i++) {
        service.info(`Message ${i}`, { requestId: `req${i}` });
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should handle concurrent logging', async () => {
      const promises = [];
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            service.info(`Concurrent message ${i}`);
            resolve();
          })
        );
      }

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });
  });

  describe('Log Levels', () => {
    it('should respect log level configuration', () => {
      // These should not throw regardless of log level
      expect(() => service.debug('Debug message')).not.toThrow();
      expect(() => service.info('Info message')).not.toThrow();
      expect(() => service.warn('Warning message')).not.toThrow();
      expect(() => service.error('Error message')).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in logging gracefully', () => {
      // Simulate a problematic error object
      const problematicError = {
        message: undefined,
        stack: null,
        toString: () => { throw new Error('toString failed'); },
      };

      expect(() => service.error('Problematic error', problematicError as any)).not.toThrow();
    });

    it('should handle malformed context objects', () => {
      const malformedContext = {
        userId: null,
        traceId: undefined,
        nested: {
          value: 'test',
        },
      };

      expect(() => service.info('Test', malformedContext)).not.toThrow();
    });
  });
});
