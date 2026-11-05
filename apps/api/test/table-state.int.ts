import type { INestApplication } from '@nestjs/common';
import type { TableUpdatedPayload } from '@dinesense/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { TableStateService } from '../src/table-state/table-state.service';
import { bearer, createApp, createTenant, loginAll, randomId, type Tenant } from './fixtures';

describe('table state (M2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  const http = () => request(app.getHttpServer());
  const url = (tableId: string, path: string) => `/api/v1/outlets/${t.outletId}/tables/${tableId}/${path}`;
  const seat = (tableId: string, body: object, token = tok.host) =>
    http().post(url(tableId, 'seat')).set(bearer(token)).send(body);
  const send = (tableId: string, body: object, token: string) =>
    http().post(url(tableId, 'transitions')).set(bearer(token)).send(body);
  const status = async (tableId: string) =>
    (await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).status;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
    tok = await loginAll(app, t);
  });
  afterAll(async () => app.close());

  it('runs a full manual service: seat → greet → bill → leave → clean', async () => {
    const seated = await seat(t.tables.T1, { partySize: 3, notes: 'birthday' }).expect(200);
    expect(seated.body.tables[0]).toMatchObject({
      status: 'OCCUPIED',
      version: 1,
      seating: { partySize: 3, notes: 'birthday' },
    });

    const greeted = await send(t.tables.T1, { event: 'GREET', expectedVersion: 1 }, tok.waiter).expect(200);
    expect(greeted.body.tables[0]).toMatchObject({
      status: 'GREETED',
      seating: { servingWaiter: { id: t.users.waiter.id } },
    });

    await send(t.tables.T1, { event: 'REQUEST_BILL' }, tok.waiter).expect(200);
    const billTask = await prisma.task.findFirstOrThrow({ where: { tableId: t.tables.T1, type: 'BILL' } });
    expect(billTask).toMatchObject({ status: 'OPEN', assigneeId: t.users.waiter.id });

    // Nothing was ordered, so a waiter may mark the party as left.
    await send(t.tables.T1, { event: 'STAFF_MARK_LEFT' }, tok.waiter).expect(200);
    expect(await status(t.tables.T1)).toBe('NEEDS_CLEANING');
    const tasks = await prisma.task.findMany({
      where: { tableId: t.tables.T1 },
      orderBy: { createdAt: 'asc' },
    });
    expect(tasks.map((x) => [x.type, x.status])).toEqual([
      ['BILL', 'CANCELLED'],
      ['CLEAN', 'OPEN'],
    ]);

    await send(t.tables.T1, { event: 'CLEAN_CONFIRMED' }, tok.busser).expect(200);
    expect(await status(t.tables.T1)).toBe('VACANT');
    const clean = await prisma.task.findFirstOrThrow({ where: { tableId: t.tables.T1, type: 'CLEAN' } });
    expect(clean).toMatchObject({ status: 'DONE', doneById: t.users.busser.id });

    const seating = await prisma.seating.findFirstOrThrow({
      where: { tables: { some: { tableId: t.tables.T1 } } },
    });
    expect(seating).toMatchObject({ status: 'CLOSED', greetedById: t.users.waiter.id });
    for (const k of [
      'seatedAt',
      'greetedAt',
      'billRequestedAt',
      'leftAt',
      'closedAt',
      'cleanedAt',
    ] as const) {
      expect(seating[k], k).toBeInstanceOf(Date);
    }

    const events = await prisma.tableEvent.findMany({
      where: { tableId: t.tables.T1 },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual([
      'VACANT>OCCUPIED',
      'OCCUPIED>GREETED',
      'GREETED>BILL_REQUESTED',
      'BILL_REQUESTED>NEEDS_CLEANING',
      'NEEDS_CLEANING>VACANT',
    ]);
    expect(
      await prisma.auditLog.count({ where: { entityId: t.tables.T1, action: 'table.transition' } }),
    ).toBe(5);

    const timeline = await http().get(url(t.tables.T1, 'timeline')).set(bearer(tok.manager)).expect(200);
    expect(timeline.body.events[0]).toMatchObject({
      type: 'CLEAN_CONFIRMED',
      actorName: expect.stringContaining('busser'),
    });
  });

  it('rejects invalid transitions, wrong roles and stale versions with clear codes', async () => {
    await seat(t.tables.T2, { partySize: 2 }).expect(200);
    expect((await seat(t.tables.T2, { partySize: 2 }).expect(409)).body.error.code).toBe(
      'TABLE_INVALID_TRANSITION',
    );
    expect((await send(t.tables.T2, { event: 'GREET' }, tok.busser).expect(403)).body.error.code).toBe(
      'FORBIDDEN',
    );
    const stale = await send(t.tables.T2, { event: 'GREET', expectedVersion: 0 }, tok.waiter).expect(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 1 } });
    // Clients cannot inject system events (orders, payments) through the staff endpoint.
    await send(t.tables.T2, { event: 'PAYMENT_CAPTURED' }, tok.manager).expect(400);
    await send(t.tables.T2, { event: 'FORCE_STATE', to: 'VACANT' }, tok.manager).expect(200);
    expect(await status(t.tables.T2)).toBe('VACANT');
  });

  it('only one of two simultaneous seat requests wins', async () => {
    const results = await Promise.all([
      seat(t.tables.T3, { partySize: 2 }),
      seat(t.tables.T3, { partySize: 4 }, tok.manager),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.seatingTable.count({ where: { tableId: t.tables.T3, isOpen: true } })).toBe(1);
    await send(t.tables.T3, { event: 'FORCE_STATE', to: 'VACANT' }, tok.manager).expect(200);
  });

  it('joins tables into one seating that moves together', async () => {
    const res = await seat(t.tables.T1, { partySize: 7, joinTableIds: [t.tables.T2] }).expect(200);
    expect(res.body.tables.map((x: TableUpdatedPayload) => x.status)).toEqual(['OCCUPIED', 'OCCUPIED']);
    const [a, b] = res.body.tables as TableUpdatedPayload[];
    expect(a!.seating!.id).toBe(b!.seating!.id);

    // Acting on either table moves both.
    await send(t.tables.T2, { event: 'GREET' }, tok.waiter).expect(200);
    expect([await status(t.tables.T1), await status(t.tables.T2)]).toEqual(['GREETED', 'GREETED']);

    // A busy table cannot be joined.
    const busy = await seat(t.tables.T3, { partySize: 2, joinTableIds: [t.tables.T1] }).expect(409);
    expect(busy.body.error.details.tables[0].id).toBe(t.tables.T1);
    expect(await status(t.tables.T3)).toBe('VACANT'); // rolled back

    await send(t.tables.T1, { event: 'FORCE_STATE', to: 'NEEDS_CLEANING' }, tok.manager).expect(200);
    expect([await status(t.tables.T1), await status(t.tables.T2)]).toEqual([
      'NEEDS_CLEANING',
      'NEEDS_CLEANING',
    ]);
    await send(t.tables.T1, { event: 'CLEAN_CONFIRMED' }, tok.busser).expect(200);
    await send(t.tables.T2, { event: 'CLEAN_CONFIRMED' }, tok.busser).expect(200);
  });

  it('managers force any state, keeping the seating consistent', async () => {
    await send(t.tables.T4, { event: 'FORCE_STATE', to: 'ORDERED' }, tok.manager).expect(200);
    expect(await prisma.seatingTable.count({ where: { tableId: t.tables.T4, isOpen: true } })).toBe(1);
    await send(t.tables.T4, { event: 'FORCE_STATE', to: 'VACANT' }, tok.manager).expect(200);
    expect(await prisma.seatingTable.count({ where: { tableId: t.tables.T4, isOpen: true } })).toBe(0);
    await send(t.tables.T4, { event: 'FORCE_STATE', to: 'PAID' }, tok.host).expect(403);
  });

  it("hides other tenants' tables", async () => {
    const other = await createTenant(prisma, { floor: true });
    const res = await http()
      .post(`/api/v1/outlets/${other.outletId}/tables/${other.tables.T1}/seat`)
      .set(bearer(tok.manager))
      .send({ partySize: 2 })
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // Own outlet, foreign table id.
    await seat(other.tables.T1, { partySize: 2 }, tok.manager).expect(404);
  });

  describe('camera events (service level)', () => {
    const svc = () => app.get(TableStateService);
    const camera = (event: Parameters<TableStateService['apply']>[0]['event'], eventId?: string) =>
      svc().apply({
        organizationId: t.organizationId,
        outletId: t.outletId,
        tableId: t.tables.T4,
        event,
        actor: { kind: 'CAMERA', deviceId: 'edge-1' },
        audit: { organizationId: t.organizationId, type: 'DEVICE', id: 'edge-1' },
        source: 'CAMERA',
        eventId,
        confidence: 0.92,
      });

    it('seats from the camera, dedupes by eventId, and alerts on an unpaid departure', async () => {
      // Edge event ids are UUIDs; keep them unique per run since the test DB persists.
      const occ = `evt-occ-${randomId()}`;
      const first = await camera({ type: 'CAMERA_OCCUPIED', guestCount: 3 }, occ);
      expect(first.tables[0]).toMatchObject({ status: 'OCCUPIED', seating: { partySize: 3 } });
      expect((await camera({ type: 'CAMERA_OCCUPIED', guestCount: 3 }, occ)).duplicate).toBe(true);

      // Simulate an accepted order so the table owes money.
      const seatingId = first.tables[0]!.seating!.id;
      const station = await prisma.kitchenStation.create({
        data: { organizationId: t.organizationId, outletId: t.outletId, code: 'main', name: { en: 'Main' } },
      });
      const category = await prisma.menuCategory.create({
        data: { organizationId: t.organizationId, outletId: t.outletId, name: { en: 'C' } },
      });
      const item = await prisma.menuItem.create({
        data: {
          organizationId: t.organizationId,
          outletId: t.outletId,
          categoryId: category.id,
          stationId: station.id,
          name: { en: 'Dal' },
          vegType: 'VEG',
          pricePaise: 20_000,
          allergens: [],
        },
      });
      await prisma.order.create({
        data: {
          organizationId: t.organizationId,
          outletId: t.outletId,
          seatingId,
          number: 1,
          source: 'WAITER',
          status: 'ACCEPTED',
          items: {
            create: {
              organizationId: t.organizationId,
              outletId: t.outletId,
              menuItemId: item.id,
              nameSnapshot: { en: 'Dal' },
              stationId: station.id,
              quantity: 1,
              unitPricePaise: 20_000,
              taxRateBps: 500,
            },
          },
        },
      });

      const left = await camera({ type: 'CAMERA_VACATED' }, `evt-vac-${randomId()}`);
      expect(left.tables[0]!.status).toBe('OCCUPIED'); // never auto-closed while money is owed
      const alerts = await http()
        .get(`/api/v1/outlets/${t.outletId}/alerts`)
        .set(bearer(tok.manager))
        .expect(200);
      expect(alerts.body).toEqual([
        expect.objectContaining({ type: 'LEFT_WITHOUT_PAYING', severity: 'CRITICAL', tableId: t.tables.T4 }),
      ]);

      // Waiters cannot close an unpaid table; managers can.
      await send(t.tables.T4, { event: 'STAFF_MARK_LEFT' }, tok.waiter).expect(403);
      await send(t.tables.T4, { event: 'STAFF_MARK_LEFT' }, tok.manager).expect(200);

      const acked = await http()
        .post(`/api/v1/outlets/${t.outletId}/alerts/${alerts.body[0].id}/ack`)
        .set(bearer(tok.host))
        .expect(200);
      expect(acked.body).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedById: t.users.host.id });
    });
  });

  describe('Socket.IO', () => {
    let base: string;
    const connect = (token?: string) =>
      io(`${base}/rt`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });

    // Resolves immediately if the socket already connected while we were awaiting something else.
    const connected = (s: Socket) =>
      new Promise<void>((resolve) => (s.connected ? resolve() : s.once('connect', () => resolve())));

    beforeAll(async () => {
      await app.listen(0);
      const addr = app.getHttpServer().address() as { port: number };
      base = `http://127.0.0.1:${addr.port}`;
    });

    it('pushes table.updated to staff of the outlet, and nobody else', async () => {
      const mine = connect(tok.waiter);
      const other = await createTenant(prisma);
      const foreign = connect((await loginAll(app, other)).manager);
      await Promise.all([mine, foreign].map(connected));
      const foreignEvents: unknown[] = [];
      foreign.on('table.updated', (p) => foreignEvents.push(p));

      const received = new Promise<TableUpdatedPayload>((resolve) => mine.on('table.updated', resolve));
      await seat(t.tables.T3, { partySize: 5 }).expect(200);
      const payload = await received;
      expect(payload).toMatchObject({
        v: 1,
        tableId: t.tables.T3,
        status: 'OCCUPIED',
        seating: { partySize: 5 },
      });

      await new Promise((r) => setTimeout(r, 100));
      expect(foreignEvents).toEqual([]);
      [mine, foreign].forEach((s: Socket) => s.close());
    });

    it('disconnects sockets without a valid token', async () => {
      const s = connect('not-a-token');
      await new Promise<void>((resolve) => s.on('disconnect', () => resolve()));
      expect(s.connected).toBe(false);
      s.close();
    });
  });
});
