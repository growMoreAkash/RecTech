import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, createTenant, login, type Tenant } from './fixtures';

describe('auth', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma);
  });
  afterAll(async () => app.close());

  it.each(['owner', 'manager', 'host', 'waiter', 'busser'] as const)(
    '%s can log in and read /me',
    async (key) => {
      const { accessToken } = await login(app, t.users[key].email);
      const me = await http().get('/api/v1/me').set(bearer(accessToken)).expect(200);
      expect(me.body.id).toBe(t.users[key].id);
      expect(Object.keys(me.body.outlets)).toEqual([t.outletId]);
    },
  );

  it('rejects a wrong password with INVALID_CREDENTIALS and a request id', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .set('x-request-id', 'req-abc')
      .send({ email: t.users.manager.email, password: 'wrong-password' })
      .expect(401);
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect', requestId: 'req-abc' },
    });
  });

  it('returns VALIDATION_FAILED with details for bad input', async () => {
    const res = await http().post('/api/v1/auth/login').send({ email: 'nope' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(['email', 'password']);
  });

  it('requires a token on protected routes', async () => {
    const res = await http().get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rotates refresh tokens and revokes the family when a rotated token is reused', async () => {
    const first = await login(app, t.users.manager.email);
    const second = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);

    // Replaying the old token = theft signal → whole family revoked.
    await http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
  });

  it('accepts the refresh token from the httpOnly cookie', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: t.users.host.email, password: 'correct-horse-battery' })
      .expect(200);
    const cookie = res.headers['set-cookie'] as unknown as string[];
    expect(cookie.join(';')).toMatch(/ds_refresh=.*HttpOnly/);
    await http().post('/api/v1/auth/refresh').set('Cookie', cookie).send({}).expect(200);
  });

  it('logout revokes the session', async () => {
    const s = await login(app, t.users.waiter.email);
    await http().post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken }).expect(204);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
  });

  describe('PIN login', () => {
    const pin = (deviceToken: string | undefined, userId: string, p: string) => {
      const r = http().post('/api/v1/auth/pin-login');
      if (deviceToken) void r.set('x-device-token', deviceToken);
      return r.send({ userId, pin: p });
    };

    it('works from a registered device and is scoped to that device', async () => {
      const res = await pin(t.deviceToken, t.users.waiter.id, t.users.waiter.pin).expect(200);
      const me = await http().get('/api/v1/me').set(bearer(res.body.accessToken)).expect(200);
      expect(me.body.deviceId).toBeTruthy();
      expect(me.body.outlets).toEqual({ [t.outletId]: ['WAITER'] });
    });

    it('is refused without a registered device', async () => {
      const res = await pin(undefined, t.users.waiter.id, t.users.waiter.pin).expect(401);
      expect(res.body.error.code).toBe('DEVICE_NOT_REGISTERED');
      await pin('sd_forged', t.users.waiter.id, t.users.waiter.pin).expect(401);
    });

    it("cannot log in a user from another organization on this tenant's device", async () => {
      const other = await createTenant(prisma);
      await pin(t.deviceToken, other.users.waiter.id, other.users.waiter.pin).expect(401);
    });

    it('locks out after too many wrong PINs, even for the right PIN', async () => {
      const u = t.users.busser;
      for (let i = 0; i < 3; i++) await pin(t.deviceToken, u.id, '0000').expect(401);
      const res = await pin(t.deviceToken, u.id, u.pin).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });
});
