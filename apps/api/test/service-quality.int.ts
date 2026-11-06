import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ServiceEngine } from '../src/service-quality/service-engine.service';
import { bearer, createApp, createMenu, createTenant, loginAll, randomId, type Tenant } from './fixtures';

const MIN = 60_000;

describe('service quality on the floor (M10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: ServiceEngine;
  let t: Tenant;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  let items: { starter: string; main: string; dessert: string };
  const http = () => request(app.getHttpServer());
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
  const sweep = (minutes: number) => engine.sweep(new Date(Date.now() + minutes * MIN), t.outletId);
  const seatingOf = async (tableId: string) =>
    prisma.seating.findFirstOrThrow({ where: { tables: { some: { tableId, isOpen: true } } } });
  const seatAndGreet = async (tableId: string) => {
    await http()
      .post(`${o()}/tables/${tableId}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 2 })
      .expect(200);
    await http()
      .post(`${o()}/tables/${tableId}/transitions`)
      .set(bearer(tok.waiter))
      .send({ event: 'GREET' })
      .expect(200);
  };
  const order = (tableId: string, ids: string[]) =>
    http()
      .post(`${o()}/tables/${tableId}/orders`)
      .set(bearer(tok.waiter))
      .send({ items: ids.map((menuItemId) => ({ menuItemId, quantity: 1 })) })
      .expect(201);
  const move = (itemId: string, status: string, token = tok.manager) =>
    http().patch(`${o()}/order-items/${itemId}`).set(bearer(token)).send({ status }).expect(200);
  const serve = async (itemId: string) => {
    await move(itemId, 'READY');
    await move(itemId, 'SERVED', tok.waiter);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    engine = app.get(ServiceEngine);
    t = await createTenant(prisma, { floor: true });
    tok = await loginAll(app, t);
    const m = await createMenu(prisma, t);
    const base = { organizationId: t.organizationId, outletId: t.outletId };
    const cat = (en: string, course: 'STARTER' | 'MAIN' | 'DESSERT') =>
      prisma.menuCategory.create({ data: { ...base, name: { en }, course } });
    const item = async (en: string, categoryId: string) =>
      (
        await prisma.menuItem.create({
          data: {
            ...base,
            categoryId,
            stationId: m.stations.main,
            name: { en },
            vegType: 'VEG',
            pricePaise: 20_000,
            allergens: [],
          },
        })
      ).id;
    items = {
      starter: await item('Paneer Tikka', (await cat('Starters', 'STARTER')).id),
      main: await item('Kadhai Paneer', (await cat('Mains', 'MAIN')).id),
      dessert: await item('Gulab Jamun', (await cat('Desserts', 'DESSERT')).id),
    };
    await http()
      .patch(`${o()}/settings`)
      .set(bearer(tok.manager))
      .send({ pacingEnabled: true, midMealCheckMinutes: 10 })
      .expect(200);
  });
  afterAll(async () => app.close());

  it('validates the idle and pacing ladders', async () => {
    await http()
      .patch(`${o()}/settings`)
      .set(bearer(tok.manager))
      .send({ idleNudgeMinutes: 20, idleAlertMinutes: 10 })
      .expect(400);
    await http()
      .patch(`${o()}/settings`)
      .set(bearer(tok.manager))
      .send({ fireMainsAfterMinutes: 10, autoFireMinutes: 5 })
      .expect(400);
  });

  it('idle table: nudges the serving waiter once, then alerts managers; a staff touch ends it', async () => {
    await seatAndGreet(t.tables.T1);
    const seating = await seatingOf(t.tables.T1);
    expect(seating.lastStaffTouchAt).not.toBeNull();

    expect((await sweep(14)).nudges).toBe(0);
    expect((await sweep(16)).nudges).toBe(1);
    expect((await sweep(17)).nudges).toBe(0); // once per idle episode
    const nudge = await prisma.task.findFirstOrThrow({
      where: { seatingId: seating.id, type: 'CHECK_TABLE' },
    });
    expect(nudge).toMatchObject({ status: 'OPEN', assigneeId: t.users.waiter.id });

    expect((await sweep(26)).alerts).toBe(1);
    expect((await sweep(27)).alerts).toBe(0);
    const alert = await prisma.alert.findFirstOrThrow({
      where: { seatingId: seating.id, type: 'IDLE_TABLE' },
    });
    expect(alert).toMatchObject({ status: 'OPEN', severity: 'WARNING' });

    // The waiter goes to the table and ticks the nudge off: touch → alert resolved.
    await http().post(`${o()}/tasks/${nudge.id}/done`).set(bearer(tok.waiter)).expect(200);
    expect((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).status).toBe('RESOLVED');
    expect((await seatingOf(t.tables.T1)).lastStaffTouchAt!.getTime()).toBeGreaterThan(
      seating.lastStaffTouchAt!.getTime(),
    );
  });

  it('course pacing: mains wait for starters, a prompt to fire them, the waiter fires; ETAs on queued items', async () => {
    await seatAndGreet(t.tables.T2);
    const created = await order(t.tables.T2, [items.starter, items.main]);
    const byMenu = (id: string) =>
      created.body.items.find((i: { menuItemId: string }) => i.menuItemId === id);
    const starter = byMenu(items.starter);
    const main = byMenu(items.main);
    expect(starter).toMatchObject({ status: 'QUEUED', course: 'STARTER' });
    expect(main).toMatchObject({ status: 'HELD', course: 'MAIN', etaReadyAt: null });
    // No history yet → the default 15 min.
    const eta = new Date(starter.etaReadyAt).getTime() - new Date(starter.queuedAt).getTime();
    expect(eta).toBeGreaterThanOrEqual(15 * MIN);

    // The kitchen sees the held main greyed out on its ticket; bump leaves it alone.
    const kds = await http().get(`${o()}/kds?station=main`).set(bearer(tok.manager)).expect(200);
    const ticket = kds.body.tickets.find((x: { orderId: string }) => x.orderId === created.body.id);
    expect(ticket.items.map((i: { status: string }) => i.status).sort()).toEqual(['HELD', 'QUEUED']);
    await http()
      .post(`${o()}/kds/orders/${created.body.id}/bump?station=main`)
      .set(bearer(tok.manager))
      .expect(200);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: main.id } })).status).toBe('HELD');
    // Items cannot be moved out of HELD one by one.
    await http()
      .patch(`${o()}/order-items/${main.id}`)
      .set(bearer(tok.manager))
      .send({ status: 'READY' })
      .expect(409);

    await move(starter.id, 'SERVED', tok.waiter);
    expect((await sweep(5)).firePrompts).toBe(0);
    expect((await sweep(9)).firePrompts).toBe(1);
    expect((await sweep(10)).firePrompts).toBe(0);
    const seating = await seatingOf(t.tables.T2);
    const prompt = await prisma.task.findFirstOrThrow({
      where: { seatingId: seating.id, type: 'FIRE_COURSE' },
    });
    expect(prompt.assigneeId).toBe(t.users.waiter.id);

    const fired = await http().post(`${o()}/tables/${t.tables.T2}/fire`).set(bearer(tok.waiter)).expect(200);
    expect(fired.body).toEqual({ fired: 1 });
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: main.id } });
    expect(after.status).toBe('QUEUED');
    expect(after.firedAt).not.toBeNull();
    expect(after.etaReadyAt).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: prompt.id } })).status).toBe('DONE');
    await http().post(`${o()}/tables/${t.tables.T2}/fire`).set(bearer(tok.waiter)).expect(200, { fired: 0 });

    // Dessert: mains served a while ago and nothing sweet ordered → offer dessert, once.
    await serve(main.id);
    expect((await sweep(10)).dessertOffers).toBe(0);
    expect((await sweep(16)).dessertOffers).toBe(1);
    expect((await sweep(30)).dessertOffers).toBe(0);
    expect(await prisma.task.count({ where: { seatingId: seating.id, type: 'OFFER_DESSERT' } })).toBe(1);
  });

  it('held mains go to the kitchen by themselves when nobody fires them', async () => {
    await seatAndGreet(t.tables.T3);
    const created = await order(t.tables.T3, [items.starter, items.main]);
    const [starter, main] = [items.starter, items.main].map((id) =>
      created.body.items.find((i: { menuItemId: string }) => i.menuItemId === id),
    );
    await serve(starter.id);
    expect((await sweep(21)).fired).toBe(1);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: main.id } })).status).toBe('QUEUED');
    const fire = await prisma.auditLog.findFirst({
      where: { organizationId: t.organizationId, action: 'order.course.fire', actorType: 'SYSTEM' },
    });
    expect(fire).not.toBeNull();
  });

  it('mid-meal check-in: asked once after food is served; a thumbs-down alerts managers at once', async () => {
    await seatAndGreet(t.tables.T4);
    const qr = (await prisma.table.findUniqueOrThrow({ where: { id: t.tables.T4 } })).qrToken;
    const token = (
      await http()
        .post(`/api/v1/g/t/${qr}/session`)
        .set('x-forwarded-for', ip)
        .send({ deviceId: `dev_${randomId()}${randomId()}` })
        .expect(201)
    ).body.token as string;
    const g = { 'x-guest-token': token, 'x-forwarded-for': ip };
    const created = await order(t.tables.T4, [items.dessert]);
    const guestOrders = async () => (await http().get('/api/v1/g/orders').set(g).expect(200)).body;
    const before = await guestOrders();
    expect(before.checkIn).toBe(false);
    expect(before.orders[0].etaReadyAt).toEqual(expect.any(String));

    await serve(created.body.items[0].id);
    expect((await guestOrders()).checkIn).toBe(false); // not yet 10 minutes
    await prisma.orderItem.update({
      where: { id: created.body.items[0].id },
      data: { servedAt: new Date(Date.now() - 11 * MIN) },
    });
    expect((await guestOrders()).checkIn).toBe(true);

    await http()
      .post('/api/v1/g/feedback')
      .set(g)
      .send({ positive: false, comment: 'Food is cold', extra: 1 })
      .expect(400);
    const sent = await http()
      .post('/api/v1/g/feedback')
      .set(g)
      .send({ positive: false, comment: 'Food is cold' })
      .expect(201);
    expect(sent.body).toEqual({ ok: true, duplicate: false });
    expect((await guestOrders()).checkIn).toBe(false);
    const seating = await seatingOf(t.tables.T4);
    const alert = await prisma.alert.findFirstOrThrow({
      where: { seatingId: seating.id, type: 'GUEST_UNHAPPY' },
    });
    expect(alert.message).toContain('Food is cold');
    const task = await prisma.task.findFirstOrThrow({
      where: { seatingId: seating.id, type: 'SERVICE_RECOVERY' },
    });
    expect(task.status).toBe('OPEN');
    // Managers see it in their inbox; waiters don't.
    const mine = await http().get(`${o()}/tasks?scope=mine`).set(bearer(tok.manager)).expect(200);
    expect(mine.body.map((x: { id: string }) => x.id)).toContain(task.id);
    const waiter = await http().get(`${o()}/tasks?scope=mine`).set(bearer(tok.waiter)).expect(200);
    expect(waiter.body.map((x: { id: string }) => x.id)).not.toContain(task.id);
    // Once per device.
    const again = await http().post('/api/v1/g/feedback').set(g).send({ positive: true }).expect(201);
    expect(again.body.duplicate).toBe(true);
  });

  it('tips: recorded on the payment for the serving waiter, never on the bill; shown in the day report', async () => {
    const bill = (await http().post(`${o()}/tables/${t.tables.T2}/bills`).set(bearer(tok.waiter)).expect(200))
      .body as { id: string; totalPaise: number };
    const paid = await http()
      .post(`${o()}/bills/${bill.id}/payments`)
      .set(bearer(tok.owner))
      .send({ method: 'UPI', amountPaise: bill.totalPaise, tipPaise: 5_000 })
      .expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.totalPaise).toBe(bill.totalPaise);
    const payment = await prisma.payment.findFirstOrThrow({ where: { billId: bill.id } });
    expect(payment).toMatchObject({
      amountPaise: bill.totalPaise,
      tipPaise: 5_000,
      tipWaiterId: t.users.waiter.id,
    });

    const report = await http().get(`${o()}/reports/day`).set(bearer(tok.manager)).expect(200);
    expect(report.body.tips).toEqual({ totalPaise: 5_000, unattributedPaise: 0 });
    expect(
      report.body.waiters.find((w: { waiterId: string }) => w.waiterId === t.users.waiter.id).tipsPaise,
    ).toBe(5_000);
    expect(report.body.sales.totalPaise).toBe(bill.totalPaise);
    expect(report.body.service.midMeal).toEqual({ positive: 0, negative: 1 });
    expect(report.body.service.idleAlerts).toBeGreaterThanOrEqual(1);
  });
});
