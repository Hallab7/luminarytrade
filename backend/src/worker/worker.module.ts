import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobQueueService } from './job-queue.service';
import { JobController } from './controllers/job.controller';

// Processors
import { 
  ScoreAgentProcessor, 
  DetectFraudProcessor, 
  UpdateOracleProcessor, 
  SubmitBlockchainProcessor, 
  ReportMetricsProcessor 
} from './job-processor';

// Legacy processors for backward compatibility
import { AiScoringProcessor } from './processors/ai-scoring.processor';
import { OracleUpdateProcessor } from './processors/oracle-update.processor';
import { BatchingProcessor } from './processors/batching.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          db: configService.get('REDIS_DB', 0),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      }),
      inject: [ConfigService],
    }),
    // Priority-based queues
    BullModule.registerQueue(
      { 
        name: 'high-priority',
        config: {
          maxPriority: 10,
        },
      },
      { 
        name: 'normal-priority',
        config: {
          maxPriority: 5,
        },
      },
      { 
        name: 'low-priority',
        config: {
          maxPriority: 1,
        },
      },
      // Specialized queues
      { name: 'delayed' },
      { name: 'dead-letter' },
      // Legacy queues for backward compatibility
      { name: 'ai-scoring' },
      { name: 'oracle-updates' },
      { name: 'batching' },
    ),
  ],
  controllers: [JobController],
  providers: [
    JobQueueService,
    // New enhanced processors
    ScoreAgentProcessor,
    DetectFraudProcessor,
    UpdateOracleProcessor,
    SubmitBlockchainProcessor,
    ReportMetricsProcessor,
    // Legacy processors for backward compatibility
    AiScoringProcessor,
    OracleUpdateProcessor,
    BatchingProcessor,
  ],
  exports: [JobQueueService],
})
export class WorkerModule {}
