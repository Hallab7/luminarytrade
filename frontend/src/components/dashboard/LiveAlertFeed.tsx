/**
 * LiveAlertFeed.tsx
 *
 * Scrollable live feed of fraud alerts delivered via WebSocket.
 * Designed to slot into the Dashboard chart grid (full-width row).
 * Matches Dashboard.tsx aesthetic: dark card, indigo/amber accent palette.
 */

import React, { useEffect, useRef } from 'react';
import { useLatestFraudAlerts } from '../../context/WebSocketContext';
import { FraudAlertPayload } from '../../services/WebSocketManager';

// ─── Severity styles ──────────────────────────────────────────────────────────

const severityStyle: Record<
  FraudAlertPayload['severity'],
  { color: string; bg: string; label: string }
> = {
  low:      { color: '#22c55e', bg: '#22c55e18', label: 'LOW' },
  medium:   { color: '#f59e0b', bg: '#f59e0b18', label: 'MED' },
  high:     { color: '#ef4444', bg: '#ef444418', label: 'HIGH' },
  critical: { color: '#a855f7', bg: '#a855f718', label: 'CRIT' },
};

// ─── Single alert row ─────────────────────────────────────────────────────────

interface AlertRowProps {
  alert: FraudAlertPayload;
  isNew: boolean;
}

const AlertRow: React.FC<AlertRowProps> = ({ alert, isNew }) => {
  const { color, bg, label } = severityStyle[alert.severity];
  const time = new Date(alert.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div
      data-testid="alert-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '54px 1fr auto auto',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 8,
        background: isNew ? `${color}0a` : 'transparent',
        borderLeft: `2px solid ${isNew ? color : 'transparent'}`,
        transition: 'background 1s, border-color 1s',
        fontSize: 12,
      }}
    >
      {/* Severity badge */}
      <span style={{
        background: bg,
        color,
        borderRadius: 5,
        padding: '2px 6px',
        fontWeight: 800,
        fontSize: 10,
        letterSpacing: '0.06em',
        textAlign: 'center',
      }}>
        {label}
      </span>

      {/* Description */}
      <span style={{ color: '#cbd5e1', lineHeight: 1.4 }}>
        <span style={{ color: '#94a3b8', fontWeight: 600 }}>{alert.accountId}</span>
        {' — '}{alert.description}
        {alert.amount != null && (
          <span style={{ color: '#64748b' }}> · ${alert.amount.toLocaleString()}</span>
        )}
      </span>

      {/* Alert ID */}
      <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 10 }}>
        #{alert.alertId.slice(-6)}
      </span>

      {/* Time */}
      <span style={{ color: '#475569', whiteSpace: 'nowrap' }}>{time}</span>
    </div>
  );
};

// ─── Feed ─────────────────────────────────────────────────────────────────────

interface LiveAlertFeedProps {
  maxVisible?: number;
}

const LiveAlertFeed: React.FC<LiveAlertFeedProps> = ({ maxVisible = 12 }) => {
  const alerts = useLatestFraudAlerts(maxVisible);
  const listRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Auto-scroll to top when new alert arrives
  useEffect(() => {
    if (alerts.length > prevLengthRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
    prevLengthRef.current = alerts.length;
  }, [alerts.length]);

  return (
    <div
      data-testid="live-alert-feed"
      style={{
        background: 'linear-gradient(135deg, #1e1e2f 0%, #252540 100%)',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.06)',
        padding: '18px 20px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
            🛡 Live Fraud Alerts
          </span>
          {alerts.length > 0 && (
            <span style={{
              background: '#ef444422',
              color: '#fca5a5',
              borderRadius: 6,
              padding: '1px 7px',
              fontSize: 11,
              fontWeight: 700,
            }}>
              {alerts.length}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#475569' }}>
          Last {maxVisible} alerts
        </span>
      </div>

      {/* List */}
      <div
        ref={listRef}
        style={{
          maxHeight: 260,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          scrollbarWidth: 'thin',
          scrollbarColor: '#334155 transparent',
        }}
      >
        {alerts.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '32px 0',
            color: '#475569',
            fontSize: 13,
          }}>
            No alerts received yet…
          </div>
        ) : (
          alerts.map((alert, i) => (
            <AlertRow key={alert.alertId} alert={alert} isNew={i === 0} />
          ))
        )}
      </div>
    </div>
  );
};

export default LiveAlertFeed;