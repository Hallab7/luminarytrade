/**
 * agentsApi.ts
 * 
 * RTK Query API slice for agents with automatic caching
 */

import { baseApi } from './baseApi';

export interface Agent {
  id: string;
  name: string;
  type: string;
  status: string;
  performance?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSearchParams {
  query?: string;
  type?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export const agentsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Get all agents with caching
    getAgents: builder.query<Agent[], void>({
      query: () => '/agents',
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'Agents' as const, id })),
              { type: 'Agents', id: 'LIST' },
            ]
          : [{ type: 'Agents', id: 'LIST' }],
      // Keep this data cached for 5 minutes
      keepUnusedDataFor: 300,
    }),

    // Get single agent
    getAgent: builder.query<Agent, string>({
      query: (id) => `/agents/${id}`,
      providesTags: (result, error, id) => [{ type: 'Agents', id }],
      keepUnusedDataFor: 300,
    }),

    // Search agents with debounced caching
    searchAgents: builder.query<Agent[], AgentSearchParams>({
      query: (params) => ({
        url: '/agents/search',
        params,
      }),
      providesTags: [{ type: 'Agents', id: 'SEARCH' }],
      // Shorter cache for search results
      keepUnusedDataFor: 60,
    }),

    // Create agent
    createAgent: builder.mutation<Agent, Partial<Agent>>({
      query: (body) => ({
        url: '/agents',
        method: 'POST',
        body,
      }),
      // Invalidate agents list cache
      invalidatesTags: [{ type: 'Agents', id: 'LIST' }],
    }),

    // Update agent
    updateAgent: builder.mutation<Agent, { id: string; data: Partial<Agent> }>({
      query: ({ id, data }) => ({
        url: `/agents/${id}`,
        method: 'PUT',
        body: data,
      }),
      // Invalidate specific agent and list
      invalidatesTags: (result, error, { id }) => [
        { type: 'Agents', id },
        { type: 'Agents', id: 'LIST' },
      ],
    }),

    // Delete agent
    deleteAgent: builder.mutation<void, string>({
      query: (id) => ({
        url: `/agents/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, id) => [
        { type: 'Agents', id },
        { type: 'Agents', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetAgentsQuery,
  useGetAgentQuery,
  useSearchAgentsQuery,
  useLazySearchAgentsQuery, // For manual triggering
  useCreateAgentMutation,
  useUpdateAgentMutation,
  useDeleteAgentMutation,
} = agentsApi;
