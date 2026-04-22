/**
 * WebSocketManager.ts
 *
 * Core WebSocket service for LuminaryTrade real-time data pipeline.
 * Handles connection lifecycle, automatic reconnection with exponential
 * backoff, pub/sub event routing, subscription management, and
 * connection-health monitoring.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type WsEventType =
  | 'score_update'
  | 'fraud_alert'
  | 'price_update'
  | 'connection_status'
  | 'error';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  timestamp: number;
  id: string;
}

export interface ScoreUpdatePayload {
  accountId: string;
  score: number;
  previousScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  delta: number;
}

export interface FraudAlertPayload {
  alertId: string;
  accountId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  amount?: number;
  timestamp: number;
}

export interface PriceUpdatePayload {
  asset: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
}

export interface ConnectionStatusPayload {
  status: ConnectionStatus;
  latency?: number;
  reconnectAttempt?: number;
}

export type EventHandler<T = unknown> = (event: WsEvent<T>) => void;
export type UnsubscribeFn = () => void;

export interface SubscriptionOptions {
  filter?: (event: WsEvent) => boolean;
  onError?: (err: Error) => void;
}

export interface WebSocketManagerOptions {
  url: string;
  reconnectBaseDelay?: number;   // ms, default 1000
  reconnectMaxDelay?: number;    // ms, default 30000
  reconnectMaxAttempts?: number; // default 10
  pingInterval?: number;         // ms, default 25000
  batchInterval?: number;        // ms, default 50 — batches rapid updates
  maxCacheSize?: number;         // recent events per type, default 100
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── WebSocketManager ─────────────────────────────────────────────────────────

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingBatch: WsEvent[] = [];
  private latencyProbe: number | null = null;

  // Subscriptions: eventType → Set of handlers
  private subscribers = new Map<WsEventType, Set<{ handler: EventHandler; options: SubscriptionOptions }>>();

  // Recent event cache per type
  private eventCache = new Map<WsEventType, WsEvent[]>();

  // Queued messages while offline
  private offlineQueue: object[] = [];

  private readonly opts: Required<WebSocketManagerOptions>;

  constructor(options: WebSocketManagerOptions) {
    this.opts = {
      reconnectBaseDelay: 1_000,
      reconnectMaxDelay: 30_000,
      reconnectMaxAttempts: 10,
      pingInterval: 25_000,
      batchInterval: 50,
      maxCacheSize: 100,
      ...options,
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Open the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this._setStatus('connecting');
    this._openSocket();
  }

  /** Gracefully close and stop all timers. */
  disconnect(): void {
    this._clearTimers();
    this.reconnectAttempts = 0;
    if (this.ws) {
      this.ws.onclose = null; // prevent auto-reconnect
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
    this._setStatus('disconnected');
  }

  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  subscribe<T = unknown>(
    type: WsEventType,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {},
  ): UnsubscribeFn {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
    }
    const entry = { handler: handler as EventHandler, options };
    this.subscribers.get(type)!.add(entry);

    // Replay cached events immediately
    const cached = this.eventCache.get(type) ?? [];
    cached.forEach((evt) => {
      if (!options.filter || options.filter(evt)) {
        try { handler(evt as WsEvent<T>); } catch { /* ignore */ }
      }
    });

    return () => {
      this.subscribers.get(type)?.delete(entry);
    };
  }

  /** Send a message to the server. Queues if offline. */
  send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.offlineQueue.push(message);
    }
  }

  /** Change subscription channels dynamically. */
  updateSubscriptions(channels: WsEventType[]): void {
    this.send({ type: 'subscribe', channels });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getLatency(): number | null {
    return this.latencyProbe;
  }

  getCachedEvents(type: WsEventType): WsEvent[] {
    return this.eventCache.get(type) ?? [];
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _openSocket(): void {
    try {
      this.ws = new WebSocket(this.opts.url);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this._setStatus('connected');
      this._startPing();
      this._flushOfflineQueue();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as WsEvent;
        this._handlePong(parsed);
        this._enqueue(parsed);
      } catch {
        // malformed frame — ignore
      }
    };

    this.ws.onerror = () => {
      // onerror always precedes onclose; let onclose drive reconnect
    };

    this.ws.onclose = (event: CloseEvent) => {
      this._clearPing();
      if (event.code !== 1000) {
        // Abnormal close — reconnect
        this._scheduleReconnect();
      } else {
        this._setStatus('disconnected');
      }
    };
  }

  private _scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.opts.reconnectMaxAttempts) {
      this._setStatus('disconnected');
      this._publish({
        type: 'error',
        payload: new Error('Max reconnect attempts reached'),
        timestamp: Date.now(),
        id: generateId(),
      });
      return;
    }

    this._setStatus('reconnecting');
    const delay = Math.min(
      this.opts.reconnectBaseDelay * 2 ** this.reconnectAttempts,
      this.opts.reconnectMaxDelay,
    );
    this.reconnectAttempts++;

    this._publish({
      type: 'connection_status',
      payload: { status: 'reconnecting', reconnectAttempt: this.reconnectAttempts } satisfies ConnectionStatusPayload,
      timestamp: Date.now(),
      id: generateId(),
    });

    this.reconnectTimer = setTimeout(() => {
      this._openSocket();
    }, delay);
  }

  private _startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const start = Date.now();
        this.ws.send(JSON.stringify({ type: '__ping', ts: start }));
      }
    }, this.opts.pingInterval);
  }

  private _handlePong(event: WsEvent): void {
    if ((event as unknown as { type: string; ts: number }).type === '__pong') {
      const raw = event as unknown as { ts: number };
      this.latencyProbe = Date.now() - raw.ts;
    }
  }

  private _clearPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private _clearTimers(): void {
    this._clearPing();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.batchTimer) { clearTimeout(this.batchTimer); this.batchTimer = null; }
  }

  private _flushOfflineQueue(): void {
    while (this.offlineQueue.length) {
      const msg = this.offlineQueue.shift()!;
      this.ws?.send(JSON.stringify(msg));
    }
  }

  /** Batch rapid incoming events to reduce re-render thrash. */
  private _enqueue(event: WsEvent): void {
    this.pendingBatch.push(event);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        const batch = this.pendingBatch.splice(0);
        this.batchTimer = null;
        batch.forEach((evt) => this._dispatch(evt));
      }, this.opts.batchInterval);
    }
  }

  private _dispatch(event: WsEvent): void {
    this._cacheEvent(event);
    this._publish(event);
  }

  private _publish(event: WsEvent): void {
    const handlers = this.subscribers.get(event.type);
    if (!handlers) return;
    handlers.forEach(({ handler, options }) => {
      if (options.filter && !options.filter(event)) return;
      try { handler(event); } catch (err) {
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private _cacheEvent(event: WsEvent): void {
    const list = this.eventCache.get(event.type) ?? [];
    list.push(event);
    if (list.length > this.opts.maxCacheSize) list.shift();
    this.eventCache.set(event.type, list);
  }

  private _setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this._publish({
      type: 'connection_status',
      payload: { status } satisfies ConnectionStatusPayload,
      timestamp: Date.now(),
      id: generateId(),
    });
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _instance: WebSocketManager | null = null;

export function getWebSocketManager(url?: string): WebSocketManager {
  if (!_instance) {
    if (!url) throw new Error('WebSocketManager: url required for first initialisation');
    _instance = new WebSocketManager({ url });
  }
  return _instance;
}

/** Tear down the singleton (useful in tests). */
export function resetWebSocketManager(): void {
  _instance?.disconnect();
  _instance = null;
}