import { WindowedAnalyticsAggregator } from '../aggregators/windowed-analytics.aggregator';
import { AnalyticsEvent } from '../types';

describe('WindowedAnalyticsAggregator', () => {
  let aggregator: WindowedAnalyticsAggregator;

  beforeEach(() => {
    aggregator = new WindowedAnalyticsAggregator();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-26T10:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aggregates agent performance metrics', () => {
    const baseTs = Date.now();
    const events: AnalyticsEvent[] = [
      {
        type: 'agent.evaluated',
        ts: baseTs,
        agentId: 'a1',
        payload: { score: 80, won: true, error: false },
      },
      {
        type: 'agent.evaluated',
        ts: baseTs,
        agentId: 'a1',
        payload: { score: 40, won: false, error: true },
      },
    ];

    events.forEach((event) => aggregator.ingest(event));

    const metrics = aggregator.getAgentPerformance('a1', '1hour');
    expect(metrics.samples).toBe(2);
    expect(metrics.avgScore).toBe(60);
    expect(metrics.winRate).toBe(0.5);
    expect(metrics.errorRate).toBe(0.5);
  });

  it('aggregates user activity and system throughput', () => {
    const baseTs = Date.now();
    aggregator.ingest({
      type: 'user.request',
      ts: baseTs,
      userId: 'u1',
      apiKeyId: 'k1',
      payload: { error: false },
    });
    aggregator.ingest({
      type: 'user.request',
      ts: baseTs,
      userId: 'u1',
      apiKeyId: 'k1',
      payload: { error: true },
    });

    const user = aggregator.getUserActivity('u1', '1min');
    expect(user.requestsPerMinute).toBe(2);
    expect(user.errorsPerMinute).toBe(1);
    expect(user.apiKeyUsage.k1).toBe(2);

    const throughput = aggregator.getSystemThroughput('1min');
    expect(throughput.requestsPerMinute).toBe(2);
    expect(throughput.errorsPerMinute).toBe(1);
  });

  it('aggregates oracle and blockchain metrics', () => {
    const baseTs = Date.now();
    aggregator.ingest({
      type: 'oracle.response',
      ts: baseTs,
      provider: 'p1',
      payload: { freshnessMs: 1000, responseTimeMs: 120, accurate: true },
    });
    aggregator.ingest({
      type: 'oracle.response',
      ts: baseTs,
      provider: 'p1',
      payload: { freshnessMs: 3000, responseTimeMs: 200, accurate: false },
    });
    aggregator.ingest({
      type: 'blockchain.submission',
      ts: baseTs,
      payload: { success: true, blockTimeMs: 5000, gasUsed: 12000 },
    });
    aggregator.ingest({
      type: 'blockchain.submission',
      ts: baseTs,
      payload: { success: false, blockTimeMs: 7000, gasUsed: 10000 },
    });

    const oracle = aggregator.getOracleMetrics('p1', '1hour');
    expect(oracle.samples).toBe(2);
    expect(oracle.dataFreshnessMs).toBe(2000);
    expect(oracle.avgResponseTimeMs).toBe(160);
    expect(oracle.accuracyRate).toBe(0.5);

    const chain = aggregator.getBlockchainMetrics('1hour');
    expect(chain.samples).toBe(2);
    expect(chain.successRate).toBe(0.5);
    expect(chain.avgBlockTimeMs).toBe(6000);
    expect(chain.avgGasUsage).toBe(11000);
  });

  it('prunes old buckets to keep bounded memory', () => {
    const oldTs = new Date('2026-03-24T00:00:00.000Z').getTime();
    aggregator.ingest({
      type: 'user.request',
      ts: oldTs,
      userId: 'old-user',
      payload: { error: false },
    });

    aggregator.prune(Date.now());

    const user = aggregator.getUserActivity('old-user', '1day');
    expect(user.requestsPerMinute).toBe(0);
    expect(user.errorsPerMinute).toBe(0);
  });
});
