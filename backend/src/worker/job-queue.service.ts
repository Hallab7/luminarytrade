import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { 
  JobType, 
  JobPriority, 
  JobStatus, 
  JobData, 
  JobOptions, 
  JobResult, 
  JobMetrics,
  QueueMetrics,
  DeadLetterJob,
  JOB_DEFINITIONS 
} from './job-types';

@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private deadLetterQueue: Queue;
  private jobMetrics: Map<string, JobMetrics> = new Map();

  constructor(
    @InjectQueue('high-priority') private highPriorityQueue: Queue,
    @InjectQueue('normal-priority') private normalPriorityQueue: Queue,
    @InjectQueue('low-priority') private lowPriorityQueue: Queue,
    @InjectQueue('delayed') private delayedQueue: Queue,
    @InjectQueue('dead-letter') private deadLetterQueueInject: Queue,
  ) {
    this.deadLetterQueue = this.deadLetterQueueInject;
  }

  async onModuleInit() {
    await this.initializeQueueEvents();
    this.logger.log('Job Queue Service initialized');
  }

  async onModuleDestroy() {
    await this.gracefulShutdown();
  }

  private async initializeQueueEvents() {
    const queues = [
      { name: 'high-priority', queue: this.highPriorityQueue },
      { name: 'normal-priority', queue: this.normalPriorityQueue },
      { name: 'low-priority', queue: this.lowPriorityQueue },
      { name: 'delayed', queue: this.delayedQueue },
    ];

    for (const { name, queue } of queues) {
      const queueEvents = new QueueEvents(name, {
        connection: queue.client,
      });

      queueEvents.on('completed', ({ jobId, returnvalue }) => {
        this.handleJobCompleted(jobId, returnvalue);
      });

      queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.handleJobFailed(jobId, failedReason);
      });

      queueEvents.on('progress', ({ jobId, data }) => {
        this.handleJobProgress(jobId, data);
      });

      queueEvents.on('stalled', ({ jobId }) => {
        this.handleJobStalled(jobId);
      });

      this.queueEvents.set(name, queueEvents);
    }
  }

  async addJob<T extends JobData>(
    type: JobType,
    data: T,
    options: JobOptions = {}
  ): Promise<Job<T>> {
    const definition = JOB_DEFINITIONS[type];
    const queue = this.getQueueByPriority(options.priority || definition.priority);
    
    const jobOptions = {
      priority: options.priority || definition.priority,
      attempts: options.attempts || definition.defaultAttempts,
      backoff: options.backoff || definition.defaultBackoff,
      removeOnComplete: options.removeOnComplete || 100,
      removeOnFail: options.removeOnFail || 50,
      delay: options.delay,
      jobId: options.jobId,
      repeat: options.repeat,
      parent: options.parent,
      timeout: definition.timeout,
    };

    // Add job metadata
    const enrichedData = {
      ...data,
      jobType: type,
      createdAt: Date.now(),
      priority: jobOptions.priority,
    };

    const job = await queue.add(type.toString(), enrichedData, jobOptions);
    
    // Track job metrics
    this.jobMetrics.set(job.id!, {
      id: job.id!,
      type,
      status: JobStatus.WAITING,
      priority: jobOptions.priority,
      progress: 0,
      data: enrichedData,
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: jobOptions.attempts!,
    });

    this.logger.log(`Job ${job.id} of type ${type} added to ${queue.name} queue`);
    return job;
  }

  async addDelayedJob<T extends JobData>(
    type: JobType,
    data: T,
    delayMs: number,
    options: JobOptions = {}
  ): Promise<Job<T>> {
    return this.addJob(type, data, { ...options, delay: delayMs });
  }

  async addRecurringJob<T extends JobData>(
    type: JobType,
    data: T,
    cronExpression: string,
    options: JobOptions = {}
  ): Promise<Job<T>> {
    return this.addJob(type, data, {
      ...options,
      repeat: { cron: cronExpression },
    });
  }

  async addJobWithDependencies<T extends JobData>(
    type: JobType,
    data: T,
    dependencies: string[],
    options: JobOptions = {}
  ): Promise<Job<T>> {
    // Wait for dependencies to complete
    for (const depJobId of dependencies) {
      const depJob = await this.getJob(depJobId);
      if (!depJob || (await depJob.getState()) !== 'completed') {
        throw new Error(`Dependency job ${depJobId} is not completed`);
      }
    }

    return this.addJob(type, data, { ...options, dependencies });
  }

  private getQueueByPriority(priority: JobPriority): Queue {
    switch (priority) {
      case JobPriority.HIGH:
        return this.highPriorityQueue;
      case JobPriority.NORMAL:
        return this.normalPriorityQueue;
      case JobPriority.LOW:
        return this.lowPriorityQueue;
      default:
        return this.normalPriorityQueue;
    }
  }

  async getJob(jobId: string): Promise<Job | null> {
    // Search all queues for the job
    const queues = [
      this.highPriorityQueue,
      this.normalPriorityQueue,
      this.lowPriorityQueue,
      this.delayedQueue,
    ];

    for (const queue of queues) {
      try {
        const job = await queue.getJob(jobId);
        if (job) return job;
      } catch (error) {
        // Job not found in this queue, continue searching
      }
    }

    return null;
  }

  async getJobMetrics(jobId: string): Promise<JobMetrics | null> {
    return this.jobMetrics.get(jobId) || null;
  }

  async getQueueMetrics(queueName?: string): Promise<QueueMetrics[]> {
    const queues = queueName 
      ? [{ name: queueName, queue: this.getQueueByName(queueName) }]
      : [
          { name: 'high-priority', queue: this.highPriorityQueue },
          { name: 'normal-priority', queue: this.normalPriorityQueue },
          { name: 'low-priority', queue: this.lowPriorityQueue },
          { name: 'delayed', queue: this.delayedQueue },
          { name: 'dead-letter', queue: this.deadLetterQueue },
        ];

    const metrics: QueueMetrics[] = [];

    for (const { name, queue } of queues) {
      const counts = await queue.getJobCounts();
      metrics.push({
        queueName: name,
        waiting: (counts.waiting as number) || 0,
        active: (counts.active as number) || 0,
        completed: (counts.completed as number) || 0,
        failed: (counts.failed as number) || 0,
        delayed: (counts.delayed as number) || 0,
        paused: (counts.paused as number) || 0,
        total: Object.values(counts).reduce((sum: number, count: unknown) => sum + (count as number), 0),
      });
    }

    return metrics;
  }

  async getJobsByStatus(status: JobStatus, type?: JobType): Promise<Job[]> {
    const queues = [this.highPriorityQueue, this.normalPriorityQueue, this.lowPriorityQueue];
    const jobs: Job[] = [];

    for (const queue of queues) {
      const stateJobs = await queue.getJobs([status], 0, -1);
      if (type) {
        jobs.push(...stateJobs.filter(job => job.data.jobType === type));
      } else {
        jobs.push(...stateJobs);
      }
    }

    return jobs;
  }

  async retryJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new Error(`Job ${jobId} is not in failed state`);
    }

    await job.retry();
    this.logger.log(`Job ${jobId} retried`);
    return true;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    if (state !== 'waiting' && state !== 'delayed') {
      throw new Error(`Job ${jobId} cannot be cancelled (current state: ${state})`);
    }

    await job.remove();
    this.jobMetrics.delete(jobId);
    this.logger.log(`Job ${jobId} cancelled`);
    return true;
  }

  async getDeadLetterJobs(): Promise<DeadLetterJob[]> {
    const jobs = await this.deadLetterQueue.getJobs(['failed'], 0, -1);
    
    return jobs.map(job => ({
      id: job.id!,
      type: job.data.jobType,
      data: job.data,
      error: job.failedReason || 'Unknown error',
      failedAt: new Date(job.finishedOn || Date.now()),
      attempts: job.attemptsMade,
      originalQueue: job.opts.parent?.queue || 'unknown',
    }));
  }

  async retryDeadLetterJob(jobId: string): Promise<boolean> {
    const deadJob = await this.deadLetterQueue.getJob(jobId);
    if (!deadJob) {
      throw new Error(`Dead letter job ${jobId} not found`);
    }

    // Move job back to original queue
    const originalQueue = this.getQueueByPriority(deadJob.data.priority);
    await originalQueue.add(
      deadJob.data.jobType.toString(),
      deadJob.data,
      deadJob.opts
    );

    // Remove from dead letter queue
    await deadJob.remove();
    this.logger.log(`Dead letter job ${jobId} moved back to ${originalQueue.name} queue`);
    return true;
  }

  private handleJobCompleted(jobId: string, result: any) {
    const metrics = this.jobMetrics.get(jobId);
    if (metrics) {
      metrics.status = JobStatus.COMPLETED;
      metrics.result = result;
      metrics.completedAt = new Date();
      metrics.processingTime = metrics.completedAt.getTime() - metrics.createdAt.getTime();
      this.jobMetrics.set(jobId, metrics);
    }
    this.logger.log(`Job ${jobId} completed successfully`);
  }

  private handleJobFailed(jobId: string, error: string) {
    const metrics = this.jobMetrics.get(jobId);
    if (metrics) {
      metrics.status = JobStatus.FAILED;
      metrics.errorMessage = error;
      metrics.failedAt = new Date();
      metrics.attempts++;
      
      // Move to dead letter if max attempts reached
      if (metrics.attempts >= metrics.maxAttempts) {
        this.moveToDeadLetter(jobId, metrics, error);
      }
    }
    this.logger.error(`Job ${jobId} failed: ${error}`);
  }

  private handleJobProgress(jobId: string, progress: number) {
    const metrics = this.jobMetrics.get(jobId);
    if (metrics) {
      metrics.progress = progress;
      this.jobMetrics.set(jobId, metrics);
    }
  }

  private handleJobStalled(jobId: string) {
    const metrics = this.jobMetrics.get(jobId);
    if (metrics) {
      metrics.status = JobStatus.ACTIVE; // Stalled jobs are still considered active
    }
    this.logger.warn(`Job ${jobId} stalled`);
  }

  private async moveToDeadLetter(jobId: string, metrics: JobMetrics, error: string) {
    try {
      await this.deadLetterQueue.add(
        'dead-letter',
        {
          originalJobId: jobId,
          type: metrics.type,
          data: metrics.data,
          error,
          failedAt: Date.now(),
          attempts: metrics.attempts,
        },
        {
          removeOnComplete: 100,
          removeOnFail: 50,
        }
      );
      
      // Remove from active tracking
      this.jobMetrics.delete(jobId);
      this.logger.log(`Job ${jobId} moved to dead letter queue`);
    } catch (moveError) {
      this.logger.error(`Failed to move job ${jobId} to dead letter queue: ${moveError}`);
    }
  }

  private getQueueByName(name: string): Queue {
    switch (name) {
      case 'high-priority':
        return this.highPriorityQueue;
      case 'normal-priority':
        return this.normalPriorityQueue;
      case 'low-priority':
        return this.lowPriorityQueue;
      case 'delayed':
        return this.delayedQueue;
      case 'dead-letter':
        return this.deadLetterQueue;
      default:
        throw new Error(`Unknown queue: ${name}`);
    }
  }

  private async gracefulShutdown() {
    this.logger.log('Starting graceful shutdown...');
    
    // Close all queue events
    for (const [name, queueEvents] of this.queueEvents) {
      await queueEvents.close();
      this.logger.log(`Queue events for ${name} closed`);
    }
    
    // Close all workers
    for (const [name, worker] of this.workers) {
      await worker.close();
      this.logger.log(`Worker for ${name} closed`);
    }
    
    this.logger.log('Graceful shutdown completed');
  }
}
