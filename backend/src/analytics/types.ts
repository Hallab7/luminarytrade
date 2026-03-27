export type AnalyticsWindow = '1min' | '5min' | '1hour' | '1day';

export type AnalyticsEventType =
  | 'agent.evaluated'
  | 'oracle.response'
  | 'user.request'
  | 'blockchain.submission';

export interface AnalyticsEvent {
  id?: string;
  type: AnalyticsEventType;
  ts: number;
  agentId?: string;
  userId?: string;
  apiKeyId?: string;
  provider?: string;
  payload: Record<string, unknown>;
}

export interface AgentPerformanceMetrics {
  agentId: string;
  winRate: number;
  avgScore: number;
  errorRate: number;
  samples: number;
}

export interface OracleMetrics {
  provider: string;
  dataFreshnessMs: number;
  avgResponseTimeMs: number;
  accuracyRate: number;
  samples: number;
}

export interface UserActivityMetrics {
  userId: string;
  requestsPerMinute: number;
  errorsPerMinute: number;
  apiKeyUsage: Record<string, number>;
}

export interface BlockchainSubmissionMetrics {
  successRate: number;
  avgBlockTimeMs: number;
  avgGasUsage: number;
  samples: number;
}

export interface ThroughputBucket {
  bucket: AnalyticsWindow;
  requestsPerMinute: number;
  errorsPerMinute: number;
  at: number;
}
