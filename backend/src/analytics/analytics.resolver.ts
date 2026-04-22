import { Resolver, Query, Args } from '@nestjs/graphql';
import { AnalyticsService } from './analytics.service';
import {
  AgentPerformanceMetrics,
  AnalyticsWindow,
  BlockchainSubmissionMetrics,
  OracleMetrics,
  OptimizationTarget,
  OptimizedPortfolio,
  RiskMetrics,
  ThroughputBucket,
  UserActivityMetrics,
} from './types';

@Resolver('Analytics')
export class AnalyticsResolver {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // ---------------------------------------------------------------------------
  // Existing queries (unchanged)
  // ---------------------------------------------------------------------------

  @Query(() => AgentPerformanceMetrics, { name: 'agentPerformance' })
  getAgentPerformance(
    @Args('id') id: string,
    @Args('window', { type: () => String, nullable: true }) window?: AnalyticsWindow,
  ) {
    return this.analyticsService.getAgentPerformance(id, window ?? '1hour');
  }

  @Query(() => UserActivityMetrics, { name: 'userActivity' })
  getUserActivity(
    @Args('id') id: string,
    @Args('window', { type: () => String, nullable: true }) window?: AnalyticsWindow,
  ) {
    return this.analyticsService.getUserActivity(id, window ?? '1hour');
  }

  @Query(() => BlockchainSubmissionMetrics, { name: 'blockchainStats' })
  getBlockchainStats(
    @Args('window', { type: () => String, nullable: true }) window?: AnalyticsWindow,
  ) {
    return this.analyticsService.getBlockchainStats(window ?? '1hour');
  }

  @Query(() => OracleMetrics, { name: 'oracleMetrics' })
  getOracleMetrics(
    @Args('provider') provider: string,
    @Args('window', { type: () => String, nullable: true }) window?: AnalyticsWindow,
  ) {
    return this.analyticsService.getOracleMetrics(provider, window ?? '1hour');
  }

  @Query(() => ThroughputBucket, { name: 'systemThroughput' })
  getSystemThroughput(
    @Args('bucket', { type: () => String, nullable: true }) bucket?: AnalyticsWindow,
  ) {
    return this.analyticsService.getSystemThroughput(bucket ?? '1min');
  }

  // ---------------------------------------------------------------------------
  // New queries: risk metrics (#243)
  // ---------------------------------------------------------------------------

  /**
   * Returns portfolio-level risk statistics for a given agent.
   *
   * Example:
   *   query {
   *     portfolioRisk(agentId: "abc", window: "1day") {
   *       sharpeRatio
   *       sortinoRatio
   *       maxDrawdown
   *       valueAtRisk95
   *       beta
   *       annualizedVolatility
   *     }
   *   }
   */
  @Query(() => Object, { name: 'portfolioRisk' })
  getPortfolioRisk(
    @Args('agentId') agentId: string,
    @Args('window', { type: () => String, nullable: true }) window?: AnalyticsWindow,
  ): RiskMetrics {
    return this.analyticsService.getPortfolioRisk(agentId, window ?? '1day');
  }

  // ---------------------------------------------------------------------------
  // New queries: portfolio optimization (#243)
  // ---------------------------------------------------------------------------

  /**
   * Returns an optimized weight allocation for the agent's current positions.
   *
   * Supported targets: 'max-sharpe' | 'min-volatility' | 'risk-parity'
   *
   * Example:
   *   query {
   *     optimizePortfolio(agentId: "abc", target: "max-sharpe") {
   *       expectedReturn
   *       expectedVolatility
   *       sharpeRatio
   *       optimizationTarget
   *       allocations {
   *         assetId
   *         weight
   *         expectedReturn
   *         riskContribution
   *       }
   *     }
   *   }
   */
  @Query(() => Object, { name: 'optimizePortfolio' })
  optimizePortfolio(
    @Args('agentId') agentId: string,
    @Args('target', { type: () => String, nullable: true }) target?: string,
  ): OptimizedPortfolio {
    const validTargets: OptimizationTarget[] = ['max-sharpe', 'min-volatility', 'risk-parity'];
    const resolvedTarget: OptimizationTarget =
      validTargets.includes(target as OptimizationTarget)
        ? (target as OptimizationTarget)
        : 'max-sharpe';

    return this.analyticsService.optimizePortfolio(agentId, resolvedTarget);
  }
}