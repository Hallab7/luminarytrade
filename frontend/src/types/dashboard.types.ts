/**
 * dashboard.types.ts
 *
 * TypeScript interfaces for the data visualization dashboard.
 */

// ─── Time Window ──────────────────────────────────────────────────────────────

export type TimeWindow = '1D' | '7D' | '30D' | 'YTD';

// ─── Credit Score Trend ───────────────────────────────────────────────────────

export interface CreditScoreTrendPoint {
  date: string;
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ─── Fraud Risk Heatmap ───────────────────────────────────────────────────────

export interface FraudHeatmapCell {
  hour: number;        // 0–23
  dayOfWeek: number;   // 0 (Sun) – 6 (Sat)
  dayLabel: string;    // "Mon", "Tue", etc.
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ─── Transaction Volume ───────────────────────────────────────────────────────

export interface TransactionVolumePoint {
  date: string;
  count: number;
  volume: number;
  avgAmount: number;
}

// ─── Agent Performance ────────────────────────────────────────────────────────

export interface AgentPerformanceMetric {
  agentName: string;
  accuracy: number;     // 0–100
  speed: number;        // 0–100
  throughput: number;   // 0–100
  errorRate: number;    // 0–100 (inverted: 100 = no errors)
  satisfaction: number; // 0–100
}

// ─── Risk Distribution ────────────────────────────────────────────────────────

export interface RiskDistributionSlice {
  name: string;
  value: number;
  color: string;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export interface DataStatistics {
  avg: number;
  min: number;
  max: number;
  stddev: number;
  total: number;
}

// ─── Dashboard Summary ────────────────────────────────────────────────────────

export interface DashboardSummary {
  totalTransactions: number;
  avgCreditScore: number;
  fraudAlerts: number;
  activeAgents: number;
  riskScore: number;
}

// ─── Unified Dashboard Data ───────────────────────────────────────────────────

export interface TradingBonusPoint {
  date: string;
  bonusAmount: number;
  multiplier: number;
  tradeCount: number;
}

export interface BonusBreakdown {
  type: 'referral' | 'affiliate' | 'activity' | 'bugReport' | 'volume';
  label: string;
  amount: number;
  color: string;
  count?: number;
}

export interface BonusHistoryItem {
  id: string;
  type: 'referral' | 'affiliate' | 'activity' | 'bugReport' | 'volume';
  amount: number;
  description: string;
  timestamp: string;
  status: 'earned' | 'pending' | 'paid';
}

export interface DashboardData {
  summary: DashboardSummary;
  creditScoreTrend: CreditScoreTrendPoint[];
  fraudHeatmap: FraudHeatmapCell[];
  transactionVolume: TransactionVolumePoint[];
  agentPerformance: AgentPerformanceMetric[];
  riskDistribution: RiskDistributionSlice[];
  tradingBonuses: TradingBonusPoint[];
  bonusBreakdown: BonusBreakdown[];
  bonusHistory: BonusHistoryItem[];
  scoreStatistics: DataStatistics;
  volumeStatistics: DataStatistics;
}

// ─── Chart Export ─────────────────────────────────────────────────────────────

export type ChartExportFormat = 'PNG' | 'SVG' | 'CSV' | 'JSON';
