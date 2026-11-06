import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { ROLES, type Role } from '@dinesense/shared';
import { type AppRequest, contextOf, type RequestContext } from '../common/request';

export const PUBLIC_KEY = 'ds:public';
export const ROLES_KEY = 'ds:roles';

/** No authentication required. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Allowed roles. For routes with an `:outletId` param the user must hold one of these roles *in that outlet*;
 * otherwise in any outlet. Routes without @Roles or @Public are denied (default deny).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Any authenticated staff member. */
export const Authenticated = () => Roles(...ROLES);

export const Managers = () => Roles('OWNER', 'MANAGER');

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext =>
  contextOf(ctx.switchToHttp().getRequest<AppRequest>()),
);
