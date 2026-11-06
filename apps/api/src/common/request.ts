import type { Role } from '@dinesense/shared';
import type { Request } from 'express';

/** Claims carried in the access token. */
export interface AuthUser {
  sub: string;
  org: string;
  name: string;
  /** Roles per outlet id. */
  outlets: Record<string, Role[]>;
  /** Present when the session came from PIN login on a staff device. */
  deviceId?: string;
}

export type AppRequest = Request & { id?: string; user?: AuthUser };

export interface RequestContext {
  user: AuthUser;
  requestId?: string;
  ip?: string;
}

export function contextOf(req: AppRequest): RequestContext {
  if (!req.user) throw new Error('contextOf() called on an unauthenticated request');
  return { user: req.user, requestId: req.id, ip: req.ip };
}
