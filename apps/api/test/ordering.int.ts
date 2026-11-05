import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RateLimitService } from '../src/common/rate-limit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  bearer,
  createApp,
  createMenu,
  createTenant,
  loginAll,
  type MenuFixture,
  randomId,
  type Tenant,
} from './fixtures';

describe('menu, QR ordering, approval and KDS (M3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let m: MenuFixture;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  let chef: string;
  const http = () => request(app.getHttpServer());
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const qr = async (tableId: string) =>
    (await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).qrToken;
  const status = async (tableId: string) =>
    (await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).status;
  const guestSession = async (tableId: string) =>
    (
      await http()
        .post(`/api/v1/g/t/${await qr(tableId)}/session`)
        .send({ deviceId: `dev_${randomId()}${randomId()}` })
        .expect(201)
    ).body.token as string;
  const g = (token: string) => ({ 'x-guest-token': token });
  const dalFull = () => ({ menuItemId: m.items.dal, quantity: 2, modifierIds: [m.portion.full] });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
    m = await createMenu(prisma, t);
    tok = await loginAll(app, t);
    // A chef with dashboard access for the KDS.
    const c = await http()
      .post(`${o()}/staff`)
      .set(bearer(tok.owner))
      .send({
        name: 'Chef',
        role: 'CHEF',
        pin: '7777',
        email: `chef.${randomId()}@test.dinesense.in`,
        password: 'correct-horse-battery',
      });
    chef = (
      await http().post('/api/v1/auth/login').send({ email: c.body.email, password: 'correct-horse-battery' })
    ).body.accessToken;
    await app.listen(0);
  });
  afterAll(async () => app.close());

  describe('menu admin', () => {
    it('managers build the menu; the kitchen toggles stock; others cannot', async () => {
      const group = await http()
        .post(`${o()}/menu/modifier-groups`)
        .set(bearer(tok.manager))
        .send({
          name: { en: 'Spice' },
          minSelect: 0,
          maxSelect: 1,
          modifiers: [
            { name: { en: 'Mild' }, priceDeltaPaise: 0 },
            { name: { en: 'Hot' }, priceDeltaPaise: 0 },
          ],
        })
        .expect(201);
      const item = await http()
        .post(`${o()}/menu/items`)
        .set(bearer(tok.manager))
        .send({
          categoryId: m.categoryId,
          stationId: m.stations.main,
          name: { en: 'Chana Masala', hi: 'चना मसाला' },
          vegType: 'VEG',
          pricePaise: 26_000,
          spiceLevel: 2,
          allergens: ['gluten'],
          modifierGroupIds: [group.body.id],
        })
        .expect(201);
      expect(item.body.modifierGroups[0].modifiers).toHaveLength(2);
      await http().post(`${o()}/menu/items`).set(bearer(tok.waiter)).send({}).expect(403);
      await http()
        .post(`${o()}/menu/items`)
        .set(bearer(tok.manager))
        .send({ ...item.body, id: undefined })
        .expect(400);
      await http()
        .post(`${o()}/menu/items`)
        .set(bearer(tok.manager))
        .send({
          categoryId: m.categoryId,
          stationId: m.stations.main,
          name: { en: 'X' },
          vegType: 'VEG',
          pricePaise: 100,
          taxRateBps: 700,
        })
        .expect(400);

      await http()
        .patch(`${o()}/menu/items/${item.body.id}/availability`)
        .set(bearer(chef))
        .send({ isAvailable: false })
        .expect(200);
      await http()
        .patch(`${o()}/menu/items/${item.body.id}/availability`)
        .set(bearer(tok.waiter))
        .send({ isAvailable: true })
        .expect(403);
      const menu = await http().get(`${o()}/menu`).set(bearer(tok.waiter)).expect(200);
      expect(menu.body.items.find((i: { id: string }) => i.id === item.body.id).isAvailable).toBe(false);
      await http().delete(`${o()}/menu/items/${item.body.id}`).set(bearer(tok.manager)).expect(204);
    });
  });

  describe('guest QR flow', () => {
    it('shows a read-only menu until the party is seated', async () => {
      const landing = await http()
        .get(`/api/v1/g/t/${await qr(t.tables.T1)}`)
        .expect(200);
      expect(landing.body.open).toBe(false);
      const names = landing.body.menu.categories[0].items.map((i: { name: { en: string } }) => i.name.en);
      expect(names).toEqual(expect.arrayContaining(['Dal Makhani', 'Lassi', 'Rasmalai']));
      expect(names).not.toContain('Poha'); // outside its time window
      const res = await http()
        .post(`/api/v1/g/t/${await qr(t.tables.T1)}/session`)
        .send({ deviceId: 'dev_aaaaaaaaaaaaaaaa' })
        .expect(409);
      expect(res.body.error.code).toBe('NO_OPEN_SEATING');
      await http().get('/api/v1/g/t/nope').expect(404);
    });

    it('runs QR order → approval → KDS → ready → served, moving the table along', async () => {
      await http()
        .post(`${o()}/tables/${t.tables.T1}/seat`)
        .set(bearer(tok.host))
        .send({ partySize: 2 })
        .expect(200);
      const phoneA = await guestSession(t.tables.T1);
      const phoneB = await guestSession(t.tables.T1);

      // Phone B listens for the shared cart.
      const addr = app.getHttpServer().address() as { port: number };
      const sock: Socket = io(`http://127.0.0.1:${addr.port}/rt`, {
        auth: { guestToken: phoneB },
        transports: ['websocket'],
        reconnection: false,
      });
      await new Promise<void>((r) => (sock.connected ? r() : sock.once('connect', () => r())));
      const cartPing = new Promise((r) => sock.once('cart.updated', r));

      // Validation: required modifier, sold out, out of window.
      const noPortion = await http()
        .post('/api/v1/g/cart/lines')
        .set(g(phoneA))
        .send({ menuItemId: m.items.dal, quantity: 1 })
        .expect(400);
      expect(noPortion.body.error.code).toBe('INVALID_MODIFIERS');
      for (const id of [m.items.soldOut, m.items.breakfast]) {
        const r = await http()
          .post('/api/v1/g/cart/lines')
          .set(g(phoneA))
          .send({ menuItemId: id, quantity: 1 })
          .expect(409);
        expect(r.body.error.code).toBe('ITEM_UNAVAILABLE');
      }

      await http().post('/api/v1/g/cart/lines').set(g(phoneA)).send(dalFull()).expect(201);
      await http()
        .post('/api/v1/g/cart/lines')
        .set(g(phoneA))
        .send({ ...dalFull(), quantity: 1 })
        .expect(201); // merges
      await cartPing;
      await http()
        .post('/api/v1/g/cart/lines')
        .set(g(phoneB))
        .send({ menuItemId: m.items.lassi, quantity: 2, note: 'less sugar' })
        .expect(201);

      const cartB = await http().get('/api/v1/g/cart').set(g(phoneB)).expect(200);
      expect(cartB.body.lines.map((l: { quantity: number; mine: boolean }) => [l.quantity, l.mine])).toEqual([
        [3, false],
        [2, true],
      ]);
      expect(cartB.body.totals).toEqual({
        subtotalPaise: 114_000,
        cgstPaise: 2_850,
        sgstPaise: 2_850,
        totalPaise: 119_700,
      });

      // Staff/guest tokens are not interchangeable.
      await http().get('/api/v1/g/cart').set(g(tok.waiter)).expect(401);
      await http().get(`${o()}/floor`).set(bearer(phoneA)).expect(401);

      const placed = await http().post('/api/v1/g/orders').set(g(phoneA)).expect(201);
      expect(placed.body).toMatchObject({ status: 'PENDING_APPROVAL', number: 1, source: 'QR' });
      expect((await http().get('/api/v1/g/cart').set(g(phoneB))).body.lines).toEqual([]);
      expect(
        await prisma.task.count({
          where: { orderId: placed.body.id, type: 'APPROVE_ORDER', status: 'OPEN' },
        }),
      ).toBe(1);
      expect(
        (await http().get(`${o()}/kds?station=main`).set(bearer(chef)).expect(200)).body.tickets,
      ).toEqual([]);

      const queue = await http()
        .get(`${o()}/orders?status=PENDING_APPROVAL`)
        .set(bearer(tok.waiter))
        .expect(200);
      expect(queue.body.map((x: { id: string }) => x.id)).toContain(placed.body.id);

      await http().post(`${o()}/orders/${placed.body.id}/approve`).set(bearer(tok.waiter)).expect(200);
      const again = await http()
        .post(`${o()}/orders/${placed.body.id}/approve`)
        .set(bearer(tok.waiter))
        .expect(409);
      expect(again.body.error.code).toBe('ORDER_NOT_PENDING');
      // A QR order does not count as the greet: the table stays OCCUPIED (SLA keeps running).
      expect(await status(t.tables.T1)).toBe('OCCUPIED');

      const kds = await http().get(`${o()}/kds?station=main`).set(bearer(chef)).expect(200);
      expect(kds.body.tickets).toHaveLength(1);
      expect(kds.body.tickets[0]).toMatchObject({
        number: 1,
        tables: ['T1'],
        items: [{ quantity: 3, status: 'QUEUED' }],
      });
      const bar = await http().get(`${o()}/kds?station=bar`).set(bearer(chef)).expect(200);
      expect(bar.body.tickets[0].items[0]).toMatchObject({ quantity: 2, note: 'less sugar' });

      // Greeting after the order landed goes straight to ORDERED.
      await http()
        .post(`${o()}/tables/${t.tables.T1}/transitions`)
        .set(bearer(tok.waiter))
        .send({ event: 'GREET' })
        .expect(200);
      expect(await status(t.tables.T1)).toBe('ORDERED');

      const dalItem = kds.body.tickets[0].items[0].id as string;
      const lassiItem = bar.body.tickets[0].items[0].id as string;
      const move = (id: string, s: string, token: string) =>
        http().patch(`${o()}/order-items/${id}`).set(bearer(token)).send({ status: s });

      await move(dalItem, 'COOKING', tok.waiter).expect(403);
      await move(dalItem, 'COOKING', chef).expect(200);
      await move(dalItem, 'SERVED', chef).expect(409); // must be READY first
      await move(dalItem, 'READY', chef).expect(200);
      const serve = await prisma.task.findFirstOrThrow({ where: { orderId: placed.body.id, type: 'SERVE' } });
      expect(serve).toMatchObject({ status: 'OPEN', assigneeId: t.users.waiter.id });

      await http().post(`${o()}/kds/orders/${placed.body.id}/bump?station=bar`).set(bearer(chef)).expect(200);
      await move(dalItem, 'SERVED', chef).expect(403);
      await move(dalItem, 'SERVED', tok.waiter).expect(200);
      expect(await status(t.tables.T1)).toBe('ORDERED'); // lassi not served yet
      await move(lassiItem, 'SERVED', tok.waiter).expect(200);
      expect(await status(t.tables.T1)).toBe('SERVED');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: serve.id } })).status).toBe('DONE');
      expect((await http().get(`${o()}/kds?station=main`).set(bearer(chef))).body.tickets).toEqual([]);

      // Prices are snapshotted: a later menu price change does not touch the order.
      await prisma.menuItem.update({ where: { id: m.items.dal }, data: { pricePaise: 99_900 } });
      const mine = await http().get('/api/v1/g/orders').set(g(phoneA)).expect(200);
      expect(mine.body.orders[0].items.map((i: { status: string }) => i.status)).toEqual([
        'SERVED',
        'SERVED',
      ]);
      expect(mine.body.bill.subtotalPaise).toBe(114_000);
      await prisma.menuItem.update({ where: { id: m.items.dal }, data: { pricePaise: 30_000 } });

      // Guest buttons.
      expect(
        (await http().post('/api/v1/g/actions').set(g(phoneA)).send({ type: 'WATER' }).expect(201)).body
          .duplicate,
      ).toBe(false);
      expect(
        (await http().post('/api/v1/g/actions').set(g(phoneB)).send({ type: 'WATER' }).expect(201)).body
          .duplicate,
      ).toBe(true);
      const water = await prisma.task.findFirstOrThrow({ where: { tableId: t.tables.T1, type: 'WATER' } });
      expect(water.assigneeId).toBe(t.users.waiter.id);
      await http().post('/api/v1/g/actions').set(g(phoneB)).send({ type: 'BILL' }).expect(201);
      expect(await status(t.tables.T1)).toBe('BILL_REQUESTED');

      // When the seating closes every phone loses access.
      await http()
        .post(`${o()}/tables/${t.tables.T1}/transitions`)
        .set(bearer(tok.manager))
        .send({ event: 'STAFF_MARK_LEFT' })
        .expect(200);
      const ended = await http().get('/api/v1/g/cart').set(g(phoneA)).expect(409);
      expect(ended.body.error.code).toBe('NO_OPEN_SEATING');
      sock.close();
    });

    it('a rejected QR order never reaches the kitchen and the guest sees why', async () => {
      await http()
        .post(`${o()}/tables/${t.tables.T2}/seat`)
        .set(bearer(tok.host))
        .send({ partySize: 4 })
        .expect(200);
      const phone = await guestSession(t.tables.T2);
      await http()
        .post('/api/v1/g/cart/lines')
        .set(g(phone))
        .send({ menuItemId: m.items.lassi, quantity: 40 })
        .expect(201);
      const order = await http().post('/api/v1/g/orders').set(g(phone)).expect(201);
      await http()
        .post(`${o()}/orders/${order.body.id}/reject`)
        .set(bearer(tok.waiter))
        .send({ reason: 'Prank — 40 lassis' })
        .expect(200);
      const seen = await http().get('/api/v1/g/orders').set(g(phone)).expect(200);
      expect(seen.body.orders[0]).toMatchObject({ status: 'REJECTED', rejectedReason: 'Prank — 40 lassis' });
      expect(seen.body.bill.totalPaise).toBe(0);
      expect((await http().get(`${o()}/kds?station=bar`).set(bearer(chef))).body.tickets).toEqual([]);
      await http()
        .post(`${o()}/tables/${t.tables.T2}/transitions`)
        .set(bearer(tok.manager))
        .send({ event: 'FORCE_STATE', to: 'VACANT' })
        .expect(200);
    });

    it('skips approval when the outlet turns it off', async () => {
      await prisma.outletSettings.update({
        where: { outletId: t.outletId },
        data: { qrOrderNeedsApproval: false },
      });
      await http()
        .post(`${o()}/tables/${t.tables.T3}/seat`)
        .set(bearer(tok.host))
        .send({ partySize: 2 })
        .expect(200);
      const phone = await guestSession(t.tables.T3);
      await http()
        .post('/api/v1/g/cart/lines')
        .set(g(phone))
        .send({ menuItemId: m.items.lassi, quantity: 1 })
        .expect(201);
      expect((await http().post('/api/v1/g/orders').set(g(phone)).expect(201)).body.status).toBe('ACCEPTED');
      expect((await http().get(`${o()}/kds?station=bar`).set(bearer(chef))).body.tickets).toHaveLength(1);
      await prisma.outletSettings.update({
        where: { outletId: t.outletId },
        data: { qrOrderNeedsApproval: true },
      });
    });
  });

  describe('waiter-assisted order', () => {
    it('goes straight to the kitchen, counts as greet and makes the waiter the server', async () => {
      await http()
        .post(`${o()}/tables/${t.tables.T4}/seat`)
        .set(bearer(tok.host))
        .send({ partySize: 3 })
        .expect(200);
      const order = await http()
        .post(`${o()}/tables/${t.tables.T4}/orders`)
        .set(bearer(tok.waiter))
        .send({ items: [{ ...dalFull(), modifierIds: [m.portion.half] }] })
        .expect(201);
      expect(order.body).toMatchObject({
        status: 'ACCEPTED',
        source: 'WAITER',
        items: [{ unitPricePaise: 20_000, quantity: 2 }],
      });
      expect(await status(t.tables.T4)).toBe('ORDERED');
      const seating = await prisma.seating.findFirstOrThrow({
        where: { tables: { some: { tableId: t.tables.T4, isOpen: true } } },
      });
      expect(seating).toMatchObject({
        servingWaiterId: t.users.waiter.id,
        greetedAt: expect.any(Date),
        firstOrderAt: expect.any(Date),
      });
      await http()
        .post(`${o()}/tables/${t.tables.T4}/orders`)
        .set(bearer(tok.busser))
        .send({ items: [dalFull()] })
        .expect(403);
      const listed = await http()
        .get(`${o()}/tables/${t.tables.T4}/orders`)
        .set(bearer(tok.host))
        .expect(200);
      expect(listed.body).toHaveLength(1);
    });

    it('cannot order for a table without an open seating', async () => {
      await http()
        .post(`${o()}/tables/${t.tables.T1}/transitions`)
        .set(bearer(tok.busser))
        .send({ event: 'CLEAN_CONFIRMED' });
      const r = await http()
        .post(`${o()}/tables/${t.tables.T1}/orders`)
        .set(bearer(tok.waiter))
        .send({ items: [dalFull()] })
        .expect(409);
      expect(r.body.error.code).toBe('NO_OPEN_SEATING');
    });
  });

  it('rate limits by key within a window', async () => {
    const rl = app.get(RateLimitService);
    const key = `test-${randomId()}`;
    for (let i = 0; i < 3; i++) await rl.hit(key, 3, 60);
    await expect(rl.hit(key, 3, 60)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
