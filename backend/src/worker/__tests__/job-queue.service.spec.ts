import { Test, TestingModule } from '@nestjs/testing';
import { JobQueueService } from '../job-queue.service';
import { BullModule } from '@nestjs/bullmq';
import { JobType, JobPriority, JobStatus } from '../job-types';

describe('JobQueueService', () => {
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addJob', () => {
    it('should add a high priority job to the correct queue', async () => {
      const jobData = { test: 'data' };
      const mockJob = { id: 'test-job-id', queue: { name: 'high-priority' } };
      mockQueue.add.mockResolvedValue(mockJob);

      const result = await service.addJob(JobType.SCORE_AGENT, jobData, {
        priority: JobPriority.HIGH,
      });

      expect(result).toEqual(mockJob);
      expect(mockQueue.add).toHaveBeenCalledWith(
        JobType.SCORE_AGENT.toString(),
        expect.objectContaining({
          ...jobData,
          jobType: JobType.SCORE_AGENT,
          createdAt: expect.any(Number),
          priority: JobPriority.HIGH,
        }),
        expect.objectContaining({
          priority: JobPriority.HIGH,
          attempts: 3,
          timeout: 30000,
        })
      );
    });

    it('should add a normal priority job to the correct queue', async () => {
      const jobData = { test: 'data' };
      const mockJob = { id: 'test-job-id', queue: { name: 'normal-priority' } };
      mockQueue.add.mockResolvedValue(mockJob);

      const result = await service.addJob(JobType.UPDATE_ORACLE, jobData);

      expect(result).toEqual(mockJob);
      expect(mockQueue.add).toHaveBeenCalledWith(
        JobType.UPDATE_ORACLE.toString(),
        expect.objectContaining({
          ...jobData,
          jobType: JobType.UPDATE_ORACLE,
          priority: JobPriority.NORMAL,
        }),
        expect.objectContaining({
          priority: JobPriority.NORMAL,
          attempts: 5,
          timeout: 60000,
        })
      );
    });

    it('should add a low priority job to the correct queue', async () => {
      const jobData = { test: 'data' };
      const mockJob = { id: 'test-job-id', queue: { name: 'low-priority' } };
      mockQueue.add.mockResolvedValue(mockJob);

      const result = await service.addJob(JobType.REPORT_METRICS, jobData);

      expect(result).toEqual(mockJob);
      expect(mockQueue.add).toHaveBeenCalledWith(
        JobType.REPORT_METRICS.toString(),
        expect.objectContaining({
          ...jobData,
          jobType: JobType.REPORT_METRICS,
          priority: JobPriority.LOW,
        }),
        expect.objectContaining({
          priority: JobPriority.LOW,
          attempts: 2,
          timeout: 120000,
        })
      );
    });
  });

  describe('addDelayedJob', () => {
    it('should add a delayed job', async () => {
      const jobData = { test: 'data' };
      const delayMs = 5000;
      const mockJob = { id: 'test-job-id', queue: { name: 'delayed' } };
      mockQueue.add.mockResolvedValue(mockJob);

      const result = await service.addDelayedJob(JobType.SCORE_AGENT, jobData, delayMs);

      expect(result).toEqual(mockJob);
      expect(mockQueue.add).toHaveBeenCalledWith(
        JobType.SCORE_AGENT.toString(),
        expect.objectContaining({
          ...jobData,
          jobType: JobType.SCORE_AGENT,
        }),
        expect.objectContaining({
          delay: delayMs,
        })
      );
    });
  });

  describe('addRecurringJob', () => {
    it('should add a recurring job with cron expression', async () => {
      const jobData = { test: 'data' };
      const cronExpression = '0 * * * *'; // Every hour
      const mockJob = { id: 'test-job-id', queue: { name: 'normal-priority' } };
      mockQueue.add.mockResolvedValue(mockJob);

      const result = await service.addRecurringJob(
        JobType.REPORT_METRICS,
        jobData,
        cronExpression
      );

      expect(result).toEqual(mockJob);
      expect(mockQueue.add).toHaveBeenCalledWith(
        JobType.REPORT_METRICS.toString(),
        expect.objectContaining({
          ...jobData,
          jobType: JobType.REPORT_METRICS,
        }),
        expect.objectContaining({
          repeat: { cron: cronExpression },
        })
      );
    });
  });

  describe('addJobWithDependencies', () => {
    it('should add a job with dependencies when dependencies are completed', async () => {
      const jobData = { test: 'data' };
      const dependencies = ['job1', 'job2'];
      const mockJob = { id: 'test-job-id', queue: { name: 'normal-priority' } };
      const mockDepJob = { getState: jest.fn().mockResolvedValue('completed') };

      mockQueue.getJob.mockResolvedValue(mockDepJob);
      mockQueue.add.mockResolvedValue(mockJob);

      const result = await service.addJobWithDependencies(
        JobType.SUBMIT_BLOCKCHAIN,
        jobData,
        dependencies
      );

      expect(result).toEqual(mockJob);
      expect(mockQueue.getJob).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should throw error when dependencies are not completed', async () => {
      const jobData = { test: 'data' };
      const dependencies = ['job1'];
      const mockDepJob = { getState: jest.fn().mockResolvedValue('failed') };

      mockQueue.getJob.mockResolvedValue(mockDepJob);

      await expect(
        service.addJobWithDependencies(JobType.SUBMIT_BLOCKCHAIN, jobData, dependencies)
      ).rejects.toThrow('Dependency job job1 is not completed');
    });
  });

  describe('getQueueMetrics', () => {
    it('should return metrics for all queues', async () => {
      const mockCounts = {
        waiting: 10,
        active: 5,
        completed: 100,
        failed: 2,
        delayed: 3,
        paused: 0,
      };
      mockQueue.getJobCounts.mockResolvedValue(mockCounts);

      const result = await service.getQueueMetrics();

      expect(result).toHaveLength(5); // 5 queues
      expect(result[0]).toEqual({
        queueName: 'high-priority',
        waiting: 10,
        active: 5,
        completed: 100,
        failed: 2,
        delayed: 3,
        paused: 0,
        total: 120,
      });
    });

    it('should return metrics for specific queue', async () => {
      const mockCounts = {
        waiting: 5,
        active: 2,
        completed: 50,
        failed: 1,
        delayed: 0,
        paused: 0,
      };
      mockQueue.getJobCounts.mockResolvedValue(mockCounts);

      const result = await service.getQueueMetrics('high-priority');

      expect(result).toHaveLength(1);
      expect(result[0].queueName).toBe('high-priority');
    });
  });

  describe('retryJob', () => {
    it('should retry a failed job', async () => {
      const jobId = 'test-job-id';
      const mockJob = { getState: jest.fn().mockResolvedValue('failed'), retry: jest.fn() };

      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await service.retryJob(jobId);

      expect(result).toBe(true);
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should throw error for non-failed job', async () => {
      const jobId = 'test-job-id';
      const mockJob = { getState: jest.fn().mockResolvedValue('completed') };

      mockQueue.getJob.mockResolvedValue(mockJob);

      await expect(service.retryJob(jobId)).rejects.toThrow('Job test-job-id is not in failed state');
    });

    it('should throw error for non-existent job', async () => {
      const jobId = 'non-existent-job';

      mockQueue.getJob.mockResolvedValue(null);

      await expect(service.retryJob(jobId)).rejects.toThrow('Job non-existent-job not found');
    });
  });

  describe('cancelJob', () => {
    it('should cancel a waiting job', async () => {
      const jobId = 'test-job-id';
      const mockJob = { getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn() };

      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await service.cancelJob(jobId);

      expect(result).toBe(true);
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('should throw error for active job', async () => {
      const jobId = 'test-job-id';
      const mockJob = { getState: jest.fn().mockResolvedValue('active') };

      mockQueue.getJob.mockResolvedValue(mockJob);

      await expect(service.cancelJob(jobId)).rejects.toThrow('Job test-job-id cannot be cancelled');
    });
  });

  describe('getDeadLetterJobs', () => {
    it('should return dead letter jobs', async () => {
      const mockDeadJobs = [
        {
          id: 'dead-job-1',
          data: { jobType: JobType.SCORE_AGENT },
          failedReason: 'Test error',
          attemptsMade: 3,
          finishedOn: Date.now(),
          opts: { parent: { queue: 'high-priority' } },
        },
      ];

      mockQueue.getJobs.mockResolvedValue(mockDeadJobs);

      const result = await service.getDeadLetterJobs();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'dead-job-1',
        type: JobType.SCORE_AGENT,
        data: { jobType: JobType.SCORE_AGENT },
        error: 'Test error',
        failedAt: expect.any(Date),
        attempts: 3,
        originalQueue: 'high-priority',
      });
    });
  });

  describe('retryDeadLetterJob', () => {
    it('should retry a dead letter job', async () => {
      const jobId = 'dead-job-1';
      const mockDeadJob = {
        id: jobId,
        data: { jobType: JobType.SCORE_AGENT, priority: JobPriority.HIGH },
        opts: { attempts: 3 },
        remove: jest.fn(),
      };

      mockQueue.getJob.mockResolvedValue(mockDeadJob);
      mockQueue.add.mockResolvedValue({ id: 'new-job-id' });

      const result = await service.retryDeadLetterJob(jobId);

      expect(result).toBe(true);
      expect(mockDeadJob.remove).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith(
        JobType.SCORE_AGENT.toString(),
        mockDeadJob.data,
        mockDeadJob.opts
      );
    });
  });
});
