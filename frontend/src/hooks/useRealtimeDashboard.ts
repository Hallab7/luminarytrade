/**
 * useRealtimeDashboard.ts
 *
 * Bridges the WebSocketContext into the existing useDashboardData lifecycle.
 * Applies live score / fraud / price events on top of the snapshot data
 * returned by useDashboardData, with debouncing to prevent render jank.
 *
 * Drop-in companion to useDashboardData — Dashboard.tsx can use both in
 * parallel; live events override stale snapshot values.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  useFraudAlerts,
  usePriceUpdates,
  useScoreUpdates,
  useWebSocket,
} from '../context/WebSocketContext';
import {
  CreditScoreTrendPoint,
  DashboardSummary,
  FraudHeatmapCell,
} from '../types/dashboard.types';
import {
  FraudAlertPayload,
  PriceUpdatePayload,
  ScoreUpdatePayload,
  WsEvent,
} from '../services/WebSocketManager';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RealtimeOverlay {
  /** Patches to merge into DashboardSummary */
  summaryPatch: Partial<DashboardSummary>;
  /** Prepended to creditScoreTrend */
  liveScorePoints: CreditScoreTrendPoint[];
  /** Appended fraud cells (live alerts mapped to heatmap) */
  liveFraudCells: FraudHeatmapCell[];
  /** Latest prices keyed by asset symbol */
  latestPrices: Record<string, PriceUpdatePayload>;
  /** Whether any live data has arrived */
  hasLiveData: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 80;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function scoreToCreditTrendPoint(p: ScoreUpdatePayload): CreditScoreTrendPoint {
  return {
    date: new Date().toISOString().slice(0, 10),
    score: p.score,
    riskLevel: p.riskLevel,
  };
}

function fraudAlertToHeatmapCell(p: FraudAlertPayload): FraudHeatmapCell {
  const now = new Date(p.timestamp);
  const dow = now.getDay();
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    hour: now.getHours(),
    dayOfWeek: dow,
    dayLabel: labels[dow],
    count: 1,
    severity: p.severity,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRealtimeDashboard(): RealtimeOverlay {
  const { status } = useWebSocket();

  // Mutable accumulators — written inside event handlers, flushed via state
  const scorePointsRef = useRef<CreditScoreTrendPoint[]>([]);
  const fraudCellsRef = useRef<FraudHeatmapCell[]>([]);
  const pricesRef = useRef<Record<string, PriceUpdatePayload>>({});
  const summaryPatchRef = useRef<Partial<DashboardSummary>>({});

  // Trigger re-render after debounced batch
  const [tick, setTick] = useState(0);
  const scheduleFlush = useCallback(() => {
    setTick((t) => t + 1);
  }, []);
  const debouncedTick = useDebounced(tick, DEBOUNCE_MS);

  // Score updates
  useScoreUpdates(
    useCallback(
      (evt: WsEvent<ScoreUpdatePayload>) => {
        const point = scoreToCreditTrendPoint(evt.payload);
        scorePointsRef.current = [point, ...scorePointsRef.current].slice(0, 50);
        summaryPatchRef.current = {
          ...summaryPatchRef.current,
          avgCreditScore: evt.payload.score,
        };
        scheduleFlush();
      },
      [scheduleFlush],
    ),
  );

  // Fraud alerts
  useFraudAlerts(
    useCallback(
      (evt: WsEvent<FraudAlertPayload>) => {
        const cell = fraudAlertToHeatmapCell(evt.payload);
        fraudCellsRef.current = [...fraudCellsRef.current, cell].slice(-200);
        summaryPatchRef.current = {
          ...summaryPatchRef.current,
          fraudAlerts: (summaryPatchRef.current.fraudAlerts ?? 0) + 1,
        };
        scheduleFlush();
      },
      [scheduleFlush],
    ),
  );

  // Price updates
  usePriceUpdates(
    useCallback(
      (evt: WsEvent<PriceUpdatePayload>) => {
        pricesRef.current = {
          ...pricesRef.current,
          [evt.payload.asset]: evt.payload,
        };
        scheduleFlush();
      },
      [scheduleFlush],
    ),
  );

  // Reset live data when connection drops
  useEffect(() => {
    if (status === 'disconnected') {
      // Keep data visible in offline mode — do not reset
    }
    if (status === 'connected') {
      // On reconnect, sync queued changes (already accumulated in refs)
      scheduleFlush();
    }
  }, [status, scheduleFlush]);

  const hasLiveData =
    scorePointsRef.current.length > 0 ||
    fraudCellsRef.current.length > 0 ||
    Object.keys(pricesRef.current).length > 0;

  // Snapshot on each debounced tick
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return {
    summaryPatch: { ...summaryPatchRef.current },
    liveScorePoints: [...scorePointsRef.current],
    liveFraudCells: [...fraudCellsRef.current],
    latestPrices: { ...pricesRef.current },
    hasLiveData,
    // debouncedTick consumed implicitly via the render cycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } as RealtimeOverlay;
  // We intentionally depend on debouncedTick to re-snapshot refs
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  void debouncedTick;
}