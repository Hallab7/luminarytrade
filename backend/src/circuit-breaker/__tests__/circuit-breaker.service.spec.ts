import { Test, TestingModule } from '@nestjs/testing';
import { CircuitBreakerService, CircuitState } from '../circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    service = new CircuitBreakerService('test-circuit', {
      failureThreshold: 3,
      resetTimeout: 60000,
      monitoringPeriod: 10000,
      expectedRecoveryTime: 30000,
      timeout: 5000,
      retryCount: 2,
      retryDelay: 1000,
      retryBackoffMultiplier: 2,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should start in CLOSED state', () => {
    expect(service.getState()).toBe(CircuitState.CLOSED);
    expect(service.isClosed()).toBe(true);
    expect(service.isOpen()).toBe(false);
    expect(service.isHalfOpen()).toBe(false);
  });

  describe('execute', () => {
    it('should execute successful function', async () => {
      const successFn = jest.fn().mockResolvedValue('success');
      
      const result = await service.execute(successFn);
      
      expect(result).toBe('success');
      expect(successFn).toHaveBeenCalledTimes(1);
      expect(service.isClosed()).toBe(true);
    });

    it('should handle function failure and open circuit after threshold', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      // First failure
      await expect(service.execute(failFn)).rejects.toThrow('Test error');
      expect(service.isClosed()).toBe(true);
      
      // Second failure
      await expect(service.execute(failFn)).rejects.toThrow('Test error');
      expect(service.isClosed()).toBe(true);
      
      // Third failure - should open circuit
      await expect(service.execute(failFn)).rejects.toThrow('Test error');
      expect(service.isOpen()).toBe(true);
    });

    it('should use fallback when circuit is open', async () => {
      const fallbackFn = jest.fn().mockReturnValue('fallback-result');
      const failFn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      const serviceWithFallback = new CircuitBreakerService('test-circuit', {
        failureThreshold: 1,
        resetTimeout: 60000,
        monitoringPeriod: 10000,
        expectedRecoveryTime: 30000,
        timeout: 5000,
        retryCount: 2,
        retryDelay: 1000,
        retryBackoffMultiplier: 2,
      }, {
        fallback: fallbackFn,
      });
      
      // First failure to open circuit
      await expect(serviceWithFallback.execute(failFn)).rejects.toThrow('Test error');
      
      // Second call should use fallback
      const result = await serviceWithFallback.execute(failFn);
      
      expect(result).toBe('fallback-result');
      expect(fallbackFn).toHaveBeenCalled();
    });

    it('should retry failed function', async () => {
      let attemptCount = 0;
      const retryFn = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error(`Attempt ${attemptCount} failed`));
        }
        return Promise.resolve('success after retries');
      });
      
      const result = await service.execute(retryFn);
      
      expect(result).toBe('success after retries');
      expect(retryFn).toHaveBeenCalledTimes(3);
    });

    it('should timeout long-running function', async () => {
      const longRunningFn = jest.fn().mockImplementation(() => {
        return new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
      });
      
      await expect(service.execute(longRunningFn)).rejects.toThrow('timed out');
      expect(longRunningFn).toHaveBeenCalledTimes(1);
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(service.execute(failFn)).rejects.toThrow('Test error');
      }
      
      expect(service.isOpen()).toBe(true);
      
      // Wait for reset timeout (simulate with shorter timeout for testing)
      const serviceWithShortTimeout = new CircuitBreakerService('test-circuit', {
        failureThreshold: 1,
        resetTimeout: 100, // 100ms
        monitoringPeriod: 10000,
        expectedRecoveryTime: 30000,
        timeout: 5000,
        retryCount: 0,
        retryDelay: 1000,
        retryBackoffMultiplier: 2,
      });
      
      const successFn = jest.fn().mockResolvedValue('success');
      await serviceWithShortTimeout.execute(successFn);
      expect(serviceWithShortTimeout.isOpen()).toBe(true);
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Next call should succeed and close circuit
      const result = await serviceWithShortTimeout.execute(successFn);
      expect(result).toBe('success');
      expect(serviceWithShortTimeout.isClosed()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return circuit statistics', async () => {
      const successFn = jest.fn().mockResolvedValue('success');
      const failFn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      // Successful execution
      await service.execute(successFn);
      
      // Failed execution
      await expect(service.execute(failFn)).rejects.toThrow();
      
      const stats = service.getStats();
      
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.successes).toBe(1);
      expect(stats.failures).toBe(1);
      expect(stats.lastSuccessTime).toBeDefined();
      expect(stats.lastFailureTime).toBeDefined();
      expect(stats.uptime).toBeGreaterThan(0);
      expect(stats.downtime).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset circuit to initial state', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      // Cause failures to open circuit
      for (let i = 0; i < 3; i++) {
        await expect(service.execute(failFn)).rejects.toThrow('Test error');
      }
      
      expect(service.isOpen()).toBe(true);
      expect(service.getStats().failures).toBe(3);
      
      // Reset circuit
      service.reset();
      
      expect(service.isClosed()).toBe(true);
      expect(service.getStats().failures).toBe(0);
      expect(service.getStats().successes).toBe(0);
    });
  });

  describe('forceOpen', () => {
    it('should force circuit open', () => {
      service.forceOpen();
      
      expect(service.isOpen()).toBe(true);
      expect(service.isClosed()).toBe(false);
      expect(service.isHalfOpen()).toBe(false);
    });
  });

  describe('forceClose', () => {
    it('should force circuit closed', () => {
      service.forceOpen(); // Open first
      service.forceClose(); // Then close
      
      expect(service.isClosed()).toBe(true);
      expect(service.isOpen()).toBe(false);
      expect(service.isHalfOpen()).toBe(false);
    });
  });

  describe('configuration', () => {
    it('should validate configuration on creation', () => {
      expect(() => {
        new CircuitBreakerService('test', {
          failureThreshold: 0, // Invalid
          resetTimeout: 60000,
          monitoringPeriod: 10000,
          expectedRecoveryTime: 30000,
          timeout: 5000,
          retryCount: 2,
          retryDelay: 1000,
          retryBackoffMultiplier: 2,
        });
      }).toThrow('failureThreshold must be greater than 0');
    });

    it('should update configuration', () => {
      service.updateConfig({
        failureThreshold: 10,
        timeout: 10000,
      });
      
      const config = service.getConfig();
      expect(config.failureThreshold).toBe(10);
      expect(config.timeout).toBe(10000);
    });
  });

  describe('events', () => {
    it('should emit state change events', (done) => {
      service.on('stateChange', (event) => {
        expect(event.name).toBe('test-circuit');
        expect(event.from).toBe(CircuitState.CLOSED);
        expect(event.to).toBe(CircuitState.OPEN);
        done();
      });
      
      // Force state change
      service.forceOpen();
    });

    it('should emit reset events', (done) => {
      service.on('reset', (event) => {
        expect(event.name).toBe('test-circuit');
        done();
      });
      
      service.reset();
    });
  });

  describe('exponential backoff', () => {
    it('should apply exponential backoff for retries', async () => {
      let attemptCount = 0;
      const startTime = Date.now();
      
      const retryFn = jest.fn().mockImplementation(() => {
        attemptCount++;
        return Promise.reject(new Error(`Attempt ${attemptCount}`));
      });
      
      await expect(service.execute(retryFn)).rejects.toThrow();
      
      const duration = Date.now() - startTime;
      
      // Should have retried 3 times (initial + 2 retries)
      expect(retryFn).toHaveBeenCalledTimes(3);
      
      // Should have taken some time due to delays
      expect(duration).toBeGreaterThan(2000); // At least 2 delays of 1000ms each
    });
  });

  describe('edge cases', () => {
    it('should handle empty function name', () => {
      expect(() => {
        new CircuitBreakerService('', {
          failureThreshold: 5,
          resetTimeout: 60000,
          monitoringPeriod: 10000,
          expectedRecoveryTime: 30000,
          timeout: 5000,
          retryCount: 2,
          retryDelay: 1000,
          retryBackoffMultiplier: 2,
        });
      }).not.toThrow();
    });

    it('should handle zero retries', async () => {
      const serviceNoRetries = new CircuitBreakerService('test-circuit', {
        failureThreshold: 1,
        resetTimeout: 60000,
        monitoringPeriod: 10000,
        expectedRecoveryTime: 30000,
        timeout: 5000,
        retryCount: 0, // No retries
        retryDelay: 1000,
        retryBackoffMultiplier: 2,
      });
      
      const failFn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      await expect(serviceNoRetries.execute(failFn)).rejects.toThrow('Test error');
      
      // Should only be called once (no retries)
      expect(failFn).toHaveBeenCalledTimes(1);
    });

    it('should handle zero timeout', async () => {
      const serviceNoTimeout = new CircuitBreakerService('test-circuit', {
        failureThreshold: 5,
        resetTimeout: 60000,
        monitoringPeriod: 10000,
        expectedRecoveryTime: 30000,
        timeout: 0, // No timeout
        retryCount: 2,
        retryDelay: 1000,
        retryBackoffMultiplier: 2,
      });
      
      const longRunningFn = jest.fn().mockImplementation(() => {
        return new Promise(resolve => setTimeout(resolve, 100));
      });
      
      const result = await serviceNoTimeout.execute(longRunningFn);
      
      expect(result).toBeUndefined();
      expect(longRunningFn).toHaveBeenCalledTimes(1);
    });
  });
});
