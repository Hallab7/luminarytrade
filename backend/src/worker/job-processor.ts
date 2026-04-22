import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { 
  JobType, 
  JobData, 
  JobResult, 
  JobPriority
} from './job-types';
import { 
  JobLifecycleHooks,
  JobProcessor as JobProcessorDecorator,
  JobHandler
} from './decorators/job.decorator';
import { JobQueueService } from './job-queue.service';

@Injectable()
@JobProcessorDecorator({
  queueName: 'high-priority',
  concurrency: 5,
  maxAttempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
})
export class ScoreAgentProcessor extends WorkerHost implements JobLifecycleHooks {
  private readonly logger = new Logger(ScoreAgentProcessor.name);

  constructor(private readonly jobQueueService: JobQueueService) {
    super();
  }

  @JobHandler({
    type: JobType.SCORE_AGENT,
    priority: JobPriority.HIGH,
    timeout: 30000,
  })
  async process(job: Job<JobData>): Promise<JobResult> {
    this.logger.log(`Processing ScoreAgent job ${job.id}`);
    
    const { loanApplication, applicantData } = job.data;
    
    try {
      // Update progress
      await job.updateProgress(10);
      await this.onProgress(job, 10);
      
      // Simulate credit scoring logic
      await new Promise(resolve => setTimeout(resolve, 2000));
      await job.updateProgress(50);
      await this.onProgress(job, 50);
      
      // Calculate credit score (simplified)
      const creditScore = this.calculateCreditScore(applicantData);
      await job.updateProgress(90);
      await this.onProgress(job, 90);
      
      const result: JobResult = {
        success: true,
        data: {
          creditScore,
          riskLevel: this.getRiskLevel(creditScore),
          approved: creditScore > 650,
          loanApplication,
        },
        timestamp: Date.now(),
        processingTime: Date.now() - job.data.createdAt,
      };
      
      await job.updateProgress(100);
      await this.onProgress(job, 100);
      
      this.logger.log(`ScoreAgent job ${job.id} completed with score: ${creditScore}`);
      return result;
      
    } catch (error) {
      this.logger.error(`ScoreAgent job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  async onQueued(job: Job): Promise<void> {
    this.logger.log(`ScoreAgent job ${job.id} queued for processing`);
  }

  async onActive(job: Job): Promise<void> {
    this.logger.log(`ScoreAgent job ${job.id} started processing`);
    job.data.startedAt = Date.now();
  }

  async onProgress(job: Job, progress: number): Promise<void> {
    this.logger.log(`ScoreAgent job ${job.id} progress: ${progress}%`);
  }

  async onCompleted(job: Job, result: JobResult): Promise<void> {
    this.logger.log(`ScoreAgent job ${job.id} completed successfully`);
  }

  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`ScoreAgent job ${job.id} failed: ${error.message}`);
  }

  async onStalled(job: Job): Promise<void> {
    this.logger.warn(`ScoreAgent job ${job.id} stalled`);
  }

  private calculateCreditScore(applicantData: any): number {
    // Simplified credit scoring algorithm
    let score = 600; // Base score
    
    if (applicantData.income > 50000) score += 50;
    if (applicantData.creditHistory > 5) score += 30;
    if (applicantData.debtToIncome < 0.3) score += 40;
    if (applicantData.hasLatePayments) score -= 50;
    
    return Math.min(850, Math.max(300, score));
  }

  private getRiskLevel(score: number): string {
    if (score >= 750) return 'LOW';
    if (score >= 650) return 'MEDIUM';
    return 'HIGH';
  }
}

@Injectable()
@JobProcessorDecorator({
  queueName: 'high-priority',
  concurrency: 10,
  maxAttempts: 3,
  backoff: { type: 'exponential', delay: 500 },
})
export class DetectFraudProcessor extends WorkerHost implements JobLifecycleHooks {
  private readonly logger = new Logger(DetectFraudProcessor.name);

  constructor(private readonly jobQueueService: JobQueueService) {
    super();
  }

  @JobHandler({
    type: JobType.DETECT_FRAUD,
    priority: JobPriority.HIGH,
    timeout: 15000,
  })
  async process(job: Job<JobData>): Promise<JobResult> {
    this.logger.log(`Processing DetectFraud job ${job.id}`);
    
    const { transaction, userProfile } = job.data;
    
    try {
      await job.updateProgress(20);
      await this.onProgress(job, 20);
      
      // Simulate fraud detection
      await new Promise(resolve => setTimeout(resolve, 1000));
      await job.updateProgress(60);
      await this.onProgress(job, 60);
      
      const fraudSignals = this.analyzeFraudSignals(transaction, userProfile);
      const riskScore = this.calculateFraudRisk(fraudSignals);
      
      await job.updateProgress(90);
      await this.onProgress(job, 90);
      
      const result: JobResult = {
        success: true,
        data: {
          isFraudulent: riskScore > 0.7,
          riskScore,
          signals: fraudSignals,
          action: riskScore > 0.7 ? 'BLOCK' : 'ALLOW',
          transaction,
        },
        timestamp: Date.now(),
        processingTime: Date.now() - job.data.createdAt,
      };
      
      await job.updateProgress(100);
      await this.onProgress(job, 100);
      
      this.logger.log(`DetectFraud job ${job.id} completed with risk score: ${riskScore}`);
      return result;
      
    } catch (error) {
      this.logger.error(`DetectFraud job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  async onQueued(job: Job): Promise<void> {
    this.logger.log(`DetectFraud job ${job.id} queued for processing`);
  }

  async onActive(job: Job): Promise<void> {
    this.logger.log(`DetectFraud job ${job.id} started processing`);
  }

  async onProgress(job: Job, progress: number): Promise<void> {
    this.logger.log(`DetectFraud job ${job.id} progress: ${progress}%`);
  }

  async onCompleted(job: Job, result: JobResult): Promise<void> {
    this.logger.log(`DetectFraud job ${job.id} completed successfully`);
  }

  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`DetectFraud job ${job.id} failed: ${error.message}`);
  }

  async onStalled(job: Job): Promise<void> {
    this.logger.warn(`DetectFraud job ${job.id} stalled`);
  }

  private analyzeFraudSignals(transaction: any, userProfile: any): string[] {
    const signals: string[] = [];
    
    if (transaction.amount > userProfile.avgTransactionAmount * 5) {
      signals.push('UNUSUAL_AMOUNT');
    }
    
    if (transaction.location !== userProfile.recentLocation) {
      signals.push('UNUSUAL_LOCATION');
    }
    
    if (transaction.time > userProfile.usualTransactionTime + 3600000) {
      signals.push('UNUSUAL_TIME');
    }
    
    return signals;
  }

  private calculateFraudRisk(signals: string[]): number {
    const riskBySignal = {
      'UNUSUAL_AMOUNT': 0.3,
      'UNUSUAL_LOCATION': 0.4,
      'UNUSUAL_TIME': 0.2,
    };
    
    return signals.reduce((risk, signal) => risk + (riskBySignal[signal] || 0), 0);
  }
}

@Injectable()
@JobProcessorDecorator({
  queueName: 'normal-priority',
  concurrency: 2,
  maxAttempts: 5,
  backoff: { type: 'fixed', delay: 5000 },
})
export class UpdateOracleProcessor extends WorkerHost implements JobLifecycleHooks {
  private readonly logger = new Logger(UpdateOracleProcessor.name);

  constructor(private readonly jobQueueService: JobQueueService) {
    super();
  }

  @JobHandler({
    type: JobType.UPDATE_ORACLE,
    priority: JobPriority.NORMAL,
    timeout: 60000,
  })
  async process(job: Job<JobData>): Promise<JobResult> {
    this.logger.log(`Processing UpdateOracle job ${job.id}`);
    
    const { oracleType, dataSource } = job.data;
    
    try {
      await job.updateProgress(25);
      await this.onProgress(job, 25);
      
      // Simulate oracle data fetching
      await new Promise(resolve => setTimeout(resolve, 3000));
      await job.updateProgress(75);
      await this.onProgress(job, 75);
      
      const oracleData = await this.fetchOracleData(oracleType, dataSource);
      
      const result: JobResult = {
        success: true,
        data: {
          oracleType,
          data: oracleData,
          updatedAt: Date.now(),
          dataSource,
        },
        timestamp: Date.now(),
        processingTime: Date.now() - job.data.createdAt,
      };
      
      await job.updateProgress(100);
      await this.onProgress(job, 100);
      
      this.logger.log(`UpdateOracle job ${job.id} completed for ${oracleType}`);
      return result;
      
    } catch (error) {
      this.logger.error(`UpdateOracle job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  async onQueued(job: Job): Promise<void> {
    this.logger.log(`UpdateOracle job ${job.id} queued for processing`);
  }

  async onActive(job: Job): Promise<void> {
    this.logger.log(`UpdateOracle job ${job.id} started processing`);
  }

  async onProgress(job: Job, progress: number): Promise<void> {
    this.logger.log(`UpdateOracle job ${job.id} progress: ${progress}%`);
  }

  async onCompleted(job: Job, result: JobResult): Promise<void> {
    this.logger.log(`UpdateOracle job ${job.id} completed successfully`);
  }

  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`UpdateOracle job ${job.id} failed: ${error.message}`);
  }

  async onStalled(job: Job): Promise<void> {
    this.logger.warn(`UpdateOracle job ${job.id} stalled`);
  }

  private async fetchOracleData(oracleType: string, dataSource: string): Promise<any> {
    // Simulate oracle data fetching
    return {
      price: Math.random() * 1000,
      timestamp: Date.now(),
      source: dataSource,
      confidence: Math.random(),
    };
  }
}

@Injectable()
@JobProcessorDecorator({
  queueName: 'normal-priority',
  concurrency: 3,
  maxAttempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
})
export class SubmitBlockchainProcessor extends WorkerHost implements JobLifecycleHooks {
  private readonly logger = new Logger(SubmitBlockchainProcessor.name);

  constructor(private readonly jobQueueService: JobQueueService) {
    super();
  }

  @JobHandler({
    type: JobType.SUBMIT_BLOCKCHAIN,
    priority: JobPriority.NORMAL,
    timeout: 45000,
  })
  async process(job: Job<JobData>): Promise<JobResult> {
    this.logger.log(`Processing SubmitBlockchain job ${job.id}`);
    
    const { transaction, network } = job.data;
    
    try {
      await job.updateProgress(30);
      await this.onProgress(job, 30);
      
      // Simulate blockchain submission
      await new Promise(resolve => setTimeout(resolve, 4000));
      await job.updateProgress(80);
      await this.onProgress(job, 80);
      
      const txHash = await this.submitTransaction(transaction, network);
      
      const result: JobResult = {
        success: true,
        data: {
          transactionHash: txHash,
          network,
          status: 'CONFIRMED',
          blockNumber: Math.floor(Math.random() * 1000000),
          gasUsed: Math.floor(Math.random() * 100000),
        },
        timestamp: Date.now(),
        processingTime: Date.now() - job.data.createdAt,
      };
      
      await job.updateProgress(100);
      await this.onProgress(job, 100);
      
      this.logger.log(`SubmitBlockchain job ${job.id} completed with hash: ${txHash}`);
      return result;
      
    } catch (error) {
      this.logger.error(`SubmitBlockchain job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  async onQueued(job: Job): Promise<void> {
    this.logger.log(`SubmitBlockchain job ${job.id} queued for processing`);
  }

  async onActive(job: Job): Promise<void> {
    this.logger.log(`SubmitBlockchain job ${job.id} started processing`);
  }

  async onProgress(job: Job, progress: number): Promise<void> {
    this.logger.log(`SubmitBlockchain job ${job.id} progress: ${progress}%`);
  }

  async onCompleted(job: Job, result: JobResult): Promise<void> {
    this.logger.log(`SubmitBlockchain job ${job.id} completed successfully`);
  }

  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`SubmitBlockchain job ${job.id} failed: ${error.message}`);
  }

  async onStalled(job: Job): Promise<void> {
    this.logger.warn(`SubmitBlockchain job ${job.id} stalled`);
  }

  private async submitTransaction(transaction: any, network: string): Promise<string> {
    // Simulate blockchain submission
    return `0x${Math.random().toString(16).substr(2, 64)}`;
  }
}

@Injectable()
@JobProcessorDecorator({
  queueName: 'low-priority',
  concurrency: 1,
  maxAttempts: 2,
  backoff: { type: 'fixed', delay: 10000 },
})
export class ReportMetricsProcessor extends WorkerHost implements JobLifecycleHooks {
  private readonly logger = new Logger(ReportMetricsProcessor.name);

  constructor(private readonly jobQueueService: JobQueueService) {
    super();
  }

  @JobHandler({
    type: JobType.REPORT_METRICS,
    priority: JobPriority.LOW,
    timeout: 120000,
  })
  async process(job: Job<JobData>): Promise<JobResult> {
    this.logger.log(`Processing ReportMetrics job ${job.id}`);
    
    const { reportType, timeRange } = job.data;
    
    try {
      await job.updateProgress(15);
      await this.onProgress(job, 15);
      
      // Simulate report generation
      await new Promise(resolve => setTimeout(resolve, 8000));
      await job.updateProgress(70);
      await this.onProgress(job, 70);
      
      const reportData = await this.generateReport(reportType, timeRange);
      
      const result: JobResult = {
        success: true,
        data: {
          reportType,
          timeRange,
          reportData,
          generatedAt: Date.now(),
          format: 'JSON',
        },
        timestamp: Date.now(),
        processingTime: Date.now() - job.data.createdAt,
      };
      
      await job.updateProgress(100);
      await this.onProgress(job, 100);
      
      this.logger.log(`ReportMetrics job ${job.id} completed for ${reportType}`);
      return result;
      
    } catch (error) {
      this.logger.error(`ReportMetrics job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  async onQueued(job: Job): Promise<void> {
    this.logger.log(`ReportMetrics job ${job.id} queued for processing`);
  }

  async onActive(job: Job): Promise<void> {
    this.logger.log(`ReportMetrics job ${job.id} started processing`);
  }

  async onProgress(job: Job, progress: number): Promise<void> {
    this.logger.log(`ReportMetrics job ${job.id} progress: ${progress}%`);
  }

  async onCompleted(job: Job, result: JobResult): Promise<void> {
    this.logger.log(`ReportMetrics job ${job.id} completed successfully`);
  }

  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`ReportMetrics job ${job.id} failed: ${error.message}`);
  }

  async onStalled(job: Job): Promise<void> {
    this.logger.warn(`ReportMetrics job ${job.id} stalled`);
  }

  private async generateReport(reportType: string, timeRange: string): Promise<any> {
    // Simulate report generation
    return {
      summary: {
        totalJobs: Math.floor(Math.random() * 1000),
        successRate: Math.random() * 100,
        avgProcessingTime: Math.random() * 5000,
      },
      details: {
        byType: {
          [JobType.SCORE_AGENT]: Math.floor(Math.random() * 100),
          [JobType.DETECT_FRAUD]: Math.floor(Math.random() * 100),
          [JobType.UPDATE_ORACLE]: Math.floor(Math.random() * 100),
          [JobType.SUBMIT_BLOCKCHAIN]: Math.floor(Math.random() * 100),
          [JobType.REPORT_METRICS]: Math.floor(Math.random() * 100),
        },
        byPriority: {
          [JobPriority.HIGH]: Math.floor(Math.random() * 100),
          [JobPriority.NORMAL]: Math.floor(Math.random() * 100),
          [JobPriority.LOW]: Math.floor(Math.random() * 100),
        },
      },
      timeRange,
      generatedAt: Date.now(),
    };
  }
}
