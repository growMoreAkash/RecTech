import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, createTenant, loginAll, randomId, type Tenant } from './fixtures';

describe('staff app API: device staff, task inbox, web push (M4)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  const sent: { endpoint: string; payload: { title: string; body: string; tag: string } }[] = [];
  const sender = vi.fn((sub: { endpoint: string }, payload: string) => {
    if (sub.endpoint.includes('gone'))
      return Promise.reject(Object.assign(new Error('Gone'), { statusCode: 410 }));
    sent.push({
      endpoint: sub.endpoint,
      payload: JSON.parse(payload) as { title: string; body: string; tag: string },
    });
    return Promise.resolve();
  });
  const http = () => request(app.getHttpServer());
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const subscribe = (token: string, endpoint: string) =>
    http()
      .post('/api/v1/me/push-subscriptions')
      .set(bearer(token))
      .send({
        endpoint,
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      })
      .expect(204);
  const guestCall = async (tableId: string, type: string) => {
    const qr = (await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).qrToken;
    const s = await http()
      .post(`/api/v1/g/t/${qr}/session`)
      .send({ deviceId: `dev_${randomId()}${randomId()}` })
      .expect(201);
    await http().post('/api/v1/g/actions').set({ 'x-guest-token': s.body.token }).send({ type }).expect(201);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp({ pushSender: sender }));
    t = await createTenant(prisma, { floor: true });
    tok = await loginAll(app, t);
  });
  afterAll(async () => app.close());

  it('lists names for a registered terminal only, without secrets', async () => {
    const res = await http()
      .get('/api/v1/auth/device-staff')
      .set('x-device-token', t.deviceToken)
      .expect(200);
    expect(res.body.outlet.id).toBe(t.outletId);
    expect(res.body.staff.map((s: { name: string }) => s.name)).toHaveLength(5);
    expect(JSON.stringify(res.body)).not.toMatch(/pinHash|passwordHash|email/);
    await http().get('/api/v1/auth/device-staff').expect(401);
    await http().get('/api/v1/auth/device-staff').set('x-device-token', 'sd_forged').expect(401);
  });

  it('exposes the VAPID public key', async () => {
    const res = await http().get('/api/v1/push/public-key').expect(200);
    expect(res.body).toMatchObject({ enabled: true, publicKey: expect.stringMatching(/^B/) });
  });

  it('pushes a guest request to the serving waiter', async () => {
    await subscribe(tok.waiter, 'https://push.example/waiter-phone');
    await http()
      .post(`${o()}/tables/${t.tables.T1}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 2 })
      .expect(200);
    await http()
      .post(`${o()}/tables/${t.tables.T1}/transitions`)
      .set(bearer(tok.waiter))
      .send({ event: 'GREET' })
      .expect(200);
    sent.length = 0;
    await guestCall(t.tables.T1, 'WATER');
    expect(sent).toEqual([
      {
        endpoint: 'https://push.example/waiter-phone',
        payload: expect.objectContaining({ body: 'Water for table T1' }),
      },
    ]);
  });

  it('pushes unassigned work only to checked-in staff whose role handles it', async () => {
    const now = Date.now();
    const shift = (userId: string, role: string) =>
      http()
        .post(`${o()}/shifts`)
        .set(bearer(tok.manager))
        .send({
          userId,
          role,
          startsAt: new Date(now - 600_000).toISOString(),
          endsAt: new Date(now + 6 * 3_600_000).toISOString(),
          sectionIds: [],
        })
        .expect(201);
    const ws = await shift(t.users.waiter.id, 'WAITER');
    const bs = await shift(t.users.busser.id, 'BUSSER');
    await http().post(`${o()}/shifts/${ws.body.id}/check-in`).set(bearer(tok.waiter)).expect(200);
    await http().post(`${o()}/shifts/${bs.body.id}/check-in`).set(bearer(tok.busser)).expect(200);
    await subscribe(tok.busser, 'https://push.example/busser-phone');

    // T2 has no serving waiter: a call goes to on-shift waiters, not the busser.
    await http()
      .post(`${o()}/tables/${t.tables.T2}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 2 })
      .expect(200);
    sent.length = 0;
    await guestCall(t.tables.T2, 'CALL_WAITER');
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/waiter-phone']);

    // A table needing cleaning goes to the busser.
    sent.length = 0;
    await http()
      .post(`${o()}/tables/${t.tables.T2}/transitions`)
      .set(bearer(tok.waiter))
      .send({ event: 'STAFF_MARK_LEFT' })
      .expect(200);
    expect(sent).toEqual([
      {
        endpoint: 'https://push.example/busser-phone',
        payload: expect.objectContaining({ body: 'Clean table T2' }),
      },
    ]);

    // On break → no pushes.
    await http()
      .post(`${o()}/shifts/${bs.body.id}/break`)
      .set(bearer(tok.busser))
      .send({ onBreak: true })
      .expect(200);
    await http()
      .post(`${o()}/tables/${t.tables.T3}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 2 })
      .expect(200);
    sent.length = 0;
    await http()
      .post(`${o()}/tables/${t.tables.T3}/transitions`)
      .set(bearer(tok.manager))
      .send({ event: 'STAFF_MARK_LEFT' })
      .expect(200);
    expect(sent).toEqual([]);
  });

  it('runs the task inbox: mine vs role queue, accept races, manual done', async () => {
    // T2's call was cancelled when those guests left; T1 is still seated.
    await guestCall(t.tables.T1, 'CALL_WAITER');
    const waiterInbox = await http().get(`${o()}/tasks`).set(bearer(tok.waiter)).expect(200);
    const types = waiterInbox.body.map((x: { type: string }) => x.type);
    expect(types).toEqual(expect.arrayContaining(['WATER', 'CALL_WAITER']));
    expect(types).not.toContain('CLEAN');
    const busserInbox = await http().get(`${o()}/tasks`).set(bearer(tok.busser)).expect(200);
    expect(busserInbox.body.map((x: { type: string; tableLabel: string }) => [x.type, x.tableLabel])).toEqual(
      expect.arrayContaining([['CLEAN', 'T2']]),
    );

    // A second waiter cannot take a task someone else accepted.
    const call = waiterInbox.body.find((x: { type: string }) => x.type === 'CALL_WAITER');
    const w2 = await http()
      .post(`${o()}/staff`)
      .set(bearer(tok.manager))
      .send({ name: 'W2', role: 'WAITER', pin: '5151' })
      .expect(201);
    await prisma.user.update({
      where: { id: w2.body.id },
      data: { email: `w2.${randomId()}@test.dinesense.in` },
    });
    const accepted = await http().post(`${o()}/tasks/${call.id}/accept`).set(bearer(tok.waiter)).expect(200);
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED', assigneeId: t.users.waiter.id });
    const w2tok = (
      await http()
        .post('/api/v1/auth/pin-login')
        .set('x-device-token', t.deviceToken)
        .send({ userId: w2.body.id, pin: '5151' })
        .expect(200)
    ).body.accessToken as string;
    await http().post(`${o()}/tasks/${call.id}/accept`).set(bearer(w2tok)).expect(409);

    await http().post(`${o()}/tasks/${call.id}/done`).set(bearer(tok.waiter)).expect(200);
    const clean = busserInbox.body.find((x: { type: string }) => x.type === 'CLEAN');
    const r = await http().post(`${o()}/tasks/${clean.id}/done`).set(bearer(tok.busser)).expect(409);
    expect(r.body.error.details.type).toBe('CLEAN'); // finish it with "Cleaned" on the table

    const all = await http().get(`${o()}/tasks?scope=all`).set(bearer(tok.manager)).expect(200);
    expect(all.body.length).toBeGreaterThanOrEqual(busserInbox.body.length);
  });

  it('prunes subscriptions the push service reports as gone', async () => {
    await subscribe(tok.waiter, 'https://push.example/gone-phone');
    await http()
      .post(`${o()}/tables/${t.tables.T4}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 2 })
      .expect(200);
    await http()
      .post(`${o()}/tables/${t.tables.T4}/transitions`)
      .set(bearer(tok.waiter))
      .send({ event: 'GREET' })
      .expect(200);
    await guestCall(t.tables.T4, 'CUTLERY');
    expect(
      await prisma.pushSubscription.count({ where: { endpoint: 'https://push.example/gone-phone' } }),
    ).toBe(0);
    expect(
      await prisma.pushSubscription.count({ where: { endpoint: 'https://push.example/waiter-phone' } }),
    ).toBe(1);
  });
});
