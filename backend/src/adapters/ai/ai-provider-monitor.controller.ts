import { Controller, Get, Post, Put, Delete, Query, Param, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { MetricsInterceptor } from '../../metrics/interceptors/metrics.interceptor';
import { LoggingInterceptor } from '../../logging/interceptors/logging.interceptor';
import { AIProviderMonitorService } from '../ai/ai-provider-monitor.service';
import { AIOrchestrationService } from '../../compute-bridge/service/ai-orchestration.service';
import { CircuitBreakerState } from '../patterns/circuit-breaker';
import { AIProvider } from '../../compute-bridge/entities/ai-result-entity';

@ApiTags('AI Provider Monitoring')
@Controller('ai/providers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(MetricsInterceptor, LoggingInterceptor)
export class AIProviderMonitorController {
  constructor(
    private readonly providerMonitor: AIProviderMonitorService,
    private readonly aiOrchestration: AIOrchestrationService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get status of all AI providers' })
  @ApiResponse({ status: 200, description: 'Provider status retrieved successfully' })
  async getAllProviders() {
    const providers = this.providerMonitor.getAllProviderHealth();
    const circuitBreakers = this.providerMonitor.getAllCircuitBreakerStatus();
    const metrics = this.providerMonitor.getAllProviderMetrics();
    const recommendations = this.providerMonitor.getProviderRecommendations();

    return {
      timestamp: new Date(),
      providers: providers.map(provider => ({
        ...provider,
        circuitBreakerState: circuitBreakers.get(provider.provider),
        metrics: metrics.get(provider.provider),
        recommendation: recommendations.find(r => r.provider === provider.provider),
      })),
      summary: {
        totalProviders: providers.length,
        healthyProviders: providers.filter(p => p.isHealthy).length,
        providersWithOpenCircuits: Array.from(circuitBreakers.values())
          .filter(state => state === CircuitBreakerState.OPEN).length,
        averageResponseTime: providers.reduce((sum, p) => sum + p.responseTime, 0) / providers.length,
        averageFailureRate: providers.reduce((sum, p) => sum + p.failureRate, 0) / providers.length,
      },
    };
  }

  @Get(':provider')
  @ApiOperation({ summary: 'Get detailed health status for specific provider' })
  @ApiParam({ name: 'provider', description: 'AI provider name', enum: AIProvider })
  @ApiResponse({ status: 200, description: 'Provider health status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async getProviderHealth(@Param('provider') provider: AIProvider) {
    const health = this.providerMonitor.getProviderHealth(provider);
    const metrics = this.providerMonitor.getProviderMetrics(provider);
    const circuitBreakerStatus = this.providerMonitor.getAllCircuitBreakerStatus().get(provider);

    if (!health) {
      throw new Error(`Provider ${provider} not found`);
    }

    return {
      provider,
      health,
      metrics,
      circuitBreaker: {
        state: circuitBreakerStatus,
        isHealthy: circuitBreakerStatus === CircuitBreakerState.CLOSED,
        lastStateTransition: health.lastStateTransition,
      },
      recommendations: this.providerMonitor.getProviderRecommendations()
        .filter(r => r.provider === provider),
    };
  }

  @Get(':provider/health')
  @ApiOperation({ summary: 'Perform health check on specific provider' })
  @ApiParam({ name: 'provider', description: 'AI provider name', enum: AIProvider })
  @ApiResponse({ status: 200, description: 'Health check completed' })
  async performHealthCheck(@Param('provider') provider: AIProvider) {
    await this.providerMonitor.performHealthChecks();
    
    const health = this.providerMonitor.getProviderHealth(provider);
    
    if (!health) {
      throw new Error(`Provider ${provider} not found`);
    }

    return {
      provider,
      health,
      timestamp: new Date(),
      checkPerformed: true,
    };
  }

  @Get(':provider/metrics')
  @ApiOperation({ summary: 'Get detailed metrics for specific provider' })
  @ApiParam({ name: 'provider', description: 'AI provider name', enum: AIProvider })
  @ApiQuery({ name: 'timeRange', required: false, enum: ['1h', '24h', '7d'], description: 'Time range for metrics' })
  @ApiResponse({ status: 200, description: 'Provider metrics retrieved successfully' })
  async getProviderMetrics(
    @Param('provider') provider: AIProvider,
    @Query('timeRange') timeRange: '1h' | '24h' | '7d' = '24h'
  ) {
    const metrics = this.providerMonitor.getProviderMetrics(provider);
    const health = this.providerMonitor.getProviderHealth(provider);
    const analytics = await this.aiOrchestration.getPerformanceAnalytics(timeRange);

    if (!metrics || !health) {
      throw new Error(`Provider ${provider} not found`);
    }

    return {
      provider,
      timeRange,
      current: {
        ...metrics,
        health,
      },
      analytics: analytics.providerUsage[provider] ? {
        usage: analytics.providerUsage[provider],
        successRate: metrics.totalRequests > 0 ? (metrics.successfulRequests / metrics.totalRequests) * 100 : 0,
        failureRate: metrics.totalRequests > 0 ? (metrics.failedRequests / metrics.totalRequests) * 100 : 0,
        averageResponseTime: metrics.averageResponseTime,
        circuitBreakerTransitions: metrics.circuitBreakerTransitions,
        fallbackUsage: metrics.fallbackUsage,
      } : null,
      performance: {
        averageResponseTime: metrics.averageResponseTime,
        totalRequests: metrics.totalRequests,
        successfulRequests: metrics.successfulRequests,
        failedRequests: metrics.failedRequests,
        successRate: metrics.totalRequests > 0 ? (metrics.successfulRequests / metrics.totalRequests) * 100 : 0,
        failureRate: metrics.totalRequests > 0 ? (metrics.failedRequests / metrics.totalRequests) * 100 : 0,
      },
    };
  }

  @Get('circuit-breakers')
  @ApiOperation({ summary: 'Get circuit breaker status for all providers' })
  @ApiResponse({ status: 200, description: 'Circuit breaker status retrieved successfully' })
  async getCircuitBreakerStatus() {
    const circuitBreakers = this.providerMonitor.getAllCircuitBreakerStatus();
    const metrics = this.providerMonitor.getAllProviderMetrics();

    return {
      timestamp: new Date(),
      circuitBreakers: Array.from(circuitBreakers.entries()).map(([provider, state]) => ({
        provider,
        state,
        isHealthy: state === CircuitBreakerState.CLOSED,
        metrics: metrics.get(provider),
      })),
      summary: {
        totalProviders: circuitBreakers.size,
        closedCount: Array.from(circuitBreakers.values()).filter(s => s === CircuitBreakerState.CLOSED).length,
        openCount: Array.from(circuitBreakers.values()).filter(s => s === CircuitBreakerState.OPEN).length,
        halfOpenCount: Array.from(circuitBreakers.values()).filter(s => s === CircuitBreakerState.HALF_OPEN).length,
      },
    };
  }

  @Get('circuit-breakers/:provider')
  @ApiOperation({ summary: 'Get detailed circuit breaker status for specific provider' })
  @ApiParam({ name: 'provider', description: 'AI provider name', enum: AIProvider })
  @ApiResponse({ status: 200, description: 'Circuit breaker status retrieved successfully' })
  async getCircuitBreakerDetails(@Param('provider') provider: AIProvider) {
    const status = this.providerMonitor.getAllCircuitBreakerStatus().get(provider);
    const metrics = this.providerMonitor.getProviderMetrics(provider);

    if (status === undefined) {
      throw new Error(`Circuit breaker for provider ${provider} not found`);
    }

    return {
      provider,
      state: status,
      isHealthy: status === CircuitBreakerState.CLOSED,
      metrics,
      recommendations: this.getCircuitBreakerRecommendations(status, metrics),
    };
  }

  @Put('circuit-breakers/:provider/state')
  @ApiOperation({ summary: 'Force circuit breaker state change' })
  @ApiParam({ name: 'provider', description: 'AI provider name', enum: AIProvider })
  @ApiBody({ 
    description: 'Target circuit breaker state',
    schema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['OPEN', 'CLOSED'],
          description: 'Target circuit breaker state'
        }
      },
      required: ['state']
    }
  })
  @ApiResponse({ status: 200, description: 'Circuit breaker state changed successfully' })
  async forceCircuitBreakerState(
    @Param('provider') provider: AIProvider,
    @Body() body: { state: 'OPEN' | 'CLOSED' }
  ) {
    const targetState = body.state.toUpperCase() as CircuitBreakerState;
    
    this.providerMonitor.forceCircuitBreakerState(provider, targetState);
    
    const newStatus = this.providerMonitor.getAllCircuitBreakerStatus().get(provider);

    return {
      provider,
      previousState: 'UNKNOWN',
      newState: newStatus,
      timestamp: new Date(),
      forced: true,
    };
  }

  @Post('circuit-breakers/:provider/reset')
  @ApiOperation({ summary: 'Reset circuit breaker for specific provider' })
  @ApiParam({ name: 'provider', description: 'AI provider name', enum: AIProvider })
  @ApiResponse({ status: 200, description: 'Circuit breaker reset successfully' })
  async resetCircuitBreaker(@Param('provider') provider: AIProvider) {
    this.providerMonitor.resetCircuitBreaker(provider);
    
    const newStatus = this.providerMonitor.getAllCircuitBreakerStatus().get(provider);

    return {
      provider,
      newState: newStatus,
      timestamp: new Date(),
      reset: true,
    };
  }

  @Post('circuit-breakers/reset')
  @ApiOperation({ summary: 'Reset all circuit breakers' })
  @ApiResponse({ status: 200, description: 'All circuit breakers reset successfully' })
  async resetAllCircuitBreakers() {
    this.aiOrchestration.resetAllCircuitBreakers();
    
    const newStatus = this.providerMonitor.getAllCircuitBreakerStatus();

    return {
      timestamp: new Date(),
      reset: true,
      circuitBreakers: Array.from(newStatus.entries()).map(([provider, state]) => ({
        provider,
        state,
      })),
    };
  }

  @Get('fallback')
  @ApiOperation({ summary: 'Get fallback chain metrics and usage' })
  @ApiResponse({ status: 200, description: 'Fallback metrics retrieved successfully' })
  async getFallbackMetrics() {
    const fallbackMetrics = this.aiOrchestration.getFallbackMetrics();
    const recommendations = this.providerMonitor.getProviderRecommendations();

    return {
      timestamp: new Date(),
      fallbackChain: {
        primary: fallbackMetrics.primaryProvider,
        secondary: fallbackMetrics.secondaryProvider,
        tertiary: fallbackMetrics.tertiaryProvider,
        localModelProvider: fallbackMetrics.localModelProvider,
      },
      usage: fallbackMetrics.fallbackUsagePercentage,
      performance: {
        totalFallbacks: fallbackMetrics.totalFallbacks,
        averageFallbackLatency: fallbackMetrics.averageFallbackLatency,
        fallbackRate: Object.values(fallbackMetrics.fallbackUsagePercentage).reduce((sum, rate) => sum + rate, 0),
      },
      recommendations: recommendations.map(r => ({
        provider: r.provider,
        recommendation: r.recommendation,
        reason: r.reason,
        priority: r.priority,
      })),
    };
  }

  @Get('diagnostics')
  @ApiOperation({ summary: 'Get comprehensive diagnostics for troubleshooting' })
  @ApiResponse({ status: 200, description: 'Diagnostics retrieved successfully' })
  async getDiagnostics() {
    const diagnostics = await this.aiOrchestration.getDiagnostics();

    return {
      ...diagnostics,
      recommendations: this.getSystemRecommendations(diagnostics),
    };
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get performance analytics' })
  @ApiQuery({ name: 'timeRange', required: false, enum: ['1h', '24h', '7d'], description: 'Time range for analytics' })
  @ApiResponse({ status: 200, description: 'Performance analytics retrieved successfully' })
  async getAnalytics(@Query('timeRange') timeRange: '1h' | '24h' | '7d' = '24h') {
    const analytics = await this.aiOrchestration.getPerformanceAnalytics(timeRange);
    const fallbackMetrics = this.aiOrchestration.getFallbackMetrics();

    return {
      ...analytics,
      fallback: {
        usage: fallbackMetrics.fallbackUsagePercentage,
        totalFallbacks: fallbackMetrics.totalFallbacks,
        averageLatency: fallbackMetrics.averageFallbackLatency,
        fallbackRate: analytics.fallbackRate,
      },
      providerBreakdown: Object.entries(analytics.providerUsage).map(([provider, usage]) => ({
        provider,
        usage,
        percentage: analytics.totalRequests > 0 ? (usage / analytics.totalRequests) * 100 : 0,
        fallbackRate: fallbackMetrics.fallbackUsagePercentage[provider] || 0,
      })),
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Get overall AI system health' })
  @ApiResponse({ status: 200, description: 'System health retrieved successfully' })
  async getSystemHealth() {
    const healthCheck = await this.aiOrchestration.healthCheck();
    const diagnostics = await this.aiOrchestration.getDiagnostics();

    return {
      ...healthCheck,
      diagnostics: {
        totalProviders: diagnostics.systemHealth.totalProviders,
        healthyProviders: diagnostics.systemHealth.healthyProviders,
        providersWithOpenCircuits: diagnostics.systemHealth.providersWithOpenCircuits,
        averageFailureRate: diagnostics.systemHealth.averageFailureRate,
        averageResponseTime: diagnostics.systemHealth.averageResponseTime,
      },
      status: this.calculateSystemHealthStatus(healthCheck),
      alerts: this.generateHealthAlerts(healthCheck, diagnostics),
    };
  }

  @Post('test/:provider')
  @ApiOperation({ summary: 'Test specific AI provider with sample request' })
  @ApiParam({ name: 'provider', description: 'AI provider name', enum: AIProvider })
  @ApiBody({ 
    description: 'Test request data',
    schema: {
      type: 'object',
      properties: {
        userData: {
          type: 'object',
          description: 'Sample user data for testing',
          example: {
            income: 50000,
            age: 30,
            creditHistory: 'good',
            employmentStatus: 'employed'
          }
        }
      },
      required: ['userData']
    }
  })
  @ApiResponse({ status: 200, description: 'Provider test completed' })
  async testProvider(
    @Param('provider') provider: AIProvider,
    @Body() body: { userData: any }
  ) {
    const startTime = Date.now();

    try {
      const result = await this.aiOrchestration.scoreUserWithCustomChain(
        {
          userId: 'test-user',
          userData: body.userData,
          preferredProvider: provider,
        },
        [provider]
      );

      return {
        provider,
        test: {
          success: true,
          result,
          latency: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        provider,
        test: {
          success: false,
          error: error.message,
          latency: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    }
  }

  // Private helper methods

  private getCircuitBreakerRecommendations(state: CircuitBreakerState, metrics: any): string[] {
    const recommendations: string[] = [];

    if (state === CircuitBreakerState.OPEN) {
      recommendations.push('Circuit breaker is OPEN - provider is temporarily disabled');
      recommendations.push('Wait for automatic reset or manually reset when provider is healthy');
      recommendations.push('Monitor provider health before re-enabling');
    } else if (state === CircuitBreakerState.HALF_OPEN) {
      recommendations.push('Circuit breaker is HALF_OPEN - testing provider recovery');
      recommendations.push('Monitor closely for successful operations to close circuit');
    }

    if (metrics && metrics.failureRate > 20) {
      recommendations.push(`High failure rate (${metrics.failureRate.toFixed(1)}%) - investigate provider issues`);
    }

    if (metrics && metrics.averageResponseTime > 5000) {
      recommendations.push(`High response time (${metrics.averageResponseTime}ms) - check provider performance`);
    }

    return recommendations;
  }

  private getSystemRecommendations(diagnostics: any): string[] {
    const recommendations: string[] = [];

    if (diagnostics.systemHealth.averageFailureRate > 10) {
      recommendations.push('High system failure rate - review provider configurations');
    }

    if (diagnostics.systemHealth.providersWithOpenCircuits > 0) {
      recommendations.push(`${diagnostics.systemHealth.providersWithOpenCircuits} providers have open circuits - investigate failures`);
    }

    if (diagnostics.systemHealth.averageResponseTime > 3000) {
      recommendations.push('High average response time - consider optimizing requests or changing providers');
    }

    if (diagnostics.systemHealth.healthyProviders < diagnostics.systemHealth.totalProviders) {
      recommendations.push('Some providers are unhealthy - check configurations and API keys');
    }

    return recommendations;
  }

  private calculateSystemHealthStatus(healthCheck: any): 'healthy' | 'degraded' | 'unhealthy' {
    const healthyProviders = healthCheck.systemHealth.healthyProviders;
    const totalProviders = healthCheck.systemHealth.totalProviders;
    const openCircuits = healthCheck.systemHealth.providersWithOpenCircuits;
    const failureRate = healthCheck.systemHealth.averageFailureRate;

    if (healthyProviders === totalProviders && openCircuits === 0 && failureRate < 5) {
      return 'healthy';
    } else if (healthyProviders > 0 && openCircuits < totalProviders / 2 && failureRate < 20) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  private generateHealthAlerts(healthCheck: any, diagnostics: any): any[] {
    const alerts: any[] = [];

    if (healthCheck.systemHealth.providersWithOpenCircuits > 0) {
      alerts.push({
        severity: 'warning',
        title: 'Circuit Breakers Open',
        message: `${healthCheck.systemHealth.providersWithOpenCircuits} providers have open circuit breakers`,
        timestamp: new Date(),
      });
    }

    if (healthCheck.systemHealth.averageFailureRate > 15) {
      alerts.push({
        severity: 'critical',
        title: 'High Failure Rate',
        message: `System failure rate is ${healthCheck.systemHealth.averageFailureRate.toFixed(1)}%`,
        timestamp: new Date(),
      });
    }

    if (healthCheck.systemHealth.healthyProviders === 0) {
      alerts.push({
        severity: 'critical',
        title: 'All Providers Unhealthy',
        message: 'No AI providers are currently healthy',
        timestamp: new Date(),
      });
    }

    if (healthCheck.systemHealth.averageResponseTime > 5000) {
      alerts.push({
        severity: 'warning',
        title: 'High Response Time',
        message: `Average response time is ${healthCheck.systemHealth.averageResponseTime}ms`,
        timestamp: new Date(),
      });
    }

    return alerts;
  }
}
