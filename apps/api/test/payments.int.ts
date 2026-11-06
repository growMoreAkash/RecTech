import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET!;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;
const run = randomId();
const randomInt = (n: number) => Math.floor(Math.random() * n);
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

describe('split bills and pay-at-table (M7)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let m: MenuFixture;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  let mock: Server;
  const orders: { amount: number; receipt: string; auth: string }[] = [];
  let failOrders = false;
  const http = () => request(app.getHttpServer());
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const g = (token: string) => ({ 'x-guest-token': token });
  const tableStatus = async (id: string) => (await prisma.table.findUniqueOrThrow({ where: { id } })).status;

  async function guest(tableId: string) {
    const { qrToken } = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    return (
      (
        await http()
          .post(`/api/v1/g/t/${qrToken}/session`)
          // Per-IP limits live in Redis across runs; each run looks like a different phone network.
          .set('x-forwarded-for', `10.${randomInt(250)}.${randomInt(250)}.${randomInt(250)}`)
          .send({ deviceId: `dev_${randomId()}${randomId()}` })
          .expect(201)
      ).body.token as string
    );
  }

  /** Seated table with 2 × dal (₹300 each) + 1 × lassi (₹120) ordered by the waiter. */
  async function servedTable(tableId: string) {
    await http()
      .post(`${o()}/tables/${tableId}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 3 })
      .expect(200);
    await http()
      .post(`${o()}/tables/${tableId}/orders`)
      .set(bearer(tok.waiter))
      .send({
        items: [
          { menuItemId: m.items.dal, quantity: 2, modifierIds: [m.portion.full] },
          { menuItemId: m.items.lassi, quantity: 1 },
        ],
      })
      .expect(201);
    return (await http().post(`${o()}/tables/${tableId}/bills`).set(bearer(tok.waiter)).expect(200)).body as {
      id: string;
      totalPaise: number;
      lines: { id: string; description: string }[];
    };
  }

  function webhook(
    event: string,
    orderId: string,
    paymentId: string,
    amount: number,
    secret = WEBHOOK_SECRET,
  ) {
    const body = JSON.stringify({
      event,
      payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } } },
    });
    return http()
      .post('/api/v1/payments/razorpay/webhook')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', hmac(secret, body))
      .send(body);
  }

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        if (req.method !== 'POST' || req.url !== '/v1/orders' || failOrders) {
          res.writeHead(failOrders ? 500 : 404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { description: 'nope' } }));
        }
        const body = JSON.parse(data) as { amount: number; receipt: string; currency: string };
        orders.push({ amount: body.amount, receipt: body.receipt, auth: req.headers.authorization ?? '' });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: `order_${randomId()}`, amount: body.amount, currency: body.currency }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    process.env.RAZORPAY_API_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
    m = await createMenu(prisma, t);
    tok = await loginAll(app, t);
  });
  afterAll(async () => {
    await app.close();
    await new Promise((r) => mock.close(r));
  });

  it('splits a bill equally, by item and custom; shares are paid separately at the counter', async () => {
    const bill = await servedTable(t.tables.T1);
    expect(bill.totalPaise).toBe(75_600); // ₹720 + 5% GST

    const equal = await http()
      .put(`${o()}/bills/${bill.id}/split`)
      .set(bearer(tok.waiter))
      .send({ mode: 'EQUAL', ways: 3 })
      .expect(200);
    expect(equal.body.status).toBe('FINALIZED'); // splitting freezes the bill
    expect(equal.body.split.shares.map((s: { amountPaise: number }) => s.amountPaise)).toEqual([
      25_200, 25_200, 25_200,
    ]);

    const [dal, lassi] = equal.body.lines as { id: string }[];
    const byItem = await http()
      .put(`${o()}/bills/${bill.id}/split`)
      .set(bearer(tok.waiter))
      .send({
        mode: 'BY_ITEM',
        shares: [
          { label: 'Asha', lineIds: [dal!.id] },
          { label: 'Ravi', lineIds: [lassi!.id, dal!.id] },
        ],
      })
      .expect(200);
    const shares = byItem.body.split.shares as { key: string; amountPaise: number; label: string }[];
    expect(shares.reduce((s, x) => s + x.amountPaise, 0)).toBe(75_600);
    expect(shares[0]).toMatchObject({ label: 'Asha', amountPaise: 31_500 }); // half the dal
    expect(shares[1]!.amountPaise).toBe(31_500 + 12_600);

    await http()
      .put(`${o()}/bills/${bill.id}/split`)
      .set(bearer(tok.waiter))
      .send({ mode: 'CUSTOM', shares: [{ amountPaise: 50_000 }, { amountPaise: 20_000 }] })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe('SPLIT_INVALID'));
    await http()
      .put(`${o()}/bills/${bill.id}/split`)
      .set(bearer(tok.waiter))
      .send({ mode: 'BY_ITEM', shares: [{ lineIds: [dal!.id] }, { lineIds: [dal!.id] }] })
      .expect(400);

    // Ravi pays his share in two goes, Asha pays hers: table → PAID.
    await http()
      .post(`${o()}/bills/${bill.id}/payments`)
      .set(bearer(tok.waiter))
      .send({ method: 'CASH', amountPaise: 100, shareKey: 's2' })
      .expect(403);
    await http()
      .post(`${o()}/bills/${bill.id}/payments`)
      .set(bearer(tok.owner))
      .send({ method: 'UPI', amountPaise: 44_200, shareKey: 's2' })
      .expect(409)
      .expect((r) => expect(r.body.error.details.duePaise).toBe(44_100));
    await http()
      .post(`${o()}/bills/${bill.id}/payments`)
      .set(bearer(tok.owner))
      .send({ method: 'UPI', amountPaise: 40_000, shareKey: 's2' })
      .expect(200);
    // Re-splitting after money was taken is refused.
    await http().delete(`${o()}/bills/${bill.id}/split`).set(bearer(tok.owner)).expect(409);
    const part = await http()
      .post(`${o()}/bills/${bill.id}/payments`)
      .set(bearer(tok.owner))
      .send({ method: 'CASH', amountPaise: 4_100, shareKey: 's2' })
      .expect(200);
    expect(part.body.split.shares[1]).toMatchObject({ paidPaise: 44_100, duePaise: 0 });
    const done = await http()
      .post(`${o()}/bills/${bill.id}/payments`)
      .set(bearer(tok.owner))
      .send({ method: 'CARD', amountPaise: 31_500, shareKey: 's1' })
      .expect(200);
    expect(done.body.status).toBe('PAID');
    expect(await tableStatus(t.tables.T1)).toBe('PAID');
  });

  it('a by-item split on an open bill survives finalising (lines are re-created)', async () => {
    const bill = await servedTable(t.tables.T4);
    const [dal, lassi] = bill.lines;
    const r = await http()
      .put(`${o()}/bills/${bill.id}/split`)
      .set(bearer(tok.waiter))
      .send({ mode: 'BY_ITEM', shares: [{ lineIds: [dal!.id] }, { lineIds: [lassi!.id] }] })
      .expect(200);
    expect(r.body.status).toBe('FINALIZED');
    expect(r.body.split.shares.map((s: { amountPaise: number }) => s.amountPaise)).toEqual([63_000, 12_600]);
    await http()
      .post(`${o()}/bills/${bill.id}/void`)
      .set(bearer(tok.manager))
      .send({ reason: 'test' })
      .expect(200);
  });

  it('is off unless the outlet enables it', async () => {
    const bill = await servedTable(t.tables.T2);
    const phone = await guest(t.tables.T2);
    const view = await http().get('/api/v1/g/bills').set(g(phone)).expect(200);
    expect(view.body.onlinePayments).toBe(false);
    expect(view.body.bills[0]).toMatchObject({ id: bill.id, status: 'OPEN', invoiceUrl: null });
    await http()
      .post('/api/v1/g/payments')
      .set(g(phone))
      .send({ billId: bill.id })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe('PAYMENTS_UNAVAILABLE'));
  });

  it('guest pays a share online: order → checkout signature → capture; webhook is idempotent', async () => {
    await prisma.outletSettings.update({
      where: { outletId: t.outletId },
      data: { onlinePaymentsEnabled: true },
    });
    const bill = await (async () => {
      const b = await http().get(`${o()}/tables/${t.tables.T2}/bills`).set(bearer(tok.owner)).expect(200);
      return b.body[0] as { id: string };
    })();
    await http()
      .put(`${o()}/bills/${bill.id}/split`)
      .set(bearer(tok.waiter))
      .send({ mode: 'EQUAL', ways: 2 })
      .expect(200);
    const phone = await guest(t.tables.T2);

    const start = await http()
      .post('/api/v1/g/payments')
      .set(g(phone))
      .send({ billId: bill.id, shareKey: 's1' })
      .expect(200);
    expect(start.body).toMatchObject({
      provider: 'razorpay',
      keyId: 'rzp_test_dinesense',
      amountPaise: 37_800,
      currency: 'INR',
    });
    expect(orders.at(-1)).toMatchObject({ amount: 37_800 });
    expect(orders.at(-1)!.auth).toBe(
      `Basic ${Buffer.from(`rzp_test_dinesense:${KEY_SECRET}`).toString('base64')}`,
    );
    // A double tap reuses the same provider order.
    const again = await http()
      .post('/api/v1/g/payments')
      .set(g(phone))
      .send({ billId: bill.id, shareKey: 's1' })
      .expect(200);
    expect(again.body.orderId).toBe(start.body.orderId);
    expect(orders.length).toBe(1);
    // While a checkout is in progress the bill cannot be re-split.
    await http()
      .put(`${o()}/bills/${bill.id}/split`)
      .set(bearer(tok.waiter))
      .send({ mode: 'EQUAL', ways: 3 })
      .expect(409);

    const orderId = start.body.orderId as string;
    await http()
      .post('/api/v1/g/payments/verify')
      .set(g(phone))
      .send({
        orderId,
        paymentId: `pay_forged_${run}`,
        signature: hmac('wrong-secret', `${orderId}|pay_forged_${run}`),
      })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED'));
    const ok = await http()
      .post('/api/v1/g/payments/verify')
      .set(g(phone))
      .send({
        orderId,
        paymentId: `pay_share1_${run}`,
        signature: hmac(KEY_SECRET, `${orderId}|pay_share1_${run}`),
      })
      .expect(200);
    expect(ok.body.bills[0].split.shares[0]).toMatchObject({ paidPaise: 37_800, duePaise: 0 });
    // The webhook for the same payment changes nothing.
    await webhook('payment.captured', orderId, `pay_share1_${run}`, 37_800).expect(200);
    const payments = await prisma.payment.findMany({ where: { billId: bill.id } });
    expect(payments.filter((p) => p.status === 'CAPTURED')).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      method: 'RAZORPAY',
      reference: `pay_share1_${run}`,
      receivedById: null,
    });
    expect(await tableStatus(t.tables.T2)).not.toBe('PAID');

    // Second share: the browser never calls back (phone locked) — the webhook alone settles the bill.
    const phone2 = await guest(t.tables.T2);
    const s2 = await http()
      .post('/api/v1/g/payments')
      .set(g(phone2))
      .send({ billId: bill.id, shareKey: 's2' })
      .expect(200);
    await webhook('payment.captured', s2.body.orderId, `pay_share2_${run}`, 37_800, 'forged-secret').expect(
      401,
    );
    await webhook('payment.captured', s2.body.orderId, `pay_share2_${run}`, 37_800).expect(200);
    expect(await tableStatus(t.tables.T2)).toBe('PAID');
    const audit = await prisma.auditLog.findMany({ where: { entityId: bill.id, action: 'bill.payment' } });
    expect(audit).toHaveLength(2);
    // Nothing left to pay.
    await http().post('/api/v1/g/payments').set(g(phone2)).send({ billId: bill.id }).expect(409);
  });

  it('marks failed checkouts and recovers when the provider is down', async () => {
    const bill = await servedTable(t.tables.T3);
    const phone = await guest(t.tables.T3);
    failOrders = true;
    await http()
      .post('/api/v1/g/payments')
      .set(g(phone))
      .send({ billId: bill.id })
      .expect(502)
      .expect((r) => expect(r.body.error.code).toBe('PAYMENTS_UNAVAILABLE'));
    failOrders = false;
    expect((await prisma.payment.findMany({ where: { billId: bill.id } })).map((p) => p.status)).toEqual([
      'FAILED',
    ]);
    const start = await http().post('/api/v1/g/payments').set(g(phone)).send({ billId: bill.id }).expect(200);
    expect(start.body.amountPaise).toBe(75_600);
    // The phone could not open checkout at all: the reservation is released straight away.
    const other = await http().post('/api/v1/g/payments').set(g(phone)).send({ billId: bill.id }).expect(200);
    expect(other.body.orderId).toBe(start.body.orderId);
    await http()
      .post('/api/v1/g/payments/abandon')
      .set(g(phone))
      .send({ orderId: start.body.orderId })
      .expect(200);
    const fresh = await http().post('/api/v1/g/payments').set(g(phone)).send({ billId: bill.id }).expect(200);
    expect(fresh.body.orderId).not.toBe(start.body.orderId);
    await webhook('payment.failed', fresh.body.orderId, `pay_declined_${run}`, 75_600).expect(200);
    const rows = await prisma.payment.findMany({ where: { billId: bill.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((p) => p.status)).toEqual(['FAILED', 'FAILED', 'FAILED']);
    // The cashier can always take the money at the counter.
    await http()
      .post(`${o()}/bills/${bill.id}/payments`)
      .set(bearer(tok.owner))
      .send({ method: 'CASH', amountPaise: 75_600 })
      .expect(200);
    // A late success for an already-settled bill is still recorded (money was taken) and flagged for refund.
    await webhook('payment.captured', start.body.orderId, `pay_late_${run}`, 75_600).expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: bill.id, action: 'bill.payment.excess' } })).toBe(
      1,
    );
  });

  it("keeps guests to their own table's bills", async () => {
    const other = await guest(t.tables.T4);
    const bill = (await prisma.bill.findFirstOrThrow({ where: { outletId: t.outletId, status: 'PAID' } })).id;
    await http().post('/api/v1/g/payments').set(g(other)).send({ billId: bill }).expect(404);
    await webhook('payment.captured', 'order_unknown', `pay_x_${run}`, 100).expect(200);
  });
  it("reports the day's seatings, greet times, waiters and sales to managers only", async () => {
    await http().get(`${o()}/reports/day`).set(bearer(tok.waiter)).expect(403);
    const r = await http().get(`${o()}/reports/day`).set(bearer(tok.manager)).expect(200);
    const bills = await prisma.bill.findMany({
      where: { outletId: t.outletId, status: { in: ['FINALIZED', 'PAID'] } },
    });
    expect(r.body.sales.totalPaise).toBe(bills.reduce((x, b) => x + b.totalPaise, 0));
    expect(r.body.seatings.total).toBe(4);
    expect(r.body.seatings.covers).toBe(4 * 3);
    expect(r.body.payments.map((p: { method: string }) => p.method)).toEqual(
      expect.arrayContaining(['RAZORPAY', 'CASH', 'UPI', 'CARD']),
    );
    const razorpay = r.body.payments.find((p: { method: string }) => p.method === 'RAZORPAY');
    expect(razorpay.amountPaise).toBe(37_800 * 2 + 75_600); // two shares + the late (excess) capture
    expect(r.body.salesByHour.reduce((x: number, h: { bills: number }) => x + h.bills, 0)).toBe(bills.length);
    const other = await http().get(`${o()}/reports/day?date=2020-01-01`).set(bearer(tok.manager)).expect(200);
    expect(other.body.seatings.total).toBe(0);
  });

  it('M10: an online tip rides in the same checkout but stays off the bill', async () => {
    // A table of its own (T1–T4 are taken by the tests above).
    const t1 = await prisma.table.findUniqueOrThrow({ where: { id: t.tables.T1 } });
    const t5 = await prisma.table.create({
      data: {
        organizationId: t.organizationId,
        outletId: t.outletId,
        sectionId: t1.sectionId,
        label: 'T5',
        capacity: 4,
        x: 500,
        y: 500,
        w: 80,
        h: 80,
        joinableWith: [],
        qrToken: `qr_${randomId()}${randomId()}`,
        staffQrToken: `sq_${randomId()}${randomId()}`,
      },
    });
    const bill = await servedTable(t5.id);
    const phone = await guest(t5.id);
    const start = await http()
      .post('/api/v1/g/payments')
      .set(g(phone))
      .send({ billId: bill.id, tipPaise: 7_500 })
      .expect(200);
    expect(start.body).toMatchObject({
      amountPaise: 75_600 + 7_500,
      billAmountPaise: 75_600,
      tipPaise: 7_500,
    });
    expect(orders.at(-1)).toMatchObject({ amount: 83_100 });
    await webhook('payment.captured', start.body.orderId, `pay_tip_${run}`, 83_100).expect(200);
    const p = await prisma.payment.findFirstOrThrow({ where: { providerOrderId: start.body.orderId } });
    expect(p).toMatchObject({ status: 'CAPTURED', amountPaise: 75_600, tipPaise: 7_500 });
    const after = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(after).toMatchObject({ status: 'PAID', totalPaise: 75_600 });
  });
});
