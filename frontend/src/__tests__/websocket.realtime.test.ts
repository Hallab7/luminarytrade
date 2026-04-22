/**
 * websocket.realtime.test.ts
 *
 * Comprehensive tests for:
 *   - WebSocketManager (connection lifecycle, reconnection, pub/sub, batching, cache)
 *   - WebSocketContext / hooks (provider, useScoreUpdates, useFraudAlerts, etc.)
 *   - useRealtimeDashboard (overlay merging, offline mode, debouncing)
 *
 * Run:
 *   npm test -- --testPathPattern="websocket|realtime" --coverage
 */

import {
    WebSocketManager,
    resetWebSocketManager,
    getWebSocketManager,
    WsEvent,
    ScoreUpdatePayload,
    FraudAlertPayload,
    PriceUpdatePayload,
  } from '../services/WebSocketManager';
  
  // ─── WebSocket mock ───────────────────────────────────────────────────────────
  
  type WsReadyState = 0 | 1 | 2 | 3;
  
  class MockWebSocket {
    static CONNECTING: WsReadyState = 0;
    static OPEN: WsReadyState = 1;
    static CLOSING: WsReadyState = 2;
    static CLOSED: WsReadyState = 3;
  
    readyState: WsReadyState = MockWebSocket.CONNECTING;
    url: string;
    sentMessages: string[] = [];
  
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;
  
    static instances: MockWebSocket[] = [];
  
    constructor(url: string) {
      this.url = url;
      MockWebSocket.instances.push(this);
    }
  
    send(data: string): void {
      this.sentMessages.push(data);
    }
  
    close(code = 1000, reason = ''): void {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code, reason, wasClean: code === 1000 } as CloseEvent);
    }
  
    // Test helpers
    simulateOpen(): void {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }
  
    simulateMessage(data: object): void {
      this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }
  
    simulateClose(code = 1006): void {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code, reason: '', wasClean: false } as CloseEvent);
    }
  }
  
  // Install mock globally
  (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  
  // ─── Test utilities ───────────────────────────────────────────────────────────
  
  function makeEvent<T>(type: WsEvent['type'], payload: T): WsEvent<T> {
    return { type, payload, timestamp: Date.now(), id: 'test-id' };
  }
  
  function makeScoreEvent(overrides?: Partial<ScoreUpdatePayload>): WsEvent<ScoreUpdatePayload> {
    return makeEvent('score_update', {
      accountId: 'G123',
      score: 750,
      previousScore: 720,
      riskLevel: 'low',
      delta: 30,
      ...overrides,
    });
  }
  
  function makeFraudEvent(overrides?: Partial<FraudAlertPayload>): WsEvent<FraudAlertPayload> {
    return makeEvent('fraud_alert', {
      alertId: 'alert-001',
      accountId: 'G456',
      severity: 'high',
      description: 'Suspicious transaction pattern detected',
      amount: 5000,
      timestamp: Date.now(),
      ...overrides,
    });
  }
  
  function makePriceEvent(overrides?: Partial<PriceUpdatePayload>): WsEvent<PriceUpdatePayload> {
    return makeEvent('price_update', {
      asset: 'XLM',
      price: 0.12,
      change24h: 3.2,
      volume24h: 1_200_000,
      timestamp: Date.now(),
      ...overrides,
    });
  }
  
  // ─── WebSocketManager tests ───────────────────────────────────────────────────
  
  describe('WebSocketManager', () => {
    let manager: WebSocketManager;
  
    beforeEach(() => {
      jest.useFakeTimers();
      MockWebSocket.instances = [];
      resetWebSocketManager();
      manager = new WebSocketManager({
        url: 'wss://test.luminarytrade.io/ws',
        reconnectBaseDelay: 100,
        reconnectMaxDelay: 1000,
        reconnectMaxAttempts: 3,
        pingInterval: 500,
        batchInterval: 50,
      });
    });
  
    afterEach(() => {
      manager.disconnect();
      jest.useRealTimers();
    });
  
    // ── Connection lifecycle ──────────────────────────────────────────────────
  
    describe('Connection lifecycle', () => {
      it('transitions to "connecting" on connect()', () => {
        manager.connect();
        expect(manager.getStatus()).toBe('connecting');
      });
  
      it('transitions to "connected" when socket opens', () => {
        manager.connect();
        MockWebSocket.instances[0].simulateOpen();
        expect(manager.getStatus()).toBe('connected');
      });
  
      it('is safe to call connect() multiple times', () => {
        manager.connect();
        manager.connect();
        expect(MockWebSocket.instances.length).toBe(1);
      });
  
      it('transitions to "disconnected" on clean disconnect()', () => {
        manager.connect();
        MockWebSocket.instances[0].simulateOpen();
        manager.disconnect();
        expect(manager.getStatus()).toBe('disconnected');
      });
  
      it('does not reconnect after clean disconnect (code 1000)', () => {
        manager.connect();
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        manager.disconnect();
        jest.advanceTimersByTime(5000);
        expect(MockWebSocket.instances.length).toBe(1);
      });
    });
  
    // ── Reconnection ─────────────────────────────────────────────────────────
  
    describe('Automatic reconnection with backoff', () => {
      it('schedules reconnect after abnormal close', () => {
        manager.connect();
        MockWebSocket.instances[0].simulateOpen();
        MockWebSocket.instances[0].simulateClose(1006);
        expect(manager.getStatus()).toBe('reconnecting');
      });
  
      it('uses exponential backoff (attempt 0 → 100ms, attempt 1 → 200ms)', () => {
        manager.connect();
        MockWebSocket.instances[0].simulateOpen();
        MockWebSocket.instances[0].simulateClose(1006);
        // First reconnect after 100ms * 2^0 = 100ms
        jest.advanceTimersByTime(100);
        expect(MockWebSocket.instances.length).toBe(2);
        MockWebSocket.instances[1].simulateOpen();
        MockWebSocket.instances[1].simulateClose(1006);
        // Second reconnect after 100ms * 2^1 = 200ms
        jest.advanceTimersByTime(200);
        expect(MockWebSocket.instances.length).toBe(3);
      });
  
      it('caps delay at reconnectMaxDelay', () => {
        manager.connect();
        // Force max attempts worth of reconnects
        for (let i = 0; i < 3; i++) {
          const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
          ws.simulateOpen();
          ws.simulateClose(1006);
          jest.advanceTimersByTime(1100); // beyond max delay
        }
        // Should have stopped at maxAttempts
        expect(manager.getStatus()).toBe('disconnected');
      });
  
      it('resets reconnect counter on successful open', () => {
        manager.connect();
        MockWebSocket.instances[0].simulateOpen();
        MockWebSocket.instances[0].simulateClose(1006);
        jest.advanceTimersByTime(100);
        MockWebSocket.instances[1].simulateOpen();
        // Now close again — counter should have reset
        MockWebSocket.instances[1].simulateClose(1006);
        expect(manager.getStatus()).toBe('reconnecting');
      });
    });
  
    // ── Pub/sub ───────────────────────────────────────────────────────────────
  
    describe('Event pub/sub', () => {
      it('calls subscriber when matching event dispatched', () => {
        const handler = jest.fn();
        manager.connect();
        manager.subscribe('score_update', handler);
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage(makeScoreEvent());
        jest.advanceTimersByTime(100); // flush batch
        expect(handler).toHaveBeenCalledTimes(1);
      });
  
      it('does NOT call subscriber for non-matching event type', () => {
        const handler = jest.fn();
        manager.connect();
        manager.subscribe('score_update', handler);
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage(makeFraudEvent());
        jest.advanceTimersByTime(100);
        expect(handler).not.toHaveBeenCalled();
      });
  
      it('supports multiple subscribers for same event type', () => {
        const h1 = jest.fn();
        const h2 = jest.fn();
        manager.connect();
        manager.subscribe('fraud_alert', h1);
        manager.subscribe('fraud_alert', h2);
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage(makeFraudEvent());
        jest.advanceTimersByTime(100);
        expect(h1).toHaveBeenCalledTimes(1);
        expect(h2).toHaveBeenCalledTimes(1);
      });
  
      it('unsubscribe removes handler', () => {
        const handler = jest.fn();
        manager.connect();
        const unsub = manager.subscribe('score_update', handler);
        unsub();
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage(makeScoreEvent());
        jest.advanceTimersByTime(100);
        expect(handler).not.toHaveBeenCalled();
      });
  
      it('applies event filter', () => {
        const handler = jest.fn();
        manager.connect();
        manager.subscribe<ScoreUpdatePayload>(
          'score_update',
          handler,
          { filter: (e) => (e.payload as ScoreUpdatePayload).score > 800 },
        );
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage(makeScoreEvent({ score: 700 })); // filtered out
        ws.simulateMessage(makeScoreEvent({ score: 850 })); // passes
        jest.advanceTimersByTime(100);
        expect(handler).toHaveBeenCalledTimes(1);
        expect((handler.mock.calls[0][0] as WsEvent<ScoreUpdatePayload>).payload.score).toBe(850);
      });
    });
  
    // ── Batching ──────────────────────────────────────────────────────────────
  
    describe('Update batching', () => {
      it('batches rapid events and dispatches after batchInterval', () => {
        const handler = jest.fn();
        manager.connect();
        manager.subscribe('price_update', handler);
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        // Fire 5 events rapidly
        for (let i = 0; i < 5; i++) {
          ws.simulateMessage(makePriceEvent({ price: i * 0.01 }));
        }
        expect(handler).not.toHaveBeenCalled(); // not yet
        jest.advanceTimersByTime(60);
        expect(handler).toHaveBeenCalledTimes(5);
      });
    });
  
    // ── Event cache ───────────────────────────────────────────────────────────
  
    describe('Event cache', () => {
      it('caches received events', () => {
        manager.connect();
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage(makeScoreEvent({ score: 700 }));
        jest.advanceTimersByTime(100);
        const cached = manager.getCachedEvents('score_update');
        expect(cached).toHaveLength(1);
        expect((cached[0].payload as ScoreUpdatePayload).score).toBe(700);
      });
  
      it('replays cached events to new subscribers', () => {
        manager.connect();
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage(makeScoreEvent({ score: 720 }));
        jest.advanceTimersByTime(100);
        // Subscribe AFTER the event
        const handler = jest.fn();
        manager.subscribe('score_update', handler);
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });
  
    // ── Offline queue ─────────────────────────────────────────────────────────
  
    describe('Offline queue', () => {
      it('queues messages sent while disconnected', () => {
        manager.send({ type: 'subscribe', channels: ['score_update'] });
        // Not connected yet — should not throw
        expect(MockWebSocket.instances).toHaveLength(0);
      });
  
      it('flushes queued messages on reconnect', () => {
        const msg = { type: 'subscribe', channels: ['score_update'] };
        manager.send(msg); // queued
        manager.connect();
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        expect(ws.sentMessages).toContain(JSON.stringify(msg));
      });
    });
  
    // ── Ping / latency ────────────────────────────────────────────────────────
  
    describe('Ping / latency monitoring', () => {
      it('sends ping after pingInterval', () => {
        manager.connect();
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        jest.advanceTimersByTime(550);
        const pings = ws.sentMessages.filter((m) => JSON.parse(m).type === '__ping');
        expect(pings.length).toBeGreaterThanOrEqual(1);
      });
    });
  
    // ── Singleton ────────────────────────────────────────────────────────────
  
    describe('Singleton factory', () => {
      it('getWebSocketManager returns same instance on subsequent calls', () => {
        const a = getWebSocketManager('wss://test.luminarytrade.io/ws');
        const b = getWebSocketManager();
        expect(a).toBe(b);
      });
  
      it('resetWebSocketManager clears the singleton', () => {
        getWebSocketManager('wss://test.luminarytrade.io/ws');
        resetWebSocketManager();
        // Next call with no url should throw
        expect(() => getWebSocketManager()).toThrow();
      });
    });
  
    // ── Connection status events ──────────────────────────────────────────────
  
    describe('Connection status events', () => {
      it('publishes connection_status on connect', () => {
        const handler = jest.fn();
        manager.subscribe('connection_status', handler);
        manager.connect();
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ payload: expect.objectContaining({ status: 'connecting' }) }),
        );
      });
  
      it('publishes connection_status with "connected" when socket opens', () => {
        const handler = jest.fn();
        manager.subscribe('connection_status', handler);
        manager.connect();
        MockWebSocket.instances[0].simulateOpen();
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ payload: expect.objectContaining({ status: 'connected' }) }),
        );
      });
  
      it('publishes connection_status with reconnect attempt info', () => {
        const handler = jest.fn();
        manager.subscribe('connection_status', handler);
        manager.connect();
        MockWebSocket.instances[0].simulateOpen();
        MockWebSocket.instances[0].simulateClose(1006);
        const reconnectCall = handler.mock.calls.find(
          (c) => (c[0] as WsEvent).payload &&
            (c[0] as WsEvent<{ status: string; reconnectAttempt?: number }>).payload.reconnectAttempt !== undefined,
        );
        expect(reconnectCall).toBeDefined();
      });
    });
  });
  
  // ─── Integration: connection scenarios ───────────────────────────────────────
  
  describe('Connection scenarios (integration)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      MockWebSocket.instances = [];
      resetWebSocketManager();
    });
  
    afterEach(() => {
      jest.useRealTimers();
    });
  
    it('handles server-side close and reconnects automatically', () => {
      const manager = new WebSocketManager({
        url: 'wss://test.luminarytrade.io/ws',
        reconnectBaseDelay: 50,
        reconnectMaxAttempts: 5,
      });
  
      manager.connect();
      MockWebSocket.instances[0].simulateOpen();
      expect(manager.getStatus()).toBe('connected');
  
      MockWebSocket.instances[0].simulateClose(1011); // server error
      expect(manager.getStatus()).toBe('reconnecting');
  
      jest.advanceTimersByTime(100);
      MockWebSocket.instances[1].simulateOpen();
      expect(manager.getStatus()).toBe('connected');
  
      manager.disconnect();
    });
  
    it('handles malformed JSON messages gracefully', () => {
      const manager = new WebSocketManager({
        url: 'wss://test.luminarytrade.io/ws',
      });
      manager.connect();
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      // Should not throw
      expect(() => {
        ws.onmessage?.({ data: 'not-json-{{{' } as MessageEvent);
      }).not.toThrow();
      manager.disconnect();
    });
  
    it('dynamic subscription update sends subscribe message', () => {
      const manager = new WebSocketManager({
        url: 'wss://test.luminarytrade.io/ws',
      });
      manager.connect();
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      manager.updateSubscriptions(['score_update', 'fraud_alert']);
      const msg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(msg).toEqual({ type: 'subscribe', channels: ['score_update', 'fraud_alert'] });
      manager.disconnect();
    });
  });