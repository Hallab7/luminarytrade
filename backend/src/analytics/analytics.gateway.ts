import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: 'analytics',
  cors: { origin: '*' },
})
export class AnalyticsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AnalyticsGateway.name);

  handleConnection(client: Socket): void {
    this.logger.debug(`Analytics client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Analytics client disconnected: ${client.id}`);
  }

  broadcastUpdate(payload: unknown): void {
    this.server.emit('analytics:update', payload);
  }
}
