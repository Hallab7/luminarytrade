/**
 * OptimizedAgentSearch.tsx
 * 
 * Example component demonstrating optimized search with debouncing and caching
 */

import React from 'react';
import { useOptimizedSearch } from '../../hooks/useOptimizedSearch';
import { useLazySearchAgentsQuery } from '../../store/api/agentsApi';

interface Agent {
  id: string;
  name: string;
  type: string;
  status: string;
}

export const OptimizedAgentSearch: React.FC = () => {
  const [searchAgents] = useLazySearchAgentsQuery();

  const {
    results,
    loading,
    error,
    query,
    setQuery,
    clearCache,
  } = useOptimizedSearch<Agent>({
    debounceDelay: 300,      // Wait 300ms after user stops typing
    minQueryLength: 2,       // Only search if query is 2+ characters
    cacheTTL: 60000,         // Cache results for 1 minute
    enableCache: true,
    searchFn: async (searchQuery) => {
      const { data } = await searchAgents({ query: searchQuery });
      return data || [];
    },
  });

  return (
    <div className="agent-search">
      <div className="search-header">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents..."
          className="search-input"
        />
        <button onClick={clearCache} className="clear-cache-btn">
          Clear Cache
        </button>
      </div>

      {loading && (
        <div className="loading-state">
          <p>Searching...</p>
        </div>
      )}

      {error && (
        <div className="error-state">
          <p>Error: {error.message}</p>
        </div>
      )}

      {!loading && !error && results.length === 0 && query.length >= 2 && (
        <div className="empty-state">
          <p>No agents found for "{query}"</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="results-list">
          <p className="results-count">
            Found {results.length} agent{results.length !== 1 ? 's' : ''}
          </p>
          <ul>
            {results.map((agent) => (
              <li key={agent.id} className="agent-item">
                <div className="agent-name">{agent.name}</div>
                <div className="agent-meta">
                  <span className="agent-type">{agent.type}</span>
                  <span className={`agent-status status-${agent.status.toLowerCase()}`}>
                    {agent.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {query.length > 0 && query.length < 2 && (
        <div className="hint">
          <p>Type at least 2 characters to search</p>
        </div>
      )}
    </div>
  );
};
