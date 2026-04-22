import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

/**
 * Issue #240 — Optimize WebSocket Connections
 *
 * Improvements:
 * - Heartbeat ping/pong to detect and evict stale connections
 * - Per-connection tracking (count + last-seen timestamp)
 * - Redis adapter for horizontal scaling / load balancing
 */
@WebSocketGateway({
  namespace: 'analytics',
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class AnalyticsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AnalyticsGateway.name);

  /** client id → last heartbeat timestamp */
  private readonly connections = new Map<string, number>();

  private heartbeatTimer: NodeJS.Timeout | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async afterInit(server: Server): Promise<void> {
    await this.attachRedisAdapter(server);
    this.startHeartbeat();
    this.logger.log('AnalyticsGateway initialised');
  }

  handleConnection(client: Socket): void {
    this.connections.set(client.id, Date.now());
    this.logger.debug(`Client connected: ${client.id} (total: ${this.connections.size})`);
  }

  handleDisconnect(client: Socket): void {
    this.connections.delete(client.id);
    this.logger.debug(`Client disconnected: ${client.id} (total: ${this.connections.size})`);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  @SubscribeMessage('pong')
  handlePong(client: Socket): void {
    this.connections.set(client.id, Date.now());
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, lastSeen] of this.connections) {
        if (now - lastSeen > HEARTBEAT_TIMEOUT_MS) {
          this.logger.warn(`Evicting stale connection: ${id}`);
          this.server.sockets.sockets.get(id)?.disconnect(true);
          this.connections.delete(id);
        }
      }
      // Ping all remaining clients
      this.server.emit('ping');
    }, HEARTBEAT_INTERVAL_MS);
  }

  // ── Broadcasting ───────────────────────────────────────────────────────────

  broadcastUpdate(payload: unknown): void {
    this.server.emit('analytics:update', payload);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  // ── Redis adapter (load balancing) ─────────────────────────────────────────

  private async attachRedisAdapter(server: Server): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set — running without Redis adapter (single-node mode)');
      return;
    }

    try {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      server.adapter(createAdapter(pubClient, subClient));
      this.logger.log('Redis adapter attached for WebSocket load balancing');
    } catch (err) {
      this.logger.error('Failed to attach Redis adapter — falling back to in-memory', err);
    }
  }
}

