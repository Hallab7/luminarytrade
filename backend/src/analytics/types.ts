// ---------------------------------------------------------------------------
// Shared window / event types
// ---------------------------------------------------------------------------

export type AnalyticsWindow = '1min' | '5min' | '1hour' | '24hour' | '1day';

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

// ---------------------------------------------------------------------------
// Existing metrics (unchanged)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// New: position snapshot (used by risk + optimization)
// ---------------------------------------------------------------------------

/**
 * A single open position held by an agent at the time of the analytics query.
 * The `returns` array is an ordered time-series of period (daily) returns,
 * oldest first. Populated by WindowedAnalyticsAggregator.getAgentPositions().
 */
export interface AgentPosition {
  assetId: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  returns: number[]; // ordered oldest → newest, e.g. [0.01, -0.003, 0.008, ...]
}

// ---------------------------------------------------------------------------
// New: risk metrics (#243)
// ---------------------------------------------------------------------------

/**
 * Portfolio-level risk statistics for a given agent over a time window.
 * All ratio metrics are annualized. maxDrawdown and valueAtRisk95 are
 * expressed as negative decimals (e.g. -0.12 = -12%).
 */
export interface RiskMetrics {
  agentId: string;
  sharpeRatio: number;           // annualized excess return / annualized vol
  sortinoRatio: number;          // annualized excess return / downside vol
  maxDrawdown: number;           // worst peak-to-trough drop, e.g. -0.15
  valueAtRisk95: number;         // 1-day loss exceeded only 5% of the time
  beta: number;                  // vs. equal-weight benchmark of same positions
  annualizedVolatility: number;  // annualized stddev of daily returns
}

// ---------------------------------------------------------------------------
// New: portfolio optimization (#243)
// ---------------------------------------------------------------------------

export type OptimizationTarget =
  | 'max-sharpe'       // maximise (return - riskFree) / volatility
  | 'min-volatility'   // minimise portfolio variance
  | 'risk-parity';     // equalise risk contribution across assets

/**
 * Weight and risk statistics for a single asset within an optimized portfolio.
 */
export interface PortfolioAllocation {
  assetId: string;
  weight: number;            // 0–1; all weights sum to 1.0
  expectedReturn: number;    // annualized expected return for this asset
  riskContribution: number;  // fraction of total portfolio risk (0–1)
}

/**
 * Output of the portfolio optimization solver for a given agent and target.
 */
export interface OptimizedPortfolio {
  agentId: string;
  allocations: PortfolioAllocation[];
  expectedReturn: number;      // annualized portfolio expected return
  expectedVolatility: number;  // annualized portfolio volatility
  sharpeRatio: number;         // (expectedReturn - riskFreeRate) / expectedVolatility
  optimizationTarget: OptimizationTarget;
}