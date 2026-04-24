/**
 * BatchedDashboard.tsx
 * 
 * Example component demonstrating request batching for dashboard data
 */

import React, { useEffect, useState } from 'react';
import { useBatchedRequest } from '../../utils/requestBatcher';

interface DashboardData {
  agentsSummary: {
    total: number;
    active: number;
    inactive: number;
  };
  recentTransactions: Array<{
    id: string;
    amount: number;
    timestamp: string;
  }>;
  analyticsOverview: {
    totalVolume: number;
    successRate: number;
    avgResponseTime: number;
  };
}

export const BatchedDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const { batchGet } = useBatchedRequest();

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setLoading(true);
        setError(null);

        // These 3 requests will be automatically batched into 1 API call
        // Reducing network overhead and improving performance
        const [agentsSummary, recentTransactions, analyticsOverview] = await Promise.all([
          batchGet<DashboardData['agentsSummary']>('/agents/summary'),
          batchGet<DashboardData['recentTransactions']>('/transactions/recent'),
          batchGet<DashboardData['analyticsOverview']>('/analytics/overview'),
        ]);

        setData({
          agentsSummary,
          recentTransactions,
          analyticsOverview,
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load dashboard'));
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <p>Error: {error.message}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      <div className="dashboard-grid">
        {/* Agents Summary */}
        <div className="dashboard-card">
          <h2>Agents Summary</h2>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Total</span>
              <span className="stat-value">{data.agentsSummary.total}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Active</span>
              <span className="stat-value">{data.agentsSummary.active}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Inactive</span>
              <span className="stat-value">{data.agentsSummary.inactive}</span>
            </div>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="dashboard-card">
          <h2>Recent Transactions</h2>
          <ul className="transactions-list">
            {data.recentTransactions.map((tx) => (
              <li key={tx.id} className="transaction-item">
                <span className="tx-amount">${tx.amount.toFixed(2)}</span>
                <span className="tx-time">
                  {new Date(tx.timestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Analytics Overview */}
        <div className="dashboard-card">
          <h2>Analytics Overview</h2>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Total Volume</span>
              <span className="stat-value">
                ${data.analyticsOverview.totalVolume.toLocaleString()}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Success Rate</span>
              <span className="stat-value">
                {data.analyticsOverview.successRate.toFixed(1)}%
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Avg Response Time</span>
              <span className="stat-value">
                {data.analyticsOverview.avgResponseTime}ms
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
