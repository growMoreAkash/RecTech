import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokens, LoginInput, PinLoginInput, Role } from '@dinesense/shared';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import type { AuthUser } from '../common/request';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { randomToken, sha256, verifySecret } from './crypto';

const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED, 'Email or password is incorrect');
const invalidRefresh = () =>
  new AppError('INVALID_REFRESH_TOKEN', HttpStatus.UNAUTHORIZED, 'Refresh token is invalid or expired');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Email + password (owners, managers, cashiers, hosts on the dashboard). */
  async login({ email, password }: LoginInput): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await verifySecret(user?.active ? user.passwordHash : null, password);
    if (!user || !ok) throw invalidCredentials();
    return this.issue(user.id, { familyId: randomUUID() });
  }

  /**
   * PIN login. Only valid from a registered, non-revoked StaffDevice; the token is scoped to that device's outlet.
   * Failed attempts are counted per user and lock PIN login for PIN_LOCKOUT_SECONDS after PIN_MAX_ATTEMPTS.
   */
  async pinLogin(deviceToken: string | undefined, { userId, pin }: PinLoginInput): Promise<AuthTokens> {
    const device = deviceToken
      ? await this.prisma.staffDevice.findUnique({ where: { tokenHash: sha256(deviceToken) } })
      : null;
    if (!device || device.revokedAt) {
      throw new AppError('DEVICE_NOT_REGISTERED', HttpStatus.UNAUTHORIZED, 'This device is not registered');
    }

    const lockKey = `pin-fail:${userId}`;
    const fails = Number(await this.redis.get(lockKey));
    if (fails >= this.env.PIN_MAX_ATTEMPTS) {
      throw new AppError(
        'RATE_LIMITED',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many PIN attempts; try again later',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: device.organizationId,
        active: true,
        roles: { some: { outletId: device.outletId } },
      },
    });
    const ok = await verifySecret(user?.pinHash, pin);
    if (!user || !ok) {
      await this.redis.multi().incr(lockKey).expire(lockKey, this.env.PIN_LOCKOUT_SECONDS).exec();
      throw new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED, 'PIN is incorrect');
    }
    await this.redis.del(lockKey);
    await this.prisma.staffDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return this.issue(user.id, { familyId: randomUUID(), deviceId: device.id, outletId: device.outletId });
  }

  /**
   * Rotating refresh. Presenting an already-rotated token is treated as theft — the whole family is revoked —
   * unless it happens within REFRESH_REUSE_GRACE_SECONDS of the rotation: then the previous response was most likely
   * lost in transit (page navigation, flaky mobile network) and the session simply continues with a fresh pair.
   */
  async refresh(token: string | undefined): Promise<AuthTokens> {
    if (!token) throw invalidRefresh();
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row) throw invalidRefresh();
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw invalidRefresh();
    }
    if (row.expiresAt <= new Date()) throw invalidRefresh();
    if (row.rotatedAt) {
      const graceMs = this.env.REFRESH_REUSE_GRACE_SECONDS * 1000;
      if (Date.now() - row.rotatedAt.getTime() > graceMs) {
        await this.revokeFamily(row.familyId);
        throw invalidRefresh();
      }
      const outletId = row.deviceId
        ? (await this.prisma.staffDevice.findUnique({ where: { id: row.deviceId } }))?.outletId
        : undefined;
      return this.issue(row.userId, {
        familyId: row.familyId,
        deviceId: row.deviceId ?? undefined,
        outletId,
      });
    }

    // Claim the row atomically so two concurrent refreshes cannot both succeed.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await this.revokeFamily(row.familyId);
      throw invalidRefresh();
    }

    const outletId = row.deviceId
      ? (await this.prisma.staffDevice.findUnique({ where: { id: row.deviceId } }))?.outletId
      : undefined;
    return this.issue(row.userId, { familyId: row.familyId, deviceId: row.deviceId ?? undefined, outletId });
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Builds claims from the DB (so role changes apply on next refresh) and issues an access + refresh pair. */
  private async issue(
    userId: string,
    opts: { familyId: string; deviceId?: string; outletId?: string },
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { outlet: { select: { archivedAt: true } } } } },
    });
    if (!user?.active) throw invalidRefresh();

    const outlets: Record<string, Role[]> = {};
    for (const r of user.roles) {
      if (r.outlet.archivedAt) continue;
      if (opts.outletId && r.outletId !== opts.outletId) continue;
      (outlets[r.outletId] ??= []).push(r.role);
    }
    if (!Object.keys(outlets).length) throw AppError.forbidden('No active outlet access');

    const claims: AuthUser = {
      sub: user.id,
      org: user.organizationId,
      name: user.name,
      outlets,
      ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
    };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS });

    const refreshToken = randomToken('rt', 32);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId: opts.familyId,
        deviceId: opts.deviceId ?? null,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS };
  }
}
