import { Injectable } from '@nestjs/common';
import { WindowedAnalyticsAggregator } from './aggregators/windowed-analytics.aggregator';
import { ComputeBridgeService } from '../compute-bridge/compute-bridge.service';
import {
  AgentPerformanceMetrics,
  AgentPosition,
  AnalyticsEvent,
  AnalyticsWindow,
  BlockchainSubmissionMetrics,
  OracleMetrics,
  OptimizationTarget,
  OptimizedPortfolio,
  RiskMetrics,
  ThroughputBucket,
  UserActivityMetrics,
} from './types';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly aggregator: WindowedAnalyticsAggregator,
    private readonly computeBridge: ComputeBridgeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Existing pass-through methods (unchanged)
  // ---------------------------------------------------------------------------

  ingest(event: AnalyticsEvent): void {
    this.aggregator.ingest(event);
  }

  getAgentPerformance(id: string, window: AnalyticsWindow): AgentPerformanceMetrics {
    return this.aggregator.getAgentPerformance(id, window);
  }

  getSystemThroughput(bucket: AnalyticsWindow): ThroughputBucket {
    return this.aggregator.getSystemThroughput(bucket);
  }

  getUserActivity(id: string, window: AnalyticsWindow): UserActivityMetrics {
    return this.aggregator.getUserActivity(id, window);
  }

  getBlockchainStats(window: AnalyticsWindow): BlockchainSubmissionMetrics {
    return this.aggregator.getBlockchainMetrics(window);
  }

  getOracleMetrics(provider: string, window: AnalyticsWindow): OracleMetrics {
    return this.aggregator.getOracleMetrics(provider, window);
  }

  prune(): void {
    this.aggregator.prune();
  }

  // ---------------------------------------------------------------------------
  // New: risk metrics (#243)
  // ---------------------------------------------------------------------------

  /**
   * Computes Sharpe, Sortino, max drawdown, VaR 95%, beta, and annualized
   * volatility for a given agent over the requested analytics window.
   */
  getPortfolioRisk(agentId: string, window: AnalyticsWindow): RiskMetrics {
    const positions = this.getAgentPositions(agentId, window);
    return this.computeBridge.computeRiskMetrics(agentId, positions);
  }

  // ---------------------------------------------------------------------------
  // New: portfolio optimization (#243)
  // ---------------------------------------------------------------------------

  /**
   * Returns an optimal weight allocation for the agent's current positions.
   *
   * Supported targets:
   *   'max-sharpe'      — maximise risk-adjusted return
   *   'min-volatility'  — minimise portfolio variance
   *   'risk-parity'     — equalise risk contribution across assets
   *
   * NOTE: For N > 50 positions, consider offloading to a worker thread to
   * avoid blocking the event loop during gradient descent.
   */
  optimizePortfolio(
    agentId: string,
    target: OptimizationTarget = 'max-sharpe',
  ): OptimizedPortfolio {
    const positions = this.getAgentPositions(agentId, '1day');
    return this.computeBridge.optimize(agentId, positions, target);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getAgentPositions(agentId: string, window: AnalyticsWindow): AgentPosition[] {
    return this.aggregator.getAgentPositions(agentId, window);
  }
}