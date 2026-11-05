import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createApp, createTenant, login, loginAll, PASSWORD, type Tenant } from './fixtures';

interface FloorTable {
  id: string;
  label: string;
  sectionId: string;
  capacity: number;
  minCapacity: number;
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  joinableWith: string[];
  qrToken: string;
  live: { status: string };
}

describe('floor plan, staff and shifts (M2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  const http = () => request(app.getHttpServer());
  const base = () => `/api/v1/outlets/${t.outletId}`;
  const toInput = ({ live: _l, qrToken: _q, id, ...rest }: FloorTable) => ({ ...rest, id, key: id });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
    tok = await loginAll(app, t);
  });
  afterAll(async () => app.close());

  describe('floor plan', () => {
    it('returns sections, layout and live state in one snapshot', async () => {
      const res = await http().get(`${base()}/floor`).set(bearer(tok.waiter)).expect(200);
      expect(res.body.sections).toHaveLength(2);
      expect(res.body.greetSlaSeconds).toBe(300);
      expect(res.body.tables.map((x: FloorTable) => [x.label, x.live.status])).toEqual([
        ['T1', 'VACANT'],
        ['T2', 'VACANT'],
        ['T3', 'VACANT'],
        ['T4', 'VACANT'],
      ]);
    });

    it('saves a plan: swaps labels, adds a joinable table, removes a vacant one', async () => {
      const snap = (await http().get(`${base()}/floor`).set(bearer(tok.manager))).body as {
        tables: FloorTable[];
      };
      const [t1, t2, t3] = snap.tables.map(toInput);
      const plan = {
        tables: [
          { ...t1!, label: 'T2', x: 500 },
          { ...t2!, label: 'T1' },
          // T3 kept, T4 removed; a new table joinable with T3.
          t3!,
          {
            ...t3!,
            id: undefined,
            key: 'new-1',
            label: 'T9',
            capacity: 6,
            minCapacity: 4,
            joinableWith: [t3!.key],
          },
        ],
      };
      const res = await http().put(`${base()}/floor-plan`).set(bearer(tok.manager)).send(plan).expect(200);
      const byLabel = Object.fromEntries((res.body.tables as FloorTable[]).map((x) => [x.label, x]));
      expect(Object.keys(byLabel).sort()).toEqual(['T1', 'T2', 'T3', 'T9']);
      expect(byLabel.T2!.id).toBe(t.tables.T1);
      expect(byLabel.T2!.x).toBe(500);
      // Joins are symmetric.
      expect(byLabel.T9!.joinableWith).toEqual([t.tables.T3]);
      expect(byLabel.T3!.joinableWith).toEqual([byLabel.T9!.id]);
      const removed = await prisma.table.findUniqueOrThrow({ where: { id: t.tables.T4 } });
      expect(removed.archivedAt).toBeInstanceOf(Date);
      expect(
        await prisma.auditLog.count({ where: { entityId: t.outletId, action: 'floor.plan.save' } }),
      ).toBe(1);
    });

    it('refuses to remove a table that is in service', async () => {
      await http()
        .post(`${base()}/tables/${t.tables.T3}/seat`)
        .set(bearer(tok.host))
        .send({ partySize: 2 })
        .expect(200);
      const snap = (await http().get(`${base()}/floor`).set(bearer(tok.manager))).body as {
        tables: FloorTable[];
      };
      const plan = {
        tables: snap.tables
          .filter((x) => x.id !== t.tables.T3)
          .map(toInput)
          .map((x) => ({ ...x, joinableWith: [] })),
      };
      const res = await http().put(`${base()}/floor-plan`).set(bearer(tok.manager)).send(plan).expect(409);
      expect(res.body.error.details.tables[0].label).toBe('T3');
    });

    it('validates labels, sections and permissions', async () => {
      const snap = (await http().get(`${base()}/floor`).set(bearer(tok.manager))).body as {
        tables: FloorTable[];
      };
      const tables = snap.tables.map(toInput);
      const dup = { tables: tables.map((x) => ({ ...x, label: 'T1' })) };
      await http().put(`${base()}/floor-plan`).set(bearer(tok.manager)).send(dup).expect(400);
      const badSection = { tables: tables.map((x, i) => (i === 0 ? { ...x, sectionId: 'nope' } : x)) };
      await http().put(`${base()}/floor-plan`).set(bearer(tok.manager)).send(badSection).expect(400);
      await http().put(`${base()}/floor-plan`).set(bearer(tok.waiter)).send({ tables }).expect(403);
    });

    it('manages sections; a section with tables cannot be archived', async () => {
      const s = await http()
        .post(`${base()}/sections`)
        .set(bearer(tok.manager))
        .send({ name: 'Rooftop', color: '#ff8800' })
        .expect(201);
      await http()
        .patch(`${base()}/sections/${s.body.id}`)
        .set(bearer(tok.manager))
        .send({ name: 'Terrace' })
        .expect(200);
      await http().delete(`${base()}/sections/${s.body.id}`).set(bearer(tok.manager)).expect(204);
      await http().delete(`${base()}/sections/${t.sections[0]}`).set(bearer(tok.manager)).expect(409);
      await http().post(`${base()}/sections`).set(bearer(tok.host)).send({ name: 'x' }).expect(403);
    });
  });

  describe('staff', () => {
    it('lists staff for hosts and managers, not waiters', async () => {
      const res = await http().get(`${base()}/staff`).set(bearer(tok.host)).expect(200);
      expect(res.body).toHaveLength(5);
      expect(res.body[0]).not.toHaveProperty('pinHash');
      await http().get(`${base()}/staff`).set(bearer(tok.waiter)).expect(403);
    });

    it('managers add floor staff; only owners add managers', async () => {
      const w = await http()
        .post(`${base()}/staff`)
        .set(bearer(tok.manager))
        .send({ name: 'New Waiter', role: 'WAITER', pin: '4321' })
        .expect(201);
      expect(w.body.roles).toEqual(['WAITER']);
      const mgr = {
        name: 'Boss',
        role: 'MANAGER',
        pin: '4322',
        email: `boss.${Date.now()}@test.dinesense.in`,
        password: PASSWORD,
      };
      await http().post(`${base()}/staff`).set(bearer(tok.manager)).send(mgr).expect(403);
      await http().post(`${base()}/staff`).set(bearer(tok.owner)).send(mgr).expect(201);
      // A manager cannot promote a waiter to manager either.
      await http()
        .patch(`${base()}/staff/${w.body.id}`)
        .set(bearer(tok.manager))
        .send({ roles: ['MANAGER'] })
        .expect(403);
    });

    it('changing roles revokes existing sessions', async () => {
      const session = await login(app, t.users.busser.email);
      await http()
        .patch(`${base()}/staff/${t.users.busser.id}`)
        .set(bearer(tok.manager))
        .send({ roles: ['BUSSER', 'WAITER'] })
        .expect(200);
      await http().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
      const fresh = await login(app, t.users.busser.email);
      const me = await http().get('/api/v1/me').set(bearer(fresh.accessToken)).expect(200);
      expect(me.body.outlets[t.outletId].sort()).toEqual(['BUSSER', 'WAITER']);
    });
  });

  describe('shifts', () => {
    const now = Date.now();
    const shiftBody = (userId: string, role = 'WAITER') => ({
      userId,
      role,
      startsAt: new Date(now - 30 * 60_000).toISOString(),
      endsAt: new Date(now + 6 * 3_600_000).toISOString(),
      sectionIds: [t.sections[0]],
      maxTables: 4,
    });

    it('creates, checks in with a stable sequence, breaks and checks out', async () => {
      const waiter2 = await http()
        .post(`${base()}/staff`)
        .set(bearer(tok.manager))
        .send({ name: 'W2', role: 'WAITER', pin: '5555' });
      const s1 = await http()
        .post(`${base()}/shifts`)
        .set(bearer(tok.manager))
        .send(shiftBody(t.users.waiter.id))
        .expect(201);
      const s2 = await http()
        .post(`${base()}/shifts`)
        .set(bearer(tok.manager))
        .send(shiftBody(waiter2.body.id))
        .expect(201);

      // Simultaneous check-ins still get distinct, consecutive sequence numbers.
      const [a, b] = await Promise.all([
        http().post(`${base()}/shifts/${s1.body.id}/check-in`).set(bearer(tok.waiter)),
        http().post(`${base()}/shifts/${s2.body.id}/check-in`).set(bearer(tok.manager)),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect([a.body.checkInSeq, b.body.checkInSeq].sort()).toEqual([1, 2]);

      await http().post(`${base()}/shifts/${s1.body.id}/check-in`).set(bearer(tok.waiter)).expect(409);
      // Waiters manage only their own shift.
      await http()
        .post(`${base()}/shifts/${s2.body.id}/break`)
        .set(bearer(tok.waiter))
        .send({ onBreak: true })
        .expect(403);
      const br = await http()
        .post(`${base()}/shifts/${s1.body.id}/break`)
        .set(bearer(tok.waiter))
        .send({ onBreak: true })
        .expect(200);
      expect(br.body.onBreak).toBe(true);
      const out = await http()
        .post(`${base()}/shifts/${s1.body.id}/check-out`)
        .set(bearer(tok.waiter))
        .expect(200);
      expect(out.body).toMatchObject({ onBreak: false, checkedOutAt: expect.any(String) });

      const list = await http().get(`${base()}/shifts`).set(bearer(tok.waiter)).expect(200);
      expect(list.body.shifts.map((s: { id: string }) => s.id)).toEqual(
        expect.arrayContaining([s1.body.id, s2.body.id]),
      );
      await http().delete(`${base()}/shifts/${s1.body.id}`).set(bearer(tok.manager)).expect(409);
    });

    it('validates role, sections and timing', async () => {
      await http()
        .post(`${base()}/shifts`)
        .set(bearer(tok.manager))
        .send(shiftBody(t.users.busser.id, 'CHEF'))
        .expect(400);
      await http()
        .post(`${base()}/shifts`)
        .set(bearer(tok.manager))
        .send({ ...shiftBody(t.users.waiter.id), sectionIds: ['nope'] })
        .expect(400);
      const future = {
        ...shiftBody(t.users.host.id, 'HOST'),
        startsAt: new Date(now + 5 * 3_600_000).toISOString(),
        endsAt: new Date(now + 9 * 3_600_000).toISOString(),
      };
      const s = await http().post(`${base()}/shifts`).set(bearer(tok.manager)).send(future).expect(201);
      await http().post(`${base()}/shifts/${s.body.id}/check-in`).set(bearer(tok.host)).expect(409);
      await http().delete(`${base()}/shifts/${s.body.id}`).set(bearer(tok.manager)).expect(204);
    });
  });
});
