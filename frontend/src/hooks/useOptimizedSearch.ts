/**
 * useOptimizedSearch.ts
 * 
 * Optimized search hook with debouncing, caching, and minimal API calls
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDebounce } from './useDebounce';

interface SearchOptions<T> {
  /** Debounce delay in ms */
  debounceDelay?: number;
  /** Minimum query length to trigger search */
  minQueryLength?: number;
  /** Cache TTL in ms */
  cacheTTL?: number;
  /** Search function */
  searchFn: (query: string) => Promise<T[]>;
  /** Initial results */
  initialResults?: T[];
  /** Enable caching */
  enableCache?: boolean;
}

interface SearchResult<T> {
  results: T[];
  loading: boolean;
  error: Error | null;
  query: string;
}

interface CacheEntry<T> {
  results: T[];
  timestamp: number;
}

/**
 * Optimized search hook with debouncing and caching
 * 
 * Features:
 * - Automatic debouncing to reduce API calls
 * - In-memory caching with TTL
 * - Minimum query length validation
 * - Request cancellation
 * - Loading and error states
 */
export function useOptimizedSearch<T = any>(
  options: SearchOptions<T>
): SearchResult<T> & {
  setQuery: (query: string) => void;
  clearCache: () => void;
  refetch: () => void;
} {
  const {
    debounceDelay = 300,
    minQueryLength = 2,
    cacheTTL = 60000, // 1 minute
    searchFn,
    initialResults = [],
    enableCache = true,
  } = options;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>(initialResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const debouncedQuery = useDebounce(query, debounceDelay);
  const cacheRef = useRef<Map<string, CacheEntry<T>>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Check if cached result is still valid
   */
  const getCachedResult = useCallback(
    (searchQuery: string): T[] | null => {
      if (!enableCache) return null;

      const cached = cacheRef.current.get(searchQuery);
      if (!cached) return null;

      const isExpired = Date.now() - cached.timestamp > cacheTTL;
      if (isExpired) {
        cacheRef.current.delete(searchQuery);
        return null;
      }

      return cached.results;
    },
    [cacheTTL, enableCache]
  );

  /**
   * Cache search results
   */
  const setCachedResult = useCallback(
    (searchQuery: string, searchResults: T[]): void => {
      if (!enableCache) return;

      cacheRef.current.set(searchQuery, {
        results: searchResults,
        timestamp: Date.now(),
      });
    },
    [enableCache]
  );

  /**
   * Perform search
   */
  const performSearch = useCallback(
    async (searchQuery: string) => {
      // Validate query length
      if (searchQuery.length < minQueryLength) {
        setResults(initialResults);
        setLoading(false);
        setError(null);
        return;
      }

      // Check cache first
      const cached = getCachedResult(searchQuery);
      if (cached) {
        setResults(cached);
        setLoading(false);
        setError(null);
        return;
      }

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      setLoading(true);
      setError(null);

      try {
        const searchResults = await searchFn(searchQuery);
        
        // Only update if this is still the current query
        if (searchQuery === debouncedQuery) {
          setResults(searchResults);
          setCachedResult(searchQuery, searchResults);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err);
          setResults(initialResults);
        }
      } finally {
        setLoading(false);
      }
    },
    [
      minQueryLength,
      initialResults,
      getCachedResult,
      setCachedResult,
      searchFn,
      debouncedQuery,
    ]
  );

  /**
   * Effect to trigger search on debounced query change
   */
  useEffect(() => {
    if (debouncedQuery === '') {
      setResults(initialResults);
      setLoading(false);
      setError(null);
      return;
    }

    performSearch(debouncedQuery);
  }, [debouncedQuery, performSearch, initialResults]);

  /**
   * Clear cache
   */
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  /**
   * Refetch current query
   */
  const refetch = useCallback(() => {
    if (debouncedQuery) {
      cacheRef.current.delete(debouncedQuery);
      performSearch(debouncedQuery);
    }
  }, [debouncedQuery, performSearch]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    results,
    loading,
    error,
    query,
    setQuery,
    clearCache,
    refetch,
  };
}
