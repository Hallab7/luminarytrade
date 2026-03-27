import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AnalyticsGateway } from './analytics.gateway';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEvent } from './types';

const STREAM_KEY = 'analytics:events';
const GROUP_NAME = 'analytics-engine';
const CHECKPOINT_KEY = 'analytics:checkpoint:last-id';
const SYSTEM_THROUGHPUT_TS_KEY = 'analytics:ts:system:throughput';
const BLOCKCHAIN_TS_KEY = 'analytics:ts:blockchain:submissions';

@Injectable()
export class StreamProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamProcessorService.name);
  private redis?: Redis;
  private running = false;
  private checkpointId = '0-0';
  private loopPromise?: Promise<void>;
  private pushTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly analyticsService: AnalyticsService,
    private readonly gateway: AnalyticsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connectRedis();
    if (!this.redis) {
      this.logger.warn('Redis unavailable: stream processor is disabled');
      return;
    }

    this.running = true;
    this.loopPromise = this.consumeLoop();
    this.pushTimer = setInterval(() => this.publishSnapshot(), 2000);
    this.pruneTimer = setInterval(() => this.analyticsService.prune(), 60_000);
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.pushTimer) clearInterval(this.pushTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    await this.loopPromise;
    if (this.redis) {
      await this.redis.quit();
    }
  }

  async ingestEvent(event: AnalyticsEvent): Promise<void> {
    if (!this.redis) {
      this.analyticsService.ingest(event);
      return;
    }

    await this.redis.xadd(STREAM_KEY, '*', 'event', JSON.stringify(event));
  }

  async querySeries(key: string, startMs: number, endMs: number): Promise<unknown[]> {
    if (!this.redis) {
      return [];
    }

    const rows = await this.redis.zrangebyscore(key, startMs, endMs);
    return rows
      .map((row) => {
        try {
          return JSON.parse(row) as unknown;
        } catch {
          return null;
        }
      })
      .filter((row): row is unknown => row !== null);
  }

  private async connectRedis(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');

    try {
      this.redis = new Redis({ host, port, password, maxRetriesPerRequest: 2, lazyConnect: true });
      await this.redis.connect();
      this.checkpointId = (await this.redis.get(CHECKPOINT_KEY)) ?? '0-0';

      try {
        await this.redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, this.checkpointId, 'MKSTREAM');
      } catch (error) {
        const message = (error as Error).message;
        if (!message.includes('BUSYGROUP')) {
          throw error;
        }
      }

      this.logger.log('Analytics stream processor connected to Redis Streams');
    } catch (error) {
      this.logger.error(`Failed to initialize Redis stream processor: ${(error as Error).message}`);
      this.redis = undefined;
    }
  }

  private isRelevantEvent(event: AnalyticsEvent): boolean {
    return (
      event.type === 'agent.evaluated' ||
      event.type === 'oracle.response' ||
      event.type === 'user.request' ||
      event.type === 'blockchain.submission'
    );
  }

  private transformEvent(raw: string): AnalyticsEvent | null {
    try {
      const event = JSON.parse(raw) as AnalyticsEvent;
      if (!event.ts) {
        event.ts = Date.now();
      }
      return event;
    } catch {
      return null;
    }
  }

  private async consumeLoop(): Promise<void> {
    if (!this.redis) return;

    const consumerName = `consumer-${process.pid}`;

    while (this.running && this.redis) {
      try {
        const response = await this.redis.xreadgroup(
          'GROUP',
          GROUP_NAME,
          consumerName,
          'COUNT',
          1000,
          'BLOCK',
          1000,
          'STREAMS',
          STREAM_KEY,
          '>',
        );

        if (!response || response.length === 0) {
          continue;
        }

        for (const stream of response) {
          const entries = stream[1];
          for (const entry of entries) {
            const streamId = entry[0];
            const fields = entry[1];
            const rawPayload = fields[1];
            const parsed = this.transformEvent(rawPayload);

            if (parsed && this.isRelevantEvent(parsed)) {
              this.analyticsService.ingest(parsed);
              await this.persistSnapshots(parsed);
            }

            await this.redis.xack(STREAM_KEY, GROUP_NAME, streamId);
            this.checkpointId = streamId;
          }
        }

        await this.redis.set(CHECKPOINT_KEY, this.checkpointId);
      } catch (error) {
        this.logger.warn(`Stream consume loop error: ${(error as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  private publishSnapshot(): void {
    const throughput = this.analyticsService.getSystemThroughput('1min');
    const blockchain = this.analyticsService.getBlockchainStats('1hour');
    this.gateway.broadcastUpdate({
      at: Date.now(),
      throughput,
      blockchain,
      lagMs: 0,
    });
  }

  private async persistSnapshots(event: AnalyticsEvent): Promise<void> {
    if (!this.redis) return;

    const minuteTs = Math.floor(event.ts / 60_000) * 60_000;
    const throughput = this.analyticsService.getSystemThroughput('1min');
    const blockchain = this.analyticsService.getBlockchainStats('1hour');

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(SYSTEM_THROUGHPUT_TS_KEY, minuteTs, minuteTs);
    pipeline.zadd(
      SYSTEM_THROUGHPUT_TS_KEY,
      minuteTs,
      JSON.stringify({ minuteTs, ...throughput }),
    );
    pipeline.zremrangebyscore(BLOCKCHAIN_TS_KEY, minuteTs, minuteTs);
    pipeline.zadd(BLOCKCHAIN_TS_KEY, minuteTs, JSON.stringify({ minuteTs, ...blockchain }));

    if (event.agentId) {
      const key = `analytics:ts:agent:${event.agentId}:performance`;
      const perf = this.analyticsService.getAgentPerformance(event.agentId, '1hour');
      pipeline.zremrangebyscore(key, minuteTs, minuteTs);
      pipeline.zadd(key, minuteTs, JSON.stringify({ minuteTs, ...perf }));
    }

    if (event.userId) {
      const key = `analytics:ts:user:${event.userId}:activity`;
      const activity = this.analyticsService.getUserActivity(event.userId, '1hour');
      pipeline.zremrangebyscore(key, minuteTs, minuteTs);
      pipeline.zadd(key, minuteTs, JSON.stringify({ minuteTs, ...activity }));
    }

    if (event.provider) {
      const key = `analytics:ts:oracle:${event.provider}:metrics`;
      const oracle = this.analyticsService.getOracleMetrics(event.provider, '1hour');
      pipeline.zremrangebyscore(key, minuteTs, minuteTs);
      pipeline.zadd(key, minuteTs, JSON.stringify({ minuteTs, ...oracle }));
    }

    pipeline.zremrangebyscore(SYSTEM_THROUGHPUT_TS_KEY, 0, minuteTs - 7 * 24 * 60 * 60_000);
    pipeline.zremrangebyscore(BLOCKCHAIN_TS_KEY, 0, minuteTs - 7 * 24 * 60 * 60_000);
    await pipeline.exec();
  }
}
