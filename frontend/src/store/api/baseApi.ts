/**
 * baseApi.ts
 * 
 * RTK Query base API configuration with automatic caching,
 * request deduplication, and optimized data fetching.
 */

import { createApi, fetchBaseQuery, retry } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';

// Custom base query with retry logic
const baseQueryWithRetry = retry(
  fetchBaseQuery({
    baseUrl: process.env.REACT_APP_API_BASE_URL || '/api',
    prepareHeaders: (headers) => {
      const token = localStorage.getItem('authToken');
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      headers.set('Content-Type', 'application/json');
      return headers;
    },
  }),
  { maxRetries: 2 }
);

// Enhanced base query with error handling
const baseQueryWithErrorHandling: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await baseQueryWithRetry(args, api, extraOptions);
  
  if (result.error) {
    // Handle 401 unauthorized
    if (result.error.status === 401) {
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
  }
  
  return result;
};

/**
 * Base API slice with RTK Query
 * 
 * Features:
 * - Automatic caching with configurable TTL
 * - Request deduplication
 * - Automatic refetching on focus/reconnect
 * - Optimistic updates support
 * - Tag-based cache invalidation
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithErrorHandling,
  
  // Tag types for cache invalidation
  tagTypes: [
    'Agents',
    'Transactions',
    'Scores',
    'Analytics',
    'User',
    'Wallet',
    'Dashboard',
  ],
  
  // Global cache configuration
  keepUnusedDataFor: 60, // Keep cached data for 60 seconds
  
  // Refetch on mount or arg change
  refetchOnMountOrArgChange: 30, // Refetch if data is older than 30 seconds
  
  // Refetch on focus/reconnect
  refetchOnFocus: false, // Disable to reduce API calls
  refetchOnReconnect: true,
  
  endpoints: () => ({}),
});

export const { 
  middleware: apiMiddleware,
  reducerPath: apiReducerPath,
  reducer: apiReducer,
} = baseApi;
