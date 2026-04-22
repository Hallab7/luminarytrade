import { Test, TestingModule } from '@nestjs/testing';
import { JobController } from '../controllers/job.controller';
import { JobQueueService } from '../job-queue.service';
import { JobType, JobPriority, JobStatus } from '../job-types';
import { Job } from 'bullmq';

describe('JobController', () => {
  let controller: JobController;
  let service: JobQueueService;

  const mockJobQueueService = {
    getJobsByStatus: jest.fn(),
    getQueueMetrics: jest.fn(),
    getJob: jest.fn(),
    getJobMetrics: jest.fn(),
    addJob: jest.fn(),
    addDelayedJob: jest.fn(),
    addRecurringJob: jest.fn(),
    addJobWithDependencies: jest.fn(),
    retryJob: jest.fn(),
    cancelJob: jest.fn(),
    getDeadLetterJobs: jest.fn(),
    retryDeadLetterJob: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobController],
      providers: [
        {
          provide: JobQueueService,
          useValue: mockJobQueueService,
        },
      ],
    }).compile();

    controller = module.get<JobController>(JobController);
    service = module.get<JobQueueService>(JobQueueService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getJobs', () => {
    it('should return jobs filtered by status and type', async () => {
      const mockJobs = [
        { id: 'job1', data: { jobType: JobType.SCORE_AGENT } },
        { id: 'job2', data: { jobType: JobType.SCORE_AGENT } },
      ];
      mockJobQueueService.getJobsByStatus.mockResolvedValue(mockJobs);

      const result = await controller.getJobs(
        JobStatus.COMPLETED,
        JobType.SCORE_AGENT
      );

      expect(result).toEqual({
        success: true,
        data: mockJobs,
        count: 2,
        filters: { status: JobStatus.COMPLETED, type: JobType.SCORE_AGENT },
      });
      expect(mockJobQueueService.getJobsByStatus).toHaveBeenCalledWith(
        JobStatus.COMPLETED,
        JobType.SCORE_AGENT
      );
    });

    it('should return queue metrics for specific queue', async () => {
      const mockMetrics = [
        { queueName: 'high-priority', waiting: 5, active: 2, completed: 100 },
      ];
      mockJobQueueService.getQueueMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getJobs(undefined, undefined, 'high-priority');

      expect(result).toEqual({
        success: true,
        data: mockMetrics,
        queue: 'high-priority',
      });
      expect(mockJobQueueService.getQueueMetrics).toHaveBeenCalledWith('high-priority');
    });

    it('should return all queue metrics', async () => {
      const mockMetrics = [
        { queueName: 'high-priority', waiting: 5, active: 2, completed: 100 },
        { queueName: 'normal-priority', waiting: 3, active: 1, completed: 50 },
      ];
      mockJobQueueService.getQueueMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getJobs();

      expect(result).toEqual({
        success: true,
        data: mockMetrics,
        totalQueues: 2,
      });
      expect(mockJobQueueService.getQueueMetrics).toHaveBeenCalledWith();
    });
  });

  describe('getQueueMetrics', () => {
    it('should return queue metrics', async () => {
      const mockMetrics = [
        { queueName: 'high-priority', waiting: 5, active: 2, completed: 100 },
      ];
      mockJobQueueService.getQueueMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getQueueMetrics();

      expect(result).toEqual({
        success: true,
        data: mockMetrics,
      });
    });

    it('should return queue metrics for specific queue', async () => {
      const mockMetrics = [
        { queueName: 'high-priority', waiting: 5, active: 2, completed: 100 },
      ];
      mockJobQueueService.getQueueMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getQueueMetrics('high-priority');

      expect(result).toEqual({
        success: true,
        data: mockMetrics,
      });
      expect(mockJobQueueService.getQueueMetrics).toHaveBeenCalledWith('high-priority');
    });
  });

  describe('getJob', () => {
    it('should return job details', async () => {
      const mockJob = {
        id: 'job1',
        name: JobType.SCORE_AGENT.toString(),
        data: { jobType: JobType.SCORE_AGENT, test: 'data' },
        opts: { priority: JobPriority.HIGH },
        progress: 50,
        timestamp: Date.now(),
        processedOn: Date.now(),
        finishedOn: Date.now(),
        attemptsMade: 1,
        failedReason: null,
      };
      const mockMetrics = {
        id: 'job1',
        type: JobType.SCORE_AGENT,
        status: JobStatus.ACTIVE,
        priority: JobPriority.HIGH,
        progress: 50,
        data: mockJob.data,
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 3,
      };

      mockJobQueueService.getJob.mockResolvedValue(mockJob as Job);
      mockJobQueueService.getJobMetrics.mockResolvedValue(mockMetrics);
      (mockJob.getState as jest.Mock).mockResolvedValue('active');

      const result = await controller.getJob('job1');

      expect(result).toEqual({
        success: true,
        data: {
          id: 'job1',
          name: JobType.SCORE_AGENT.toString(),
          data: mockJob.data,
          opts: mockJob.opts,
          progress: 50,
          state: 'active',
          metrics: mockMetrics,
          createdAt: expect.any(Date),
          processedOn: expect.any(Date),
          finishedOn: expect.any(Date),
          attemptsMade: 1,
          failedReason: null,
        },
      });
    });

    it('should return 404 for non-existent job', async () => {
      mockJobQueueService.getJob.mockResolvedValue(null);

      const result = await controller.getJob('non-existent');

      expect(result).toEqual({
        success: false,
        error: 'Job not found',
        status: 404,
      });
    });
  });

  describe('createJob', () => {
    it('should create a new job', async () => {
      const createJobDto = {
        type: JobType.SCORE_AGENT,
        data: { test: 'data' },
        options: { priority: JobPriority.HIGH },
      };
      const mockJob = {
        id: 'job1',
        queue: { name: 'high-priority' },
        timestamp: Date.now(),
      };

      mockJobQueueService.addJob.mockResolvedValue(mockJob);

      const result = await controller.createJob(createJobDto);

      expect(result).toEqual({
        success: true,
        data: {
          id: 'job1',
          type: JobType.SCORE_AGENT,
          priority: JobPriority.HIGH,
          queue: 'high-priority',
          createdAt: expect.any(Date),
          estimatedStart: expect.any(Date),
        },
        status: 201,
      });
      expect(mockJobQueueService.addJob).toHaveBeenCalledWith(
        JobType.SCORE_AGENT,
        { test: 'data' },
        { priority: JobPriority.HIGH }
      );
    });

    it('should handle job creation errors', async () => {
      const createJobDto = {
        type: JobType.SCORE_AGENT,
        data: { test: 'data' },
      };
      mockJobQueueService.addJob.mockRejectedValue(new Error('Invalid job data'));

      const result = await controller.createJob(createJobDto);

      expect(result).toEqual({
        success: false,
        error: 'Invalid job data',
        status: 400,
      });
    });
  });

  describe('createDelayedJob', () => {
    it('should create a delayed job', async () => {
      const createDelayedJobDto = {
        type: JobType.SCORE_AGENT,
        data: { test: 'data' },
        delayMs: 5000,
      };
      const mockJob = {
        id: 'job1',
        queue: { name: 'delayed' },
      };

      mockJobQueueService.addDelayedJob.mockResolvedValue(mockJob);

      const result = await controller.createDelayedJob(createDelayedJobDto);

      expect(result).toEqual({
        success: true,
        data: {
          id: 'job1',
          type: JobType.SCORE_AGENT,
          delayMs: 5000,
          scheduledAt: expect.any(Date),
          queue: 'delayed',
        },
        status: 201,
      });
    });
  });

  describe('createRecurringJob', () => {
    it('should create a recurring job', async () => {
      const createRecurringJobDto = {
        type: JobType.REPORT_METRICS,
        data: { test: 'data' },
        cronExpression: '0 * * * *',
      };
      const mockJob = {
        id: 'job1',
        queue: { name: 'low-priority' },
        opts: { repeat: { cron: '0 * * * *' } },
      };

      mockJobQueueService.addRecurringJob.mockResolvedValue(mockJob);

      const result = await controller.createRecurringJob(createRecurringJobDto);

      expect(result).toEqual({
        success: true,
        data: {
          id: 'job1',
          type: JobType.REPORT_METRICS,
          cronExpression: '0 * * * *',
          queue: 'low-priority',
          nextRun: 'Next run based on cron: 0 * * * *',
        },
        status: 201,
      });
    });
  });

  describe('createJobWithDependencies', () => {
    it('should create a job with dependencies', async () => {
      const createJobWithDependenciesDto = {
        type: JobType.SUBMIT_BLOCKCHAIN,
        data: { test: 'data' },
        dependencies: ['job1', 'job2'],
      };
      const mockJob = {
        id: 'job3',
        queue: { name: 'normal-priority' },
      };

      mockJobQueueService.addJobWithDependencies.mockResolvedValue(mockJob);

      const result = await controller.createJobWithDependencies(createJobWithDependenciesDto);

      expect(result).toEqual({
        success: true,
        data: {
          id: 'job3',
          type: JobType.SUBMIT_BLOCKCHAIN,
          dependencies: ['job1', 'job2'],
          queue: 'normal-priority',
          status: 'waiting_for_dependencies',
        },
        status: 201,
      });
    });
  });

  describe('retryJob', () => {
    it('should retry a failed job', async () => {
      mockJobQueueService.retryJob.mockResolvedValue(true);

      const result = await controller.retryJob('job1');

      expect(result).toEqual({
        success: true,
        message: 'Job job1 retried successfully',
      });
      expect(mockJobQueueService.retryJob).toHaveBeenCalledWith('job1');
    });

    it('should handle retry errors', async () => {
      mockJobQueueService.retryJob.mockRejectedValue(new Error('Job not found'));

      const result = await controller.retryJob('non-existent');

      expect(result).toEqual({
        success: false,
        error: 'Job not found',
        status: 404,
      });
    });
  });

  describe('cancelJob', () => {
    it('should cancel a job', async () => {
      mockJobQueueService.cancelJob.mockResolvedValue(true);

      const result = await controller.cancelJob('job1');

      expect(result).toEqual({
        success: true,
        message: 'Job job1 cancelled successfully',
      });
      expect(mockJobQueueService.cancelJob).toHaveBeenCalledWith('job1');
    });

    it('should handle cancel errors', async () => {
      mockJobQueueService.cancelJob.mockRejectedValue(new Error('Job not found'));

      const result = await controller.cancelJob('non-existent');

      expect(result).toEqual({
        success: false,
        error: 'Job not found',
        status: 404,
      });
    });
  });

  describe('getDeadLetterJobs', () => {
    it('should return dead letter jobs', async () => {
      const mockDeadJobs = [
        {
          id: 'dead-job-1',
          type: JobType.SCORE_AGENT,
          data: { test: 'data' },
          error: 'Test error',
          failedAt: new Date(),
          attempts: 3,
          originalQueue: 'high-priority',
        },
      ];
      mockJobQueueService.getDeadLetterJobs.mockResolvedValue(mockDeadJobs);

      const result = await controller.getDeadLetterJobs();

      expect(result).toEqual({
        success: true,
        data: mockDeadJobs,
        count: 1,
      });
    });
  });

  describe('retryDeadLetterJob', () => {
    it('should retry a dead letter job', async () => {
      mockJobQueueService.retryDeadLetterJob.mockResolvedValue(true);

      const result = await controller.retryDeadLetterJob('dead-job-1');

      expect(result).toEqual({
        success: true,
        message: 'Dead letter job dead-job-1 retried successfully',
      });
      expect(mockJobQueueService.retryDeadLetterJob).toHaveBeenCalledWith('dead-job-1');
    });
  });

  describe('getJobMetrics', () => {
    it('should return job metrics', async () => {
      const mockMetrics = {
        id: 'job1',
        type: JobType.SCORE_AGENT,
        status: JobStatus.COMPLETED,
        priority: JobPriority.HIGH,
        progress: 100,
        data: { test: 'data' },
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 3,
        processingTime: 2000,
      };
      mockJobQueueService.getJobMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getJobMetrics('job1');

      expect(result).toEqual({
        success: true,
        data: mockMetrics,
      });
    });

    it('should return 404 for non-existent job metrics', async () => {
      mockJobQueueService.getJobMetrics.mockResolvedValue(null);

      const result = await controller.getJobMetrics('non-existent');

      expect(result).toEqual({
        success: false,
        error: 'Job metrics not found',
        status: 404,
      });
    });
  });
});
