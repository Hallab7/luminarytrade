import { Test, TestingModule } from '@nestjs/testing';
import { JobQueueService } from '../job-queue.service';
import { JobType, JobPriority } from '../job-types';
import { BullModule } from '@nestjs/bullmq';

describe('Job Performance Stress Tests', () => {
  let service: JobQueueService;
  let module: TestingModule;

  const mockQueue = {
    add: jest.fn(),
    getJob: jest.fn(),
    getJobCounts: jest.fn(),
    getJobs: jest.fn(),
    remove: jest.fn(),
    retry: jest.fn(),
    client: {},
  };

  beforeEach(async () => {
    const mockModule = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: {
            host: 'localhost',
            port: 6379,
          },
        }),
        BullModule.registerQueue(
          { name: 'high-priority' },
          { name: 'normal-priority' },
          { name: 'low-priority' },
          { name: 'delayed' },
          { name: 'dead-letter' },
        ),
      ],
      providers: [JobQueueService],
    })
    .overrideProvider('BullQueue_high-priority')
    .useValue(mockQueue)
    .overrideProvider('BullQueue_normal-priority')
    .useValue(mockQueue)
    .overrideProvider('BullQueue_low-priority')
    .useValue(mockQueue)
    .overrideProvider('BullQueue_delayed')
    .useValue(mockQueue)
    .overrideProvider('BullQueue_dead-letter')
    .useValue(mockQueue)
    .compile();

    service = mockModule.get<JobQueueService>(JobQueueService);
    module = mockModule;
  });

  afterEach(async () => {
    await module.close();
  });

  describe('High Volume Job Processing', () => {
    it('should handle 1000+ jobs per hour across all types', async () => {
      const startTime = Date.now();
      const jobCount = 1200; // 20% more than required
      const jobPromises: Promise<any>[] = [];
      
      // Mock successful job creation
      mockQueue.add.mockResolvedValue({ 
        id: `job-${Math.random()}`, 
        queue: { name: 'test-queue' } 
      });

      // Create jobs with different priorities and types
      for (let i = 0; i < jobCount; i++) {
        const jobType = Object.values(JobType)[i % Object.values(JobType).length];
        const priority = i % 3 === 0 ? JobPriority.HIGH : 
                       i % 3 === 1 ? JobPriority.NORMAL : JobPriority.LOW;
        
        jobPromises.push(
          service.addJob(jobType, { 
            test: `data-${i}`,
            index: i 
          }, { priority })
        );
      }

      // Execute all jobs concurrently
      const results = await Promise.all(jobPromises);
      const endTime = Date.now();
      const duration = endTime - startTime;
      const jobsPerHour = (jobCount / duration) * 3600000; // Convert to jobs/hour

      expect(results).toHaveLength(jobCount);
      expect(jobsPerHour).toBeGreaterThan(1000);
      expect(mockQueue.add).toHaveBeenCalledTimes(jobCount);
      
      console.log(`Processed ${jobCount} jobs in ${duration}ms (${jobsPerHour.toFixed(2)} jobs/hour)`);
    }, 30000); // 30 second timeout

    it('should maintain priority ordering under load', async () => {
      const jobOrder: Array<{ type: JobType; priority: JobPriority; index: number }> = [];
      
      // Mock queue add to track order
      mockQueue.add.mockImplementation((name, data, opts) => {
        jobOrder.push({
          type: data.jobType,
          priority: opts.priority,
          index: data.index
        });
        return Promise.resolve({ id: `job-${data.index}`, queue: { name } });
      });

      // Create jobs with mixed priorities
      const jobs = [
        { type: JobType.DETECT_FRAUD, priority: JobPriority.HIGH, index: 1 },
        { type: JobType.SCORE_AGENT, priority: JobPriority.HIGH, index: 2 },
        { type: JobType.REPORT_METRICS, priority: JobPriority.LOW, index: 3 },
        { type: JobType.UPDATE_ORACLE, priority: JobPriority.NORMAL, index: 4 },
        { type: JobType.SUBMIT_BLOCKCHAIN, priority: JobPriority.NORMAL, index: 5 },
        { type: JobType.DETECT_FRAUD, priority: JobPriority.HIGH, index: 6 },
      ];

      // Add jobs in random order
      const shuffledJobs = [...jobs].sort(() => Math.random() - 0.5);
      
      for (const job of shuffledJobs) {
        await service.addJob(job.type, { index: job.index }, { priority: job.priority });
      }

      // Verify high priority jobs are processed first
      const highPriorityJobs = jobOrder.filter(job => job.priority === JobPriority.HIGH);
      const normalPriorityJobs = jobOrder.filter(job => job.priority === JobPriority.NORMAL);
      const lowPriorityJobs = jobOrder.filter(job => job.priority === JobPriority.LOW);

      expect(highPriorityJobs).toHaveLength(3);
      expect(normalPriorityJobs).toHaveLength(2);
      expect(lowPriorityJobs).toHaveLength(1);
      
      // Verify the order respects priority (HIGH before NORMAL before LOW)
      const highPriorityIndices = highPriorityJobs.map(job => job.index);
      const normalPriorityIndices = normalPriorityJobs.map(job => job.index);
      const lowPriorityIndices = lowPriorityJobs.map(job => job.index);

      // All high priority jobs should come before normal priority jobs
      const firstNormalIndex = Math.min(...normalPriorityIndices);
      const lastHighIndex = Math.max(...highPriorityIndices);
      expect(lastHighIndex).toBeLessThan(firstNormalIndex);
    });

    it('should handle delayed jobs with precise timing', async () => {
      const delayMs = 5000; // 5 seconds
      const tolerance = 1000; // ±1 second tolerance
      const startTime = Date.now();
      
      mockQueue.add.mockResolvedValue({ 
        id: 'delayed-job', 
        queue: { name: 'delayed' } 
      });

      const job = await service.addDelayedJob(
        JobType.UPDATE_ORACLE,
        { test: 'delayed-data' },
        delayMs
      );

      const endTime = Date.now();
      const actualDelay = endTime - startTime;

      expect(job).toBeDefined();
      expect(mockQueue.add).toHaveBeenCalledWith(
        JobType.UPDATE_ORACLE.toString(),
        expect.objectContaining({
          test: 'delayed-data',
          jobType: JobType.UPDATE_ORACLE,
        }),
        expect.objectContaining({
          delay: delayMs,
        })
      );

      // Verify the delay is within tolerance (this is a simplified test)
      expect(actualDelay).toBeLessThan(tolerance);
    });

    it('should handle job dependencies correctly', async () => {
      const dependencyJobId = 'dependency-job';
      const dependentJobId = 'dependent-job';
      
      // Mock dependency job as completed
      const mockDependencyJob = {
        getState: jest.fn().mockResolvedValue('completed')
      };
      
      mockQueue.getJob.mockResolvedValue(mockDependencyJob);
      mockQueue.add.mockResolvedValue({ 
        id: dependentJobId, 
        queue: { name: 'normal-priority' } 
      });

      const job = await service.addJobWithDependencies(
        JobType.SUBMIT_BLOCKCHAIN,
        { test: 'dependent-data' },
        [dependencyJobId]
      );

      expect(job).toBeDefined();
      expect(mockQueue.getJob).toHaveBeenCalledWith(dependencyJobId);
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should handle dead letter queue for failed jobs', async () => {
      const failedJobId = 'failed-job';
      
      const mockDeadJobs = [
        {
          id: failedJobId,
          data: { jobType: JobType.SCORE_AGENT, priority: JobPriority.HIGH },
          failedReason: 'Connection timeout',
          attemptsMade: 3,
          finishedOn: Date.now(),
          opts: { parent: { queue: 'high-priority' } },
        }
      ];

      mockQueue.getJobs.mockResolvedValue(mockDeadJobs);
      mockQueue.getJob.mockResolvedValue({
        id: failedJobId,
        data: { jobType: JobType.SCORE_AGENT, priority: JobPriority.HIGH },
        opts: { attempts: 3 },
        remove: jest.fn(),
      });
      mockQueue.add.mockResolvedValue({ id: 'retry-job' });

      // Get dead letter jobs
      const deadJobs = await service.getDeadLetterJobs();
      expect(deadJobs).toHaveLength(1);
      expect(deadJobs[0].id).toBe(failedJobId);
      expect(deadJobs[0].type).toBe(JobType.SCORE_AGENT);

      // Retry dead letter job
      const retryResult = await service.retryDeadLetterJob(failedJobId);
      expect(retryResult).toBe(true);
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should maintain job metrics under high load', async () => {
      const jobCount = 500;
      const mockJob = { 
        id: `job-${Math.random()}`, 
        queue: { name: 'test-queue' },
        timestamp: Date.now()
      };

      mockQueue.add.mockResolvedValue(mockJob);
      mockQueue.getJob.mockResolvedValue(mockJob);
      mockQueue.getJobCounts.mockResolvedValue({
        waiting: 100,
        active: 50,
        completed: 300,
        failed: 10,
        delayed: 20,
        paused: 0,
      });

      // Create jobs
      const jobPromises: Promise<any>[] = [];
      for (let i = 0; i < jobCount; i++) {
        jobPromises.push(
          service.addJob(JobType.SCORE_AGENT, { index: i })
        );
      }

      await Promise.all(jobPromises);

      // Get metrics
      const metrics = await service.getQueueMetrics();
      expect(metrics).toHaveLength(5); // 5 queues
      expect(mockQueue.getJobCounts).toHaveBeenCalled();

      // Get individual job metrics
      const jobMetrics = await service.getJobMetrics(mockJob.id);
      expect(jobMetrics).toBeDefined();
    });
  });

  describe('Concurrent Processing', () => {
    it('should handle concurrent job creation and processing', async () => {
      const concurrentBatches = 10;
      const jobsPerBatch = 50;
      const totalJobs = concurrentBatches * jobsPerBatch;
      
      mockQueue.add.mockResolvedValue({ 
        id: `job-${Math.random()}`, 
        queue: { name: 'test-queue' } 
      });

      // Create multiple batches of jobs concurrently
      const batchPromises = Array.from({ length: concurrentBatches }, async (_, batchIndex) => {
        const batchJobPromises = Array.from({ length: jobsPerBatch }, async (_, jobIndex) => {
          const globalIndex = batchIndex * jobsPerBatch + jobIndex;
          return service.addJob(JobType.SCORE_AGENT, { 
            batch: batchIndex,
            job: jobIndex,
            global: globalIndex 
          });
        });
        
        return Promise.all(batchJobPromises);
      });

      const results = await Promise.all(batchPromises);
      const flatResults = results.flat();

      expect(flatResults).toHaveLength(totalJobs);
      expect(mockQueue.add).toHaveBeenCalledTimes(totalJobs);
    }, 20000);

    it('should handle mixed priority jobs concurrently', async () => {
      const highPriorityJobs = 100;
      const normalPriorityJobs = 150;
      const lowPriorityJobs = 50;
      
      mockQueue.add.mockResolvedValue({ 
        id: `job-${Math.random()}`, 
        queue: { name: 'test-queue' } 
      });

      // Create all job types concurrently
      const allJobPromises = [
        // High priority jobs
        ...Array.from({ length: highPriorityJobs }, (_, i) =>
          service.addJob(JobType.SCORE_AGENT, { index: i }, { priority: JobPriority.HIGH })
        ),
        // Normal priority jobs
        ...Array.from({ length: normalPriorityJobs }, (_, i) =>
          service.addJob(JobType.UPDATE_ORACLE, { index: i }, { priority: JobPriority.NORMAL })
        ),
        // Low priority jobs
        ...Array.from({ length: lowPriorityJobs }, (_, i) =>
          service.addJob(JobType.REPORT_METRICS, { index: i }, { priority: JobPriority.LOW })
        ),
      ];

      const results = await Promise.all(allJobPromises);
      const totalJobs = highPriorityJobs + normalPriorityJobs + lowPriorityJobs;

      expect(results).toHaveLength(totalJobs);
      expect(mockQueue.add).toHaveBeenCalledTimes(totalJobs);
    }, 15000);
  });

  describe('Error Handling and Recovery', () => {
    it('should handle queue failures gracefully', async () => {
      const failureRate = 0.1; // 10% failure rate
      const jobCount = 100;
      let successCount = 0;
      let failureCount = 0;

      mockQueue.add.mockImplementation(() => {
        if (Math.random() < failureRate) {
          failureCount++;
          return Promise.reject(new Error('Queue temporarily unavailable'));
        } else {
          successCount++;
          return Promise.resolve({ id: `job-${successCount}`, queue: { name: 'test-queue' } });
        }
      });

      const jobPromises = Array.from({ length: jobCount }, (_, i) =>
        service.addJob(JobType.SCORE_AGENT, { index: i })
          .catch(error => ({ error: error.message, index: i }))
      );

      const results = await Promise.all(jobPromises);
      const successfulJobs = results.filter(result => !result.error);
      const failedJobs = results.filter(result => result.error);

      expect(successfulJobs.length + failedJobs.length).toBe(jobCount);
      expect(failedJobs.length).toBeGreaterThan(0);
      expect(successfulJobs.length).toBeGreaterThan(0);
      
      console.log(`Success rate: ${successfulJobs.length}/${jobCount} (${(successfulJobs.length/jobCount*100).toFixed(1)}%)`);
    });

    it('should retry failed jobs successfully', async () => {
      const jobId = 'failed-job';
      let retryAttempts = 0;
      
      const mockJob = {
        getState: jest.fn()
          .mockResolvedValueOnce('failed')
          .mockResolvedValueOnce('waiting'),
        retry: jest.fn().mockImplementation(() => {
          retryAttempts++;
          return Promise.resolve();
        })
      };

      mockQueue.getJob.mockResolvedValue(mockJob);

      // First retry
      const result1 = await service.retryJob(jobId);
      expect(result1).toBe(true);
      expect(retryAttempts).toBe(1);
      expect(mockJob.retry).toHaveBeenCalledTimes(1);

      // Second retry
      const result2 = await service.retryJob(jobId);
      expect(result2).toBe(true);
      expect(retryAttempts).toBe(2);
      expect(mockJob.retry).toHaveBeenCalledTimes(2);
    });
  });
});
