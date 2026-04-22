import { Logger } from '@nestjs/common';
import { CircuitBreaker, CircuitBreakerState } from './circuit-breaker';
import { AIProvider } from '../../compute-bridge/entities/ai-result-entity';

export interface FallbackChain {
  primary: AIProvider;
  secondary: AIProvider;
  tertiary: AIProvider;
  local: AIProvider;
}

export interface FallbackConfig {
  maxAttempts: number;
  timeoutPerAttempt: number;
  enableCircuitBreaker: boolean;
  retryDelay: number;
  exponentialBackoff: boolean;
  jitter: boolean;
}

export interface FallbackMetrics {
  totalAttempts: number;
  primaryUsage: number;
  secondaryUsage: number;
  tertiaryUsage: number;
  localUsage: number;
  averageLatency: number;
  failureRate: number;
  circuitBreakerTrips: number;
  lastFallbackTime: Date;
  fallbackReasons: Array<{
    provider: AIProvider;
    reason: string;
    timestamp: Date;
  }>;
}

export interface FallbackResult<T> {
  result: T;
  provider: AIProvider;
  attemptCount: number;
  totalLatency: number;
  fallbackChain: AIProvider[];
  circuitBreakerStates: Map<AIProvider, CircuitBreakerState>;
}

/**
 * Enhanced Fallback/Failover Pattern
 * Provides intelligent fallback chains with circuit breaker protection,
 * metrics collection, and adaptive routing.
 */
export class FallbackHandler<T> {
  private readonly logger: Logger;
  private readonly circuitBreakers = new Map<AIProvider, CircuitBreaker>();
  private readonly metrics: FallbackMetrics;
  private readonly config: FallbackConfig;

  constructor(
    private readonly name: string,
    private readonly fallbackChain: FallbackChain,
    config: Partial<FallbackConfig> = {}
  ) {
    this.logger = new Logger(`FallbackHandler-${name}`);
    
    // Default configuration
    this.config = {
      maxAttempts: 4,
      timeoutPerAttempt: 30000, // 30 seconds
      enableCircuitBreaker: true,
      retryDelay: 1000, // 1 second
      exponentialBackoff: true,
      jitter: true,
      ...config,
    };

    // Initialize metrics
    this.metrics = {
      totalAttempts: 0,
      primaryUsage: 0,
      secondaryUsage: 0,
      tertiaryUsage: 0,
      localUsage: 0,
      averageLatency: 0,
      failureRate: 0,
      circuitBreakerTrips: 0,
      lastFallbackTime: new Date(),
      fallbackReasons: [],
    };

    // Initialize circuit breakers if enabled
    if (this.config.enableCircuitBreaker) {
      this.initializeCircuitBreakers();
    }
  }

  /**
   * Execute operation with intelligent fallback chain
   */
  async executeWithFallback<A>(
    adapters: Map<AIProvider, A>,
    operation: (adapter: A, provider: AIProvider) => Promise<T>
  ): Promise<FallbackResult<T>> {
    const startTime = Date.now();
    this.metrics.totalAttempts++;

    const fallbackChain = this.buildFallbackChain(adapters);
    const circuitBreakerStates = new Map<AIProvider, CircuitBreakerState>();
    const usedProviders: AIProvider[] = [];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < Math.min(this.config.maxAttempts, fallbackChain.length); attempt++) {
      const provider = fallbackChain[attempt];
      const adapter = adapters.get(provider);

      if (!adapter) {
        this.logger.warn(`Adapter not found for provider ${provider}`);
        continue;
      }

      // Check circuit breaker state
      const circuitBreaker = this.circuitBreakers.get(provider);
      if (circuitBreaker) {
        const state = circuitBreaker.getState();
        circuitBreakerStates.set(provider, state);

        if (state === CircuitBreakerState.OPEN) {
          this.logger.info(`Circuit breaker OPEN for provider ${provider}, skipping`);
          this.recordFallback(provider, 'Circuit breaker is OPEN');
          continue;
        }
      }

      usedProviders.push(provider);
      this.updateProviderUsage(provider);

      try {
        const result = await this.executeWithTimeout(
          () => operation(adapter, provider),
          this.config.timeoutPerAttempt
        );

        const totalLatency = Date.now() - startTime;
        this.updateMetrics(totalLatency, true);

        this.logger.info(`Operation successful with provider ${provider}`, undefined, {
          provider,
          attempt: attempt + 1,
          totalLatency,
        });

        return {
          result,
          provider,
          attemptCount: attempt + 1,
          totalLatency,
          fallbackChain: usedProviders,
          circuitBreakerStates,
        };

      } catch (error) {
        lastError = error as Error;
        
        // Record circuit breaker failure
        if (circuitBreaker) {
          try {
            await circuitBreaker.execute(() => Promise.reject(error));
          } catch (cbError) {
            // Expected - circuit breaker will handle the failure
          }
        }

        this.recordFallback(provider, error.message);

        this.logger.warn(`Provider ${provider} failed`, undefined, {
          provider,
          attempt: attempt + 1,
          error: error.message,
        });

        // Add delay before next attempt (except for last attempt)
        if (attempt < Math.min(this.config.maxAttempts, fallbackChain.length) - 1) {
          await this.delay(this.calculateDelay(attempt));
        }
      }
    }

    // All providers failed
    const totalLatency = Date.now() - startTime;
    this.updateMetrics(totalLatency, false);

    throw new Error(
      `All providers exhausted for ${this.name}. ` +
      `Attempts: ${usedProviders.length}, ` +
      `Last error: ${lastError?.message}`
    );
  }

  /**
   * Execute operation with custom fallback strategy
   */
  async executeWithCustomFallback<A>(
    adapters: Map<AIProvider, A>,
    customChain: AIProvider[],
    operation: (adapter: A, provider: AIProvider) => Promise<T>
  ): Promise<FallbackResult<T>> {
    const startTime = Date.now();
    this.metrics.totalAttempts++;

    const circuitBreakerStates = new Map<AIProvider, CircuitBreakerState>();
    const usedProviders: AIProvider[] = [];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < Math.min(this.config.maxAttempts, customChain.length); attempt++) {
      const provider = customChain[attempt];
      const adapter = adapters.get(provider);

      if (!adapter) {
        this.logger.warn(`Adapter not found for provider ${provider}`);
        continue;
      }

      // Check circuit breaker state
      const circuitBreaker = this.circuitBreakers.get(provider);
      if (circuitBreaker) {
        const state = circuitBreaker.getState();
        circuitBreakerStates.set(provider, state);

        if (state === CircuitBreakerState.OPEN) {
          this.logger.info(`Circuit breaker OPEN for provider ${provider}, skipping`);
          this.recordFallback(provider, 'Circuit breaker is OPEN');
          continue;
        }
      }

      usedProviders.push(provider);
      this.updateProviderUsage(provider);

      try {
        const result = await this.executeWithTimeout(
          () => operation(adapter, provider),
          this.config.timeoutPerAttempt
        );

        const totalLatency = Date.now() - startTime;
        this.updateMetrics(totalLatency, true);

        return {
          result,
          provider,
          attemptCount: attempt + 1,
          totalLatency,
          fallbackChain: usedProviders,
          circuitBreakerStates,
        };

      } catch (error) {
        lastError = error as Error;
        
        // Record circuit breaker failure
        if (circuitBreaker) {
          try {
            await circuitBreaker.execute(() => Promise.reject(error));
          } catch (cbError) {
            // Expected - circuit breaker will handle the failure
          }
        }

        this.recordFallback(provider, error.message);

        if (attempt < Math.min(this.config.maxAttempts, customChain.length) - 1) {
          await this.delay(this.calculateDelay(attempt));
        }
      }
    }

    // All providers failed
    const totalLatency = Date.now() - startTime;
    this.updateMetrics(totalLatency, false);

    throw new Error(
      `All custom providers exhausted for ${this.name}. ` +
      `Attempts: ${usedProviders.length}, ` +
      `Last error: ${lastError?.message}`
    );
  }

  /**
   * Get preferred provider based on health and performance
   */
  getPreferredProvider(healthStatus: Map<AIProvider, boolean>): AIProvider {
    // Check primary provider first
    if (healthStatus.get(this.fallbackChain.primary)) {
      return this.fallbackChain.primary;
    }

    // Check secondary provider
    if (healthStatus.get(this.fallbackChain.secondary)) {
      return this.fallbackChain.secondary;
    }

    // Check tertiary provider
    if (healthStatus.get(this.fallbackChain.tertiary)) {
      return this.fallbackChain.tertiary;
    }

    // Fall back to local model
    return this.fallbackChain.local;
  }

  /**
   * Get fallback metrics
   */
  getMetrics(): FallbackMetrics {
    return { ...this.metrics };
  }

  /**
   * Get circuit breaker status for all providers
   */
  getCircuitBreakerStatus(): Map<AIProvider, CircuitBreakerState> {
    const status = new Map<AIProvider, CircuitBreakerState>();
    
    for (const [provider, circuitBreaker] of this.circuitBreakers) {
      status.set(provider, circuitBreaker.getState());
    }
    
    return status;
  }

  /**
   * Reset circuit breakers
   */
  resetCircuitBreakers(): void {
    for (const [provider, circuitBreaker] of this.circuitBreakers) {
      circuitBreaker.reset();
      this.logger.info(`Circuit breaker reset for provider ${provider}`);
    }
  }

  /**
   * Reset circuit breaker for specific provider
   */
  resetCircuitBreaker(provider: AIProvider): void {
    const circuitBreaker = this.circuitBreakers.get(provider);
    
    if (circuitBreaker) {
      circuitBreaker.reset();
      this.logger.info(`Circuit breaker reset for provider ${provider}`);
    }
  }

  /**
   * Force circuit breaker state
   */
  forceCircuitBreakerState(provider: AIProvider, state: CircuitBreakerState): void {
    const circuitBreaker = this.circuitBreakers.get(provider);
    
    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not found for provider ${provider}`);
    }

    switch (state) {
      case CircuitBreakerState.OPEN:
        circuitBreaker.forceOpen();
        break;
      case CircuitBreakerState.CLOSED:
        circuitBreaker.forceClose();
        break;
      case CircuitBreakerState.HALF_OPEN:
        throw new Error('Cannot force HALF_OPEN state directly');
    }

    this.logger.warn(`Circuit breaker state forced to ${state} for provider ${provider}`);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<FallbackConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.info('Fallback handler configuration updated', undefined, newConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): FallbackConfig {
    return { ...this.config };
  }

  /**
   * Get fallback chain
   */
  getFallbackChain(): FallbackChain {
    return { ...this.fallbackChain };
  }

  // Private methods

  private initializeCircuitBreakers(): void {
    const providers = [
      this.fallbackChain.primary,
      this.fallbackChain.secondary,
      this.fallbackChain.tertiary,
      this.fallbackChain.local,
    ];

    for (const provider of providers) {
      const circuitBreaker = new CircuitBreaker(`Fallback-${this.name}-${provider}`, {
        failureThreshold: 3,
        resetTimeout: 60000, // 1 minute
        successThreshold: 2,
        monitoringEnabled: true,
        timeout: this.config.timeoutPerAttempt,
        halfOpenMaxCalls: 1,
      });

      this.circuitBreakers.set(provider, circuitBreaker);
    }
  }

  private buildFallbackChain<A>(adapters: Map<AIProvider, A>): AIProvider[] {
    const chain: AIProvider[] = [];

    // Add providers in order of preference, only if adapter exists
    if (adapters.has(this.fallbackChain.primary)) {
      chain.push(this.fallbackChain.primary);
    }
    if (adapters.has(this.fallbackChain.secondary)) {
      chain.push(this.fallbackChain.secondary);
    }
    if (adapters.has(this.fallbackChain.tertiary)) {
      chain.push(this.fallbackChain.tertiary);
    }
    if (adapters.has(this.fallbackChain.local)) {
      chain.push(this.fallbackChain.local);
    }

    if (chain.length === 0) {
      throw new Error(`No adapters available for fallback: ${this.name}`);
    }

    return chain;
  }

  private async executeWithTimeout<R>(
    operation: () => Promise<R>,
    timeoutMs: number
  ): Promise<R> {
    if (timeoutMs <= 0) {
      return await operation();
    }

    return new Promise<R>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
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

  private updateProviderUsage(provider: AIProvider): void {
    switch (provider) {
      case this.fallbackChain.primary:
        this.metrics.primaryUsage++;
        break;
      case this.fallbackChain.secondary:
        this.metrics.secondaryUsage++;
        break;
      case this.fallbackChain.tertiary:
        this.metrics.tertiaryUsage++;
        break;
      case this.fallbackChain.local:
        this.metrics.localUsage++;
        break;
    }
  }

  private recordFallback(provider: AIProvider, reason: string): void {
    this.metrics.fallbackReasons.push({
      provider,
      reason,
      timestamp: new Date(),
    });

    // Keep only last 100 fallback reasons
    if (this.metrics.fallbackReasons.length > 100) {
      this.metrics.fallbackReasons.shift();
    }

    this.metrics.lastFallbackTime = new Date();
  }

  private updateMetrics(totalLatency: number, success: boolean): void {
    // Update average latency
    const totalOperations = this.metrics.primaryUsage + 
                          this.metrics.secondaryUsage + 
                          this.metrics.tertiaryUsage + 
                          this.metrics.localUsage;
    
    if (totalOperations > 0) {
      this.metrics.averageLatency = 
        (this.metrics.averageLatency * (totalOperations - 1) + totalLatency) / totalOperations;
    }

    // Update failure rate
    if (!success) {
      const failureCount = totalOperations - 
        (this.metrics.primaryUsage + this.metrics.secondaryUsage + 
         this.metrics.tertiaryUsage + this.metrics.localUsage - 1);
      this.metrics.failureRate = (failureCount / totalOperations) * 100;
    }

    // Update circuit breaker trips
    for (const [provider, circuitBreaker] of this.circuitBreakers) {
      if (circuitBreaker.getState() === CircuitBreakerState.OPEN) {
        this.metrics.circuitBreakerTrips++;
      }
    }
  }

  private calculateDelay(attempt: number): number {
    let delay = this.config.retryDelay;

    if (this.config.exponentialBackoff) {
      delay = this.config.retryDelay * Math.pow(2, attempt);
    }

    if (this.config.jitter) {
      // Add ±25% jitter
      const jitterFactor = 0.25;
      const jitterAmount = delay * jitterFactor;
      delay = delay + (Math.random() * jitterAmount * 2 - jitterAmount);
    }

    return Math.max(0, Math.min(delay, 30000)); // Cap at 30 seconds
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
