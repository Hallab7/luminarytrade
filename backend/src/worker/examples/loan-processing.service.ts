import { Injectable } from '@nestjs/common';
import { 
  JobQueueService, 
  JobType, 
  JobPriority, 
  JobStatus 
} from '../job-types';
import { Job } from 'bullmq';

/**
 * Example service demonstrating real-world usage of the Worker Pool system
 * for a loan processing platform
 */
@Injectable()
export class LoanProcessingService {
  constructor(private jobQueue: JobQueueService) {}

  /**
   * Example 1: Process a complete loan application with multiple jobs
   */
  async processLoanApplication(loanApplication: any) {
    console.log(`Starting loan application processing for: ${loanApplication.id}`);

    try {
      // Step 1: High priority credit scoring
      const scoringJob = await this.jobQueue.addJob(
        JobType.SCORE_AGENT,
        {
          loanApplicationId: loanApplication.id,
          applicantData: {
            income: loanApplication.applicant.income,
            creditHistory: loanApplication.applicant.creditHistory,
            debtToIncome: loanApplication.applicant.debtToIncome,
            employmentStatus: loanApplication.applicant.employmentStatus
          }
        },
        {
          priority: JobPriority.HIGH,
          attempts: 3,
          timeout: 30000
        }
      );

      // Step 2: High priority fraud detection (runs in parallel with scoring)
      const fraudJob = await this.jobQueue.addJob(
        JobType.DETECT_FRAUD,
        {
          transactionId: loanApplication.transactionId,
          userProfile: {
            recentLocation: loanApplication.applicant.location,
            avgTransactionAmount: loanApplication.applicant.avgTransaction,
            usualTransactionTime: loanApplication.applicant.usualTime
          },
          transaction: {
            amount: loanApplication.amount,
            location: loanApplication.location,
            time: Date.now()
          }
        },
        {
          priority: JobPriority.HIGH,
          attempts: 3,
          timeout: 15000
        }
      );

      // Step 3: Oracle data update (normal priority)
      const oracleJob = await this.jobQueue.addJob(
        JobType.UPDATE_ORACLE,
        {
          oracleType: 'credit-score-benchmark',
          dataSource: 'experian-api',
          loanApplicationId: loanApplication.id
        },
        {
          priority: JobPriority.NORMAL,
          attempts: 5,
          timeout: 60000
        }
      );

      return {
        applicationId: loanApplication.id,
        jobs: {
          scoring: scoringJob.id,
          fraud: fraudJob.id,
          oracle: oracleJob.id
        },
        status: 'processing'
      };

    } catch (error) {
      console.error(`Failed to start loan processing: ${error.message}`);
      throw error;
    }
  }

  /**
   * Example 2: Submit approved loan to blockchain with dependencies
   */
  async submitApprovedLoan(loanApplicationId: string, scoringJobId: string) {
    console.log(`Submitting approved loan ${loanApplicationId} to blockchain`);

    // Wait for credit scoring to complete before blockchain submission
    const blockchainJob = await this.jobQueue.addJobWithDependencies(
      JobType.SUBMIT_BLOCKCHAIN,
      {
        loanApplicationId,
        transaction: {
          amount: 10000, // Example amount
          currency: 'USD',
          recipient: loanApplicationId,
          network: 'stellar'
        },
        network: 'stellar-testnet'
      },
      [scoringJobId], // Dependency: wait for scoring job
      {
        priority: JobPriority.NORMAL,
        attempts: 5,
        timeout: 45000,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    );

    return {
      blockchainJobId: blockchainJob.id,
      status: 'submitted_to_blockchain'
    };
  }

  /**
   * Example 3: Schedule periodic compliance reports
   */
  async scheduleComplianceReports() {
    console.log('Scheduling compliance reports');

    // Daily compliance report at 2 AM
    const dailyReport = await this.jobQueue.addRecurringJob(
      JobType.REPORT_METRICS,
      {
        reportType: 'compliance-daily',
        timeRange: '24h',
        includeMetrics: ['loan_volume', 'fraud_cases', 'approval_rates'],
        format: 'pdf'
      },
      '0 2 * * *', // Cron: 2:00 AM daily
      {
        priority: JobPriority.LOW,
        attempts: 2,
        timeout: 120000
      }
    );

    // Weekly compliance report every Sunday at 1 AM
    const weeklyReport = await this.jobQueue.addRecurringJob(
      JobType.REPORT_METRICS,
      {
        reportType: 'compliance-weekly',
        timeRange: '7d',
        includeMetrics: ['risk_assessment', 'portfolio_performance'],
        format: 'excel'
      },
      '0 1 * * 0', // Cron: 1:00 AM every Sunday
      {
        priority: JobPriority.LOW,
        attempts: 2,
        timeout: 300000
      }
    );

    return {
      dailyReportId: dailyReport.id,
      weeklyReportId: weeklyReport.id,
      status: 'scheduled'
    };
  }

  /**
   * Example 4: Handle failed jobs and implement retry logic
   */
  async handleFailedJobs() {
    console.log('Checking for failed jobs...');

    // Get all failed jobs
    const failedJobs = await this.jobQueue.getJobsByStatus(JobStatus.FAILED);
    
    const retryResults = [];
    
    for (const job of failedJobs) {
      try {
        // Check if job should be retried based on type and error
        if (await this.shouldRetryJob(job)) {
          await this.jobQueue.retryJob(job.id);
          retryResults.push({
            jobId: job.id,
            type: job.data.jobType,
            action: 'retried',
            status: 'success'
          });
        } else {
          retryResults.push({
            jobId: job.id,
            type: job.data.jobType,
            action: 'skipped',
            reason: 'Manual review required'
          });
        }
      } catch (error) {
        retryResults.push({
          jobId: job.id,
          type: job.data.jobType,
          action: 'failed',
          error: error.message
        });
      }
    }

    return retryResults;
  }

  /**
   * Example 5: Monitor system performance and health
   */
  async getSystemHealth() {
    const queueMetrics = await this.jobQueue.getQueueMetrics();
    
    const health = {
      overall: 'healthy',
      queues: {},
      alerts: []
    };

    let totalWaiting = 0;
    let totalFailed = 0;

    for (const metric of queueMetrics) {
      totalWaiting += metric.waiting;
      totalFailed += metric.failed;

      // Check for queue-specific issues
      if (metric.waiting > 100) {
        health.alerts.push({
          queue: metric.queueName,
          severity: 'warning',
          message: `High backlog: ${metric.waiting} jobs waiting`
        });
        health.overall = 'degraded';
      }

      if (metric.failed > 10) {
        health.alerts.push({
          queue: metric.queueName,
          severity: 'error',
          message: `High failure rate: ${metric.failed} failed jobs`
        });
        health.overall = 'unhealthy';
      }

      health.queues[metric.queueName] = {
        waiting: metric.waiting,
        active: metric.active,
        completed: metric.completed,
        failed: metric.failed,
        utilization: ((metric.active / (metric.active + metric.waiting)) * 100).toFixed(1)
      };
    }

    // Overall system health assessment
    if (totalWaiting > 500) {
      health.overall = 'degraded';
    }
    
    if (totalFailed > 50) {
      health.overall = 'unhealthy';
    }

    return health;
  }

  /**
   * Example 6: Batch processing for bulk operations
   */
  async processBulkLoanApplications(applications: any[]) {
    console.log(`Processing ${applications.length} loan applications in bulk`);

    const batchResults = [];
    const batchSize = 10; // Process in batches to avoid overwhelming the system

    for (let i = 0; i < applications.length; i += batchSize) {
      const batch = applications.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (application, index) => {
        try {
          // Add delay between jobs to prevent overwhelming high-priority queue
          const delayMs = index * 100; // 100ms delay between jobs in batch
          
          const job = await this.jobQueue.addDelayedJob(
            JobType.SCORE_AGENT,
            {
              loanApplicationId: application.id,
              applicantData: application.applicant,
              batchId: Math.floor(i / batchSize),
              batchIndex: index
            },
            delayMs,
            {
              priority: JobPriority.HIGH,
              attempts: 3,
              timeout: 30000
            }
          );

          return {
            applicationId: application.id,
            jobId: job.id,
            status: 'queued',
            delay: delayMs
          };
        } catch (error) {
          return {
            applicationId: application.id,
            status: 'failed',
            error: error.message
          };
        }
      });

      const batchResult = await Promise.all(batchPromises);
      batchResults.push(...batchResult);

      // Wait between batches
      if (i + batchSize < applications.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return {
      totalApplications: applications.length,
      processed: batchResults.filter(r => r.status === 'queued').length,
      failed: batchResults.filter(r => r.status === 'failed').length,
      batches: Math.ceil(applications.length / batchSize),
      results: batchResults
    };
  }

  /**
   * Example 7: Real-time job monitoring dashboard
   */
  async getDashboardData() {
    const [queueMetrics, deadLetterJobs] = await Promise.all([
      this.jobQueue.getQueueMetrics(),
      this.jobQueue.getDeadLetterJobs()
    ]);

    // Calculate aggregate metrics
    const totalJobs = queueMetrics.reduce((sum, metric) => sum + metric.total, 0);
    const activeJobs = queueMetrics.reduce((sum, metric) => sum + metric.active, 0);
    const completedJobs = queueMetrics.reduce((sum, metric) => sum + metric.completed, 0);
    const failedJobs = queueMetrics.reduce((sum, metric) => sum + metric.failed, 0);

    // Get recent jobs by status
    const recentJobs = await Promise.all([
      this.jobQueue.getJobsByStatus(JobStatus.ACTIVE),
      this.jobQueue.getJobsByStatus(JobStatus.COMPLETED),
      this.jobQueue.getJobsByStatus(JobStatus.FAILED)
    ]);

    return {
      overview: {
        totalJobs,
        activeJobs,
        completedJobs,
        failedJobs,
        successRate: completedJobs > 0 ? ((completedJobs / (completedJobs + failedJobs)) * 100).toFixed(1) : 0,
        deadLetterCount: deadLetterJobs.length
      },
      queues: queueMetrics.map(metric => ({
        name: metric.queueName,
        waiting: metric.waiting,
        active: metric.active,
        completed: metric.completed,
        failed: metric.failed,
        utilization: ((metric.active / (metric.active + metric.waiting)) * 100).toFixed(1)
      })),
      recentActivity: {
        active: recentJobs[0].slice(0, 5).map(job => ({
          id: job.id,
          type: job.data.jobType,
          progress: job.progress,
          startedAt: new Date(job.timestamp)
        })),
        completed: recentJobs[1].slice(0, 5).map(job => ({
          id: job.id,
          type: job.data.jobType,
          completedAt: new Date(job.finishedOn)
        })),
        failed: recentJobs[2].slice(0, 5).map(job => ({
          id: job.id,
          type: job.data.jobType,
          error: job.failedReason,
          failedAt: new Date(job.finishedOn)
        }))
      },
      deadLetterJobs: deadLetterJobs.slice(0, 10).map(job => ({
        id: job.id,
        type: job.type,
        error: job.error,
        failedAt: job.failedAt,
        attempts: job.attempts
      }))
    };
  }

  /**
   * Helper method to determine if a job should be retried
   */
  private async shouldRetryJob(job: Job): Promise<boolean> {
    const maxRetries = 3;
    const retriableErrors = [
      'Connection timeout',
      'Network error',
      'Service temporarily unavailable'
    ];

    // Don't retry if max attempts exceeded
    if (job.attemptsMade >= maxRetries) {
      return false;
    }

    // Don't retry certain job types that require manual review
    if (job.data.jobType === JobType.DETECT_FRAUD && job.failedReason?.includes('high_risk')) {
      return false;
    }

    // Retry for specific error types
    return retriableErrors.some(error => 
      job.failedReason?.includes(error)
    );
  }
}

/**
 * Example usage in a controller
 */
@Injectable()
export class LoanController {
  constructor(private loanService: LoanProcessingService) {}

  async submitLoanApplication(req: any, res: any) {
    try {
      const result = await this.loanService.processLoanApplication(req.body);
      res.status(202).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSystemHealth(req: any, res: any) {
    try {
      const health = await this.loanService.getSystemHealth();
      res.json(health);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getDashboard(req: any, res: any) {
    try {
      const dashboard = await this.loanService.getDashboardData();
      res.json(dashboard);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}
