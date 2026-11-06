import type { INestApplication } from '@nestjs/common';
import { financialYear } from '@dinesense/shared';
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

describe('billing (M4)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let m: MenuFixture;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  let cashier: string;
  const http = () => request(app.getHttpServer());
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const status = async (id: string) => (await prisma.table.findUniqueOrThrow({ where: { id } })).status;

  /** Seats a table and has the waiter order: 2 × dal (₹300) + 1 × lassi (₹120) = ₹720. */
  async function servedTable(tableId: string) {
    await http()
      .post(`${o()}/tables/${tableId}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 2 })
      .expect(200);
    const order = await http()
      .post(`${o()}/tables/${tableId}/orders`)
      .set(bearer(tok.waiter))
      .send({
        items: [
          { menuItemId: m.items.dal, quantity: 2, modifierIds: [m.portion.full] },
          { menuItemId: m.items.lassi, quantity: 1 },
        ],
      })
      .expect(201);
    return order.body as { id: string; items: { id: string }[] };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
    m = await createMenu(prisma, t);
    tok = await loginAll(app, t);
    await prisma.outlet.update({
      where: { id: t.outletId },
      data: { invoicePrefix: 'TST', gstin: '29ABCDE1234F1Z5', legalName: 'Test Foods Pvt Ltd' },
    });
    const email = `cashier.${randomId()}@test.dinesense.in`;
    await http()
      .post(`${o()}/staff`)
      .set(bearer(tok.owner))
      .send({ name: 'Cashier', role: 'CASHIER', pin: '3333', email, password: 'correct-horse-battery' })
      .expect(201);
    cashier = (await http().post('/api/v1/auth/login').send({ email, password: 'correct-horse-battery' }))
      .body.accessToken;
  });
  afterAll(async () => app.close());

  it('bills, discounts, finalises with a gap-free number, takes split payment and frees the table', async () => {
    await servedTable(t.tables.T1);
    await http()
      .post(`${o()}/tables/${t.tables.T1}/transitions`)
      .set(bearer(tok.waiter))
      .send({ event: 'REQUEST_BILL' })
      .expect(200);

    // Service charge from outlet settings.
    await prisma.outletSettings.update({ where: { outletId: t.outletId }, data: { serviceChargeBps: 1000 } });
    const draft = await http().post(`${o()}/tables/${t.tables.T1}/bills`).set(bearer(tok.waiter)).expect(200);
    expect(draft.body).toMatchObject({
      status: 'OPEN',
      subtotalPaise: 72_000,
      serviceChargePaise: 7_200,
      invoiceNumber: null,
    });
    expect(draft.body.lines.map((l: { description: string }) => l.description)).toEqual([
      'Dal Makhani (Full)',
      'Lassi',
    ]);

    // Waiters cannot discount; a discount needs a reason.
    await http()
      .patch(`${o()}/bills/${draft.body.id}`)
      .set(bearer(tok.waiter))
      .send({ discountPaise: 2_000, discountReason: 'x' })
      .expect(403);
    await http()
      .patch(`${o()}/bills/${draft.body.id}`)
      .set(bearer(cashier))
      .send({ discountPaise: 2_000 })
      .expect(400);
    const tooMuch = await http()
      .patch(`${o()}/bills/${draft.body.id}`)
      .set(bearer(cashier))
      .send({ discountPaise: 80_000, discountReason: 'x' })
      .expect(400);
    expect(tooMuch.body.error.code).toBe('DISCOUNT_TOO_LARGE');

    const adjusted = await http()
      .patch(`${o()}/bills/${draft.body.id}`)
      .set(bearer(cashier))
      .send({ discountPaise: 7_000, discountReason: 'Regular guest' })
      .expect(200);
    // 72,000 − 7,000 = 65,000; SC 10% = 6,500; GST 5% on 71,500 = 3,575 → round to rupee.
    expect(adjusted.body).toMatchObject({
      discountPaise: 7_000,
      serviceChargePaise: 6_500,
      taxablePaise: 71_500,
    });
    expect(adjusted.body.cgstPaise).toBe(adjusted.body.sgstPaise);
    expect(adjusted.body.totalPaise % 100).toBe(0);
    const total = adjusted.body.totalPaise as number;
    expect(total).toBe(71_500 + adjusted.body.cgstPaise * 2 + adjusted.body.roundOffPaise);

    const fin = await http().post(`${o()}/bills/${draft.body.id}/finalize`).set(bearer(cashier)).expect(200);
    const fy = financialYear(new Date());
    expect(fin.body).toMatchObject({
      status: 'FINALIZED',
      invoiceNumber: `TST/${fy}/00001`,
      duePaise: total,
    });
    await http()
      .patch(`${o()}/bills/${draft.body.id}`)
      .set(bearer(cashier))
      .send({ serviceChargeBps: 0 })
      .expect(409);

    // Split: UPI then cash. Overpaying is refused.
    await http()
      .post(`${o()}/bills/${draft.body.id}/payments`)
      .set(bearer(cashier))
      .send({ method: 'UPI', amountPaise: 50_000, reference: 'UPI123' })
      .expect(200);
    expect(await status(t.tables.T1)).toBe('BILL_REQUESTED');
    const over = await http()
      .post(`${o()}/bills/${draft.body.id}/payments`)
      .set(bearer(cashier))
      .send({ method: 'CASH', amountPaise: total })
      .expect(409);
    expect(over.body.error).toMatchObject({ code: 'OVERPAYMENT', details: { duePaise: total - 50_000 } });
    const paid = await http()
      .post(`${o()}/bills/${draft.body.id}/payments`)
      .set(bearer(cashier))
      .send({ method: 'CASH', amountPaise: total - 50_000 })
      .expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', duePaise: 0, paidPaise: total });
    expect(await status(t.tables.T1)).toBe('PAID');
    expect(await prisma.task.count({ where: { tableId: t.tables.T1, type: 'BILL', status: 'DONE' } })).toBe(
      1,
    );

    // Guests leave → cleaning → free.
    await http()
      .post(`${o()}/tables/${t.tables.T1}/transitions`)
      .set(bearer(tok.waiter))
      .send({ event: 'STAFF_MARK_LEFT' })
      .expect(200);
    await http()
      .post(`${o()}/tables/${t.tables.T1}/transitions`)
      .set(bearer(tok.busser))
      .send({ event: 'CLEAN_CONFIRMED' })
      .expect(200);
    expect(await status(t.tables.T1)).toBe('VACANT');

    // The shareable invoice renders and is protected by its signature.
    const link = fin.body.invoiceUrl as string;
    const html = await http().get(link).expect(200);
    expect(html.headers['content-type']).toMatch(/text\/html/);
    expect(html.text).toContain('TAX INVOICE');
    expect(html.text).toContain(`TST/${fy}/00001`);
    expect(html.text).toContain('GSTIN: 29ABCDE1234F1Z5');
    expect(html.text).toContain('Regular guest');
    await http().get(link.replace(/t=.*/, 't=forged')).expect(404);
    await http().get(`/api/v1/invoices/${draft.body.id}`).expect(404);
  });

  it('numbers invoices consecutively per outlet and puts late orders on a second bill', async () => {
    await servedTable(t.tables.T2);
    const first = await http().post(`${o()}/tables/${t.tables.T2}/bills`).set(bearer(cashier)).expect(200);
    await http().post(`${o()}/bills/${first.body.id}/finalize`).set(bearer(cashier)).expect(200);

    // Dessert after the bill was printed.
    await http()
      .post(`${o()}/tables/${t.tables.T2}/orders`)
      .set(bearer(tok.waiter))
      .send({ items: [{ menuItemId: m.items.lassi, quantity: 2 }] })
      .expect(201);
    const second = await http().post(`${o()}/tables/${t.tables.T2}/bills`).set(bearer(cashier)).expect(200);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.lines).toHaveLength(1);
    expect(second.body.subtotalPaise).toBe(24_000);
    const fin2 = await http()
      .post(`${o()}/bills/${second.body.id}/finalize`)
      .set(bearer(cashier))
      .expect(200);
    expect(fin2.body.invoiceNumber).toMatch(/\/00003$/);

    const bills = await http().get(`${o()}/tables/${t.tables.T2}/bills`).set(bearer(tok.waiter)).expect(200);
    expect(bills.body.map((b: { status: string }) => b.status)).toEqual(['FINALIZED', 'FINALIZED']);

    // Paying only the first bill does not mark the table paid.
    await http()
      .post(`${o()}/bills/${first.body.id}/payments`)
      .set(bearer(cashier))
      .send({ method: 'CARD', amountPaise: first.body.totalPaise })
      .expect(200);
    expect(await status(t.tables.T2)).not.toBe('PAID');
    await http()
      .post(`${o()}/bills/${second.body.id}/payments`)
      .set(bearer(cashier))
      .send({ method: 'CASH', amountPaise: fin2.body.totalPaise })
      .expect(200);
    expect(await status(t.tables.T2)).toBe('PAID');
  });

  it('voids only unpaid bills, managers only, keeping the number on record', async () => {
    const order = await servedTable(t.tables.T3);
    const bill = await http().post(`${o()}/tables/${t.tables.T3}/bills`).set(bearer(cashier)).expect(200);
    await http().post(`${o()}/bills/${bill.body.id}/finalize`).set(bearer(cashier)).expect(200);
    await http()
      .post(`${o()}/bills/${bill.body.id}/void`)
      .set(bearer(cashier))
      .send({ reason: 'Wrong table' })
      .expect(403);
    const v = await http()
      .post(`${o()}/bills/${bill.body.id}/void`)
      .set(bearer(tok.manager))
      .send({ reason: 'Wrong table' })
      .expect(200);
    expect(v.body).toMatchObject({
      status: 'VOID',
      voidReason: 'Wrong table',
      invoiceNumber: expect.stringMatching(/\/00004$/),
    });
    // The items are billable again on a fresh bill.
    const again = await http().post(`${o()}/tables/${t.tables.T3}/bills`).set(bearer(cashier)).expect(200);
    expect(again.body.lines.map((l: { orderItemId: string }) => l.orderItemId).sort()).toEqual(
      order.items.map((i) => i.id).sort(),
    );
    const html = await http()
      .get(v.body.invoiceUrl as string)
      .expect(200);
    expect(html.text).toContain('CANCELLED TAX INVOICE');
  });

  it('refuses to bill a table with nothing ordered, and hides other tenants', async () => {
    await http()
      .post(`${o()}/tables/${t.tables.T4}/seat`)
      .set(bearer(tok.host))
      .send({ partySize: 1 })
      .expect(200);
    const r = await http().post(`${o()}/tables/${t.tables.T4}/bills`).set(bearer(cashier)).expect(409);
    expect(r.body.error.code).toBe('NOTHING_TO_BILL');
    const other = await createTenant(prisma, { floor: true });
    await http()
      .post(`/api/v1/outlets/${other.outletId}/tables/${other.tables.T1}/bills`)
      .set(bearer(cashier))
      .expect(404);
  });

  it("lists the day's bills for the cash desk only", async () => {
    const list = await http().get(`${o()}/bills`).set(bearer(cashier)).expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(4);
    await http().get(`${o()}/bills`).set(bearer(tok.waiter)).expect(403);
  });
});
