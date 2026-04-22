import { Test, TestingModule } from '@nestjs/testing';
import { CircuitBreaker, CircuitBreakerState, CircuitBreakerConfig } from '../circuit-breaker';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let successOperation: jest.Mock;
  let failureOperation: jest.Mock;
  let timeoutOperation: jest.Mock;

  beforeEach(() => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 3,
      resetTimeout: 1000, // 1 second for faster testing
      successThreshold: 2,
      monitoringEnabled: true,
      timeout: 5000,
      halfOpenMaxCalls: 1,
    };

    circuitBreaker = new CircuitBreaker('test-circuit', config);
    
    successOperation = jest.fn().mockResolvedValue('success');
    failureOperation = jest.fn().mockRejectedValue(new Error('failure'));
    timeoutOperation = jest.fn().mockImplementation(() => 
      new Promise(resolve => setTimeout(resolve, 10000)) // 10 second timeout
    );
  });

  afterEach(() => {
    circuitBreaker.reset();
    jest.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should be defined', () => {
      expect(circuitBreaker).toBeDefined();
    });

    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.isClosed()).toBe(true);
      expect(circuitBreaker.isOpen()).toBe(false);
      expect(circuitBreaker.isHalfOpen()).toBe(false);
    });

    it('should execute successful operation', async () => {
      const result = await circuitBreaker.execute(successOperation);
      
      expect(result).toBe('success');
      expect(successOperation).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should handle operation failure', async () => {
      await expect(circuitBreaker.execute(failureOperation)).rejects.toThrow('failure');
      
      expect(failureOperation).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition to OPEN after failure threshold', async () => {
      // Execute failures to reach threshold
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failureOperation);
        } catch (error) {
          // Expected to fail
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(circuitBreaker.isOpen()).toBe(true);
    });

    it('should reject immediately when OPEN', async () => {
      // Force circuit to OPEN
      circuitBreaker.forceOpen();
      
      await expect(circuitBreaker.execute(successOperation)).rejects.toThrow(
        'Circuit breaker is OPEN for test-circuit'
      );
      
      expect(successOperation).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      // Force circuit to OPEN
      circuitBreaker.forceOpen();
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Next call should transition to HALF_OPEN and attempt operation
      try {
        await circuitBreaker.execute(successOperation);
      } catch (error) {
        // Expected to fail in this test
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      expect(circuitBreaker.isHalfOpen()).toBe(true);
    });

    it('should transition back to CLOSED after successful HALF_OPEN operations', async () => {
      // Force circuit to OPEN
      circuitBreaker.forceOpen();
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Execute successful operations to meet success threshold
      await circuitBreaker.execute(successOperation);
      await circuitBreaker.execute(successOperation);
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.isClosed()).toBe(true);
    });

    it('should transition back to OPEN on failure in HALF_OPEN', async () => {
      // Force circuit to OPEN
      circuitBreaker.forceOpen();
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Execute failure in HALF_OPEN
      try {
        await circuitBreaker.execute(failureOperation);
      } catch (error) {
        // Expected to fail
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track metrics correctly', async () => {
      // Execute some operations
      await circuitBreaker.execute(successOperation);
      
      try {
        await circuitBreaker.execute(failureOperation);
      } catch (error) {
        // Expected to fail
      }
      
      await circuitBreaker.execute(successOperation);
      
      const metrics = circuitBreaker.getMetrics();
      
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.totalSuccesses).toBe(2);
      expect(metrics.totalFailures).toBe(1);
      expect(metrics.failureCount).toBe(1);
      expect(metrics.successCount).toBe(0);
      expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
      expect(metrics.averageResponseTime).toBeGreaterThan(0);
    });

    it('should calculate success and failure rates', async () => {
      // Execute operations
      await circuitBreaker.execute(successOperation);
      await circuitBreaker.execute(successOperation);
      
      try {
        await circuitBreaker.execute(failureOperation);
      } catch (error) {
        // Expected to fail
      }
      
      expect(circuitBreaker.getSuccessRate()).toBe(66.67); // 2/3 * 100
      expect(circuitBreaker.getFailureRate()).toBe(33.33); // 1/3 * 100
    });

    it('should track state transitions', async () => {
      const initialMetrics = circuitBreaker.getMetrics();
      expect(initialMetrics.stateTransitionCount).toBe(0);
      
      // Force state transition
      circuitBreaker.forceOpen();
      
      const afterOpenMetrics = circuitBreaker.getMetrics();
      expect(afterOpenMetrics.stateTransitionCount).toBe(1);
      expect(afterOpenMetrics.lastStateTransition).toContain('Transitioned from CLOSED to OPEN');
      
      // Reset
      circuitBreaker.reset();
      
      const afterResetMetrics = circuitBreaker.getMetrics();
      expect(afterResetMetrics.stateTransitionCount).toBe(2);
    });

    it('should record events', async () => {
      await circuitBreaker.execute(successOperation);
      
      try {
        await circuitBreaker.execute(failureOperation);
      } catch (error) {
        // Expected to fail
      }
      
      const events = circuitBreaker.getEvents();
      
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('SUCCESS');
      expect(events[1].type).toBe('FAILURE');
      expect(events[0].responseTime).toBeGreaterThan(0);
      expect(events[1].error).toBe('failure');
    });

    it('should track time in current state', async () => {
      const startTime = Date.now();
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics = circuitBreaker.getMetrics();
      const timeInState = metrics.timeInCurrentState;
      
      expect(timeInState).toBeGreaterThanOrEqual(100);
      expect(timeInState).toBeLessThan(200); // Allow some tolerance
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running operations', async () => {
      const shortTimeoutConfig: Partial<CircuitBreakerConfig> = {
        timeout: 100, // 100ms timeout
      };
      
      const shortTimeoutCircuit = new CircuitBreaker('timeout-test', shortTimeoutConfig);
      
      await expect(shortTimeoutCircuit.execute(timeoutOperation)).rejects.toThrow(
        'Operation timed out after 100ms'
      );
      
      const events = shortTimeoutCircuit.getEvents();
      expect(events.some(e => e.type === 'TIMEOUT')).toBe(true);
    });

    it('should not timeout fast operations', async () => {
      const fastOperation = jest.fn().mockResolvedValue('fast');
      
      const result = await circuitBreaker.execute(fastOperation);
      
      expect(result).toBe('fast');
      expect(fastOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle zero timeout', async () => {
      const noTimeoutConfig: Partial<CircuitBreakerConfig> = {
        timeout: 0,
      };
      
      const noTimeoutCircuit = new CircuitBreaker('no-timeout-test', noTimeoutConfig);
      
      const result = await noTimeoutCircuit.execute(successOperation);
      
      expect(result).toBe('success');
      expect(successOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Configuration', () => {
    it('should use custom configuration', () => {
      const customConfig: Partial<CircuitBreakerConfig> = {
        failureThreshold: 10,
        resetTimeout: 5000,
        successThreshold: 5,
        timeout: 15000,
        halfOpenMaxCalls: 3,
      };
      
      const customCircuit = new CircuitBreaker('custom-test', customConfig);
      const config = customCircuit.getConfig();
      
      expect(config.failureThreshold).toBe(10);
      expect(config.resetTimeout).toBe(5000);
      expect(config.successThreshold).toBe(5);
      expect(config.timeout).toBe(15000);
      expect(config.halfOpenMaxCalls).toBe(3);
    });

    it('should update configuration', () => {
      circuitBreaker.updateConfig({
        failureThreshold: 7,
        timeout: 8000,
      });
      
      const config = circuitBreaker.getConfig();
      expect(config.failureThreshold).toBe(7);
      expect(config.timeout).toBe(8000);
    });

    it('should disable monitoring when configured', () => {
      const noMonitoringConfig: Partial<CircuitBreakerConfig> = {
        monitoringEnabled: false,
      };
      
      const noMonitoringCircuit = new CircuitBreaker('no-monitoring-test', noMonitoringConfig);
      
      noMonitoringCircuit.execute(successOperation);
      
      const events = noMonitoringCircuit.getEvents();
      expect(events).toHaveLength(0);
    });
  });

  describe('Half-Open Behavior', () => {
    it('should limit calls in HALF_OPEN state', async () => {
      const halfOpenConfig: Partial<CircuitBreakerConfig> = {
        failureThreshold: 2,
        resetTimeout: 500,
        halfOpenMaxCalls: 2,
      };
      
      const halfOpenCircuit = new CircuitBreaker('half-open-test', halfOpenConfig);
      
      // Force to OPEN
      await halfOpenCircuit.execute(failureOperation);
      await halfOpenCircuit.execute(failureOperation);
      expect(halfOpenCircuit.getState()).toBe(CircuitBreakerState.OPEN);
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Execute successful operations up to limit
      await halfOpenCircuit.execute(successOperation);
      await halfOpenCircuit.execute(successOperation);
      
      // Next call should fail due to half-open limit
      await expect(halfOpenCircuit.execute(successOperation)).rejects.toThrow(
        'Circuit breaker is HALF_OPEN and has exceeded max calls'
      );
    });

    it('should reset half-open call count on state change', async () => {
      const halfOpenConfig: Partial<CircuitBreakerConfig> = {
        failureThreshold: 2,
        resetTimeout: 500,
        halfOpenMaxCalls: 1,
      };
      
      const halfOpenCircuit = new CircuitBreaker('half-open-reset-test', halfOpenConfig);
      
      // Force to OPEN
      await halfOpenCircuit.execute(failureOperation);
      await halfOpenCircuit.execute(failureOperation);
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Execute in HALF_OPEN
      await halfOpenCircuit.execute(successOperation);
      
      // Force back to OPEN
      halfOpenCircuit.forceOpen();
      
      // Wait for reset timeout again
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Should be able to execute again in HALF_OPEN
      await halfOpenCircuit.execute(successOperation);
      
      expect(halfOpenCircuit.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });
  });

  describe('Edge Cases', () => {
    it('should handle reset correctly', async () => {
      // Execute some operations
      await circuitBreaker.execute(successOperation);
      
      try {
        await circuitBreaker.execute(failureOperation);
      } catch (error) {
        // Expected to fail
      }
      
      // Force to OPEN
      circuitBreaker.forceOpen();
      
      // Reset
      circuitBreaker.reset();
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.successCount).toBe(0);
    });

    it('should handle concurrent operations', async () => {
      const concurrentPromises = Array.from({ length: 10 }, () => 
        circuitBreaker.execute(successOperation)
      );
      
      const results = await Promise.all(concurrentPromises);
      
      expect(results).toHaveLength(10);
      expect(results.every(result => result === 'success')).toBe(true);
      expect(successOperation).toHaveBeenCalledTimes(10);
    });

    it('should handle concurrent failures', async () => {
      const concurrentFailures = Array.from({ length: 5 }, () => 
        circuitBreaker.execute(failureOperation).catch(error => error)
      );
      
      const results = await Promise.all(concurrentFailures);
      
      expect(results).toHaveLength(5);
      expect(results.every(result => result instanceof Error)).toBe(true);
      expect(failureOperation).toHaveBeenCalledTimes(5);
      
      // Should be OPEN after threshold
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should handle empty configuration', () => {
      const defaultCircuit = new CircuitBreaker('default-test');
      
      expect(defaultCircuit.getState()).toBe(CircuitBreakerState.CLOSED);
      
      const config = defaultCircuit.getConfig();
      expect(config.failureThreshold).toBe(5);
      expect(config.resetTimeout).toBe(60000);
      expect(config.successThreshold).toBe(2);
    });

    it('should handle operation that throws non-Error', async () => {
      const stringErrorOperation = jest.fn().mockRejectedValue('string error');
      
      await expect(circuitBreaker.execute(stringErrorOperation)).rejects.toThrow('string error');
      
      const events = circuitBreaker.getEvents();
      expect(events[events.length - 1].error).toBe('string error');
    });
  });

  describe('Performance', () => {
    it('should handle high volume operations efficiently', async () => {
      const startTime = Date.now();
      
      const promises = Array.from({ length: 1000 }, () => 
        circuitBreaker.execute(successOperation)
      );
      
      await Promise.all(promises);
      
      const duration = Date.now() - startTime;
      
      // Should complete 1000 operations in reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(5000);
      expect(successOperation).toHaveBeenCalledTimes(1000);
      
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalRequests).toBe(1000);
      expect(metrics.totalSuccesses).toBe(1000);
    });

    it('should maintain performance with monitoring enabled', async () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        await circuitBreaker.execute(successOperation);
      }
      
      const duration = Date.now() - startTime;
      
      // Should complete 100 operations with monitoring in reasonable time
      expect(duration).toBeLessThan(1000);
      
      const events = circuitBreaker.getEvents();
      expect(events).toHaveLength(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle operation that returns undefined', async () => {
      const undefinedOperation = jest.fn().mockResolvedValue(undefined);
      
      const result = await circuitBreaker.execute(undefinedOperation);
      
      expect(result).toBeUndefined();
      expect(undefinedOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle operation that returns null', async () => {
      const nullOperation = jest.fn().mockResolvedValue(null);
      
      const result = await circuitBreaker.execute(nullOperation);
      
      expect(result).toBeNull();
      expect(nullOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle operation that throws and resolves in different calls', async () => {
      // First call fails
      try {
        await circuitBreaker.execute(failureOperation);
      } catch (error) {
        // Expected to fail
      }
      
      // Second call succeeds
      const result = await circuitBreaker.execute(successOperation);
      
      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('State Management', () => {
    it('should provide accurate state information', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.isClosed()).toBe(true);
      expect(circuitBreaker.isOpen()).toBe(false);
      expect(circuitBreaker.isHalfOpen()).toBe(false);
      
      circuitBreaker.forceOpen();
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(circuitBreaker.isClosed()).toBe(false);
      expect(circuitBreaker.isOpen()).toBe(true);
      expect(circuitBreaker.isHalfOpen()).toBe(false);
    });

    it('should handle force state changes', () => {
      circuitBreaker.forceOpen();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      
      circuitBreaker.forceClose();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      
      // Cannot force HALF_OPEN directly
      expect(() => {
        (circuitBreaker as any).transitionTo(CircuitBreakerState.HALF_OPEN);
      }).not.toThrow();
    });

    it('should track time until reset', async () => {
      circuitBreaker.forceOpen();
      
      const timeUntilReset = (circuitBreaker as any).getTimeUntilReset();
      
      expect(timeUntilReset).toBeGreaterThan(0);
      expect(timeUntilReset).toBeLessThanOrEqual(1000); // Based on our test config
    });
  });
});
