import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time to wait before trying again (ms)
  monitoringPeriod: number; // Time window for failure counting (ms)
  expectedRecoveryTime: number; // Expected time for service recovery (ms)
  timeout: number; // Timeout for individual calls (ms)
  retryCount: number; // Number of retries before giving up
  retryDelay: number; // Delay between retries (ms)
  retryBackoffMultiplier: number; // Multiplier for exponential backoff
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  timeouts: number;
  retries: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttemptTime?: Date;
  averageResponseTime: number;
  uptime: number;
  downtime: number;
}

export interface CircuitBreakerOptions {
  fallback?: (error: Error, ...args: any[]) => any;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  onSuccess?: (result: any, duration: number) => void;
  onFailure?: (error: Error, duration: number) => void;
  onTimeout?: (error: Error, duration: number) => void;
  onRetry?: (attempt: number, error: Error) => void;
}

export interface CallResult<T = any> {
  success: boolean;
  result?: T;
  error?: Error;
  duration: number;
  retries: number;
  fromFallback: boolean;
}

@Injectable()
export class CircuitBreakerService extends EventEmitter {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private timeouts = 0;
  private retries = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private responseTimes: number[] = [];
  private uptimeStartTime = Date.now();
  private downtimeStartTime?: Date;
  private totalDowntime = 0;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig,
    private readonly options: CircuitBreakerOptions = {},
  ) {
    super();
    this.validateConfig();
    this.logger.log(`CircuitBreaker '${name}' initialized with state: ${this.state}`);
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T = any>(fn: (...args: any[]) => Promise<T>, ...args: any[]): Promise<T> {
    const startTime = Date.now();
    
    try {
      // Check if circuit is open and we should wait
      if (this.shouldWait()) {
        const waitTime = this.nextAttemptTime ? this.nextAttemptTime.getTime() - Date.now() : 0;
        if (waitTime > 0) {
          this.logger.debug(`Circuit '${this.name}' is OPEN, waiting ${waitTime}ms`);
          await this.sleep(waitTime);
        }
      }

      // Execute with retry logic
      const result = await this.executeWithRetry<T>(fn, args, startTime);
      
      // Handle success
      this.onSuccess(result, Date.now() - startTime);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Handle failure
      this.onFailure(error as Error, duration);
      
      // Try fallback if available
      if (this.options.fallback) {
        try {
          const fallbackResult = this.options.fallback(error as Error, ...args);
          this.logger.debug(`Circuit '${this.name}' executed fallback for error: ${error}`);
          return fallbackResult;
        } catch (fallbackError) {
          this.logger.error(`Circuit '${this.name}' fallback failed:`, fallbackError);
          throw error; // Throw original error if fallback fails
        }
      }
      
      throw error;
    }
  }

  /**
   * Execute function with retry logic
   */
  private async executeWithRetry<T>(fn: (...args: any[]) => Promise<T>, args: any[], startTime: number): Promise<T> {
    let lastError: Error;
    let retryDelay = this.config.retryDelay;
    
    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        // Check if circuit allows execution
        if (!this.canExecute()) {
          throw new Error(`Circuit '${this.name}' is ${this.state} and cannot execute`);
        }

        // Execute with timeout
        const result = await this.executeWithTimeout<T>(fn, args, this.config.timeout);
        
        if (attempt > 0) {
          this.logger.debug(`Circuit '${this.name}' succeeded on attempt ${attempt + 1}`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.retryCount) {
          this.retries++;
          this.options.onRetry?.(attempt + 1, lastError);
          
          this.logger.debug(`Circuit '${this.name}' retry ${attempt + 1}/${this.config.retryCount} after ${retryDelay}ms`);
          await this.sleep(retryDelay);
          
          // Exponential backoff
          retryDelay *= this.config.retryBackoffMultiplier;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(fn: (...args: any[]) => Promise<T>, args: any[], timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.timeouts++;
        const timeoutError = new Error(`Circuit '${this.name}' timed out after ${timeout}ms`);
        this.options.onTimeout?.(timeoutError, timeout);
        reject(timeoutError);
      }, timeout);

      fn(...args)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Check if circuit can execute
   */
  private canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        return this.nextAttemptTime ? Date.now() >= this.nextAttemptTime.getTime() : false;
      case CircuitState.HALF_OPEN:
        return true;
      default:
        return false;
    }
  }

  /**
   * Check if we should wait
   */
  private shouldWait(): boolean {
    return this.state === CircuitState.OPEN && 
           this.nextAttemptTime && 
           Date.now() < this.nextAttemptTime.getTime();
  }

  /**
   * Handle successful execution
   */
  private onSuccess<T>(result: T, duration: number): void {
    this.successes++;
    this.lastSuccessTime = new Date();
    this.recordResponseTime(duration);
    
    // Update uptime/downtime
    if (this.downtimeStartTime) {
      this.totalDowntime += Date.now() - this.downtimeStartTime.getTime();
      this.downtimeStartTime = undefined;
    }
    
    // Reset failures if we were half-open
    if (this.state === CircuitState.HALF_OPEN) {
      this.failures = 0;
      this.setState(CircuitState.CLOSED);
    }
    
    this.options.onSuccess?.(result, duration);
    this.logger.debug(`Circuit '${this.name}' success in ${duration}ms`);
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: Error, duration: number): void {
    this.failures++;
    this.lastFailureTime = new Date();
    
    // Update downtime
    if (!this.downtimeStartTime && this.state !== CircuitState.OPEN) {
      this.downtimeStartTime = new Date();
    }
    
    this.options.onFailure?.(error, duration);
    this.logger.debug(`Circuit '${this.name}' failure in ${duration}ms: ${error.message}`);
    
    // Check if we should open the circuit
    if (this.shouldOpenCircuit()) {
      this.setState(CircuitState.OPEN);
      this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);
    }
  }

  /**
   * Check if circuit should open
   */
  private shouldOpenCircuit(): boolean {
    if (this.state === CircuitState.OPEN) {
      return false;
    }
    
    // Check failure threshold
    if (this.failures >= this.config.failureThreshold) {
      return true;
    }
    
    // Check failure rate in monitoring period
    const now = Date.now();
    const monitoringStart = now - this.config.monitoringPeriod;
    
    let recentFailures = 0;
    let recentCalls = 0;
    
    if (this.lastFailureTime && this.lastFailureTime.getTime() >= monitoringStart) {
      recentFailures++;
    }
    
    if (this.lastSuccessTime && this.lastSuccessTime.getTime() >= monitoringStart) {
      recentCalls++;
    }
    
    if (recentCalls > 0 && (recentFailures / recentCalls) > 0.5) {
      return true;
    }
    
    return false;
  }

  /**
   * Set circuit state
   */
  private setState(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    
    this.logger.log(`Circuit '${this.name}' state changed from ${oldState} to ${newState}`);
    this.emit('stateChange', { from: oldState, to: newState, name: this.name });
    
    this.options.onStateChange?.(oldState, newState);
  }

  /**
   * Record response time for statistics
   */
  private recordResponseTime(duration: number): void {
    this.responseTimes.push(duration);
    
    // Keep only last 100 response times
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }
  }

  /**
   * Get average response time
   */
  private getAverageResponseTime(): number {
    if (this.responseTimes.length === 0) {
      return 0;
    }
    
    const sum = this.responseTimes.reduce((acc, time) => acc + time, 0);
    return sum / this.responseTimes.length;
  }

  /**
   * Get circuit statistics
   */
  getStats(): CircuitBreakerStats {
    const now = Date.now();
    const totalUptime = now - this.uptimeStartTime - this.totalDowntime;
    const currentDowntime = this.downtimeStartTime ? now - this.downtimeStartTime.getTime() : 0;
    const totalDowntime = this.totalDowntime + currentDowntime;
    
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      timeouts: this.timeouts,
      retries: this.retries,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
      averageResponseTime: this.getAverageResponseTime(),
      uptime: totalUptime,
      downtime: totalDowntime,
    };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.timeouts = 0;
    this.retries = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.nextAttemptTime = undefined;
    this.responseTimes = [];
    this.uptimeStartTime = Date.now();
    this.downtimeStartTime = undefined;
    this.totalDowntime = 0;
    
    this.logger.log(`Circuit '${this.name}' reset`);
    this.emit('reset', { name: this.name });
  }

  /**
   * Force circuit open
   */
  forceOpen(): void {
    this.setState(CircuitState.OPEN);
    this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);
  }

  /**
   * Force circuit closed
   */
  forceClose(): void {
    this.setState(CircuitState.CLOSED);
    this.failures = 0;
    this.nextAttemptTime = undefined;
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if circuit is closed
   */
  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Check if circuit is half-open
   */
  isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    if (this.config.failureThreshold <= 0) {
      throw new Error('failureThreshold must be greater than 0');
    }
    
    if (this.config.resetTimeout <= 0) {
      throw new Error('resetTimeout must be greater than 0');
    }
    
    if (this.config.monitoringPeriod <= 0) {
      throw new Error('monitoringPeriod must be greater than 0');
    }
    
    if (this.config.timeout <= 0) {
      throw new Error('timeout must be greater than 0');
    }
    
    if (this.config.retryCount < 0) {
      throw new Error('retryCount must be 0 or greater');
    }
    
    if (this.config.retryDelay < 0) {
      throw new Error('retryDelay must be 0 or greater');
    }
    
    if (this.config.retryBackoffMultiplier <= 0) {
      throw new Error('retryBackoffMultiplier must be greater than 0');
    }
  }

  /**
   * Get configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.validateConfig();
    this.logger.log(`Circuit '${this.name}' configuration updated`);
  }

  /**
   * Get name
   */
  getName(): string {
    return this.name;
  }
}
