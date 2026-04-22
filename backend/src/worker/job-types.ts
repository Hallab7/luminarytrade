export enum JobPriority {
  HIGH = 10,
  NORMAL = 5,
  LOW = 1,
}

export enum JobStatus {
  WAITING = 'waiting',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELAYED = 'delayed',
  PAUSED = 'paused',
}

export enum JobType {
  SCORE_AGENT = 'ScoreAgent',
  DETECT_FRAUD = 'DetectFraud',
  UPDATE_ORACLE = 'UpdateOracle',
  SUBMIT_BLOCKCHAIN = 'SubmitBlockchain',
  REPORT_METRICS = 'ReportMetrics',
}

export interface JobData {
  [key: string]: any;
}

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
  processingTime?: number;
}

export interface JobOptions {
  priority?: JobPriority;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  removeOnComplete?: number;
  removeOnFail?: number;
  jobId?: string;
  repeat?: {
    cron?: string;
    every?: number;
  };
  parent?: {
    id: string;
    queue: string;
  };
  dependencies?: string[];
}

export interface JobDefinition {
  type: JobType;
  priority: JobPriority;
  defaultAttempts: number;
  defaultBackoff: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  concurrency: number;
  timeout: number;
  description: string;
}

export const JOB_DEFINITIONS: Record<JobType, JobDefinition> = {
  [JobType.SCORE_AGENT]: {
    type: JobType.SCORE_AGENT,
    priority: JobPriority.HIGH,
    defaultAttempts: 3,
    defaultBackoff: {
      type: 'exponential',
      delay: 1000,
    },
    concurrency: 5,
    timeout: 30000,
    description: 'Run credit scoring for loan applications',
  },
  [JobType.DETECT_FRAUD]: {
    type: JobType.DETECT_FRAUD,
    priority: JobPriority.HIGH,
    defaultAttempts: 3,
    defaultBackoff: {
      type: 'exponential',
      delay: 500,
    },
    concurrency: 10,
    timeout: 15000,
    description: 'Detect fraud patterns in transactions',
  },
  [JobType.UPDATE_ORACLE]: {
    type: JobType.UPDATE_ORACLE,
    priority: JobPriority.NORMAL,
    defaultAttempts: 5,
    defaultBackoff: {
      type: 'fixed',
      delay: 5000,
    },
    concurrency: 2,
    timeout: 60000,
    description: 'Fetch oracle data from external sources',
  },
  [JobType.SUBMIT_BLOCKCHAIN]: {
    type: JobType.SUBMIT_BLOCKCHAIN,
    priority: JobPriority.NORMAL,
    defaultAttempts: 5,
    defaultBackoff: {
      type: 'exponential',
      delay: 2000,
    },
    concurrency: 3,
    timeout: 45000,
    description: 'Submit transactions to Stellar blockchain',
  },
  [JobType.REPORT_METRICS]: {
    type: JobType.REPORT_METRICS,
    priority: JobPriority.LOW,
    defaultAttempts: 2,
    defaultBackoff: {
      type: 'fixed',
      delay: 10000,
    },
    concurrency: 1,
    timeout: 120000,
    description: 'Generate performance and usage reports',
  },
};

export interface JobMetrics {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: JobPriority;
  progress: number;
  data: JobData;
  result?: JobResult;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  attempts: number;
  maxAttempts: number;
  errorMessage?: string;
  parentJob?: string;
  childJobs?: string[];
  processingTime?: number;
}

export interface QueueMetrics {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
}

export interface DeadLetterJob {
  id: string;
  type: JobType;
  data: JobData;
  error: string;
  failedAt: Date;
  attempts: number;
  originalQueue: string;
}

export interface JobDependency {
  jobId: string;
  dependsOn: string[];
  queue: string;
}
