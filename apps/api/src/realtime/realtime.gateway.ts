import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { type Role, RT_NAMESPACE, rooms, type ServerToClientEvents } from '@dinesense/shared';
import type { Namespace, Socket } from 'socket.io';
import type { AuthUser } from '../common/request';
import { GUEST_ISSUER, type GuestClaims } from '../guest/guest-token';
import { PrismaService } from '../prisma/prisma.service';

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

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const auth = (socket.handshake.auth as Record<string, unknown> | undefined) ?? {};
    const token: unknown = auth.token;
    try {
      if (typeof auth.guestToken === 'string') return await this.joinGuest(socket, auth.guestToken);
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

  /** Guests only ever hear about their own seating (cart, orders) and their outlet's menu availability. */
  private async joinGuest(socket: Socket, token: string): Promise<void> {
    const g = await this.jwt.verifyAsync<GuestClaims>(token, { issuer: GUEST_ISSUER, audience: 'guest' });
    const seating = await this.prisma.seating.findFirst({
      where: { id: g.seat, organizationId: g.org, status: 'OPEN' },
    });
    if (!seating) throw new Error('seating closed');
    (socket.data as { guest?: GuestClaims }).guest = g;
    await socket.join([rooms.seating(g.seat), rooms.menu(g.out)]);
  }
}
