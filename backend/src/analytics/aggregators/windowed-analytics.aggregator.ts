import { Injectable } from '@nestjs/common';
import {
  AgentPerformanceMetrics,
  AnalyticsEvent,
  AnalyticsWindow,
  BlockchainSubmissionMetrics,
  OracleMetrics,
  ThroughputBucket,
  UserActivityMetrics,
} from '../types';

type MinuteBucket = {
  ts: number;
  requests: number;
  errors: number;
  wins: number;
  scoreTotal: number;
  scoreCount: number;
  agentErrors: number;
  freshnessTotalMs: number;
  responseTimeTotalMs: number;
  oracleCount: number;
  oracleAccurate: number;
  submissionsSuccess: number;
  submissionsTotal: number;
  blockTimeTotalMs: number;
  gasTotal: number;
  apiKeyUsage: Record<string, number>;
};

const DAY_MINUTES = 24 * 60;
const EXTRA_RETENTION_MINUTES = 5;

@Injectable()
export class WindowedAnalyticsAggregator {
  private readonly systemBuckets = new Map<number, MinuteBucket>();
  private readonly agentBuckets = new Map<string, Map<number, MinuteBucket>>();
  private readonly userBuckets = new Map<string, Map<number, MinuteBucket>>();
  private readonly oracleBuckets = new Map<string, Map<number, MinuteBucket>>();

  private currentMinute(ts: number): number {
    return Math.floor(ts / 60_000) * 60_000;
  }

  private buildEmpty(ts: number): MinuteBucket {
    return {
      ts,
      requests: 0,
      errors: 0,
      wins: 0,
      scoreTotal: 0,
      scoreCount: 0,
      agentErrors: 0,
      freshnessTotalMs: 0,
      responseTimeTotalMs: 0,
      oracleCount: 0,
      oracleAccurate: 0,
      submissionsSuccess: 0,
      submissionsTotal: 0,
      blockTimeTotalMs: 0,
      gasTotal: 0,
      apiKeyUsage: {},
    };
  }

  private upsert(map: Map<number, MinuteBucket>, minute: number): MinuteBucket {
    const existing = map.get(minute);
    if (existing) {
      return existing;
    }
    const fresh = this.buildEmpty(minute);
    map.set(minute, fresh);
    return fresh;
  }

  private upsertNamed(
    root: Map<string, Map<number, MinuteBucket>>,
    name: string,
    minute: number,
  ): MinuteBucket {
    const bucketMap = root.get(name) ?? new Map<number, MinuteBucket>();
    if (!root.has(name)) {
      root.set(name, bucketMap);
    }
    return this.upsert(bucketMap, minute);
  }

  private cutoffMinute(nowMs = Date.now()): number {
    return this.currentMinute(nowMs) - (DAY_MINUTES + EXTRA_RETENTION_MINUTES) * 60_000;
  }

  private pruneMap(map: Map<number, MinuteBucket>, cutoff: number): void {
    for (const k of map.keys()) {
      if (k < cutoff) {
        map.delete(k);
      }
    }
  }

  private pruneNamedMap(root: Map<string, Map<number, MinuteBucket>>, cutoff: number): void {
    for (const [name, map] of root.entries()) {
      this.pruneMap(map, cutoff);
      if (map.size === 0) {
        root.delete(name);
      }
    }
  }

  private minutesForWindow(window: AnalyticsWindow): number {
    if (window === '1min') return 1;
    if (window === '5min') return 5;
    if (window === '1hour') return 60;
    return DAY_MINUTES;
  }

  private sliceWindow(map: Map<number, MinuteBucket>, window: AnalyticsWindow): MinuteBucket[] {
    const nowMinute = this.currentMinute(Date.now());
    const from = nowMinute - (this.minutesForWindow(window) - 1) * 60_000;
    const rows: MinuteBucket[] = [];
    for (const [minute, bucket] of map.entries()) {
      if (minute >= from && minute <= nowMinute) {
        rows.push(bucket);
      }
    }
    return rows;
  }

  private aggregate(buckets: MinuteBucket[]): MinuteBucket {
    const out = this.buildEmpty(Date.now());
    for (const b of buckets) {
      out.requests += b.requests;
      out.errors += b.errors;
      out.wins += b.wins;
      out.scoreTotal += b.scoreTotal;
      out.scoreCount += b.scoreCount;
      out.agentErrors += b.agentErrors;
      out.freshnessTotalMs += b.freshnessTotalMs;
      out.responseTimeTotalMs += b.responseTimeTotalMs;
      out.oracleCount += b.oracleCount;
      out.oracleAccurate += b.oracleAccurate;
      out.submissionsSuccess += b.submissionsSuccess;
      out.submissionsTotal += b.submissionsTotal;
      out.blockTimeTotalMs += b.blockTimeTotalMs;
      out.gasTotal += b.gasTotal;
      for (const [apiKey, count] of Object.entries(b.apiKeyUsage)) {
        out.apiKeyUsage[apiKey] = (out.apiKeyUsage[apiKey] ?? 0) + count;
      }
    }
    return out;
  }

  ingest(event: AnalyticsEvent): void {
    const minute = this.currentMinute(event.ts);
    const system = this.upsert(this.systemBuckets, minute);

    if (event.type === 'agent.evaluated') {
      const agentId = event.agentId;
      if (!agentId) return;
      const bucket = this.upsertNamed(this.agentBuckets, agentId, minute);
      const score = Number(event.payload.score ?? 0);
      const won = Boolean(event.payload.won);
      const isError = Boolean(event.payload.error);

      bucket.scoreTotal += score;
      bucket.scoreCount += 1;
      bucket.wins += won ? 1 : 0;
      bucket.agentErrors += isError ? 1 : 0;
      system.requests += 1;
      system.errors += isError ? 1 : 0;
      return;
    }

    if (event.type === 'oracle.response') {
      const provider = event.provider;
      if (!provider) return;
      const bucket = this.upsertNamed(this.oracleBuckets, provider, minute);
      const freshness = Number(event.payload.freshnessMs ?? 0);
      const responseMs = Number(event.payload.responseTimeMs ?? 0);
      const accurate = Boolean(event.payload.accurate);

      bucket.freshnessTotalMs += freshness;
      bucket.responseTimeTotalMs += responseMs;
      bucket.oracleCount += 1;
      bucket.oracleAccurate += accurate ? 1 : 0;
      system.requests += 1;
      return;
    }

    if (event.type === 'user.request') {
      const userId = event.userId;
      if (!userId) return;
      const bucket = this.upsertNamed(this.userBuckets, userId, minute);
      const isError = Boolean(event.payload.error);
      const apiKeyId = event.apiKeyId ?? 'unknown';

      bucket.requests += 1;
      bucket.errors += isError ? 1 : 0;
      bucket.apiKeyUsage[apiKeyId] = (bucket.apiKeyUsage[apiKeyId] ?? 0) + 1;
      system.requests += 1;
      system.errors += isError ? 1 : 0;
      return;
    }

    if (event.type === 'blockchain.submission') {
      const success = Boolean(event.payload.success);
      const blockTimeMs = Number(event.payload.blockTimeMs ?? 0);
      const gasUsed = Number(event.payload.gasUsed ?? 0);

      system.submissionsTotal += 1;
      system.submissionsSuccess += success ? 1 : 0;
      system.blockTimeTotalMs += blockTimeMs;
      system.gasTotal += gasUsed;
      system.requests += 1;
      system.errors += success ? 0 : 1;
    }
  }

  prune(nowMs = Date.now()): void {
    const cutoff = this.cutoffMinute(nowMs);
    this.pruneMap(this.systemBuckets, cutoff);
    this.pruneNamedMap(this.agentBuckets, cutoff);
    this.pruneNamedMap(this.userBuckets, cutoff);
    this.pruneNamedMap(this.oracleBuckets, cutoff);
  }

  getAgentPerformance(agentId: string, window: AnalyticsWindow): AgentPerformanceMetrics {
    const map = this.agentBuckets.get(agentId) ?? new Map<number, MinuteBucket>();
    const total = this.aggregate(this.sliceWindow(map, window));
    return {
      agentId,
      winRate: total.scoreCount > 0 ? total.wins / total.scoreCount : 0,
      avgScore: total.scoreCount > 0 ? total.scoreTotal / total.scoreCount : 0,
      errorRate: total.scoreCount > 0 ? total.agentErrors / total.scoreCount : 0,
      samples: total.scoreCount,
    };
  }

  getOracleMetrics(provider: string, window: AnalyticsWindow): OracleMetrics {
    const map = this.oracleBuckets.get(provider) ?? new Map<number, MinuteBucket>();
    const total = this.aggregate(this.sliceWindow(map, window));
    return {
      provider,
      dataFreshnessMs: total.oracleCount > 0 ? total.freshnessTotalMs / total.oracleCount : 0,
      avgResponseTimeMs:
        total.oracleCount > 0 ? total.responseTimeTotalMs / total.oracleCount : 0,
      accuracyRate: total.oracleCount > 0 ? total.oracleAccurate / total.oracleCount : 0,
      samples: total.oracleCount,
    };
  }

  getUserActivity(userId: string, window: AnalyticsWindow): UserActivityMetrics {
    const map = this.userBuckets.get(userId) ?? new Map<number, MinuteBucket>();
    const total = this.aggregate(this.sliceWindow(map, window));
    const minutes = this.minutesForWindow(window);
    return {
      userId,
      requestsPerMinute: total.requests / minutes,
      errorsPerMinute: total.errors / minutes,
      apiKeyUsage: total.apiKeyUsage,
    };
  }

  getBlockchainMetrics(window: AnalyticsWindow): BlockchainSubmissionMetrics {
    const total = this.aggregate(this.sliceWindow(this.systemBuckets, window));
    return {
      successRate:
        total.submissionsTotal > 0 ? total.submissionsSuccess / total.submissionsTotal : 0,
      avgBlockTimeMs:
        total.submissionsTotal > 0 ? total.blockTimeTotalMs / total.submissionsTotal : 0,
      avgGasUsage: total.submissionsTotal > 0 ? total.gasTotal / total.submissionsTotal : 0,
      samples: total.submissionsTotal,
    };
  }

  getSystemThroughput(bucket: AnalyticsWindow): ThroughputBucket {
    const total = this.aggregate(this.sliceWindow(this.systemBuckets, bucket));
    const minutes = this.minutesForWindow(bucket);
    return {
      bucket,
      requestsPerMinute: total.requests / minutes,
      errorsPerMinute: total.errors / minutes,
      at: Date.now(),
    };
  }
}
