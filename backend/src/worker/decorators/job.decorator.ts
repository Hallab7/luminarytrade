import { SetMetadata } from '@nestjs/common';
import { JobType, JobPriority, JobDefinition } from '../job-types';

export const JOB_METADATA_KEY = 'job_metadata';

export interface JobMetadata {
  type: JobType;
  priority?: JobPriority;
  queue?: string;
  concurrency?: number;
  timeout?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  description?: string;
}

export function Job(metadata: JobMetadata) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    SetMetadata(JOB_METADATA_KEY, {
      ...metadata,
      methodName: propertyKey,
      className: target.constructor.name,
    })(target, propertyKey, descriptor);
  };
}

export interface JobLifecycleHooks {
  onQueued?(job: any): Promise<void> | void;
  onProgress?(job: any, progress: number): Promise<void> | void;
  onCompleted?(job: any, result: any): Promise<void> | void;
  onFailed?(job: any, error: Error): Promise<void> | void;
  onStalled?(job: any): Promise<void> | void;
  onActive?(job: any): Promise<void> | void;
}

export function JobProcessor(options: {
  queueName: string;
  concurrency?: number;
  maxAttempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
}) {
  return function <T extends { new(...args: any[]): {} }>(constructor: T) {
    return class extends constructor implements JobLifecycleHooks {
      private _queueName = options.queueName;
      private _concurrency = options.concurrency || 1;
      private _maxAttempts = options.maxAttempts || 3;
      private _backoff = options.backoff || { type: 'exponential', delay: 1000 };

      get queueName(): string {
        return this._queueName;
      }

      get concurrency(): number {
        return this._concurrency;
      }

      get maxAttempts(): number {
        return this._maxAttempts;
      }

      get backoff(): { type: 'fixed' | 'exponential'; delay: number } {
        return this._backoff;
      }

      // Default lifecycle hooks (can be overridden by implementing classes)
      async onQueued(job: any): Promise<void> {
        // Default implementation
      }

      async onProgress(job: any, progress: number): Promise<void> {
        // Default implementation
      }

      async onCompleted(job: any, result: any): Promise<void> {
        // Default implementation
      }

      async onFailed(job: any, error: Error): Promise<void> {
        // Default implementation
      }

      async onStalled(job: any): Promise<void> {
        // Default implementation
      }

      async onActive(job: any): Promise<void> {
        // Default implementation
      }
    };
  };
}

export function JobHandler(options: {
  type: JobType;
  priority?: JobPriority;
  timeout?: number;
  dependencies?: string[];
}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const job = args[0];
      
      // Set job metadata
      job.data.jobType = options.type;
      job.data.priority = options.priority || JobPriority.NORMAL;
      job.data.dependencies = options.dependencies || [];
      
      // Set timeout if specified
      if (options.timeout) {
        job.opts.timeout = options.timeout;
      }

      try {
        // Call onActive hook
        if (this.onActive) {
          await this.onActive(job);
        }

        // Execute the original method
        const result = await originalMethod.apply(this, args);

        // Call onCompleted hook
        if (this.onCompleted) {
          await this.onCompleted(job, result);
        }

        return result;
      } catch (error) {
        // Call onFailed hook
        if (this.onFailed) {
          await this.onFailed(job, error);
        }
        throw error;
      }
    };

    // Store metadata for reflection
    SetMetadata('job_handler', {
      type: options.type,
      priority: options.priority,
      timeout: options.timeout,
      dependencies: options.dependencies,
      methodName: propertyKey,
    })(target, propertyKey, descriptor);

    return descriptor;
  };
}
