import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { EdgeDevice } from '@prisma/client';
import { EDGE_CLOCK_SKEW_SECONDS, EDGE_HEADERS, edgeSignature } from '@dinesense/shared';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { EdgeCrypto } from './edge-crypto';

type EdgeRequest = {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl: string;
  body: unknown;
  rawBody?: Buffer;
  edgeDevice?: EdgeDevice;
};

const header = (req: EdgeRequest, name: string) => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : undefined;
};
const deny = (message: string) => new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, message);

/** Verifies the HMAC-signed edge request (method, path, timestamp, exact body bytes). */
@Injectable()
export class EdgeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EdgeCrypto,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<EdgeRequest>();
    const deviceId = header(req, EDGE_HEADERS.device);
    const ts = header(req, EDGE_HEADERS.timestamp);
    const sig = header(req, EDGE_HEADERS.signature);
    if (!deviceId || !ts || !sig) throw deny('Missing edge signature headers');
    if (!/^\d{9,11}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > EDGE_CLOCK_SKEW_SECONDS) {
      throw deny('Edge clock skew too large or bad timestamp');
    }
    const device = await this.prisma.edgeDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.revokedAt) throw deny('Unknown or revoked edge device');

    // Raw JPEG bodies arrive as a Buffer; JSON bodies keep their exact bytes in rawBody.
    const body = Buffer.isBuffer(req.body) ? req.body : (req.rawBody ?? Buffer.alloc(0));
    const expected = Buffer.from(
      edgeSignature(this.crypto.deviceSecret(device.id), ts, req.method, req.originalUrl, body),
    );
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw deny('Bad edge signature');

    req.edgeDevice = device;
    return true;
  }
}

export const Edge = createParamDecorator((_: unknown, ctx: ExecutionContext): EdgeDevice => {
  const d = ctx.switchToHttp().getRequest<EdgeRequest>().edgeDevice;
  if (!d) throw new Error('@Edge() without EdgeGuard');
  return d;
});
