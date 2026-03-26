import { SetMetadata } from '@nestjs/common';
import { CircuitBreakerConfig, CircuitBreakerOptions } from '../circuit-breaker.service';

export const CIRCUIT_BREAKER_KEY = 'circuit_breaker';

export interface CircuitBreakerDecoratorOptions extends CircuitBreakerConfig {
  /**
   * Name of the circuit breaker (defaults to method name)
   */
  name?: string;
  
  /**
   * Fallback function to execute when circuit is open
   */
  fallback?: (error: Error, ...args: any[]) => any;
  
  /**
   * Callback when state changes
   */
  onStateChange?: (from: string, to: string) => void;
  
  /**
   * Callback on successful execution
   */
  onSuccess?: (result: any, duration: number) => void;
  
  /**
   * Callback on failed execution
   */
  onFailure?: (error: Error, duration: number) => void;
  
  /**
   * Callback on timeout
   */
  onTimeout?: (error: Error, duration: number) => void;
  
  /**
   * Callback on retry
   */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Circuit Breaker decorator for methods
 * Automatically wraps method execution with circuit breaker protection
 */
export const CircuitBreaker = (options: CircuitBreakerDecoratorOptions = {}) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const circuitName = options.name || `${target.constructor.name}.${propertyKey}`;
    
    // Store circuit breaker configuration
    const circuitOptions: CircuitBreakerOptions = {
      fallback: options.fallback,
      onStateChange: options.onStateChange ? 
        (from, to) => options.onStateChange!(from, to) : 
        undefined,
      onSuccess: options.onSuccess,
      onFailure: options.onFailure,
      onTimeout: options.onTimeout,
      onRetry: options.onRetry,
    };
    
    SetMetadata(CIRCUIT_BREAKER_KEY, {
      name: circuitName,
      config: {
        failureThreshold: options.failureThreshold || 5,
        resetTimeout: options.resetTimeout || 60000,
        monitoringPeriod: options.monitoringPeriod || 10000,
        expectedRecoveryTime: options.expectedRecoveryTime || 30000,
        timeout: options.timeout || 5000,
        retryCount: options.retryCount || 3,
        retryDelay: options.retryDelay || 1000,
        retryBackoffMultiplier: options.retryBackoffMultiplier || 2,
      },
      options: circuitOptions,
      target: target.constructor.name,
      method: propertyKey,
    });

    // Wrap the original method
    descriptor.value = async function (...args: any[]) {
      // Get circuit breaker instance from the service
      const circuitBreaker = this.getCircuitBreaker?.(circuitName);
      
      if (!circuitBreaker) {
        // Fallback to direct execution if no circuit breaker available
        return originalMethod.apply(this, args);
      }
      
      // Execute through circuit breaker
      return circuitBreaker.execute(originalMethod.bind(this), ...args);
    };

    return descriptor;
  };
};

/**
 * Fallback decorator for methods
 * Marks method as fallback for circuit breaker
 */
export const Fallback = (circuitName?: string) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(`${CIRCUIT_BREAKER_KEY}_fallback`, {
      circuitName: circuitName || `${target.constructor.name}.${propertyKey}`,
      method: propertyKey,
      target: target.constructor.name,
    });
  };
};

/**
 * Helper to get circuit breaker metadata from a class
 */
export const getCircuitBreakerMetadata = (target: any) => {
  return Reflect.getMetadata(CIRCUIT_BREAKER_KEY, target) || [];
};

/**
 * Helper to get fallback metadata from a class
 */
export const getFallbackMetadata = (target: any) => {
  return Reflect.getMetadata(`${CIRCUIT_BREAKER_KEY}_fallback`, target) || [];
};
