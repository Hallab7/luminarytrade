import { SetMetadata } from '@nestjs/common';

export const QUERY_OPTIMIZATION_METADATA_KEY = 'query_optimization';

export interface QueryOptimizationOptions {
  enableExplain?: boolean;
  enableIndexCheck?: boolean;
  enableN1Detection?: boolean;
  maxExecutionTime?: number; // in milliseconds
  cacheResults?: boolean;
  cacheTTL?: number; // in seconds
  useSpecificColumns?: string[];
  avoidSelectStar?: boolean;
  enableBatching?: boolean;
  batchSize?: number;
}

export interface QueryOptimizationMetadata extends QueryOptimizationOptions {
  methodName: string;
  className: string;
}

export function OptimizedQuery(options: QueryOptimizationOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    SetMetadata(QUERY_OPTIMIZATION_METADATA_KEY, {
      ...options,
      methodName: propertyKey,
      className: target.constructor.name,
    } as QueryOptimizationMetadata);
  };
}

// Specialized decorators for common optimization patterns

export function FastQuery(maxTime: number = 100) {
  return OptimizedQuery({
    maxExecutionTime: maxTime,
    enableExplain: true,
    enableIndexCheck: true,
    cacheResults: true,
    cacheTTL: 300, // 5 minutes
  });
}

export function CachedQuery(ttl: number = 600) {
  return OptimizedQuery({
    cacheResults: true,
    cacheTTL: ttl,
    enableExplain: false,
  });
}

export function BatchQuery(batchSize: number = 100) {
  return OptimizedQuery({
    enableBatching: true,
    batchSize,
    enableN1Detection: true,
  });
}

export function SelectColumns(columns: string[]) {
  return OptimizedQuery({
    useSpecificColumns: columns,
    avoidSelectStar: true,
    enableIndexCheck: true,
  });
}

export function NoN1Queries() {
  return OptimizedQuery({
    enableN1Detection: true,
    enableBatching: true,
    enableExplain: true,
  });
}

export function ExplainQuery() {
  return OptimizedQuery({
    enableExplain: true,
    enableIndexCheck: true,
    maxExecutionTime: 1000,
  });
}
