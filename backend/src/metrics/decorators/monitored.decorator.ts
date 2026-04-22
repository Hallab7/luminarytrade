import { SetMetadata } from '@nestjs/common';
import { PrometheusService, MetricLabels } from '../prometheus.service';

export const MONITORED_METADATA_KEY = 'monitored';

export interface MonitoredOptions {
  name?: string;
  labels?: Record<string, string>;
  trackDuration?: boolean;
  trackErrors?: boolean;
  customMetrics?: boolean;
}

export interface MonitoredMetadata extends MonitoredOptions {
  methodName: string;
  className: string;
}

export function Monitored(options: MonitoredOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    SetMetadata(MONITORED_METADATA_KEY, {
      ...options,
      methodName: propertyKey,
      className: target.constructor.name,
    } as MonitoredMetadata);
  };
}

export class MonitoringDecorator {
  constructor(private prometheusService: PrometheusService) {}

  wrapMethod(
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
    metadata: MonitoredMetadata
  ) {
    const originalMethod = descriptor.value;
    const prometheusService = this.prometheusService;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const labels = {
        ...metadata.labels,
        method: propertyName,
        class: metadata.className,
        service: prometheusService['config']?.labels?.service || 'unknown',
      };

      try {
        // Increment method call counter
        if (prometheusService['methodCallsTotal']) {
          prometheusService['methodCallsTotal'].inc(labels);
        }

        // Execute the original method
        const result = await originalMethod.apply(this, args);

        // Record successful execution
        if (metadata.trackDuration !== false) {
          const duration = (Date.now() - startTime) / 1000;
          if (prometheusService['methodDuration']) {
            prometheusService['methodDuration'].observe(labels, duration);
          }
        }

        if (prometheusService['methodSuccessTotal']) {
          prometheusService['methodSuccessTotal'].inc(labels);
        }

        return result;
      } catch (error) {
        // Record error
        if (metadata.trackErrors !== false) {
          if (prometheusService['methodErrorsTotal']) {
            prometheusService['methodErrorsTotal'].inc({
              ...labels,
              error_type: error.constructor.name,
            });
          }
        }

        // Record duration even for failed calls
        if (metadata.trackDuration !== false) {
          const duration = (Date.now() - startTime) / 1000;
          if (prometheusService['methodDuration']) {
            prometheusService['methodDuration'].observe(labels, duration);
          }
        }

        throw error;
      }
    };

    return descriptor;
  }
}

// Specialized decorators for specific use cases

export function TrackHttpRequest(options: { route?: string } = {}) {
  return Monitored({
    name: 'http_request',
    labels: {
      type: 'http_request',
      route: options.route || 'unknown',
    },
    trackDuration: true,
    trackErrors: true,
  });
}

export function TrackDatabaseQuery(options: { operation?: string; table?: string } = {}) {
  return Monitored({
    name: 'database_query',
    labels: {
      type: 'database_query',
      operation: options.operation || 'unknown',
      table: options.table || 'unknown',
    },
    trackDuration: true,
    trackErrors: true,
  });
}

export function TrackCacheOperation(options: { operation?: string; cache_type?: string } = {}) {
  return Monitored({
    name: 'cache_operation',
    labels: {
      type: 'cache_operation',
      operation: options.operation || 'unknown',
      cache_type: options.cache_type || 'unknown',
    },
    trackDuration: true,
    trackErrors: false,
  });
}

export function TrackJobProcessing(options: { job_type?: string; queue?: string } = {}) {
  return Monitored({
    name: 'job_processing',
    labels: {
      type: 'job_processing',
      job_type: options.job_type || 'unknown',
      queue: options.queue || 'unknown',
    },
    trackDuration: true,
    trackErrors: true,
  });
}

export function TrackAIProviderCall(options: { provider?: string; model?: string } = {}) {
  return Monitored({
    name: 'ai_provider_call',
    labels: {
      type: 'ai_provider_call',
      provider: options.provider || 'unknown',
      model: options.model || 'unknown',
    },
    trackDuration: true,
    trackErrors: true,
  });
}

export function TrackBlockchainOperation(options: { network?: string; operation?: string } = {}) {
  return Monitored({
    name: 'blockchain_operation',
    labels: {
      type: 'blockchain_operation',
      network: options.network || 'unknown',
      operation: options.operation || 'unknown',
    },
    trackDuration: true,
    trackErrors: true,
  });
}

export function TrackBusinessMetric(metricName: string, labels: Record<string, string> = {}) {
  return Monitored({
    name: metricName,
    labels: {
      type: 'business_metric',
      ...labels,
    },
    trackDuration: false,
    trackErrors: false,
    customMetrics: true,
  });
}

// Performance monitoring decorator
export function PerformanceThreshold(options: {
  thresholdMs: number;
  alertOnExceed?: boolean;
}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        if (duration > options.thresholdMs) {
          console.warn(`Performance threshold exceeded for ${propertyKey}: ${duration}ms > ${options.thresholdMs}ms`);
          
          if (options.alertOnExceed) {
            // Could integrate with alerting system here
            console.error(`ALERT: Method ${propertyKey} exceeded performance threshold`);
          }
        }

        return result;
      } catch (error) {
        throw error;
      }
    };

    return descriptor;
  };
}

// Memory usage tracking decorator
export function TrackMemoryUsage(options: { alertOnHighUsage?: boolean; thresholdMB?: number } = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const memBefore = process.memoryUsage();
      
      try {
        const result = await originalMethod.apply(this, args);
        const memAfter = process.memoryUsage();
        
        const heapUsedDiff = memAfter.heapUsed - memBefore.heapUsed;
        const heapUsedDiffMB = heapUsedDiff / 1024 / 1024;

        if (options.thresholdMB && heapUsedDiffMB > options.thresholdMB) {
          console.warn(`High memory usage in ${propertyKey}: ${heapUsedDiffMB.toFixed(2)}MB`);
          
          if (options.alertOnHighUsage) {
            console.error(`ALERT: Method ${propertyKey} used excessive memory`);
          }
        }

        return result;
      } catch (error) {
        throw error;
      }
    };

    return descriptor;
  };
}

// Custom metrics decorator
export function CustomMetric(metricType: 'counter' | 'histogram' | 'gauge', options: {
  name: string;
  help: string;
  labels?: string[];
  buckets?: number[];
}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // This would need to be implemented with access to PrometheusService
      // For now, it's a placeholder for the concept
      try {
        const result = await originalMethod.apply(this, args);
        
        // Custom metric logic would go here
        console.log(`Custom metric ${metricType} ${options.name} would be recorded`);
        
        return result;
      } catch (error) {
        throw error;
      }
    };

    return descriptor;
  };
}
