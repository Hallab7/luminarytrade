/**
 * CachedAgentsList.tsx
 * 
 * Example component using RTK Query for automatic caching and request deduplication
 */

import React from 'react';
import {
  useGetAgentsQuery,
  useCreateAgentMutation,
  useUpdateAgentMutation,
  useDeleteAgentMutation,
} from '../../store/api/agentsApi';

export const CachedAgentsList: React.FC = () => {
  // RTK Query automatically:
  // - Caches the response
  // - Deduplicates requests (if multiple components call this, only 1 API request is made)
  // - Provides loading and error states
  // - Refetches on reconnect
  const {
    data: agents,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetAgentsQuery();

  const [createAgent, { isLoading: isCreating }] = useCreateAgentMutation();
  const [updateAgent, { isLoading: isUpdating }] = useUpdateAgentMutation();
  const [deleteAgent, { isLoading: isDeleting }] = useDeleteAgentMutation();

  const handleCreateAgent = async () => {
    try {
      await createAgent({
        name: 'New Agent',
        type: 'trading',
        status: 'active',
      }).unwrap();
      // Cache is automatically invalidated and refetched
    } catch (err) {
      console.error('Failed to create agent:', err);
    }
  };

  const handleUpdateAgent = async (id: string) => {
    try {
      await updateAgent({
        id,
        data: { status: 'inactive' },
      }).unwrap();
      // Cache is automatically updated
    } catch (err) {
      console.error('Failed to update agent:', err);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    try {
      await deleteAgent(id).unwrap();
      // Cache is automatically invalidated
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="agents-loading">
        <p>Loading agents...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="agents-error">
        <p>Error: {error?.toString()}</p>
        <button onClick={refetch}>Retry</button>
      </div>
    );
  }

  return (
    <div className="agents-list">
      <div className="agents-header">
        <h2>Agents</h2>
        <button
          onClick={handleCreateAgent}
          disabled={isCreating}
          className="create-btn"
        >
          {isCreating ? 'Creating...' : 'Create Agent'}
        </button>
      </div>

      {agents && agents.length === 0 && (
        <div className="empty-state">
          <p>No agents found</p>
        </div>
      )}

      {agents && agents.length > 0 && (
        <ul className="agents-items">
          {agents.map((agent) => (
            <li key={agent.id} className="agent-item">
              <div className="agent-info">
                <h3>{agent.name}</h3>
                <p>Type: {agent.type}</p>
                <p>Status: {agent.status}</p>
                {agent.performance && (
                  <p>Performance: {agent.performance.toFixed(2)}%</p>
                )}
              </div>
              <div className="agent-actions">
                <button
                  onClick={() => handleUpdateAgent(agent.id)}
                  disabled={isUpdating}
                  className="update-btn"
                >
                  Toggle Status
                </button>
                <button
                  onClick={() => handleDeleteAgent(agent.id)}
                  disabled={isDeleting}
                  className="delete-btn"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="cache-info">
        <p>
          ℹ️ This data is cached for 5 minutes. Multiple components can use this
          data without making additional API calls.
        </p>
      </div>
    </div>
  );
};
