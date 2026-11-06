import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { type GuestClaims, GuestTokens } from './guest-token';

type GuestRequest = { headers: Record<string, string | string[] | undefined>; guest?: GuestClaims };

/**
 * Authenticates `x-guest-token` and checks the session is still live: the seating must be open.
 * When guests leave (seating closes) every phone at that table loses ordering rights immediately.
 */
@Injectable()
export class GuestGuard implements CanActivate {
  constructor(
    private readonly tokens: GuestTokens,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<GuestRequest>();
    const raw = req.headers['x-guest-token'];
    const claims = await this.tokens.verify(typeof raw === 'string' ? raw : undefined);
    const session = await this.prisma.guestSession.findFirst({
      where: { id: claims.sid, seatingId: claims.seat, organizationId: claims.org },
      select: { seating: { select: { status: true } } },
    });
    if (!session)
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Scan the table QR code to continue');
    if (session.seating.status !== 'OPEN') {
      throw new AppError(
        'NO_OPEN_SEATING',
        HttpStatus.CONFLICT,
        'This table session has ended. Thank you for visiting!',
      );
    }
    req.guest = claims;
    return true;
  }
}

export const Guest = createParamDecorator((_: unknown, ctx: ExecutionContext): GuestClaims => {
  const g = ctx.switchToHttp().getRequest<GuestRequest>().guest;
  if (!g) throw new Error('@Guest() used without GuestGuard');
  return g;
});
