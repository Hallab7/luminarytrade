/**
 * API Store Index
 * 
 * Central export for all RTK Query API slices
 */

export { baseApi } from './baseApi';
export { agentsApi } from './agentsApi';

// Re-export hooks
export {
  useGetAgentsQuery,
  useGetAgentQuery,
  useSearchAgentsQuery,
  useLazySearchAgentsQuery,
  useCreateAgentMutation,
  useUpdateAgentMutation,
  useDeleteAgentMutation,
} from './agentsApi';

// Re-export types
export type { Agent, AgentSearchParams } from './agentsApi';
