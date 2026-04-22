import { 
  Controller, 
  Get, 
  Post, 
  Delete, 
  Query, 
  Param, 
  Body, 
  HttpStatus,
  HttpCode,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { 
  JobType, 
  JobStatus, 
  JobPriority, 
  JobData, 
  JobOptions,
  JobMetrics,
  QueueMetrics,
  DeadLetterJob 
} from './job-types';
import { JobQueueService } from './job-queue.service';

@ApiTags('jobs')
@Controller('jobs')
export class JobController {
  constructor(private readonly jobQueueService: JobQueueService) {}

  @Get()
  @ApiOperation({ summary: 'List jobs with optional filtering' })
  @ApiQuery({ name: 'status', required: false, enum: JobStatus })
  @ApiQuery({ name: 'type', required: false, enum: JobType })
  @ApiQuery({ name: 'queue', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Jobs retrieved successfully' })
  async getJobs(
    @Query('status') status?: JobStatus,
    @Query('type') type?: JobType,
    @Query('queue') queueName?: string,
  ) {
    try {
      if (status && type) {
        const jobs = await this.jobQueueService.getJobsByStatus(status, type);
        return {
          success: true,
          data: jobs,
          count: jobs.length,
          filters: { status, type },
        };
      }

      if (queueName) {
        const metrics = await this.jobQueueService.getQueueMetrics(queueName);
        return {
          success: true,
          data: metrics,
          queue: queueName,
        };
      }

      const metrics = await this.jobQueueService.getQueueMetrics();
      return {
        success: true,
        data: metrics,
        totalQueues: metrics.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get queue metrics' })
  @ApiQuery({ name: 'queue', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Queue metrics retrieved successfully' })
  async getQueueMetrics(@Query('queue') queueName?: string) {
    try {
      const metrics = await this.jobQueueService.getQueueMetrics(queueName);
      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get job details by ID' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'Job details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJob(@Param('id') jobId: string) {
    try {
      const job = await this.jobQueueService.getJob(jobId);
      if (!job) {
        return {
          success: false,
          error: 'Job not found',
          status: HttpStatus.NOT_FOUND,
        };
      }

      const metrics = await this.jobQueueService.getJobMetrics(jobId);
      const state = await job.getState();

      return {
        success: true,
        data: {
          id: job.id,
          name: job.name,
          data: job.data,
          opts: job.opts,
          progress: job.progress,
          state,
          metrics,
          createdAt: new Date(job.timestamp),
          processedOn: job.processedOn ? new Date(job.processedOn) : null,
          finishedOn: job.finishedOn ? new Date(job.finishedOn) : null,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new job' })
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiResponse({ status: 201, description: 'Job created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid job data' })
  async createJob(@Body() createJobDto: CreateJobDto) {
    try {
      const job = await this.jobQueueService.addJob(
        createJobDto.type,
        createJobDto.data,
        createJobDto.options
      );

      return {
        success: true,
        data: {
          id: job.id,
          type: createJobDto.type,
          priority: createJobDto.options?.priority,
          queue: job.queue.name,
          createdAt: new Date(job.timestamp),
          estimatedStart: createJobDto.options?.delay 
            ? new Date(Date.now() + createJobDto.options.delay)
            : new Date(),
        },
        status: HttpStatus.CREATED,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.BAD_REQUEST,
      };
    }
  }

  @Post('delayed')
  @ApiOperation({ summary: 'Create a delayed job' })
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiResponse({ status: 201, description: 'Delayed job created successfully' })
  async createDelayedJob(@Body() createDelayedJobDto: CreateDelayedJobDto) {
    try {
      const job = await this.jobQueueService.addDelayedJob(
        createDelayedJobDto.type,
        createDelayedJobDto.data,
        createDelayedJobDto.delayMs,
        createDelayedJobDto.options
      );

      return {
        success: true,
        data: {
          id: job.id,
          type: createDelayedJobDto.type,
          delayMs: createDelayedJobDto.delayMs,
          scheduledAt: new Date(Date.now() + createDelayedJobDto.delayMs),
          queue: job.queue.name,
        },
        status: HttpStatus.CREATED,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.BAD_REQUEST,
      };
    }
  }

  @Post('recurring')
  @ApiOperation({ summary: 'Create a recurring job' })
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiResponse({ status: 201, description: 'Recurring job created successfully' })
  async createRecurringJob(@Body() createRecurringJobDto: CreateRecurringJobDto) {
    try {
      const job = await this.jobQueueService.addRecurringJob(
        createRecurringJobDto.type,
        createRecurringJobDto.data,
        createRecurringJobDto.cronExpression,
        createRecurringJobDto.options
      );

      return {
        success: true,
        data: {
          id: job.id,
          type: createRecurringJobDto.type,
          cronExpression: createRecurringJobDto.cronExpression,
          queue: job.queue.name,
          nextRun: job.opts.repeat?.cron 
            ? `Next run based on cron: ${createRecurringJobDto.cronExpression}`
            : 'Not scheduled',
        },
        status: HttpStatus.CREATED,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.BAD_REQUEST,
      };
    }
  }

  @Post('dependencies')
  @ApiOperation({ summary: 'Create a job with dependencies' })
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiResponse({ status: 201, description: 'Job with dependencies created successfully' })
  async createJobWithDependencies(@Body() createJobWithDependenciesDto: CreateJobWithDependenciesDto) {
    try {
      const job = await this.jobQueueService.addJobWithDependencies(
        createJobWithDependenciesDto.type,
        createJobWithDependenciesDto.data,
        createJobWithDependenciesDto.dependencies,
        createJobWithDependenciesDto.options
      );

      return {
        success: true,
        data: {
          id: job.id,
          type: createJobWithDependenciesDto.type,
          dependencies: createJobWithDependenciesDto.dependencies,
          queue: job.queue.name,
          status: 'waiting_for_dependencies',
        },
        status: HttpStatus.CREATED,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.BAD_REQUEST,
      };
    }
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed job' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'Job retried successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 400, description: 'Job cannot be retried' })
  @HttpCode(HttpStatus.OK)
  async retryJob(@Param('id') jobId: string) {
    try {
      await this.jobQueueService.retryJob(jobId);
      return {
        success: true,
        message: `Job ${jobId} retried successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.message.includes('not found') ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST,
      };
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a queued job' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'Job cancelled successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 400, description: 'Job cannot be cancelled' })
  @HttpCode(HttpStatus.OK)
  async cancelJob(@Param('id') jobId: string) {
    try {
      await this.jobQueueService.cancelJob(jobId);
      return {
        success: true,
        message: `Job ${jobId} cancelled successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.message.includes('not found') ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST,
      };
    }
  }

  @Get('dead-letter')
  @ApiOperation({ summary: 'Get dead letter jobs' })
  @ApiResponse({ status: 200, description: 'Dead letter jobs retrieved successfully' })
  async getDeadLetterJobs() {
    try {
      const jobs = await this.jobQueueService.getDeadLetterJobs();
      return {
        success: true,
        data: jobs,
        count: jobs.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }

  @Post('dead-letter/:id/retry')
  @ApiOperation({ summary: 'Retry a dead letter job' })
  @ApiParam({ name: 'id', description: 'Dead letter job ID' })
  @ApiResponse({ status: 200, description: 'Dead letter job retried successfully' })
  @ApiResponse({ status: 404, description: 'Dead letter job not found' })
  @HttpCode(HttpStatus.OK)
  async retryDeadLetterJob(@Param('id') jobId: string) {
    try {
      await this.jobQueueService.retryDeadLetterJob(jobId);
      return {
        success: true,
        message: `Dead letter job ${jobId} retried successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.message.includes('not found') ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST,
      };
    }
  }

  @Get(':id/metrics')
  @ApiOperation({ summary: 'Get job metrics' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'Job metrics retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobMetrics(@Param('id') jobId: string) {
    try {
      const metrics = await this.jobQueueService.getJobMetrics(jobId);
      if (!metrics) {
        return {
          success: false,
          error: 'Job metrics not found',
          status: HttpStatus.NOT_FOUND,
        };
      }

      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }
}

// DTOs for API endpoints
export class CreateJobDto {
  type: JobType;
  data: JobData;
  options?: JobOptions;
}

export class CreateDelayedJobDto {
  type: JobType;
  data: JobData;
  delayMs: number;
  options?: JobOptions;
}

export class CreateRecurringJobDto {
  type: JobType;
  data: JobData;
  cronExpression: string;
  options?: JobOptions;
}

export class CreateJobWithDependenciesDto {
  type: JobType;
  data: JobData;
  dependencies: string[];
  options?: JobOptions;
}
