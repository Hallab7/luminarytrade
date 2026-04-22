import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { AIResultEntity, AIResultStatus, AIProvider } from "../entities/ai-result-entity";
import {
  NormalizedScoringResult,
  ScoringRequestDto,
  ScoringResponseDto,
} from "../dto/ai-scoring.dto";
import { AuditLogService } from "../../audit/audit-log.service";
import { AuditEventType } from "../../audit/entities/audit-log.entity";
import { IEventBus } from "../../events/interfaces/event-bus.interface";
import {
  AIResultCreatedEvent,
  AIResultCompletedEvent,
  AIResultFailedEvent,
} from "../../events/domain-events/ai-result.events";
import { AdapterFactory } from "../../adapters/factory/adapter.factory";
import { AdapterRegistry } from "../../adapters/registry/adapter.registry";
import { FallbackHandler, FallbackChain, FallbackConfig } from "../../adapters/patterns/fallback-handler";
import { AIProviderMonitorService } from "../../adapters/ai/ai-provider-monitor.service";
import { BaseAIModelAdapter } from "../../adapters/ai/base-ai-model.adapter";
import { PluginRegistry } from "../../plugins/registry/plugin.registry";

/**
 * Enhanced AI Orchestration Service
 * Handles AI scoring operations with intelligent fallback chains,
 * circuit breaker protection, and comprehensive monitoring.
 */
@Injectable()
export class AIOrchestrationService {
  private readonly logger = new Logger(AIOrchestrationService.name);
  private readonly secretKey: string;
  private readonly fallbackHandler: FallbackHandler<NormalizedScoringResult>;
  private readonly adapters = new Map<AIProvider, BaseAIModelAdapter>();

  constructor(
    @InjectRepository(AIResultEntity)
    private aiResultRepository: Repository<AIResultEntity>,
    private configService: ConfigService,
    private auditLogService: AuditLogService,
    private readonly adapterFactory: AdapterFactory,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly pluginRegistry: PluginRegistry,
    private readonly providerMonitor: AIProviderMonitorService,
    @Inject("EventBus")
    private readonly eventBus: IEventBus,
  ) {
    this.secretKey =
      this.configService.get<string>("AI_SIGNATURE_SECRET") ||
      "default-secret-key";

    // Initialize fallback chain
    const fallbackChain: FallbackChain = {
      primary: AIProvider.OPENAI,
      secondary: AIProvider.LLAMA,
      tertiary: AIProvider.GROK,
      local: AIProvider.LOCAL,
    };

    const fallbackConfig: Partial<FallbackConfig> = {
      maxAttempts: 4,
      timeoutPerAttempt: 30000, // 30 seconds
      enableCircuitBreaker: true,
      retryDelay: 1000, // 1 second
      exponentialBackoff: true,
      jitter: true,
    };

    this.fallbackHandler = new FallbackHandler(
      "AI-Scoring",
      fallbackChain,
      fallbackConfig
    );

    // Initialize adapters
    this.initializeAdapters();
  }

  /**
   * Score user with intelligent fallback and circuit breaker protection
   */
  async scoreUser(request: ScoringRequestDto): Promise<ScoringResponseDto> {
    const startTime = Date.now();
    
    try {
      // Create initial result entry
      const resultEntity = this.aiResultRepository.create({
        userId: request.userId,
        provider: request.preferredProvider || AIProvider.OPENAI,
        status: AIResultStatus.PENDING,
        request: request,
      });
      
      const savedResult = await this.aiResultRepository.save(resultEntity);
      
      // Emit creation event
      await this.eventBus.publish(new AIResultCreatedEvent(savedResult.id, request));

      // Process with AI adapter using fallback chain
      const fallbackResult = await this.fallbackHandler.executeWithFallback(
        this.adapters,
        async (adapter: BaseAIModelAdapter, provider: AIProvider) => {
          return await this.providerMonitor.executeWithMonitoring(
            provider,
            () => adapter.score(request.userData)
          );
        }
      );

      const scoringResult = fallbackResult.result;

      // Record fallback usage if applicable
      if (fallbackResult.attemptCount > 1) {
        this.providerMonitor.recordFallbackUsage(fallbackResult.provider);
        this.logger.info('AI scoring used fallback provider', undefined, {
          originalProvider: request.preferredProvider || AIProvider.OPENAI,
          actualProvider: fallbackResult.provider,
          attemptCount: fallbackResult.attemptCount,
          totalLatency: fallbackResult.totalLatency,
        });
      }

      // Update result with scoring data
      savedResult.response = scoringResult;
      savedResult.provider = fallbackResult.provider;
      savedResult.creditScore = scoringResult.creditScore;
      savedResult.riskScore = scoringResult.riskScore;
      savedResult.riskLevel = scoringResult.riskLevel;
      savedResult.status = AIResultStatus.SUCCESS;
      savedResult.completedAt = new Date();
      savedResult.processingTime = fallbackResult.totalLatency;
      savedResult.fallbackUsed = fallbackResult.attemptCount > 1;
      savedResult.fallbackChain = fallbackResult.fallbackChain;
      
      await this.aiResultRepository.save(savedResult);
      
      // Emit completion event
      await this.eventBus.publish(new AIResultCompletedEvent(savedResult.id, scoringResult));
      
      // Generate signature
      const signature = this.generateSignature(savedResult);

      const response: ScoringResponseDto = {
        resultId: savedResult.id,
        userId: savedResult.userId,
        provider: savedResult.provider,
        creditScore: scoringResult.creditScore,
        riskScore: scoringResult.riskScore,
        riskLevel: scoringResult.riskLevel,
        signature,
        completedAt: savedResult.completedAt,
        processingTime: fallbackResult.totalLatency,
        fallbackUsed: fallbackResult.attemptCount > 1,
        fallbackProvider: fallbackResult.attemptCount > 1 ? fallbackResult.provider : undefined,
      };

      this.logger.info('AI scoring completed successfully', undefined, {
        resultId: savedResult.id,
        userId: savedResult.userId,
        provider: savedResult.provider,
        creditScore: scoringResult.creditScore,
        processingTime: fallbackResult.totalLatency,
        fallbackUsed: response.fallbackUsed,
      });

      return response;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error(`AI scoring failed: ${error.message}`, error, {
        userId: request.userId,
        preferredProvider: request.preferredProvider,
        processingTime,
      });
      
      // Update status to failed
      const result = await this.aiResultRepository.findOne({ 
        where: { id: (error as any).savedResultId || '' } 
      });
      
      if (result) {
        result.status = AIResultStatus.FAILED;
        result.errorMessage = error.message;
        result.processingTime = processingTime;
        result.completedAt = new Date();
        await this.aiResultRepository.save(result);
      }
      
      // Log the failure event
      await this.eventBus.publish(new AIResultFailedEvent(request.userId, error.message));
      
      throw error;
    }
  }

  /**
   * Score user with custom provider chain
   */
  async scoreUserWithCustomChain(
    request: ScoringRequestDto,
    providerChain: AIProvider[]
  ): Promise<ScoringResponseDto> {
    const startTime = Date.now();
    
    try {
      // Create initial result entry
      const resultEntity = this.aiResultRepository.create({
        userId: request.userId,
        provider: providerChain[0] || AIProvider.OPENAI,
        status: AIResultStatus.PENDING,
        request: request,
      });
      
      const savedResult = await this.aiResultRepository.save(resultEntity);
      
      // Emit creation event
      await this.eventBus.publish(new AIResultCreatedEvent(savedResult.id, request));

      // Process with custom provider chain
      const fallbackResult = await this.fallbackHandler.executeWithCustomFallback(
        this.adapters,
        providerChain,
        async (adapter: BaseAIModelAdapter, provider: AIProvider) => {
          return await this.providerMonitor.executeWithMonitoring(
            provider,
            () => adapter.score(request.userData)
          );
        }
      );

      const scoringResult = fallbackResult.result;

      // Update result with scoring data
      savedResult.response = scoringResult;
      savedResult.provider = fallbackResult.provider;
      savedResult.creditScore = scoringResult.creditScore;
      savedResult.riskScore = scoringResult.riskScore;
      savedResult.riskLevel = scoringResult.riskLevel;
      savedResult.status = AIResultStatus.SUCCESS;
      savedResult.completedAt = new Date();
      savedResult.processingTime = fallbackResult.totalLatency;
      savedResult.fallbackUsed = fallbackResult.attemptCount > 1;
      savedResult.fallbackChain = fallbackResult.fallbackChain;
      savedResult.customProviderChain = providerChain;
      
      await this.aiResultRepository.save(savedResult);
      
      // Emit completion event
      await this.eventBus.publish(new AIResultCompletedEvent(savedResult.id, scoringResult));
      
      // Generate signature
      const signature = this.generateSignature(savedResult);

      return {
        resultId: savedResult.id,
        userId: savedResult.userId,
        provider: savedResult.provider,
        creditScore: scoringResult.creditScore,
        riskScore: scoringResult.riskScore,
        riskLevel: scoringResult.riskLevel,
        signature,
        completedAt: savedResult.completedAt,
        processingTime: fallbackResult.totalLatency,
        fallbackUsed: fallbackResult.attemptCount > 1,
        fallbackProvider: fallbackResult.attemptCount > 1 ? fallbackResult.provider : undefined,
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error(`AI scoring with custom chain failed: ${error.message}`, error, {
        userId: request.userId,
        providerChain,
        processingTime,
      });
      
      // Update status to failed
      const result = await this.aiResultRepository.findOne({ 
        where: { id: (error as any).savedResultId || '' } 
      });
      
      if (result) {
        result.status = AIResultStatus.FAILED;
        result.errorMessage = error.message;
        result.processingTime = processingTime;
        result.completedAt = new Date();
        result.customProviderChain = providerChain;
        await this.aiResultRepository.save(result);
      }
      
      // Log the failure event
      await this.eventBus.publish(new AIResultFailedEvent(request.userId, error.message));
      
      throw error;
    }
  }

  async getResult(id: string): Promise<AIResultEntity> {
    const result = await this.aiResultRepository.findOne({ where: { id } });
    if (!result) {
      throw new BadRequestException(`Result with ID ${id} not found`);
    }
    return result;
  }

  async getUserResults(userId: string): Promise<AIResultEntity[]> {
    return await this.aiResultRepository.find({ 
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Get comprehensive health status of AI providers
   */
  async healthCheck(): Promise<Record<string, any>> {
    const providerHealth = this.providerMonitor.getAllProviderHealth();
    const circuitBreakerStatus = this.providerMonitor.getAllCircuitBreakerStatus();
    const fallbackMetrics = this.fallbackHandler.getMetrics();
    const providerMetrics = this.providerMonitor.getAllProviderMetrics();
    const recommendations = this.providerMonitor.getProviderRecommendations();

    return {
      timestamp: new Date(),
      providers: providerHealth,
      circuitBreakers: Object.fromEntries(circuitBreakerStatus),
      fallback: fallbackMetrics,
      metrics: Object.fromEntries(
        Array.from(providerMetrics.entries()).map(([provider, metrics]) => [
          provider,
          {
            totalRequests: metrics.totalRequests,
            successfulRequests: metrics.successfulRequests,
            failedRequests: metrics.failedRequests,
            averageResponseTime: metrics.averageResponseTime,
            successRate: metrics.totalRequests > 0 
              ? (metrics.successfulRequests / metrics.totalRequests) * 100 
              : 0,
            failureRate: metrics.totalRequests > 0 
              ? (metrics.failedRequests / metrics.totalRequests) * 100 
              : 0,
          }
        ])
      ),
      recommendations,
      systemHealth: {
        totalProviders: providerHealth.length,
        healthyProviders: providerHealth.filter(p => p.isHealthy).length,
        providersWithOpenCircuits: Array.from(circuitBreakerStatus.values())
          .filter(state => state === 'OPEN').length,
        fallbackUsageRate: fallbackMetrics.totalAttempts > 0 
          ? ((fallbackMetrics.primaryUsage + fallbackMetrics.secondaryUsage + 
             fallbackMetrics.tertiaryUsage + fallbackMetrics.localUsage - 
             fallbackMetrics.primaryUsage) / fallbackMetrics.totalAttempts) * 100 
          : 0,
      }
    };
  }

  /**
   * Get detailed diagnostics for troubleshooting
   */
  async getDiagnostics(): Promise<any> {
    return this.providerMonitor.getDiagnostics();
  }

  /**
   * Get fallback chain metrics
   */
  getFallbackMetrics(): any {
    return this.providerMonitor.getFallbackChainMetrics();
  }

  /**
   * Force circuit breaker state change
   */
  forceCircuitBreakerState(provider: AIProvider, state: string): void {
    const circuitBreakerState = state.toUpperCase() as any;
    this.providerMonitor.forceCircuitBreakerState(provider, circuitBreakerState);
  }

  /**
   * Reset circuit breaker for provider
   */
  resetCircuitBreaker(provider: AIProvider): void {
    this.providerMonitor.resetCircuitBreaker(provider);
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    this.fallbackHandler.resetCircuitBreakers();
    this.providerMonitor.getAllCircuitBreakerStatus().forEach((_, provider) => {
      this.providerMonitor.resetCircuitBreaker(provider);
    });
  }

  async verifySignature(result: AIResultEntity): Promise<boolean> {
    const expectedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(JSON.stringify(result.request))
      .digest('hex');
    
    return result.signature === expectedSignature;
  }

  /**
   * Get performance analytics
   */
  async getPerformanceAnalytics(timeRange: '1h' | '24h' | '7d' = '24h'): Promise<any> {
    const now = new Date();
    let startTime: Date;

    switch (timeRange) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
    }

    const results = await this.aiResultRepository.find({
      where: {
        created_at: { $gte: startTime } as any,
      },
      order: { created_at: 'DESC' },
    });

    const analytics = {
      timeRange,
      totalRequests: results.length,
      successfulRequests: results.filter(r => r.status === AIResultStatus.SUCCESS).length,
      failedRequests: results.filter(r => r.status === AIResultStatus.FAILED).length,
      averageProcessingTime: results.length > 0 
        ? results.reduce((sum, r) => sum + (r.processingTime || 0), 0) / results.length 
        : 0,
      providerUsage: {} as Record<string, number>,
      fallbackUsage: results.filter(r => r.fallbackUsed).length,
      fallbackRate: results.length > 0 
        ? (results.filter(r => r.fallbackUsed).length / results.length) * 100 
        : 0,
      errorRate: results.length > 0 
        ? (results.filter(r => r.status === AIResultStatus.FAILED).length / results.length) * 100 
        : 0,
      topErrors: {} as Record<string, number>,
    };

    // Calculate provider usage
    results.forEach(result => {
      const provider = result.provider;
      analytics.providerUsage[provider] = (analytics.providerUsage[provider] || 0) + 1;
    });

    // Calculate top errors
    results
      .filter(r => r.status === AIResultStatus.FAILED && r.errorMessage)
      .forEach(result => {
        const error = result.errorMessage!;
        analytics.topErrors[error] = (analytics.topErrors[error] || 0) + 1;
      });

    // Sort and limit top errors
    analytics.topErrors = Object.fromEntries(
      Object.entries(analytics.topErrors)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
    );

    return analytics;
  }

  // Private methods

  private initializeAdapters(): void {
    // Register OpenAI adapter
    if (this.configService.get('OPENAI_API_KEY')) {
      const openaiAdapter = this.adapterFactory.createAdapter('openai');
      this.adapters.set(AIProvider.OPENAI, openaiAdapter);
      this.providerMonitor.registerProvider(AIProvider.OPENAI, openaiAdapter);
    }

    // Register Llama adapter
    if (this.configService.get('LLAMA_API_KEY')) {
      const llamaAdapter = this.adapterFactory.createAdapter('llama');
      this.adapters.set(AIProvider.LLAMA, llamaAdapter);
      this.providerMonitor.registerProvider(AIProvider.LLAMA, llamaAdapter);
    }

    // Register Grok adapter
    if (this.configService.get('GROK_API_KEY')) {
      const grokAdapter = this.adapterFactory.createAdapter('grok');
      this.adapters.set(AIProvider.GROK, grokAdapter);
      this.providerMonitor.registerProvider(AIProvider.GROK, grokAdapter);
    }

    // Register local model adapter (always available as fallback)
    const localAdapter = this.adapterFactory.createAdapter('local');
    this.adapters.set(AIProvider.LOCAL, localAdapter);
    this.providerMonitor.registerProvider(AIProvider.LOCAL, localAdapter);

    this.logger.info('AI adapters initialized', undefined, {
      registeredProviders: Array.from(this.adapters.keys()),
    });
  }

  private generateSignature(result: AIResultEntity): string {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(JSON.stringify({
        resultId: result.id,
        userId: result.userId,
        provider: result.provider,
        creditScore: result.creditScore,
        riskScore: result.riskScore,
        completedAt: result.completedAt,
      }))
      .digest('hex');
  }
}
