/**
 * cacheManager.ts
 * 
 * Advanced client-side cache manager with multiple storage strategies
 */

export enum CacheStrategy {
  MEMORY = 'memory',
  LOCAL_STORAGE = 'localStorage',
  SESSION_STORAGE = 'sessionStorage',
}

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  strategy?: CacheStrategy;
  maxSize?: number; // Maximum cache size (for memory strategy)
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Advanced cache manager with multiple storage strategies
 */
export class CacheManager {
  private memoryCache = new Map<string, CacheEntry<any>>();
  private defaultTTL = 300000; // 5 minutes
  private maxSize = 100;

  /**
   * Set cache entry
   */
  public set<T>(
    key: string,
    data: T,
    options: CacheOptions = {}
  ): void {
    const {
      ttl = this.defaultTTL,
      strategy = CacheStrategy.MEMORY,
      maxSize = this.maxSize,
    } = options;

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };

    switch (strategy) {
      case CacheStrategy.MEMORY:
        this.setMemoryCache(key, entry, maxSize);
        break;
      case CacheStrategy.LOCAL_STORAGE:
        this.setStorageCache(key, entry, localStorage);
        break;
      case CacheStrategy.SESSION_STORAGE:
        this.setStorageCache(key, entry, sessionStorage);
        break;
    }
  }

  /**
   * Get cache entry
   */
  public get<T>(
    key: string,
    strategy: CacheStrategy = CacheStrategy.MEMORY
  ): T | null {
    let entry: CacheEntry<T> | null = null;

    switch (strategy) {
      case CacheStrategy.MEMORY:
        entry = this.memoryCache.get(key) || null;
        break;
      case CacheStrategy.LOCAL_STORAGE:
        entry = this.getStorageCache<T>(key, localStorage);
        break;
      case CacheStrategy.SESSION_STORAGE:
        entry = this.getStorageCache<T>(key, sessionStorage);
        break;
    }

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key, strategy);
      return null;
    }

    return entry.data;
  }

  /**
   * Check if cache has valid entry
   */
  public has(
    key: string,
    strategy: CacheStrategy = CacheStrategy.MEMORY
  ): boolean {
    return this.get(key, strategy) !== null;
  }

  /**
   * Delete cache entry
   */
  public delete(
    key: string,
    strategy: CacheStrategy = CacheStrategy.MEMORY
  ): void {
    switch (strategy) {
      case CacheStrategy.MEMORY:
        this.memoryCache.delete(key);
        break;
      case CacheStrategy.LOCAL_STORAGE:
        localStorage.removeItem(key);
        break;
      case CacheStrategy.SESSION_STORAGE:
        sessionStorage.removeItem(key);
        break;
    }
  }

  /**
   * Clear all cache entries
   */
  public clear(strategy?: CacheStrategy): void {
    if (!strategy) {
      // Clear all strategies
      this.memoryCache.clear();
      this.clearStorage(localStorage);
      this.clearStorage(sessionStorage);
      return;
    }

    switch (strategy) {
      case CacheStrategy.MEMORY:
        this.memoryCache.clear();
        break;
      case CacheStrategy.LOCAL_STORAGE:
        this.clearStorage(localStorage);
        break;
      case CacheStrategy.SESSION_STORAGE:
        this.clearStorage(sessionStorage);
        break;
    }
  }

  /**
   * Get cache size
   */
  public size(strategy: CacheStrategy = CacheStrategy.MEMORY): number {
    switch (strategy) {
      case CacheStrategy.MEMORY:
        return this.memoryCache.size;
      case CacheStrategy.LOCAL_STORAGE:
        return this.getStorageSize(localStorage);
      case CacheStrategy.SESSION_STORAGE:
        return this.getStorageSize(sessionStorage);
      default:
        return 0;
    }
  }

  /**
   * Get or set cache entry
   */
  public async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { strategy = CacheStrategy.MEMORY } = options;

    // Try to get from cache
    const cached = this.get<T>(key, strategy);
    if (cached !== null) {
      return cached;
    }

    // Fetch and cache
    const data = await factory();
    this.set(key, data, options);
    return data;
  }

  /**
   * Invalidate cache entries by pattern
   */
  public invalidatePattern(
    pattern: RegExp,
    strategy: CacheStrategy = CacheStrategy.MEMORY
  ): void {
    switch (strategy) {
      case CacheStrategy.MEMORY:
        for (const key of this.memoryCache.keys()) {
          if (pattern.test(key)) {
            this.memoryCache.delete(key);
          }
        }
        break;
      case CacheStrategy.LOCAL_STORAGE:
        this.invalidateStoragePattern(pattern, localStorage);
        break;
      case CacheStrategy.SESSION_STORAGE:
        this.invalidateStoragePattern(pattern, sessionStorage);
        break;
    }
  }

  // Private helper methods

  private setMemoryCache<T>(
    key: string,
    entry: CacheEntry<T>,
    maxSize: number
  ): void {
    // Implement LRU eviction if cache is full
    if (this.memoryCache.size >= maxSize) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }

    this.memoryCache.set(key, entry);
  }

  private setStorageCache<T>(
    key: string,
    entry: CacheEntry<T>,
    storage: Storage
  ): void {
    try {
      storage.setItem(key, JSON.stringify(entry));
    } catch (error) {
      console.warn('Failed to set storage cache:', error);
    }
  }

  private getStorageCache<T>(
    key: string,
    storage: Storage
  ): CacheEntry<T> | null {
    try {
      const item = storage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.warn('Failed to get storage cache:', error);
      return null;
    }
  }

  private clearStorage(storage: Storage): void {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  }

  private getStorageSize(storage: Storage): number {
    return storage.length;
  }

  private invalidateStoragePattern(pattern: RegExp, storage: Storage): void {
    const keysToDelete: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && pattern.test(key)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => storage.removeItem(key));
  }
}

// Singleton instance
export const cacheManager = new CacheManager();
