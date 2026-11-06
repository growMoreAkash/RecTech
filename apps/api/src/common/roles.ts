import type { Role } from '@dinesense/shared';
import type { RequestContext } from './request';

export const MANAGER_ROLES: readonly Role[] = ['OWNER', 'MANAGER'];

export function rolesIn(ctx: RequestContext, outletId: string): Role[] {
  return ctx.user.outlets[outletId] ?? [];
}

export function hasRoleIn(ctx: RequestContext, outletId: string, roles: readonly Role[]): boolean {
  return rolesIn(ctx, outletId).some((r) => roles.includes(r));
}
