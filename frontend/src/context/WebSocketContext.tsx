import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  getWebSocketManager,
  resetWebSocketManager,
  ConnectionStatus,
  WsEvent,
  ScoreUpdatePayload,
  FraudAlertPayload,
  PriceUpdatePayload,
  BonusUpdatePayload,
  WebSocketManager,
} from '../services/WebSocketManager';

const WS_URL = 'wss://test.luminarytrade.io/ws';

// ─── Context ───────────────────────────────────────────────────────────────────

interface WebSocketContextValue {
  status: ConnectionStatus;
  latency: number | null;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

// ─── Provider ──────────────────────────────────────────────────────────────────

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [latency, setLatency] = useState<number | null>(null);
  const managerRef = useRef<WebSocketManager>(getWebSocketManager(WS_URL));

  useEffect(() => {
    const manager = managerRef.current;

    manager.connect();

    // Listen to connection status events to update status
    const unsubStatus = manager.subscribe('connection_status', (evt: WsEvent<{ status: ConnectionStatus }>) => {
      setStatus(evt.payload.status);
    });

    // Poll latency from manager's ping/pong probe
    const latencyInterval = setInterval(() => {
      setLatency(manager.getLatency());
    }, 1000);

    // Cleanup
    return () => {
      unsubStatus();
      clearInterval(latencyInterval);
      manager.disconnect();
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ status, latency }}>
      {children}
    </WebSocketContext.Provider>
  );
};

// ─── Hook: core WebSocket status ────────────────────────────────────────────────

export const useWebSocket = (): WebSocketContextValue => {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return ctx;
};

// ─── Base subscription hooks ────────────────────────────────────────────────────

function useWsSubscription<T>(
  eventType: WsEvent['type'],
  handler: (event: WsEvent<T>) => void,
) {
  const manager = getWebSocketManager();
  useEffect(() => {
    const unsub = manager.subscribe(eventType, handler as (event: WsEvent) => void);
    return unsub;
  }, [manager, eventType, handler]);
}

export const useScoreUpdates = (handler: (event: WsEvent<ScoreUpdatePayload>) => void) => {
  useWsSubscription<ScoreUpdatePayload>('score_update', handler);
};

export const useFraudAlerts = (handler: (event: WsEvent<FraudAlertPayload>) => void) => {
  useWsSubscription<FraudAlertPayload>('fraud_alert', handler);
};

export const usePriceUpdates = (handler: (event: WsEvent<PriceUpdatePayload>) => void) => {
  useWsSubscription<PriceUpdatePayload>('price_update', handler);
};

export const useBonusUpdates = (handler: (event: WsEvent<BonusUpdatePayload>) => void) => {
  useWsSubscription<BonusUpdatePayload>('bonus_update', handler);
};

// ─── Latest-state convenience hooks ────────────────────────────────────────────

export function useLatestPrices(): Record<string, PriceUpdatePayload> {
  const [prices, setPrices] = useState<Record<string, PriceUpdatePayload>>({});
  usePriceUpdates(
    useCallback((evt: WsEvent<PriceUpdatePayload>) => {
      setPrices((prev) => ({ ...prev, [evt.payload.asset]: evt.payload }));
    }, []),
  );
  return prices;
}

export function useLatestBonusUpdates(limit = 20): BonusUpdatePayload[] {
  const [bonuses, setBonuses] = useState<BonusUpdatePayload[]>([]);
  useBonusUpdates(
    useCallback(
      (evt: WsEvent<BonusUpdatePayload>) => {
        setBonuses((prev) => {
          const next = [evt.payload, ...prev];
          return next.slice(0, limit);
        });
      },
      [limit],
    ),
  );
  return bonuses;
}

export function useLatestFraudAlerts(limit = 20): FraudAlertPayload[] {
  const [alerts, setAlerts] = useState<FraudAlertPayload[]>([]);
  useFraudAlerts(
    useCallback(
      (evt: WsEvent<FraudAlertPayload>) => {
        setAlerts((prev) => {
          const next = [evt.payload, ...prev];
          return next.slice(0, limit);
        });
      },
      [limit],
    ),
  );
  return alerts;
}
