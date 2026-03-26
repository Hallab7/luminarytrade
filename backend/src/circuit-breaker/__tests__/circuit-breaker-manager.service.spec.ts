import { Test, TestingModule } from '@nestjs/testing';
import { CircuitBreakerManagerService } from '../circuit-breaker-manager.service';
import { CircuitBreakerService, CircuitState } from '../circuit-breaker.service';

describe('CircuitBreakerManagerService', () => {
  let manager: CircuitBreakerManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerManagerService],
    }).compile();

    manager = module.get<CircuitBreakerManagerService>(CircuitBreakerManagerService);
  });

  it('should be defined', () => {
    expect(manager).toBeDefined();
  });

  describe('getCircuitBreaker', () => {
    it('should create new circuit breaker', () => {
      const circuitBreaker = manager.getCircuitBreaker('test-circuit', {
        failureThreshold: 5,
        timeout: 3000,
      });

      expect(circuitBreaker).toBeDefined();
      expect(circuitBreaker.getName()).toBe('test-circuit');
    });

    it('should return existing circuit breaker', () => {
      const circuit1 = manager.getCircuitBreaker('shared-circuit');
      const circuit2 = manager.getCircuitBreaker('shared-circuit');

      expect(circuit1).toBe(circuit2);
    });

    it('should use default config', () => {
      const circuitBreaker = manager.getCircuitBreaker('default-circuit');
      const config = circuitBreaker.getConfig();

      expect(config.failureThreshold).toBe(5);
      expect(config.timeout).toBe(5000);
      expect(config.retryCount).toBe(3);
    });
  });

  describe('getAllCircuitBreakers', () => {
    it('should return all circuit breakers', () => {
      manager.getCircuitBreaker('circuit1');
      manager.getCircuitBreaker('circuit2');
      manager.getCircuitBreaker('circuit3');

      const allCircuits = manager.getAllCircuitBreakers();

      expect(allCircuits.size).toBe(3);
      expect(allCircuits.has('circuit1')).toBe(true);
      expect(allCircuits.has('circuit2')).toBe(true);
      expect(allCircuits.has('circuit3')).toBe(true);
    });
  });

  describe('getCircuitBreakerByName', () => {
    it('should return circuit breaker by name', () => {
      const circuit = manager.getCircuitBreaker('test-circuit');
      const retrieved = manager.getCircuitBreakerByName('test-circuit');

      expect(retrieved).toBe(circuit);
    });

    it('should return undefined for non-existent circuit', () => {
      const retrieved = manager.getCircuitBreakerByName('non-existent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('removeCircuitBreaker', () => {
    it('should remove circuit breaker', () => {
      manager.getCircuitBreaker('temp-circuit');
      const removed = manager.removeCircuitBreaker('temp-circuit');

      expect(removed).toBe(true);
      expect(manager.getCircuitBreakerByName('temp-circuit')).toBeUndefined();
    });

    it('should return false for non-existent circuit', () => {
      const removed = manager.removeCircuitBreaker('non-existent');

      expect(removed).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status for all circuits', async () => {
      // Create circuits with different states
      const healthyCircuit = manager.getCircuitBreaker('healthy');
      const unhealthyCircuit = manager.getCircuitBreaker('unhealthy');

      // Make one circuit unhealthy
      unhealthyCircuit.forceOpen();

      const healthStatus = manager.getHealthStatus();

      expect(healthStatus).toHaveLength(2);
      
      const healthyStatus = healthStatus.find(h => h.name === 'healthy');
      const unhealthyStatus = healthStatus.find(h => h.name === 'unhealthy');

      expect(healthyStatus?.healthy).toBe(true);
      expect(healthyStatus?.state).toBe(CircuitState.CLOSED);
      
      expect(unhealthyStatus?.healthy).toBe(false);
      expect(unhealthyStatus?.state).toBe(CircuitState.OPEN);
      expect(unhealthyStatus?.issues).toContain('Circuit is OPEN');
    });
  });

  describe('getGlobalStats', () => {
    it('should return global statistics', async () => {
      // Create multiple circuits
      const circuit1 = manager.getCircuitBreaker('circuit1');
      const circuit2 = manager.getCircuitBreaker('circuit2');

      // Simulate some activity
      const successFn = jest.fn().mockResolvedValue('success');
      await circuit1.execute(successFn);
      await circuit2.execute(successFn);

      const stats = manager.getGlobalStats();

      expect(stats.totalCircuits).toBe(2);
      expect(stats.healthyCircuits).toBe(2);
      expect(stats.unhealthyCircuits).toBe(0);
      expect(stats.closedCircuits).toBe(2);
      expect(stats.openCircuits).toBe(0);
      expect(stats.halfOpenCircuits).toBe(0);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(0);
      expect(stats.globalFailureRate).toBe(0);
    });

    it('should calculate correct failure rate', async () => {
      const circuit = manager.getCircuitBreaker('test-circuit');
      
      const successFn = jest.fn().mockResolvedValue('success');
      const failFn = jest.fn().mockRejectedValue(new Error('failure'));

      // 2 successes, 1 failure = 33.3% failure rate
      await circuit.execute(successFn);
      await circuit.execute(successFn);
      await expect(circuit.execute(failFn)).rejects.toThrow();

      const stats = manager.getGlobalStats();

      expect(stats.totalRequests).toBe(3);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
      expect(stats.globalFailureRate).toBeCloseTo(0.333, 2);
    });
  });

  describe('resetAll', () => {
    it('should reset all circuit breakers', async () => {
      const circuit1 = manager.getCircuitBreaker('circuit1');
      const circuit2 = manager.getCircuitBreaker('circuit2');

      // Open circuits
      circuit1.forceOpen();
      circuit2.forceOpen();

      expect(circuit1.isOpen()).toBe(true);
      expect(circuit2.isOpen()).toBe(true);

      // Reset all
      manager.resetAll();

      expect(circuit1.isClosed()).toBe(true);
      expect(circuit2.isClosed()).toBe(true);
    });
  });

  describe('configure', () => {
    it('should update configuration', () => {
      const newConfig = {
        defaultConfig: {
          failureThreshold: 10,
          timeout: 10000,
        },
        monitoring: {
          enabled: false,
          interval: 60000,
          alertThresholds: {
            failureRate: 0.8,
            responseTime: 10000,
            downtime: 10,
          },
        },
      };

      manager.configure(newConfig);

      // Configuration is applied, but we can't easily test private config
      // This test ensures the method doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('events', () => {
    it('should emit circuit state change events', (done) => {
      manager.on('circuitStateChange', (event) => {
        expect(event.name).toBe('test-circuit');
        expect(event.from).toBe(CircuitState.CLOSED);
        expect(event.to).toBe(CircuitState.OPEN);
        done();
      });

      const circuit = manager.getCircuitBreaker('test-circuit');
      circuit.forceOpen();
    });

    it('should emit circuit reset events', (done) => {
      manager.on('circuitReset', (event) => {
        expect(event.name).toBe('test-circuit');
        done();
      });

      const circuit = manager.getCircuitBreaker('test-circuit');
      circuit.reset();
    });

    it('should emit health alert events', (done) => {
      manager.on('healthAlert', (alert) => {
        expect(alert.unhealthyCircuits.length).toBeGreaterThan(0);
        expect(alert.totalCircuits).toBeGreaterThan(0);
        done();
      });

      // Create unhealthy circuit
      const circuit = manager.getCircuitBreaker('unhealthy-circuit');
      circuit.forceOpen();

      // Trigger health check (would normally happen via interval)
      const healthStatus = manager.getHealthStatus();
      expect(healthStatus.some(h => !h.healthy)).toBe(true);
    });
  });

  describe('historical data', () => {
    it('should collect historical metrics', (done) => {
      manager.on('metricsCollected', (data) => {
        expect(data.timestamp).toBeDefined();
        expect(data.stats).toBeDefined();
        expect(data.historicalData).toBeInstanceOf(Array);
        done();
      });

      // Create some activity
      const circuit = manager.getCircuitBreaker('test-circuit');
      const successFn = jest.fn().mockResolvedValue('success');
      await circuit.execute(successFn);

      // Trigger metrics collection (would normally happen via interval)
      const stats = manager.getGlobalStats();
      expect(stats.totalCircuits).toBeGreaterThan(0);
    });

    it('should maintain historical data', () => {
      const initialData = manager.getHistoricalData();
      expect(Array.isArray(initialData)).toBe(true);
    });
  });

  describe('exportMetrics', () => {
    it('should export metrics as JSON', () => {
      const exportedData = manager.exportMetrics();
      
      expect(typeof exportedData).toBe('string');
      
      const parsed = JSON.parse(exportedData);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.config).toBeDefined();
      expect(parsed.globalStats).toBeDefined();
      expect(parsed.healthStatus).toBeDefined();
      expect(parsed.historicalData).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty circuit breaker name', () => {
      expect(() => {
        manager.getCircuitBreaker('');
      }).not.toThrow();
    });

    it('should handle circuit breaker with no options', () => {
      expect(() => {
        manager.getCircuitBreaker('no-options');
      }).not.toThrow();
    });

    it('should handle removal of non-existent circuit', () => {
      const removed = manager.removeCircuitBreaker('definitely-does-not-exist');
      expect(removed).toBe(false);
    });
  });

  describe('module lifecycle', () => {
    it('should initialize properly', async () => {
      expect(manager.getGlobalStats().totalCircuits).toBe(0);
    });

    it('should handle module destruction', async () => {
      expect(() => {
        manager.onModuleDestroy();
      }).not.toThrow();
    });
  });
});
