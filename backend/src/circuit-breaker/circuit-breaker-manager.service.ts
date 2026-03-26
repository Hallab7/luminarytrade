import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CircuitBreakerService, CircuitState, CircuitBreakerConfig, CircuitBreakerOptions } from './circuit-breaker.service';
import { getCircuitBreakerMetadata, getFallbackMetadata } from './decorators/circuit-breaker.decorator';

export interface CircuitBreakerManagerConfig {
  /**
   * Default configuration for all circuit breakers
   */
  defaultConfig?: Partial<CircuitBreakerConfig>;
  
  /**
   * Global monitoring settings
   */
  monitoring?: {
    enabled: boolean;
    interval: number; // Health check interval in ms
    alertThresholds: {
      failureRate: number; // Alert if failure rate exceeds this
      responseTime: number; // Alert if avg response time exceeds this
      downtime: number; // Alert if downtime exceeds this (minutes)
    };
  };
  
  /**
   * Metrics collection settings
   */
  metrics?: {
    enabled: boolean;
    retentionPeriod: number; // How long to keep metrics (ms)
    exportInterval: number; // Export metrics interval (ms)
  };
}

export interface CircuitBreakerHealth {
  name: string;
  state: CircuitState;
  healthy: boolean;
  lastCheck: Date;
  uptime: number;
  downtime: number;
  failureRate: number;
  averageResponseTime: number;
  issues: string[];
}

export interface GlobalCircuitStats {
  totalCircuits: number;
  healthyCircuits: number;
  unhealthyCircuits: number;
  openCircuits: number;
  closedCircuits: number;
  halfOpenCircuits: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  globalFailureRate: number;
  globalAverageResponseTime: number;
  lastUpdated: Date;
}

@Injectable()
export class CircuitBreakerManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CircuitBreakerManagerService.name);
  private circuitBreakers: Map<string, CircuitBreakerService> = new Map();
  private config: CircuitBreakerManagerConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsExportInterval?: NodeJS.Timeout;
  private historicalData: Array<{
    timestamp: Date;
    stats: GlobalCircuitStats;
  }> = [];

  constructor() {
    this.config = {
      defaultConfig: {
        failureThreshold: 5,
        resetTimeout: 60000,
        monitoringPeriod: 10000,
        expectedRecoveryTime: 30000,
        timeout: 5000,
        retryCount: 3,
        retryDelay: 1000,
        retryBackoffMultiplier: 2,
      },
      monitoring: {
        enabled: true,
        interval: 30000, // 30 seconds
        alertThresholds: {
          failureRate: 0.5, // 50%
          responseTime: 5000, // 5 seconds
          downtime: 5, // 5 minutes
        },
      },
      metrics: {
        enabled: true,
        retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
        exportInterval: 60000, // 1 minute
      },
    };
  }

  async onModuleInit() {
    this.logger.log('Initializing Circuit Breaker Manager...');
    
    // Start health monitoring
    if (this.config.monitoring?.enabled) {
      this.startHealthMonitoring();
    }
    
    // Start metrics collection
    if (this.config.metrics?.enabled) {
      this.startMetricsCollection();
    }
    
    this.logger.log('Circuit Breaker Manager initialized');
  }

  /**
   * Create or get a circuit breaker
   */
  getCircuitBreaker(
    name: string,
    config?: Partial<CircuitBreakerConfig>,
    options?: CircuitBreakerOptions
  ): CircuitBreakerService {
    let circuitBreaker = this.circuitBreakers.get(name);
    
    if (!circuitBreaker) {
      const finalConfig = { ...this.config.defaultConfig, ...config };
      circuitBreaker = new CircuitBreakerService(name, finalConfig, options);
      
      // Set up event listeners
      this.setupCircuitBreakerEvents(circuitBreaker);
      
      this.circuitBreakers.set(name, circuitBreaker);
      this.logger.log(`Created circuit breaker '${name}'`);
    }
    
    return circuitBreaker;
  }

  /**
   * Get all circuit breakers
   */
  getAllCircuitBreakers(): Map<string, CircuitBreakerService> {
    return new Map(this.circuitBreakers);
  }

  /**
   * Get circuit breaker by name
   */
  getCircuitBreakerByName(name: string): CircuitBreakerService | undefined {
    return this.circuitBreakers.get(name);
  }

  /**
   * Remove circuit breaker
   */
  removeCircuitBreaker(name: string): boolean {
    const removed = this.circuitBreakers.delete(name);
    if (removed) {
      this.logger.log(`Removed circuit breaker '${name}'`);
    }
    return removed;
  }

  /**
   * Get health status of all circuit breakers
   */
  getHealthStatus(): CircuitBreakerHealth[] {
    const healthStatuses: CircuitBreakerHealth[] = [];
    
    for (const [name, circuitBreaker] of this.circuitBreakers) {
      const stats = circuitBreaker.getStats();
      const health = this.assessCircuitHealth(name, stats);
      healthStatuses.push(health);
    }
    
    return healthStatuses;
  }

  /**
   * Get global statistics
   */
  getGlobalStats(): GlobalCircuitStats {
    let totalRequests = 0;
    let totalFailures = 0;
    let totalSuccesses = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;
    
    let healthyCount = 0;
    let unhealthyCount = 0;
    let openCount = 0;
    let closedCount = 0;
    let halfOpenCount = 0;
    
    for (const circuitBreaker of this.circuitBreakers.values()) {
      const stats = circuitBreaker.getStats();
      
      totalRequests += stats.successes + stats.failures;
      totalFailures += stats.failures;
      totalSuccesses += stats.successes;
      
      if (stats.averageResponseTime > 0) {
        totalResponseTime += stats.averageResponseTime;
        responseTimeCount++;
      }
      
      // Count states
      switch (stats.state) {
        case CircuitState.CLOSED:
          closedCount++;
          healthyCount++;
          break;
        case CircuitState.OPEN:
          openCount++;
          unhealthyCount++;
          break;
        case CircuitState.HALF_OPEN:
          halfOpenCount++;
          unhealthyCount++;
          break;
      }
    }
    
    const globalFailureRate = totalRequests > 0 ? totalFailures / totalRequests : 0;
    const globalAverageResponseTime = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
    
    return {
      totalCircuits: this.circuitBreakers.size,
      healthyCircuits: healthyCount,
      unhealthyCircuits: unhealthyCount,
      openCircuits: openCount,
      closedCircuits: closedCount,
      halfOpenCircuits: halfOpenCount,
      totalRequests,
      totalFailures,
      totalSuccesses,
      globalFailureRate,
      globalAverageResponseTime,
      lastUpdated: new Date(),
    };
  }

  /**
   * Assess individual circuit health
   */
  private assessCircuitHealth(name: string, stats: any): CircuitBreakerHealth {
    const issues: string[] = [];
    let healthy = true;
    
    // Check failure rate
    const totalRequests = stats.successes + stats.failures;
    const failureRate = totalRequests > 0 ? stats.failures / totalRequests : 0;
    
    if (failureRate > this.config.monitoring!.alertThresholds.failureRate) {
      issues.push(`High failure rate: ${(failureRate * 100).toFixed(2)}%`);
      healthy = false;
    }
    
    // Check response time
    if (stats.averageResponseTime > this.config.monitoring!.alertThresholds.responseTime) {
      issues.push(`High average response time: ${stats.averageResponseTime.toFixed(2)}ms`);
      healthy = false;
    }
    
    // Check downtime
    const downtimeMinutes = stats.downtime / (1000 * 60);
    if (downtimeMinutes > this.config.monitoring!.alertThresholds.downtime) {
      issues.push(`High downtime: ${downtimeMinutes.toFixed(2)} minutes`);
      healthy = false;
    }
    
    // Check state
    if (stats.state === CircuitState.OPEN) {
      issues.push('Circuit is OPEN');
      healthy = false;
    }
    
    return {
      name,
      state: stats.state,
      healthy,
      lastCheck: new Date(),
      uptime: stats.uptime,
      downtime: stats.downtime,
      failureRate,
      averageResponseTime: stats.averageResponseTime,
      issues,
    };
  }

  /**
   * Set up circuit breaker event listeners
   */
  private setupCircuitBreakerEvents(circuitBreaker: CircuitBreakerService): void {
    circuitBreaker.on('stateChange', (event) => {
      this.logger.log(`Circuit '${event.name}' state changed from ${event.from} to ${event.to}`);
      
      // Emit global event
      this.emit('circuitStateChange', event);
    });
    
    circuitBreaker.on('reset', (event) => {
      this.logger.log(`Circuit '${event.name}' was reset`);
      this.emit('circuitReset', event);
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.monitoring!.interval);
    
    this.logger.log(`Health monitoring started with ${this.config.monitoring!.interval}ms interval`);
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    const healthStatuses = this.getHealthStatus();
    const unhealthyCircuits = healthStatuses.filter(h => !h.healthy);
    
    if (unhealthyCircuits.length > 0) {
      this.logger.warn(`Found ${unhealthyCircuits.length} unhealthy circuits:`);
      
      for (const health of unhealthyCircuits) {
        this.logger.warn(`Circuit '${health.name}' issues: ${health.issues.join(', ')}`);
      }
      
      // Emit alert event
      this.emit('healthAlert', {
        timestamp: new Date(),
        unhealthyCircuits,
        totalCircuits: healthStatuses.length,
      });
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsExportInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.metrics!.exportInterval);
    
    this.logger.log(`Metrics collection started with ${this.config.metrics!.exportInterval}ms interval`);
  }

  /**
   * Collect metrics
   */
  private collectMetrics(): void {
    const stats = this.getGlobalStats();
    
    this.historicalData.push({
      timestamp: new Date(),
      stats,
    });
    
    // Clean old data
    const cutoffTime = Date.now() - this.config.metrics!.retentionPeriod;
    this.historicalData = this.historicalData.filter(
      data => data.timestamp.getTime() > cutoffTime
    );
    
    // Emit metrics event
    this.emit('metricsCollected', {
      timestamp: new Date(),
      stats,
      historicalData: this.historicalData,
    });
  }

  /**
   * Get historical metrics
   */
  getHistoricalData(): Array<{
    timestamp: Date;
    stats: GlobalCircuitStats;
  }> {
    return [...this.historicalData];
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const [name, circuitBreaker] of this.circuitBreakers) {
      circuitBreaker.reset();
    }
    
    this.logger.log('All circuit breakers reset');
  }

  /**
   * Configure manager
   */
  configure(config: Partial<CircuitBreakerManagerConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart monitoring if settings changed
    if (config.monitoring) {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      if (this.config.monitoring?.enabled) {
        this.startHealthMonitoring();
      }
    }
    
    // Restart metrics if settings changed
    if (config.metrics) {
      if (this.metricsExportInterval) {
        clearInterval(this.metricsExportInterval);
      }
      
      if (this.config.metrics?.enabled) {
        this.startMetricsCollection();
      }
    }
    
    this.logger.log('Circuit Breaker Manager configuration updated');
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(): string {
    const data = {
      timestamp: new Date(),
      config: this.config,
      globalStats: this.getGlobalStats(),
      healthStatus: this.getHealthStatus(),
      historicalData: this.historicalData,
    };
    
    return JSON.stringify(data, null, 2);
  }

  /**
   * Apply circuit breaker decorators to a service instance
   */
  applyDecorators(serviceInstance: any): void {
    const metadata = getCircuitBreakerMetadata(serviceInstance.constructor);
    const fallbackMetadata = getFallbackMetadata(serviceInstance.constructor);
    
    // Apply circuit breakers
    for (const circuit of metadata) {
      const circuitBreaker = this.getCircuitBreaker(
        circuit.name,
        circuit.config,
        circuit.options
      );
      
      // Store circuit breaker on instance
      serviceInstance.getCircuitBreaker = (name: string) => {
        return name === circuit.name ? circuitBreaker : undefined;
      };
    }
    
    // Apply fallbacks
    for (const fallback of fallbackMetadata) {
      const circuitBreaker = this.getCircuitBreakerByName(fallback.circuitName);
      
      if (circuitBreaker && !circuitBreaker.getStats().fallback) {
        // Update circuit breaker with fallback
        const fallbackMethod = serviceInstance[fallback.method];
        circuitBreaker.updateConfig({
          // This would need to be implemented in CircuitBreakerService
        });
      }
    }
  }

  async onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.metricsExportInterval) {
      clearInterval(this.metricsExportInterval);
    }
    
    this.removeAllListeners();
    this.logger.log('Circuit Breaker Manager destroyed');
  }
}
