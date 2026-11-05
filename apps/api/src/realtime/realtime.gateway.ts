import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { type Role, RT_NAMESPACE, rooms, type ServerToClientEvents } from '@dinesense/shared';
import type { Namespace, Socket } from 'socket.io';
import type { AuthUser } from '../common/request';

/**
 * Live updates. Clients authenticate with the access token in `handshake.auth.token` and are joined to rooms for
 * their outlets, roles and user. Sockets are a hint: clients refetch over REST on (re)connect.
 * Token auth (not cookies), so allowing any origin does not enable CSRF-style abuse.
 */
@WebSocketGateway({ namespace: RT_NAMESPACE, cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Namespace<Record<string, never>, ServerToClientEvents>;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(socket: Socket): Promise<void> {
    const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
    try {
      if (typeof token !== 'string') throw new Error('missing token');
      const user = await this.jwt.verifyAsync<AuthUser>(token);
      (socket.data as { user?: AuthUser }).user = user;
      const joined = [rooms.staff(user.sub)];
      for (const [outletId, roles] of Object.entries(user.outlets)) {
        joined.push(rooms.outlet(outletId), ...roles.map((r: Role) => rooms.role(r, outletId)));
      }
      await socket.join(joined);
    } catch {
      socket.emit('auth_error', { code: 'UNAUTHENTICATED' });
      socket.disconnect(true);
      this.logger.debug(`Rejected socket ${socket.id}`);
    }
  }
}
