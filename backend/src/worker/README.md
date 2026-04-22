# Worker Pool with Priority Queue Documentation

## Overview

The Worker Pool system provides a robust, scalable background job processing solution with priority queues, delayed execution, job dependencies, and comprehensive monitoring. Built on BullMQ with NestJS, it supports high-volume job processing (1000+ jobs/hour) with proper error handling and retry mechanisms.

## Architecture

### Core Components

1. **Job Types** (`src/worker/job-types.ts`)
   - Defines job types, priorities, and configurations
   - Enums for JobType, JobPriority, JobStatus
   - Job definitions with default settings

2. **Job Queue Service** (`src/worker/job-queue.service.ts`)
   - Central service for job management
   - Priority-based queue routing
   - Dead letter queue handling
   - Job metrics and monitoring

3. **Job Processors** (`src/worker/job-processor.ts`)
   - Type-specific job processors
   - Lifecycle hooks implementation
   - Progress tracking and error handling

4. **Job Controller** (`src/worker/controllers/job.controller.ts`)
   - REST API endpoints for job management
   - Job creation, monitoring, and control
   - Dead letter queue management

5. **Job Decorators** (`src/worker/decorators/job.decorator.ts`)
   - Decorators for job registration and configuration
   - Lifecycle hook definitions
   - Automatic processor setup

## Job Types and Priorities

### Job Types

```typescript
enum JobType {
  SCORE_AGENT = 'ScoreAgent',        // Credit scoring (HIGH priority)
  DETECT_FRAUD = 'DetectFraud',       // Fraud detection (HIGH priority)
  UPDATE_ORACLE = 'UpdateOracle',     // Oracle data updates (NORMAL priority)
  SUBMIT_BLOCKCHAIN = 'SubmitBlockchain', // Blockchain submissions (NORMAL priority)
  REPORT_METRICS = 'ReportMetrics',    // Report generation (LOW priority)
}
```

### Priority Levels

```typescript
enum JobPriority {
  HIGH = 10,    // Critical operations (scoring, fraud detection)
  NORMAL = 5,   // Regular operations (oracle updates, blockchain)
  LOW = 1,      // Background tasks (reports, maintenance)
}
```

### Queue Configuration

- **high-priority queue**: Processes HIGH priority jobs with concurrency of 5-10
- **normal-priority queue**: Processes NORMAL priority jobs with concurrency of 2-3
- **low-priority queue**: Processes LOW priority jobs with concurrency of 1
- **delayed queue**: Handles scheduled/delayed jobs
- **dead-letter queue**: Stores failed jobs after max retries

## API Endpoints

### Job Management

#### Create a Job
```http
POST /jobs
Content-Type: application/json

{
  "type": "ScoreAgent",
  "data": {
    "loanApplication": { "amount": 10000, "term": 12 },
    "applicantData": { "income": 50000, "creditHistory": 5 }
  },
  "options": {
    "priority": 10,
    "attempts": 3,
    "backoff": { "type": "exponential", "delay": 1000 }
  }
}
```

#### Create a Delayed Job
```http
POST /jobs/delayed
Content-Type: application/json

{
  "type": "UpdateOracle",
  "data": { "oracleType": "price-feed", "dataSource": "coingecko" },
  "delayMs": 300000
}
```

#### Create a Recurring Job
```http
POST /jobs/recurring
Content-Type: application/json

{
  "type": "ReportMetrics",
  "data": { "reportType": "daily-summary" },
  "cronExpression": "0 0 * * *"  // Daily at midnight
}
```

#### Create Job with Dependencies
```http
POST /jobs/dependencies
Content-Type: application/json

{
  "type": "SubmitBlockchain",
  "data": { "transaction": { "to": "0x...", "amount": 100 } },
  "dependencies": ["job-123", "job-456"]
}
```

### Job Monitoring

#### List Jobs
```http
GET /jobs?status=completed&type=ScoreAgent
GET /jobs?queue=high-priority
GET /jobs  // All queue metrics
```

#### Get Job Details
```http
GET /jobs/{jobId}
```

#### Get Job Metrics
```http
GET /jobs/{jobId}/metrics
```

#### Get Queue Metrics
```http
GET /jobs/metrics?queue=high-priority
```

### Job Control

#### Retry Failed Job
```http
POST /jobs/{jobId}/retry
```

#### Cancel Queued Job
```http
DELETE /jobs/{jobId}
```

### Dead Letter Queue

#### Get Dead Letter Jobs
```http
GET /jobs/dead-letter
```

#### Retry Dead Letter Job
```http
POST /jobs/dead-letter/{jobId}/retry
```

## Usage Examples

### Basic Job Creation

```typescript
import { JobQueueService, JobType, JobPriority } from './worker';

@Injectable()
export class LoanService {
  constructor(private jobQueue: JobQueueService) {}

  async submitLoanApplication(application: LoanApplication) {
    // High priority credit scoring
    const scoringJob = await this.jobQueue.addJob(
      JobType.SCORE_AGENT,
      {
        loanApplication: application,
        applicantData: application.applicant
      },
      {
        priority: JobPriority.HIGH,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    );

    // Normal priority fraud detection
    const fraudJob = await this.jobQueue.addJob(
      JobType.DETECT_FRAUD,
      {
        transaction: application.transaction,
        userProfile: application.applicant.profile
      },
      {
        priority: JobPriority.HIGH,
        timeout: 15000
      }
    );

    return { scoringJob: scoringJob.id, fraudJob: fraudJob.id };
  }
}
```

### Delayed Job Scheduling

```typescript
async scheduleOracleUpdate() {
  // Update oracle data every 5 minutes
  await this.jobQueue.addDelayedJob(
    JobType.UPDATE_ORACLE,
    {
      oracleType: 'price-feed',
      dataSource: 'coingecko'
    },
    300000, // 5 minutes
    {
      priority: JobPriority.NORMAL,
      attempts: 5
    }
  );
}
```

### Recurring Job Setup

```typescript
async setupDailyReports() {
  // Generate daily performance reports at midnight
  await this.jobQueue.addRecurringJob(
    JobType.REPORT_METRICS,
    {
      reportType: 'daily-performance',
      timeRange: '24h'
    },
    '0 0 * * *', // Cron expression for daily at midnight
    {
      priority: JobPriority.LOW,
      attempts: 2
    }
  );
}
```

### Job Dependencies

```typescript
async processLoanWithDependencies(application: LoanApplication) {
  // First, run credit scoring
  const scoringJob = await this.jobQueue.addJob(
    JobType.SCORE_AGENT,
    { loanApplication: application }
  );

  // Then, submit to blockchain only after scoring completes
  const blockchainJob = await this.jobQueue.addJobWithDependencies(
    JobType.SUBMIT_BLOCKCHAIN,
    {
      transaction: this.createTransaction(application),
      network: 'stellar'
    },
    [scoringJob.id], // Wait for scoring to complete
    {
      priority: JobPriority.NORMAL,
      timeout: 45000
    }
  );

  return blockchainJob.id;
}
```

### Custom Job Processor

```typescript
import { JobProcessor, JobHandler, JobLifecycleHooks } from './decorators';
import { JobType, JobPriority } from './job-types';

@Injectable()
@JobProcessor({
  queueName: 'high-priority',
  concurrency: 5,
  maxAttempts: 3,
  backoff: { type: 'exponential', delay: 1000 }
})
export class CustomProcessor extends WorkerHost implements JobLifecycleHooks {
  
  @JobHandler({
    type: JobType.SCORE_AGENT,
    priority: JobPriority.HIGH,
    timeout: 30000
  })
  async process(job: Job<JobData>): Promise<JobResult> {
    // Custom processing logic
    await this.onActive(job);
    
    try {
      // Update progress
      await job.updateProgress(25);
      await this.onProgress(job, 25);
      
      // Process the job
      const result = await this.doWork(job.data);
      
      await job.updateProgress(100);
      await this.onCompleted(job, result);
      
      return result;
    } catch (error) {
      await this.onFailed(job, error);
      throw error;
    }
  }

  async onActive(job: Job): Promise<void> {
    console.log(`Job ${job.id} started processing`);
  }

  async onProgress(job: Job, progress: number): Promise<void> {
    console.log(`Job ${job.id} progress: ${progress}%`);
  }

  async onCompleted(job: Job, result: any): Promise<void> {
    console.log(`Job ${job.id} completed successfully`);
  }

  async onFailed(job: Job, error: Error): Promise<void> {
    console.error(`Job ${job.id} failed: ${error.message}`);
  }

  private async doWork(data: JobData): Promise<any> {
    // Implement your custom logic here
    return { success: true, data: 'processed' };
  }
}
```

## Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# Queue Configuration
QUEUE_DEFAULT_ATTEMPTS=3
QUEUE_DEFAULT_BACKOFF_DELAY=1000
QUEUE_REMOVE_ON_COMPLETE=100
QUEUE_REMOVE_ON_FAIL=50
```

### Module Configuration

```typescript
// app.module.ts
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    WorkerModule,
    // ... other modules
  ],
})
export class AppModule {}
```

## Monitoring and Metrics

### Job Metrics

Each job tracks:
- Creation timestamp
- Processing start time
- Completion time
- Processing duration
- Number of attempts
- Progress percentage
- Error messages (if failed)

### Queue Metrics

Real-time metrics for each queue:
- Waiting jobs count
- Active jobs count
- Completed jobs count
- Failed jobs count
- Delayed jobs count
- Paused jobs count

### Health Checks

Monitor system health via:
```typescript
// Get overall system health
const metrics = await jobQueue.getQueueMetrics();

// Check for bottlenecks
const highPriorityQueue = metrics.find(m => m.queueName === 'high-priority');
if (highPriorityQueue.waiting > 100) {
  // Alert: High priority queue backlog
}
```

## Error Handling and Recovery

### Retry Strategy

Jobs use exponential backoff by default:
- Attempt 1: Immediate retry
- Attempt 2: Wait 1 second
- Attempt 3: Wait 2 seconds
- Attempt 4: Wait 4 seconds
- etc.

### Dead Letter Queue

Failed jobs are moved to dead letter queue after:
- Maximum attempts reached
- Timeout exceeded
- Critical system errors

Recover failed jobs:
```typescript
// Retry all dead letter jobs
const deadJobs = await jobQueue.getDeadLetterJobs();
for (const job of deadJobs) {
  await jobQueue.retryDeadLetterJob(job.id);
}
```

## Performance Optimization

### Concurrency Settings

Adjust based on your workload:
```typescript
// High CPU intensive jobs
@JobProcessor({
  queueName: 'high-priority',
  concurrency: 2, // Lower for CPU intensive
})

// I/O bound jobs
@JobProcessor({
  queueName: 'normal-priority',
  concurrency: 10, // Higher for I/O bound
})
```

### Memory Management

- Configure `removeOnComplete` and `removeOnFail` to limit memory usage
- Use job results instead of storing large data in job data
- Monitor Redis memory usage

### Scaling

- Horizontal scaling: Add more worker instances
- Vertical scaling: Increase concurrency limits
- Queue sharding: Split high-volume job types across multiple queues

## Testing

### Unit Tests

Run comprehensive test suite:
```bash
npm test
```

### Performance Tests

Stress test the system:
```bash
npm run test:performance
```

### Test Coverage

Achieve 100% test coverage:
```bash
npm run test:coverage
```

## Best Practices

1. **Job Design**
   - Keep job data small and serializable
   - Use IDs instead of large objects
   - Implement idempotent processing

2. **Error Handling**
   - Always handle errors gracefully
   - Provide meaningful error messages
   - Use appropriate retry strategies

3. **Monitoring**
   - Track job performance metrics
   - Set up alerts for queue backlogs
   - Monitor system resources

4. **Security**
   - Validate job data
   - Sanitize inputs
   - Use secure queue connections

5. **Performance**
   - Optimize job processing time
   - Use appropriate concurrency limits
   - Monitor and tune regularly

## Troubleshooting

### Common Issues

1. **Jobs Stuck in Queue**
   - Check worker process status
   - Verify Redis connection
   - Review error logs

2. **High Memory Usage**
   - Reduce `removeOnComplete`/`removeOnFail` values
   - Optimize job data size
   - Check for memory leaks

3. **Slow Processing**
   - Increase concurrency limits
   - Optimize job logic
   - Check system resources

### Debug Tools

```typescript
// Check job status
const job = await jobQueue.getJob(jobId);
const state = await job.getState();
console.log(`Job ${jobId} state: ${state}`);

// Get detailed metrics
const metrics = await jobQueue.getJobMetrics(jobId);
console.log('Job metrics:', metrics);

// Monitor queue health
const queueMetrics = await jobQueue.getQueueMetrics();
console.log('Queue metrics:', queueMetrics);
```

## Migration Guide

### From Legacy Bull Queue

1. Update imports from `@nestjs/bull` to `@nestjs/bullmq`
2. Replace old queue names with priority-based queues
3. Update job processors to extend `WorkerHost`
4. Add new job types and configurations
5. Update API calls to use new endpoints

### Backward Compatibility

The system maintains backward compatibility with existing queues:
- `ai-scoring` → maps to `ScoreAgent` type
- `oracle-updates` → maps to `UpdateOracle` type
- `batching` → maps to appropriate priority queue

## Support and Maintenance

- Regular monitoring of queue performance
- Periodic cleanup of old job data
- Updates to job processors as business logic changes
- Scaling adjustments based on workload patterns

This comprehensive worker pool system provides a solid foundation for reliable, high-performance background job processing with proper prioritization and monitoring capabilities.
