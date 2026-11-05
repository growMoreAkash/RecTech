import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { SlaEngine } from '../src/sla/sla-engine.service';
import { bearer, createApp, createTenant, loginAll, randomId, type Tenant } from './fixtures';

/**
 * The 5-minute greet rule with a fake clock: the engine is called with explicit "now" values relative to the
 * seating, exactly as BullMQ wake-ups would call it. Defaults: greet 300 s, re-assign 120 s, escalate 600 s.
 */
describe('greet SLA, round robin and escalation (M5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: SlaEngine;
  let t: Tenant;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  const pushed: { endpoint: string; body: string }[] = [];
  const waiters: { id: string; token: string; shiftId: string }[] = [];
  const http = () => request(app.getHttpServer());
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const sec = (s: number, from: Date) => new Date(from.getTime() + s * 1000);

  async function seat(tableId: string) {
    const res = await http()
      .post(`${o()}/tables/${tableId}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 2 })
      .expect(200);
    const seatingId = res.body.tables[0].seating.id as string;
    const seating = await prisma.seating.findUniqueOrThrow({ where: { id: seatingId } });
    return { seatingId, seatedAt: seating.seatedAt };
  }
  const assignments = (seatingId: string) =>
    prisma.assignment.findMany({ where: { seatingId }, orderBy: { attempt: 'asc' } });
  const alerts = (seatingId: string) =>
    prisma.alert.findMany({ where: { seatingId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp({
      pushSender: (sub, payload) => {
        pushed.push({ endpoint: sub.endpoint, body: (JSON.parse(payload) as { body: string }).body });
        return Promise.resolve();
      },
    }));
    engine = app.get(SlaEngine);
    t = await createTenant(prisma, { floor: true });
    tok = await loginAll(app, t);
    await app.listen(0);

    // Three waiters: W1 and W2 cover section A, W3 covers B. Checked in in this order.
    const now = Date.now();
    const sections = [[t.sections[0]], [t.sections[0]], [t.sections[1]]];
    for (const [i, sectionIds] of sections.entries()) {
      const pin = `61${i}1`;
      const u =
        i === 0
          ? { id: t.users.waiter.id }
          : (
              await http()
                .post(`${o()}/staff`)
                .set(bearer(tok.manager))
                .send({ name: `Waiter ${i + 1}`, role: 'WAITER', pin })
                .expect(201)
            ).body;
      const shift = await http()
        .post(`${o()}/shifts`)
        .set(bearer(tok.manager))
        .send({
          userId: u.id,
          role: 'WAITER',
          startsAt: new Date(now - 3_600_000).toISOString(),
          endsAt: new Date(now + 8 * 3_600_000).toISOString(),
          sectionIds,
        })
        .expect(201);
      await http().post(`${o()}/shifts/${shift.body.id}/check-in`).set(bearer(tok.manager)).expect(200);
      const token =
        i === 0
          ? tok.waiter
          : ((
              await http()
                .post('/api/v1/auth/pin-login')
                .set('x-device-token', t.deviceToken)
                .send({ userId: u.id, pin })
                .expect(200)
            ).body.accessToken as string);
      await http()
        .post('/api/v1/me/push-subscriptions')
        .set(bearer(token))
        .send({
          endpoint: `https://push.example/w${i + 1}-${randomId()}`,
          keys: {
            p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
            auth: 'tBHItJI5svbpez7KI4CCXg',
          },
        })
        .expect(204);
      waiters.push({ id: u.id, token, shiftId: shift.body.id });
    }
    await http()
      .post('/api/v1/me/push-subscriptions')
      .set(bearer(tok.manager))
      .send({
        endpoint: `https://push.example/manager-${randomId()}`,
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      })
      .expect(204);
  });
  afterAll(async () => app.close());

  it('assigns at 5:00, re-assigns at 7:00, escalates at 10:00, and stops when greeted', async () => {
    const { seatingId, seatedAt } = await seat(t.tables.T1);

    // Before the SLA: nothing happens, wake up at 5:00.
    const early = await engine.evaluate(seatingId, sec(240, seatedAt));
    expect(early).toEqual({ done: false, nextWakeAt: sec(300, seatedAt), actions: [] });

    // 5:00 — breach: first waiter in rotation (W1) gets it, with a GREET task and a push.
    pushed.length = 0;
    const breach = await engine.evaluate(seatingId, sec(300, seatedAt));
    expect(breach.actions).toEqual(['BREACH', 'ASSIGN']);
    expect(breach.nextWakeAt).toEqual(sec(420, seatedAt));
    let as = await assignments(seatingId);
    expect(as.map((a) => [a.attempt, a.waiterId])).toEqual([[1, waiters[0]!.id]]);
    expect(
      await prisma.task.findFirst({
        where: { seatingId, type: 'GREET', assigneeId: waiters[0]!.id, status: 'OPEN' },
      }),
    ).not.toBeNull();
    expect(pushed.map((p) => p.body)).toEqual(['Greet table T1 — guests are waiting']);

    // Idempotent: a duplicate wake-up at the same moment changes nothing.
    expect((await engine.evaluate(seatingId, sec(300, seatedAt))).actions).toEqual([]);
    expect(await assignments(seatingId)).toHaveLength(1);

    // The floor shows who must greet.
    const floor = await http().get(`${o()}/floor`).set(bearer(tok.host)).expect(200);
    const live = floor.body.tables.find((x: { id: string }) => x.id === t.tables.T1).live;
    expect(live.seating).toMatchObject({
      assignment: { attempt: 1, waiter: { id: waiters[0]!.id }, acknowledgedAt: null },
      slaBreachedAt: expect.any(String),
    });

    // 7:00 — W1 never acknowledged: expire, hand to the next in section A (W2).
    const re = await engine.evaluate(seatingId, sec(420, seatedAt));
    expect(re.actions).toEqual(['REASSIGN']);
    as = await assignments(seatingId);
    expect(as.map((a) => [a.attempt, a.waiterId, !!a.expiredAt])).toEqual([
      [1, waiters[0]!.id, true],
      [2, waiters[1]!.id, false],
    ]);
    expect(
      (
        await prisma.task.findFirstOrThrow({
          where: { seatingId, assigneeId: waiters[0]!.id, type: 'GREET' },
        })
      ).status,
    ).toBe('EXPIRED');

    // W1 can no longer acknowledge the expired assignment.
    const late = await http()
      .post(`${o()}/assignments/${as[0]!.id}/ack`)
      .set(bearer(waiters[0]!.token))
      .expect(409);
    expect(late.body.error.code).toBe('CONFLICT');

    // 10:00 — escalation to managers (critical, pushed). W2 also let the 9:00 acknowledgement pass,
    // so the table moves on again (W1 and W2 tried → W3 from section B via the outlet-wide fallback).
    pushed.length = 0;
    const esc = await engine.evaluate(seatingId, sec(600, seatedAt));
    expect(esc.actions).toEqual(['ESCALATE', 'REASSIGN']);
    expect((await assignments(seatingId)).map((a) => [a.attempt, a.waiterId])).toEqual([
      [1, waiters[0]!.id],
      [2, waiters[1]!.id],
      [3, waiters[2]!.id],
    ]);
    expect((await alerts(seatingId)).map((a) => a.type)).toEqual(
      expect.arrayContaining(['SLA_BREACH', 'REASSIGNED', 'ESCALATION']),
    );
    expect(pushed.map((p) => p.endpoint).some((e) => e.includes('manager'))).toBe(true);

    // W2 reaches the table: everything stops, SLA alerts resolve.
    await http()
      .post(`${o()}/tables/${t.tables.T1}/transitions`)
      .set(bearer(waiters[1]!.token))
      .send({ event: 'GREET' })
      .expect(200);
    expect(await engine.evaluate(seatingId, sec(900, seatedAt))).toEqual({
      done: true,
      nextWakeAt: null,
      actions: [],
    });
    expect(
      (await alerts(seatingId)).filter((a) => a.type !== 'ESCALATION' && a.status !== 'RESOLVED'),
    ).toEqual([]);
    // Whoever greets fulfils the live greet task.
    expect(
      (
        await prisma.task.findFirstOrThrow({
          where: { seatingId, assigneeId: waiters[2]!.id, type: 'GREET' },
        })
      ).status,
    ).toBe('DONE');
  });

  it('acknowledging (Accept in the inbox) stops re-assignment but not escalation', async () => {
    const { seatingId, seatedAt } = await seat(t.tables.T2);
    await engine.evaluate(seatingId, sec(300, seatedAt));
    const [first] = await assignments(seatingId);
    // Round robin continues from where it left off (W2 last) → W1.
    expect(first!.waiterId).toBe(waiters[0]!.id);
    const task = await prisma.task.findFirstOrThrow({ where: { seatingId, type: 'GREET', status: 'OPEN' } });
    await http().post(`${o()}/tasks/${task.id}/accept`).set(bearer(waiters[0]!.token)).expect(200);
    expect(
      (await prisma.assignment.findUniqueOrThrow({ where: { id: first!.id } })).acknowledgedAt,
    ).toBeInstanceOf(Date);

    expect((await engine.evaluate(seatingId, sec(500, seatedAt))).actions).toEqual([]);
    expect(await assignments(seatingId)).toHaveLength(1);
    expect((await engine.evaluate(seatingId, sec(600, seatedAt))).actions).toEqual(['ESCALATE']);
    // Someone else cannot acknowledge W1's assignment.
    await http().post(`${o()}/assignments/${first!.id}/ack`).set(bearer(waiters[1]!.token)).expect(403);
    await http()
      .post(`${o()}/tables/${t.tables.T2}/transitions`)
      .set(bearer(waiters[0]!.token))
      .send({ event: 'GREET' })
      .expect(200);
  });

  it('skips waiters on break and falls back outlet-wide when the section is uncovered', async () => {
    // W3 (section B) goes on break; T4 is in section B → fallback to A's waiters via the outlet cursor.
    await http()
      .post(`${o()}/shifts/${waiters[2]!.shiftId}/break`)
      .set(bearer(waiters[2]!.token))
      .send({ onBreak: true })
      .expect(200);
    const { seatingId, seatedAt } = await seat(t.tables.T4);
    await engine.evaluate(seatingId, sec(300, seatedAt));
    const [a] = await assignments(seatingId);
    expect([waiters[0]!.id, waiters[1]!.id]).toContain(a!.waiterId);
    expect(
      await prisma.roundRobinCursor.findUnique({
        where: { outletId_sectionKey: { outletId: t.outletId, sectionKey: '*' } },
      }),
    ).not.toBeNull();
    await http()
      .post(`${o()}/shifts/${waiters[2]!.shiftId}/break`)
      .set(bearer(waiters[2]!.token))
      .send({ onBreak: false })
      .expect(200);
    await http()
      .post(`${o()}/tables/${t.tables.T4}/transitions`)
      .set(bearer(tok.manager))
      .send({ event: 'FORCE_STATE', to: 'VACANT' })
      .expect(200);
  });

  it('two tables breaching at the same moment go to different waiters', async () => {
    await http()
      .post(`${o()}/tables/${t.tables.T1}/transitions`)
      .set(bearer(tok.manager))
      .send({ event: 'FORCE_STATE', to: 'VACANT' })
      .expect(200);
    await http()
      .post(`${o()}/tables/${t.tables.T2}/transitions`)
      .set(bearer(tok.manager))
      .send({ event: 'FORCE_STATE', to: 'VACANT' })
      .expect(200);
    const a = await seat(t.tables.T1);
    const b = await seat(t.tables.T3);
    const at = sec(300, new Date(Math.max(a.seatedAt.getTime(), b.seatedAt.getTime())));
    await Promise.all([engine.evaluate(a.seatingId, at), engine.evaluate(b.seatingId, at)]);
    const [x] = await assignments(a.seatingId);
    const [y] = await assignments(b.seatingId);
    expect(x!.waiterId).not.toBe(y!.waiterId);
    for (const id of [t.tables.T1, t.tables.T3]) {
      await http()
        .post(`${o()}/tables/${id}/transitions`)
        .set(bearer(tok.manager))
        .send({ event: 'FORCE_STATE', to: 'VACANT' })
        .expect(200);
    }
  });

  it('alerts managers when no waiter can take the table, and retries', async () => {
    for (const w of waiters)
      await http().post(`${o()}/shifts/${w.shiftId}/check-out`).set(bearer(tok.manager)).expect(200);
    const { seatingId, seatedAt } = await seat(t.tables.T2);
    pushed.length = 0;
    const r = await engine.evaluate(seatingId, sec(300, seatedAt));
    expect(r.actions).toEqual(['BREACH', 'NO_WAITER']);
    expect(r.nextWakeAt).toEqual(sec(360, seatedAt));
    expect((await alerts(seatingId)).map((x) => x.type)).toEqual(['SLA_BREACH', 'NO_ELIGIBLE_WAITER']);
    expect(pushed.some((p) => p.endpoint.includes('manager'))).toBe(true);
    await http()
      .post(`${o()}/tables/${t.tables.T2}/transitions`)
      .set(bearer(tok.manager))
      .send({ event: 'FORCE_STATE', to: 'VACANT' })
      .expect(200);
  });

  it('a real BullMQ timer fires the assignment on its own', async () => {
    const other = await createTenant(prisma, { floor: true });
    const otok = await loginAll(app, other);
    await prisma.outletSettings.update({ where: { outletId: other.outletId }, data: { greetSlaSeconds: 1 } });
    const now = Date.now();
    const shift = await http()
      .post(`/api/v1/outlets/${other.outletId}/shifts`)
      .set(bearer(otok.manager))
      .send({
        userId: other.users.waiter.id,
        role: 'WAITER',
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        sectionIds: [],
      })
      .expect(201);
    await http()
      .post(`/api/v1/outlets/${other.outletId}/shifts/${shift.body.id}/check-in`)
      .set(bearer(otok.manager))
      .expect(200);
    const res = await http()
      .post(`/api/v1/outlets/${other.outletId}/tables/${other.tables.T1}/seat`)
      .set(bearer(otok.host))
      .send({ partySize: 2 })
      .expect(200);
    const seatingId = res.body.tables[0].seating.id as string;

    const deadline = Date.now() + 10_000;
    let found = null;
    while (!found && Date.now() < deadline) {
      found = await prisma.assignment.findFirst({ where: { seatingId } });
      if (!found) await new Promise((r) => setTimeout(r, 200));
    }
    expect(found).toMatchObject({ waiterId: other.users.waiter.id, attempt: 1 });
  }, 20_000);
});
