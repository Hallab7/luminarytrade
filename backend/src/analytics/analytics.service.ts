import { Injectable } from '@nestjs/common';
import { WindowedAnalyticsAggregator } from './aggregators/windowed-analytics.aggregator';
import {
  AgentPerformanceMetrics,
  AnalyticsEvent,
  AnalyticsWindow,
  BlockchainSubmissionMetrics,
  OracleMetrics,
  ThroughputBucket,
  UserActivityMetrics,
} from './types';

@Injectable()
export class AnalyticsService {
  constructor(private readonly aggregator: WindowedAnalyticsAggregator) {}

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
}
