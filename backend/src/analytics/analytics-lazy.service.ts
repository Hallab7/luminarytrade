import { Injectable } from '@nestjs/common';
import { LazyModuleLoader } from '@nestjs/core';

/**
 * #241 — Lazy-loads the AnalyticsModule on first request.
 *
 * Inject this in controllers/gateways that need analytics instead of
 * injecting AnalyticsService directly. The module is parsed and
 * initialized only when the first analytics request arrives — not at
 * app startup.
 */
@Injectable()
export class AnalyticsLazyService {
  private analyticsService: any = null;

  constructor(private readonly lazyModuleLoader: LazyModuleLoader) {}

  private async resolve() {
    if (this.analyticsService) return this.analyticsService;

    const { AnalyticsModule } = await import('./analytics.module');
    const { AnalyticsService } = await import('./analytics.service');

    const moduleRef = await this.lazyModuleLoader.load(() => AnalyticsModule);
    this.analyticsService = moduleRef.get(AnalyticsService);
    return this.analyticsService;
  }

  async getAgentPerformance(id: string, window: string) {
    const svc = await this.resolve();
    return svc.getAgentPerformance(id, window);
  }

  async getPortfolioRisk(agentId: string, window: string) {
    const svc = await this.resolve();
    return svc.getPortfolioRisk(agentId, window);
  }

  async optimizePortfolio(agentId: string, target: string) {
    const svc = await this.resolve();
    return svc.optimizePortfolio(agentId, target);
  }

  async getUserActivity(id: string, window: string) {
    const svc = await this.resolve();
    return svc.getUserActivity(id, window);
  }

  async getBlockchainStats(window: string) {
    const svc = await this.resolve();
    return svc.getBlockchainStats(window);
  }

  async getOracleMetrics(provider: string, window: string) {
    const svc = await this.resolve();
    return svc.getOracleMetrics(provider, window);
  }

  async getSystemThroughput(bucket: string) {
    const svc = await this.resolve();
    return svc.getSystemThroughput(bucket);
  }

  async ingest(event: any) {
    const svc = await this.resolve();
    return svc.ingest(event);
  }
}