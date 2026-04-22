/**
 * WebSocketContext.tsx
 *
 * React context that owns the WebSocketManager singleton and exposes
 * typed subscription hooks to the component tree.
 *
 * Usage:
 *   <WebSocketProvider url="wss://api.luminarytrade.io/ws">
 *     <App />
 *   </WebSocketProvider>
 *
 *   // Inside any component:
 *   const { status, latency } = useWebSocket();
 *   useScoreUpdates((evt) => console.log(evt.payload));
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
  } from 'react';
  
  import {
    WebSocketManager,
    ConnectionStatus,
    EventHandler,
    FraudAlertPayload,
    PriceUpdatePayload,
    ScoreUpdatePayload,
    SubscriptionOptions,
    WsEvent,
    WsEventType,
  } from '../services/WebSocketManager';
  
  // ─── Context shape ────────────────────────────────────────────────────────────
  
  interface WebSocketContextValue {
    manager: WebSocketManager;
    status: ConnectionStatus;
    latency: number | null;
    subscribe: <T>(
      type: WsEventType,
      handler: EventHandler<T>,
      options?: SubscriptionOptions,
    ) => () => void;
  }
  
  // ─── Context creation ─────────────────────────────────────────────────────────
  
  const WebSocketContext = createContext<WebSocketContextValue | null>(null);
  
  // ─── Provider ─────────────────────────────────────────────────────────────────
  
  interface WebSocketProviderProps {
    url: string;
    children: React.ReactNode;
    /** Override manager options for testing or custom configs */
    managerOptions?: {
      reconnectBaseDelay?: number;
      reconnectMaxDelay?: number;
      reconnectMaxAttempts?: number;
      pingInterval?: number;
      batchInterval?: number;
      maxCacheSize?: number;
    };
  }
  
  export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
    url,
    children,
    managerOptions,
  }) => {
    const managerRef = useRef<WebSocketManager>(
      new WebSocketManager({ url, ...managerOptions }),
    );
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [latency, setLatency] = useState<number | null>(null);
  
    useEffect(() => {
      const manager = managerRef.current;
      manager.connect();
  
      // Track connection status
      const unsubStatus = manager.subscribe<{ status: ConnectionStatus; latency?: number }>(
        'connection_status',
        (evt) => {
          setStatus(evt.payload.status);
          if (evt.payload.latency !== undefined) setLatency(evt.payload.latency);
        },
      );
  
      return () => {
        unsubStatus();
        manager.disconnect();
      };
    }, []); // manager is stable via ref
  
    const subscribe = useCallback(
      <T,>(
        type: WsEventType,
        handler: EventHandler<T>,
        options?: SubscriptionOptions,
      ) => managerRef.current.subscribe<T>(type, handler, options),
      [],
    );
  
    return (
      <WebSocketContext.Provider
        value={{ manager: managerRef.current, status, latency, subscribe }}
      >
        {children}
      </WebSocketContext.Provider>
    );
  };
  
  // ─── Base hook ────────────────────────────────────────────────────────────────
  
  export function useWebSocket(): WebSocketContextValue {
    const ctx = useContext(WebSocketContext);
    if (!ctx) {
      throw new Error('useWebSocket must be used inside <WebSocketProvider>');
    }
    return ctx;
  }
  
  // ─── Typed subscription hooks ─────────────────────────────────────────────────
  
  /**
   * Generic hook — subscribe to any WsEventType.
   * Handler is stable via ref so callers needn't memoize.
   */
  export function useWsSubscription<T>(
    type: WsEventType,
    handler: EventHandler<T>,
    options?: SubscriptionOptions,
  ): void {
    const { subscribe } = useWebSocket();
    const handlerRef = useRef<EventHandler<T>>(handler);
    useEffect(() => { handlerRef.current = handler; });
  
    useEffect(() => {
      return subscribe<T>(type, (evt) => handlerRef.current(evt), options);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type, subscribe]);
  }
  
  /** Subscribe to credit-score updates. */
  export function useScoreUpdates(
    handler: EventHandler<ScoreUpdatePayload>,
    options?: SubscriptionOptions,
  ): void {
    useWsSubscription<ScoreUpdatePayload>('score_update', handler, options);
  }
  
  /** Subscribe to fraud alerts. */
  export function useFraudAlerts(
    handler: EventHandler<FraudAlertPayload>,
    options?: SubscriptionOptions,
  ): void {
    useWsSubscription<FraudAlertPayload>('fraud_alert', handler, options);
  }
  
  /** Subscribe to price feed updates. */
  export function usePriceUpdates(
    handler: EventHandler<PriceUpdatePayload>,
    options?: SubscriptionOptions,
  ): void {
    useWsSubscription<PriceUpdatePayload>('price_update', handler, options);
  }
  
  // ─── State-accumulating hooks ─────────────────────────────────────────────────
  
  /**
   * Accumulates the latest N score updates into an array.
   * Safe to call in components — triggers re-render only on new events.
   */
  export function useLatestScoreUpdates(limit = 20): ScoreUpdatePayload[] {
    const [updates, setUpdates] = useState<ScoreUpdatePayload[]>([]);
    useScoreUpdates(
      useCallback(
        (evt: WsEvent<ScoreUpdatePayload>) => {
          setUpdates((prev) => {
            const next = [evt.payload, ...prev];
            return next.slice(0, limit);
          });
        },
        [limit],
      ),
    );
    return updates;
  }
  
  /**
   * Accumulates the latest N fraud alerts into an array.
   */
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
  
  /**
   * Returns the most recent price for each asset seen so far.
   */
  export function useLatestPrices(): Record<string, PriceUpdatePayload> {
    const [prices, setPrices] = useState<Record<string, PriceUpdatePayload>>({});
    usePriceUpdates(
      useCallback((evt: WsEvent<PriceUpdatePayload>) => {
        setPrices((prev) => ({ ...prev, [evt.payload.asset]: evt.payload }));
      }, []),
    );
    return prices;
  }