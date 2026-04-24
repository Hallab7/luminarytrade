/**
 * requestBatcher.ts
 * 
 * Utility for batching multiple API requests into a single request
 * to reduce network overhead and improve performance.
 */

interface BatchRequest {
  id: string;
  endpoint: string;
  method: string;
  params?: any;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

interface BatchConfig {
  maxBatchSize?: number;
  batchDelay?: number;
  batchEndpoint?: string;
}

export class RequestBatcher {
  private queue: BatchRequest[] = [];
  private timer: NodeJS.Timeout | null = null;
  private config: Required<BatchConfig>;

  constructor(config: BatchConfig = {}) {
    this.config = {
      maxBatchSize: config.maxBatchSize || 10,
      batchDelay: config.batchDelay || 50,
      batchEndpoint: config.batchEndpoint || '/api/batch',
    };
  }

  /**
   * Add a request to the batch queue
   */
  public add<T>(
    endpoint: string,
    method: string = 'GET',
    params?: any
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: BatchRequest = {
        id: this.generateId(),
        endpoint,
        method,
        params,
        resolve,
        reject,
      };

      this.queue.push(request);

      // Process immediately if batch is full
      if (this.queue.length >= this.config.maxBatchSize) {
        this.flush();
      } else {
        // Schedule batch processing
        this.scheduleBatch();
      }
    });
  }

  /**
   * Schedule batch processing after delay
   */
  private scheduleBatch(): void {
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, this.config.batchDelay);
  }

  /**
   * Flush the current batch
   */
  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.config.maxBatchSize);

    try {
      const response = await fetch(this.config.batchEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          requests: batch.map((req) => ({
            id: req.id,
            endpoint: req.endpoint,
            method: req.method,
            params: req.params,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Batch request failed: ${response.statusText}`);
      }

      const results = await response.json();

      // Resolve individual promises
      batch.forEach((request) => {
        const result = results.find((r: any) => r.id === request.id);
        if (result) {
          if (result.error) {
            request.reject(new Error(result.error));
          } else {
            request.resolve(result.data);
          }
        } else {
          request.reject(new Error('No result found for request'));
        }
      });
    } catch (error) {
      // Reject all requests in batch
      batch.forEach((request) => {
        request.reject(error);
      });
    }

    // Process remaining queue
    if (this.queue.length > 0) {
      this.scheduleBatch();
    }
  }

  /**
   * Clear the queue
   */
  public clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.queue.forEach((request) => {
      request.reject(new Error('Batch queue cleared'));
    });

    this.queue = [];
  }

  /**
   * Get current queue size
   */
  public getQueueSize(): number {
    return this.queue.length;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const requestBatcher = new RequestBatcher();

/**
 * Hook for using request batcher
 */
export function useBatchedRequest() {
  const batchGet = <T>(endpoint: string, params?: any): Promise<T> => {
    return requestBatcher.add<T>(endpoint, 'GET', params);
  };

  const batchPost = <T>(endpoint: string, params?: any): Promise<T> => {
    return requestBatcher.add<T>(endpoint, 'POST', params);
  };

  return {
    batchGet,
    batchPost,
    flush: () => requestBatcher.flush(),
    clear: () => requestBatcher.clear(),
  };
}
