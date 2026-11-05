import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { TenantViolationError } from '../src/prisma/tenant';
import { bearer, createApp, createTenant, login, type Tenant } from './fixtures';

describe('tenancy, RBAC and audit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let a: Tenant;
  let b: Tenant;
  let tokens: Record<'manager' | 'waiter' | 'host', string>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    a = await createTenant(prisma);
    b = await createTenant(prisma);
    tokens = {
      manager: (await login(app, a.users.manager.email)).accessToken,
      waiter: (await login(app, a.users.waiter.email)).accessToken,
      host: (await login(app, a.users.host.email)).accessToken,
    };
  });
  afterAll(async () => app.close());

  it('lists only outlets the user belongs to', async () => {
    const res = await http().get('/api/v1/outlets').set(bearer(tokens.manager)).expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([a.outletId]);
  });

  it("returns 404 (not 403) for another tenant's outlet", async () => {
    for (const path of ['', '/settings', '/audit-logs', '/devices']) {
      const res = await http()
        .get(`/api/v1/outlets/${b.outletId}${path}`)
        .set(bearer(tokens.manager))
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('lets any staff read settings but only managers change them', async () => {
    await http().get(`/api/v1/outlets/${a.outletId}/settings`).set(bearer(tokens.waiter)).expect(200);
    const denied = await http()
      .patch(`/api/v1/outlets/${a.outletId}/settings`)
      .set(bearer(tokens.waiter))
      .send({ greetSlaSeconds: 240 })
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('writes an audit row with before/after when a manager changes settings', async () => {
    const res = await http()
      .patch(`/api/v1/outlets/${a.outletId}/settings`)
      .set(bearer(tokens.manager))
      .set('x-request-id', 'audit-req-1')
      .send({ greetSlaSeconds: 240, assignmentMode: 'LEAST_LOADED' })
      .expect(200);
    expect(res.body).toMatchObject({ greetSlaSeconds: 240, assignmentMode: 'LEAST_LOADED' });

    const logs = await http()
      .get(`/api/v1/outlets/${a.outletId}/audit-logs`)
      .set(bearer(tokens.manager))
      .expect(200);
    const entry = logs.body.items[0];
    expect(entry).toMatchObject({
      action: 'outlet.settings.update',
      actorId: a.users.manager.id,
      actorType: 'USER',
      requestId: 'audit-req-1',
      before: { greetSlaSeconds: 300, assignmentMode: 'ROUND_ROBIN' },
      after: { greetSlaSeconds: 240, assignmentMode: 'LEAST_LOADED' },
    });
  });

  it('rejects unknown settings keys', async () => {
    await http()
      .patch(`/api/v1/outlets/${a.outletId}/settings`)
      .set(bearer(tokens.manager))
      .send({ greetSlaSeconds: 240, isAdmin: true })
      .expect(400);
  });

  it('registers a staff device whose token enables PIN login, and revoking it kills sessions', async () => {
    const reg = await http()
      .post(`/api/v1/outlets/${a.outletId}/devices`)
      .set(bearer(tokens.manager))
      .send({ name: 'Bar tablet', kind: 'STAFF_TERMINAL' })
      .expect(201);
    expect(reg.body.deviceToken).toMatch(/^sd_/);
    expect(JSON.stringify(reg.body.device)).not.toContain('tokenHash');

    const session = await http()
      .post('/api/v1/auth/pin-login')
      .set('x-device-token', reg.body.deviceToken)
      .send({ userId: a.users.host.id, pin: a.users.host.pin })
      .expect(200);

    await http()
      .delete(`/api/v1/outlets/${a.outletId}/devices/${reg.body.device.id}`)
      .set(bearer(tokens.manager))
      .expect(204);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: session.body.refreshToken }).expect(401);
    await http()
      .post('/api/v1/auth/pin-login')
      .set('x-device-token', reg.body.deviceToken)
      .send({ userId: a.users.host.id, pin: a.users.host.pin })
      .expect(401);
  });

  it('hosts cannot register devices', async () => {
    await http()
      .post(`/api/v1/outlets/${a.outletId}/devices`)
      .set(bearer(tokens.host))
      .send({ name: 'x', kind: 'KDS' })
      .expect(403);
  });

  describe('scoped Prisma client', () => {
    it('never returns rows from another organization', async () => {
      const outlets = await prisma.forOrg(a.organizationId).outlet.findMany();
      expect(outlets.map((o) => o.id)).toEqual([a.outletId]);
      expect(
        await prisma.forOrg(a.organizationId).outlet.findUnique({ where: { id: b.outletId } }),
      ).toBeNull();
      const n = await prisma.forOrg(a.organizationId).outletSettings.updateMany({
        where: { outletId: b.outletId },
        data: { greetSlaSeconds: 31 },
      });
      expect(n.count).toBe(0);
    });

    it('refuses to create rows for another organization', async () => {
      await expect(
        prisma.forOrg(a.organizationId).section.create({
          data: { organizationId: b.organizationId, outletId: b.outletId, name: 'Sneaky' },
        }),
      ).rejects.toBeInstanceOf(TenantViolationError);
    });
  });

  it('health endpoints are public', async () => {
    await http().get('/health/live').expect(200);
    const ready = await http().get('/health/ready').expect(200);
    expect(ready.body.checks).toEqual({ db: 'ok', redis: 'ok' });
  });
});
