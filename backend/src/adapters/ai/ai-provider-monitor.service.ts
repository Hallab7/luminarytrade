import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CircuitBreaker, CircuitBreakerState, CircuitBreakerConfig } from '../patterns/circuit-breaker';
import { PrometheusService } from '../../metrics/prometheus.service';
import { ELKLoggerService } from '../../logging/elk-logger.service';
import { BaseAIModelAdapter } from '../ai/base-ai-model.adapter';
import { AIProvider } from '../../compute-bridge/entities/ai-result-entity';

export interface ProviderHealthStatus {
  provider: AIProvider;
  isHealthy: boolean;
  lastCheck: Date;
  responseTime: number;
  error?: string;
  circuitBreakerState: CircuitBreakerState;
  failureRate: number;
  successRate: number;
  uptime: number;
  apiKeyValid: boolean;
  rateLimitStatus?: {
    remaining: number;
    resetTime: Date;
    limit: number;
  };
}

export interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastRequestTime: Date;
  circuitBreakerTransitions: number;
  fallbackUsage: number;
}

export interface FallbackChainMetrics {
  primaryProvider: AIProvider;
  secondaryProvider: AIProvider;
  tertiaryProvider: AIProvider;
  localModelProvider: AIProvider;
  fallbackUsagePercentage: {
    [provider: string]: number;
  };
  totalFallbacks: number;
  averageFallbackLatency: number;
}

@Injectable()
export class AIProviderMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly providers = new Map<AIProvider, BaseAIModelAdapter>();
  private readonly circuitBreakers = new Map<AIProvider, CircuitBreaker>();
  private readonly healthStatus = new Map<AIProvider, ProviderHealthStatus>();
  private readonly metrics = new Map<AIProvider, ProviderMetrics>();
  private healthCheckInterval: NodeJS.Timeout;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

  constructor(
    private readonly configService: ConfigService,
    private readonly prometheusService: PrometheusService,
    private readonly logger: ELKLoggerService
  ) {}

  async onModuleInit() {
    // Start periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL);

    this.logger.info('AI Provider Monitor Service initialized', undefined, {
      healthCheckInterval: this.HEALTH_CHECK_INTERVAL,
    });

    // Perform initial health check
    await this.performHealthChecks();
  }

  async onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  /**
   * Register an AI provider for monitoring
   */
  registerProvider(provider: AIProvider, adapter: BaseAIModelAdapter): void {
    this.providers.set(provider, adapter);

    // Create circuit breaker for this provider
    const circuitBreakerConfig: Partial<CircuitBreakerConfig> = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      successThreshold: 2,
      monitoringEnabled: true,
      timeout: 30000, // 30 seconds
      halfOpenMaxCalls: 1,
    };

    const circuitBreaker = new CircuitBreaker(
      `AI-Provider-${provider}`,
      circuitBreakerConfig
    );

    this.circuitBreakers.set(provider, circuitBreaker);

    // Initialize metrics
    this.metrics.set(provider, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastRequestTime: new Date(),
      circuitBreakerTransitions: 0,
      fallbackUsage: 0,
    });

    // Initialize health status
    this.healthStatus.set(provider, {
      provider,
      isHealthy: false,
      lastCheck: new Date(),
      responseTime: 0,
      circuitBreakerState: CircuitBreakerState.CLOSED,
      failureRate: 0,
      successRate: 0,
      uptime: 0,
      apiKeyValid: false,
    });

    this.logger.info('AI provider registered for monitoring', undefined, {
      provider,
      circuitBreakerConfig,
    });
  }

  /**
   * Execute operation with circuit breaker protection and monitoring
   */
  async executeWithMonitoring<T>(
    provider: AIProvider,
    operation: () => Promise<T>
  ): Promise<T> {
    const adapter = this.providers.get(provider);
    const circuitBreaker = this.circuitBreakers.get(provider);
    const metrics = this.metrics.get(provider);

    if (!adapter || !circuitBreaker || !metrics) {
      throw new Error(`Provider ${provider} not registered for monitoring`);
    }

    const startTime = Date.now();
    metrics.totalRequests++;

    try {
      const result = await circuitBreaker.execute(async () => {
        return await operation();
      });

      const responseTime = Date.now() - startTime;
      this.recordSuccess(provider, responseTime);

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.recordFailure(provider, error as Error, responseTime);
      throw error;
    }
  }

  /**
   * Get health status of all providers
   */
  getAllProviderHealth(): ProviderHealthStatus[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get health status of specific provider
   */
  getProviderHealth(provider: AIProvider): ProviderHealthStatus | undefined {
    return this.healthStatus.get(provider);
  }

  /**
   * Get metrics for all providers
   */
  getAllProviderMetrics(): Map<AIProvider, ProviderMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get metrics for specific provider
   */
  getProviderMetrics(provider: AIProvider): ProviderMetrics | undefined {
    return this.metrics.get(provider);
  }

  /**
   * Get circuit breaker status for all providers
   */
  getAllCircuitBreakerStatus(): Map<AIProvider, CircuitBreakerState> {
    const status = new Map<AIProvider, CircuitBreakerState>();
    
    for (const [provider, circuitBreaker] of this.circuitBreakers) {
      status.set(provider, circuitBreaker.getState());
    }
    
    return status;
  }

  /**
   * Get fallback chain metrics
   */
  getFallbackChainMetrics(): FallbackChainMetrics {
    const totalRequests = Array.from(this.metrics.values())
      .reduce((sum, metric) => sum + metric.totalRequests, 0);

    const fallbackUsagePercentage: { [provider: string]: number } = {};
    
    for (const [provider, metric] of this.metrics) {
      fallbackUsagePercentage[provider] = totalRequests > 0 
        ? (metric.fallbackUsage / totalRequests) * 100 
        : 0;
    }

    return {
      primaryProvider: AIProvider.OPENAI,
      secondaryProvider: AIProvider.LLAMA,
      tertiaryProvider: AIProvider.GROK,
      localModelProvider: AIProvider.LOCAL,
      fallbackUsagePercentage,
      totalFallbacks: Array.from(this.metrics.values())
        .reduce((sum, metric) => sum + metric.fallbackUsage, 0),
      averageFallbackLatency: this.calculateAverageFallbackLatency(),
    };
  }

  /**
   * Force circuit breaker state change
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
        // Can't force half-open directly, need to go through normal flow
        throw new Error('Cannot force HALF_OPEN state directly');
    }

    this.logger.warn('Circuit breaker state forced', undefined, {
      provider,
      newState: state,
    });
  }

  /**
   * Reset circuit breaker for provider
   */
  resetCircuitBreaker(provider: AIProvider): void {
    const circuitBreaker = this.circuitBreakers.get(provider);
    
    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not found for provider ${provider}`);
    }

    circuitBreaker.reset();

    this.logger.info('Circuit breaker reset', undefined, {
      provider,
    });
  }

  /**
   * Perform health checks on all providers
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.providers.entries()).map(
      async ([provider, adapter]) => {
        try {
          await this.checkProviderHealth(provider, adapter);
        } catch (error) {
          this.logger.error('Health check failed for provider', error, {
            provider,
          });
        }
      }
    );

    await Promise.allSettled(healthCheckPromises);

    // Update Prometheus metrics
    this.updatePrometheusMetrics();
  }

  /**
   * Check health of individual provider
   */
  private async checkProviderHealth(
    provider: AIProvider,
    adapter: BaseAIModelAdapter
  ): Promise<void> {
    const startTime = Date.now();
    const healthStatus = this.healthStatus.get(provider);
    const circuitBreaker = this.circuitBreakers.get(provider);

    if (!healthStatus || !circuitBreaker) {
      return;
    }

    try {
      // Check API key configuration
      const apiKeyValid = adapter.isApiKeyConfigured();

      // Perform health check
      const isHealthy = apiKeyValid && await adapter.isHealthy();

      const responseTime = Date.now() - startTime;

      // Update health status
      healthStatus.isHealthy = isHealthy;
      healthStatus.lastCheck = new Date();
      healthStatus.responseTime = responseTime;
      healthStatus.circuitBreakerState = circuitBreaker.getState();
      healthStatus.apiKeyValid = apiKeyValid;

      // Get circuit breaker metrics
      const cbMetrics = circuitBreaker.getMetrics();
      healthStatus.failureRate = circuitBreaker.getFailureRate();
      healthStatus.successRate = circuitBreaker.getSuccessRate();
      healthStatus.uptime = this.calculateUptime(provider);

      // Check rate limit status if available
      if (adapter.getRateLimitStatus) {
        healthStatus.rateLimitStatus = await adapter.getRateLimitStatus();
      }

      this.logger.debug('Provider health check completed', undefined, {
        provider,
        isHealthy,
        responseTime,
        circuitBreakerState: healthStatus.circuitBreakerState,
      });

    } catch (error) {
      healthStatus.isHealthy = false;
      healthStatus.lastCheck = new Date();
      healthStatus.responseTime = Date.now() - startTime;
      healthStatus.circuitBreakerState = circuitBreaker.getState();
      healthStatus.error = error.message;

      this.logger.warn('Provider health check failed', undefined, {
        provider,
        error: error.message,
      });
    }
  }

  /**
   * Record successful operation
   */
  private recordSuccess(provider: AIProvider, responseTime: number): void {
    const metrics = this.metrics.get(provider);
    const healthStatus = this.healthStatus.get(provider);

    if (metrics) {
      metrics.successfulRequests++;
      metrics.lastRequestTime = new Date();
      
      // Update average response time
      const totalSuccessful = metrics.successfulRequests;
      metrics.averageResponseTime = 
        (metrics.averageResponseTime * (totalSuccessful - 1) + responseTime) / totalSuccessful;
    }

    if (healthStatus) {
      healthStatus.successRate = this.calculateSuccessRate(provider);
      healthStatus.failureRate = this.calculateFailureRate(provider);
    }

    // Record Prometheus metrics
    this.prometheusService.incrementAIProviderRequests({
      provider,
      status: 'success',
      service: 'luminarytrade-backend',
    });

    this.prometheusService.observeAIProviderResponseDuration(responseTime / 1000, {
      provider,
      service: 'luminarytrade-backend',
    });

    this.logger.debug('AI provider request succeeded', undefined, {
      provider,
      responseTime,
    });
  }

  /**
   * Record failed operation
   */
  private recordFailure(provider: AIProvider, error: Error, responseTime: number): void {
    const metrics = this.metrics.get(provider);
    const healthStatus = this.healthStatus.get(provider);

    if (metrics) {
      metrics.failedRequests++;
      metrics.lastRequestTime = new Date();
    }

    if (healthStatus) {
      healthStatus.successRate = this.calculateSuccessRate(provider);
      healthStatus.failureRate = this.calculateFailureRate(provider);
      healthStatus.error = error.message;
    }

    // Record Prometheus metrics
    this.prometheusService.incrementAIProviderRequests({
      provider,
      status: 'error',
      service: 'luminarytrade-backend',
    });

    this.prometheusService.incrementAIProviderErrors({
      provider,
      error_type: error.constructor.name,
      service: 'luminarytrade-backend',
    });

    this.logger.warn('AI provider request failed', undefined, {
      provider,
      error: error.message,
      responseTime,
    });
  }

  /**
   * Record fallback usage
   */
  recordFallbackUsage(provider: AIProvider): void {
    const metrics = this.metrics.get(provider);
    
    if (metrics) {
      metrics.fallbackUsage++;
    }

    this.prometheusService.incrementAIProviderRequests({
      provider,
      status: 'fallback',
      service: 'luminarytrade-backend',
    });

    this.logger.info('AI provider fallback used', undefined, {
      provider,
    });
  }

  /**
   * Update Prometheus metrics
   */
  private updatePrometheusMetrics(): void {
    for (const [provider, healthStatus] of this.healthStatus) {
      // Provider health status
      this.prometheusService.setAIProviderHealth(
        healthStatus.isHealthy ? 1 : 0,
        {
          provider,
          service: 'luminarytrade-backend',
        }
      );

      // Circuit breaker state
      const circuitBreakerState = healthStatus.circuitBreakerState === CircuitBreakerState.CLOSED ? 0 :
                                 healthStatus.circuitBreakerState === CircuitBreakerState.OPEN ? 1 : 2;
      
      this.prometheusService.setAIProviderCircuitBreakerState(circuitBreakerState, {
        provider,
        service: 'luminarytrade-backend',
      });

      // Response time
      this.prometheusService.setAIProviderResponseTime(healthStatus.responseTime / 1000, {
        provider,
        service: 'luminarytrade-backend',
      });
    }
  }

  /**
   * Calculate success rate for provider
   */
  private calculateSuccessRate(provider: AIProvider): number {
    const metrics = this.metrics.get(provider);
    if (!metrics || metrics.totalRequests === 0) return 0;
    return (metrics.successfulRequests / metrics.totalRequests) * 100;
  }

  /**
   * Calculate failure rate for provider
   */
  private calculateFailureRate(provider: AIProvider): number {
    const metrics = this.metrics.get(provider);
    if (!metrics || metrics.totalRequests === 0) return 0;
    return (metrics.failedRequests / metrics.totalRequests) * 100;
  }

  /**
   * Calculate uptime for provider
   */
  private calculateUptime(provider: AIProvider): number {
    const healthStatus = this.healthStatus.get(provider);
    if (!healthStatus) return 0;
    
    // Simple uptime calculation based on health checks
    // In a real implementation, this would track historical data
    return healthStatus.isHealthy ? 100 : 0;
  }

  /**
   * Calculate average fallback latency
   */
  private calculateAverageFallbackLatency(): number {
    const responseTimes = Array.from(this.healthStatus.values())
      .map(status => status.responseTime)
      .filter(time => time > 0);
    
    if (responseTimes.length === 0) return 0;
    
    return responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
  }

  /**
   * Get provider recommendations
   */
  getProviderRecommendations(): Array<{
    provider: AIProvider;
    recommendation: 'USE' | 'AVOID' | 'CAUTION';
    reason: string;
    priority: number;
  }> {
    const recommendations: Array<{
      provider: AIProvider;
      recommendation: 'USE' | 'AVOID' | 'CAUTION';
      reason: string;
      priority: number;
    }> = [];

    for (const [provider, healthStatus] of this.healthStatus) {
      const metrics = this.metrics.get(provider);
      const circuitBreaker = this.circuitBreakers.get(provider);

      let recommendation: 'USE' | 'AVOID' | 'CAUTION' = 'USE';
      let reason = 'Provider is healthy and performing well';
      let priority = 1;

      if (!healthStatus.isHealthy || circuitBreaker?.isOpen()) {
        recommendation = 'AVOID';
        reason = 'Provider is unhealthy or circuit breaker is open';
        priority = 3;
      } else if (healthStatus.failureRate > 20) {
        recommendation = 'CAUTION';
        reason = `High failure rate: ${healthStatus.failureRate.toFixed(1)}%`;
        priority = 2;
      } else if (healthStatus.responseTime > 5000) {
        recommendation = 'CAUTION';
        reason = `High response time: ${healthStatus.responseTime}ms`;
        priority = 2;
      } else if (metrics && metrics.fallbackUsage > metrics.totalRequests * 0.3) {
        recommendation = 'CAUTION';
        reason = 'High fallback usage indicates reliability issues';
        priority = 2;
      }

      recommendations.push({
        provider,
        recommendation,
        reason,
        priority,
      });
    }

    // Sort by priority (1 = highest priority)
    return recommendations.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get detailed diagnostics for troubleshooting
   */
  getDiagnostics(): {
    timestamp: Date;
    providers: Array<{
      provider: AIProvider;
      health: ProviderHealthStatus;
      metrics: ProviderMetrics;
      circuitBreaker: any;
      recentEvents: any[];
    }>;
    systemHealth: {
      totalProviders: number;
      healthyProviders: number;
      providersWithOpenCircuits: number;
      averageFailureRate: number;
      averageResponseTime: number;
    };
  } {
    const providers = Array.from(this.providers.keys()).map(provider => ({
      provider,
      health: this.healthStatus.get(provider)!,
      metrics: this.metrics.get(provider)!,
      circuitBreaker: this.circuitBreakers.get(provider)?.getMetrics(),
      recentEvents: this.circuitBreakers.get(provider)?.getEvents(10) || [],
    }));

    const healthyProviders = providers.filter(p => p.health.isHealthy).length;
    const providersWithOpenCircuits = providers.filter(p => p.circuitBreaker.state === 'OPEN').length;
    
    const totalFailureRate = providers.reduce((sum, p) => sum + p.health.failureRate, 0) / providers.length;
    const averageResponseTime = providers.reduce((sum, p) => sum + p.health.responseTime, 0) / providers.length;

    return {
      timestamp: new Date(),
      providers,
      systemHealth: {
        totalProviders: providers.length,
        healthyProviders,
        providersWithOpenCircuits,
        averageFailureRate: totalFailureRate,
        averageResponseTime,
      },
    };
  }
}
