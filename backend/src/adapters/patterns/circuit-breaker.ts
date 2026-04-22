import { Logger } from '@nestjs/common';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  successThreshold: number;
  monitoringEnabled: boolean;
  timeout: number;
  halfOpenMaxCalls: number;
}

export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  stateTransitionCount: number;
  averageResponseTime: number;
  lastStateTransition: string;
  timeInCurrentState: number;
}

export interface CircuitBreakerEvent {
  type: 'STATE_TRANSITION' | 'FAILURE' | 'SUCCESS' | 'TIMEOUT';
  timestamp: number;
  previousState?: CircuitBreakerState;
  newState?: CircuitBreakerState;
  error?: string;
  responseTime?: number;
}

/**
 * Enhanced Circuit Breaker Pattern
 * Prevents cascading failures by failing fast when a service is down.
 * Includes comprehensive monitoring, metrics, and event tracking.
 */
export class CircuitBreaker {
  private readonly logger: Logger;
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private stateTransitionCount = 0;
  private lastStateTransition: string;
  private stateEnteredAt: number;
  private responseTimes: number[] = [];
  private events: CircuitBreakerEvent[] = [];
  private halfOpenCalls = 0;

  constructor(
    private readonly name: string,
    private readonly config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.logger = new Logger(`CircuitBreaker-${name}`);
    this.stateEnteredAt = Date.now();
    this.lastStateTransition = `Initialized in ${CircuitBreakerState.CLOSED} state`;
    
    // Default configuration
    this.config = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      successThreshold: 2,
      monitoringEnabled: true,
      timeout: 30000, // 30 seconds
      halfOpenMaxCalls: 3,
      ...config,
    };
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    this.totalRequests++;

    try {
      // Check if circuit is open and should attempt reset
      if (this.state === CircuitBreakerState.OPEN) {
        if (this.shouldAttemptReset()) {
          this.transitionTo(CircuitBreakerState.HALF_OPEN);
        } else {
          throw new Error(
            `Circuit breaker is OPEN for ${this.name}. Service unavailable. Time until reset: ${this.getTimeUntilReset()}ms`,
          );
        }
      }

      // Check if we've exceeded half-open call limit
      if (this.state === CircuitBreakerState.HALF_OPEN && 
          this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        throw new Error(
          `Circuit breaker is HALF_OPEN and has exceeded max calls (${this.config.halfOpenMaxCalls}) for ${this.name}`,
        );
      }

      // Execute operation with timeout
      const result = await this.executeWithTimeout(operation, this.config.timeout);
      
      // Record success
      const responseTime = Date.now() - startTime;
      this.onSuccess(responseTime);
      
      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.onFailure(error as Error, responseTime);
      throw error;
    }
  }

  /**
   * Execute operation with timeout protection
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    if (timeoutMs <= 0) {
      return await operation();
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.recordEvent({
          type: 'TIMEOUT',
          timestamp: Date.now(),
          responseTime: timeoutMs,
        });
        reject(new Error(`Operation timed out after ${timeoutMs}ms for ${this.name}`));
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private onSuccess(responseTime: number): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    this.responseTimes.push(responseTime);
    
    // Keep only last 100 response times for average calculation
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;
      this.halfOpenCalls++;
      
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitBreakerState.CLOSED);
      }
    } else {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }

    this.recordEvent({
      type: 'SUCCESS',
      timestamp: Date.now(),
      responseTime,
    });
  }

  private onFailure(error: Error, responseTime: number): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.failureCount++;
    this.successCount = 0;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenCalls++;
      // Immediate transition back to OPEN on failure in HALF_OPEN
      this.transitionTo(CircuitBreakerState.OPEN);
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo(CircuitBreakerState.OPEN);
    }

    this.recordEvent({
      type: 'FAILURE',
      timestamp: Date.now(),
      error: error.message,
      responseTime,
    });
  }

  private transitionTo(newState: CircuitBreakerState): void {
    const previousState = this.state;
    this.state = newState;
    this.stateTransitionCount++;
    this.stateEnteredAt = Date.now();
    
    // Reset counters based on new state
    if (newState === CircuitBreakerState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenCalls = 0;
    } else if (newState === CircuitBreakerState.OPEN) {
      this.successCount = 0;
      this.halfOpenCalls = 0;
    } else if (newState === CircuitBreakerState.HALF_OPEN) {
      this.successCount = 0;
      this.halfOpenCalls = 0;
    }

    this.lastStateTransition = `Transitioned from ${previousState} to ${newState} at ${new Date().toISOString()}`;
    
    this.logger.log(`Circuit breaker ${this.name}: ${this.lastStateTransition}`);
    
    this.recordEvent({
      type: 'STATE_TRANSITION',
      timestamp: Date.now(),
      previousState,
      newState,
    });
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime >= this.config.resetTimeout;
  }

  private getTimeUntilReset(): number {
    if (!this.lastFailureTime) return 0;
    const timeSinceFailure = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.resetTimeout - timeSinceFailure);
  }

  private recordEvent(event: CircuitBreakerEvent): void {
    if (!this.config.monitoringEnabled) return;
    
    this.events.push(event);
    
    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events.shift();
    }
  }

  // Public API methods

  getState(): CircuitBreakerState {
    return this.state;
  }

  isClosed(): boolean {
    return this.state === CircuitBreakerState.CLOSED;
  }

  isOpen(): boolean {
    return this.state === CircuitBreakerState.OPEN;
  }

  isHalfOpen(): boolean {
    return this.state === CircuitBreakerState.HALF_OPEN;
  }

  getMetrics(): CircuitBreakerMetrics {
    const averageResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
      : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      stateTransitionCount: this.stateTransitionCount,
      averageResponseTime,
      lastStateTransition: this.lastStateTransition,
      timeInCurrentState: Date.now() - this.stateEnteredAt,
    };
  }

  getEvents(limit: number = 100): CircuitBreakerEvent[] {
    return this.events.slice(-limit);
  }

  getFailureRate(): number {
    if (this.totalRequests === 0) return 0;
    return (this.totalFailures / this.totalRequests) * 100;
  }

  getSuccessRate(): number {
    if (this.totalRequests === 0) return 0;
    return (this.totalSuccesses / this.totalRequests) * 100;
  }

  reset(): void {
    const previousState = this.state;
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.stateTransitionCount = 0;
    this.stateEnteredAt = Date.now();
    this.responseTimes = [];
    this.halfOpenCalls = 0;
    
    this.lastStateTransition = `Reset from ${previousState} to ${CircuitBreakerState.CLOSED} at ${new Date().toISOString()}`;
    this.logger.log(`Circuit breaker reset: ${this.name}`);
    
    this.recordEvent({
      type: 'STATE_TRANSITION',
      timestamp: Date.now(),
      previousState,
      newState: CircuitBreakerState.CLOSED,
    });
  }

  forceOpen(): void {
    this.transitionTo(CircuitBreakerState.OPEN);
  }

  forceClose(): void {
    this.transitionTo(CircuitBreakerState.CLOSED);
  }

  getConfig(): Partial<CircuitBreakerConfig> {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.log(`Circuit breaker ${this.name} configuration updated`);
  }
}
