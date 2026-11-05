import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { Role } from '@dinesense/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../common/app-error';
import type { AuthUser } from '../common/request';
import { AuthGuard } from './auth.guard';
import { PUBLIC_KEY, ROLES_KEY } from './decorators';

const user: AuthUser = { sub: 'u1', org: 'o1', name: 'Test', outlets: { out1: ['WAITER'] } };

function run(
  meta: { public?: boolean; roles?: Role[] },
  params: Record<string, string> = {},
  token = 'good',
) {
  const handler = () => undefined;
  if (meta.public) Reflect.defineMetadata(PUBLIC_KEY, true, handler);
  if (meta.roles) Reflect.defineMetadata(ROLES_KEY, meta.roles, handler);
  const req = { headers: { authorization: `Bearer ${token}` }, params, method: 'GET', path: '/x' };
  const ctx = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const jwt = {
    verifyAsync: (t: string) => (t === 'good' ? Promise.resolve(user) : Promise.reject(new Error('bad'))),
  } as unknown as JwtService;
  return new AuthGuard(new Reflector(), jwt).canActivate(ctx);
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ALLOWED';
  } catch (e) {
    return e instanceof AppError ? e.code : 'OTHER';
  }
};

describe('AuthGuard', () => {
  it('allows @Public routes without a token', async () => {
    expect(await code(run({ public: true }, {}, 'bad'))).toBe('ALLOWED');
  });

  it('rejects missing/invalid tokens', async () => {
    expect(await code(run({ roles: ['WAITER'] }, {}, 'bad'))).toBe('UNAUTHENTICATED');
  });

  it('denies routes that declare no roles (default deny)', async () => {
    expect(await code(run({}))).toBe('FORBIDDEN');
  });

  it('enforces roles within the outlet in the route', async () => {
    expect(await code(run({ roles: ['WAITER'] }, { outletId: 'out1' }))).toBe('ALLOWED');
    expect(await code(run({ roles: ['MANAGER'] }, { outletId: 'out1' }))).toBe('FORBIDDEN');
  });

  it('returns NOT_FOUND for outlets the user has no role in', async () => {
    expect(await code(run({ roles: ['WAITER'] }, { outletId: 'someone-elses' }))).toBe('NOT_FOUND');
  });

  it('checks roles across all outlets when the route has no outlet', async () => {
    expect(await code(run({ roles: ['WAITER'] }))).toBe('ALLOWED');
    expect(await code(run({ roles: ['OWNER'] }))).toBe('FORBIDDEN');
  });
});
