import { AsyncLocalStorage } from 'async_hooks';

export interface TraceContext {
  correlationId: string;
  userId?: string;
  [key: string]: any;
}

export const traceContextStorage = new AsyncLocalStorage<TraceContext>();
