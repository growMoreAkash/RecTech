import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@dinesense/shared';
import { AppError } from '../common/app-error';
import type { AppRequest, AuthUser } from '../common/request';
import { PUBLIC_KEY, ROLES_KEY } from './decorators';

/**
 * Global guard: authenticates the bearer token, then enforces @Roles and outlet scope.
 * - No @Public and no @Roles → 403 (default deny), so a forgotten decorator can never expose a route.
 * - `:outletId` the user has no role in → 404 (do not reveal other tenants' outlets).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    req.user = await this.authenticate(req);

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!roles) {
      this.logger.error(`Route ${req.method} ${req.path} has no @Roles/@Public — denied`);
      throw AppError.forbidden();
    }

    const outletId: unknown = req.params?.outletId;
    if (typeof outletId === 'string') {
      const held = req.user.outlets[outletId];
      if (!held?.length) throw AppError.notFound('Outlet');
      if (!held.some((r) => roles.includes(r))) throw AppError.forbidden();
      return true;
    }

    const all = Object.values(req.user.outlets).flat();
    if (!all.some((r) => roles.includes(r))) throw AppError.forbidden();
    return true;
  }

  private async authenticate(req: AppRequest): Promise<AuthUser> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthenticated();
    try {
      return await this.jwt.verifyAsync<AuthUser>(header.slice(7));
    } catch {
      throw AppError.unauthenticated('Access token is invalid or expired');
    }
  }
}
