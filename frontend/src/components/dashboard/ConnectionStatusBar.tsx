/**
 * ConnectionStatusBar.tsx
 *
 * Compact status indicator for the WebSocket connection.
 * Renders inline in the Dashboard header alongside existing controls.
 *
 * Shows: connected (green pulse) / reconnecting (amber spin) /
 *        disconnected (red) / latency badge when connected.
 */

import React from 'react';
import { ConnectionStatus } from '../../services/WebSocketManager';

interface ConnectionStatusBarProps {
  status: ConnectionStatus;
  latency: number | null;
  hasLiveData: boolean;
}

const DOT_BASE: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const statusConfig: Record<
  ConnectionStatus,
  { color: string; label: string; pulse: boolean }
> = {
  connected: { color: '#22c55e', label: 'Live', pulse: true },
  connecting: { color: '#6366f1', label: 'Connecting…', pulse: true },
  reconnecting: { color: '#f59e0b', label: 'Reconnecting…', pulse: true },
  disconnected: { color: '#ef4444', label: 'Offline', pulse: false },
};

const ConnectionStatusBar: React.FC<ConnectionStatusBarProps> = ({
  status,
  latency,
  hasLiveData,
}) => {
  const { color, label, pulse } = statusConfig[status];

  return (
    <div
      data-testid="connection-status-bar"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 12px',
        borderRadius: 10,
        border: `1px solid ${color}33`,
        background: `${color}0f`,
        fontSize: 12,
        fontWeight: 600,
        color,
        letterSpacing: '0.02em',
        userSelect: 'none',
        transition: 'all 0.3s',
      }}
      title={latency != null ? `Latency: ${latency}ms` : undefined}
    >
      {/* Dot + optional pulse ring */}
      <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span style={{ ...DOT_BASE, background: color }} />
        {pulse && (
          <span
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: '50%',
              border: `1.5px solid ${color}`,
              animation: 'lt-ws-pulse 1.6s ease-out infinite',
              opacity: 0.6,
            }}
          />
        )}
      </span>

      {label}

      {/* Latency badge */}
      {status === 'connected' && latency != null && (
        <span
          style={{
            background: `${color}22`,
            borderRadius: 6,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {latency}ms
        </span>
      )}

      {/* Live data badge */}
      {status === 'connected' && hasLiveData && (
        <span
          style={{
            background: '#6366f122',
            borderRadius: 6,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 700,
            color: '#818cf8',
          }}
        >
          ● LIVE
        </span>
      )}

      <style>{`
        @keyframes lt-ws-pulse {
          0%   { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default ConnectionStatusBar;