import type { INestApplication } from '@nestjs/common';
import { addDays, localDate, localDateTime } from '@dinesense/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GuestsService } from '../src/guests/guests.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ReservationsService } from '../src/reservations/reservations.service';
import {
  bearer,
  createApp,
  createMenu,
  createTenant,
  loginAll,
  type MenuFixture,
  type Tenant,
} from './fixtures';

const TZ = 'Asia/Kolkata';
const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const e164 = (p: string) => `+91${p}`;

describe('guests, privacy and bookings (M8)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let m: MenuFixture;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  let slug: string;
  // Every request comes from a fresh client IP so the per-IP booking limits (kept in Redis) don't leak between runs.
  const octet = () => Math.floor(Math.random() * 200) + 20;
  const http = () => {
    const agent = request(app.getHttpServer());
    const ip = `${octet()}.${octet()}.${octet()}.${octet()}`;
    return {
      get: (u: string) => agent.get(u).set('x-forwarded-for', ip),
      post: (u: string) => agent.post(u).set('x-forwarded-for', ip),
      patch: (u: string) => agent.patch(u).set('x-forwarded-for', ip),
      put: (u: string) => agent.put(u).set('x-forwarded-for', ip),
      delete: (u: string) => agent.delete(u).set('x-forwarded-for', ip),
    };
  };
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const tomorrow = () => addDays(localDate(new Date(), TZ), 1);
  const at = (hhmm: string, date = tomorrow()) => localDateTime(date, hhmm, TZ).toISOString();
  const status = async (id: string) => (await prisma.table.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
    m = await createMenu(prisma, t);
    tok = await loginAll(app, t);
    slug = (await prisma.outlet.findUniqueOrThrow({ where: { id: t.outletId } })).slug;
    await http()
      .put(`${o()}/hours`)
      .set(bearer(tok.manager))
      .send({
        windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opens: '11:00', closes: '23:00' })),
      })
      .expect(200);
    await http()
      .patch(`${o()}/settings`)
      .set(bearer(tok.manager))
      .send({ bookingEnabled: true, bookingSlotMinutes: 30, bookingMaxPartySize: 6 })
      .expect(200);
  });
  afterAll(async () => app.close());

  describe('guest profiles', () => {
    it('recognises a returning guest by phone and keeps visit stats', async () => {
      const p = phone();
      await http()
        .post(`${o()}/tables/${t.tables.T1}/seat`)
        .set(bearer(tok.host))
        .send({
          partySize: 2,
          guest: { phone: `0${p}`, name: 'Asha', consents: { WHATSAPP: true, MARKETING: false } },
        })
        .expect(200);
      const first = await http()
        .get(`${o()}/guests/lookup`)
        .query({ phone: p })
        .set(bearer(tok.host))
        .expect(200);
      expect(first.body.guest).toMatchObject({
        name: 'Asha',
        phone: e164(p),
        visits: 0,
        consents: { WHATSAPP: true, MARKETING: false },
      });
      const guestId = first.body.guest.id as string;
      expect(await prisma.guestConsent.count({ where: { guestId } })).toBe(2);

      // The visit: order, pay, leave → the projection updates.
      await http()
        .post(`${o()}/tables/${t.tables.T1}/orders`)
        .set(bearer(tok.waiter))
        .send({ items: [{ menuItemId: m.items.lassi, quantity: 2 }] })
        .expect(201);
      const bill = (
        await http().post(`${o()}/tables/${t.tables.T1}/bills`).set(bearer(tok.waiter)).expect(200)
      ).body;
      await http()
        .post(`${o()}/bills/${bill.id}/payments`)
        .set(bearer(tok.owner))
        .send({ method: 'CASH', amountPaise: bill.totalPaise })
        .expect(200);
      await http()
        .post(`${o()}/tables/${t.tables.T1}/transitions`)
        .set(bearer(tok.waiter))
        .send({ event: 'STAFF_MARK_LEFT' })
        .expect(200);
      const again = await http()
        .get(`${o()}/guests/lookup`)
        .query({ phone: p })
        .set(bearer(tok.host))
        .expect(200);
      expect(again.body.guest).toMatchObject({
        visits: 1,
        totalSpendPaise: bill.totalPaise,
        favourites: [{ name: 'Lassi', count: 2 }],
      });
      expect(again.body.guest.lastVisitAt).toBeTruthy();
      // Unknown numbers and bad input.
      expect(
        (await http().get(`${o()}/guests/lookup`).query({ phone: phone() }).set(bearer(tok.host))).body,
      ).toEqual({
        guest: null,
      });
      await http().get(`${o()}/guests/lookup`).query({ phone: '123' }).set(bearer(tok.host)).expect(400);
      // Every look at personal data is audited.
      expect(await prisma.auditLog.count({ where: { entityId: guestId, action: 'guest.lookup' } })).toBe(2);
    });

    it('exports everything for an access request and erases on deletion (managers only)', async () => {
      const p = phone();
      await http()
        .post(`${o()}/reservations`)
        .set(bearer(tok.host))
        .send({ startsAt: at('20:00'), partySize: 2, phone: p, name: 'Ravi', notes: 'Window seat' })
        .expect(201);
      const g = (await http().get(`${o()}/guests/lookup`).query({ phone: p }).set(bearer(tok.host))).body
        .guest;
      await http()
        .patch(`${o()}/guests/${g.id}`)
        .set(bearer(tok.host))
        .send({ allergies: 'peanuts', birthday: '04-12' })
        .expect(200);

      await http().get(`${o()}/guests/${g.id}/export`).set(bearer(tok.host)).expect(403);
      const exp = await http().get(`${o()}/guests/${g.id}/export`).set(bearer(tok.manager)).expect(200);
      expect(exp.body.profile).toMatchObject({
        phone: e164(p),
        name: 'Ravi',
        allergies: 'peanuts',
        birthday: '04-12',
      });
      expect(exp.body.reservations).toHaveLength(1);
      // The audit log keeps field names, not the personal data itself.
      const upd = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: g.id, action: 'guest.update' },
      });
      expect(JSON.stringify(upd.after)).not.toContain('peanuts');

      const erased = await http().delete(`${o()}/guests/${g.id}`).set(bearer(tok.manager)).expect(200);
      expect(erased.body).toMatchObject({ phone: null, name: null, allergies: null, erased: true });
      expect(
        (await http().get(`${o()}/guests/lookup`).query({ phone: p }).set(bearer(tok.host))).body.guest,
      ).toBeNull();
      const r = await prisma.reservation.findFirstOrThrow({ where: { guestId: g.id } });
      expect(r).toMatchObject({ status: 'CANCELLED', notes: null });
      expect(
        await prisma.auditLog.count({
          where: { entityId: g.id, action: { in: ['guest.export', 'guest.erase'] } },
        }),
      ).toBe(2);
    });

    it('retention erases inactive guests only', async () => {
      const old = await prisma.guest.create({
        data: {
          organizationId: t.organizationId,
          phone: e164(phone()),
          name: 'Old',
          createdAt: new Date('2020-01-01'),
        },
      });
      const fresh = await prisma.guest.create({
        data: { organizationId: t.organizationId, phone: e164(phone()), name: 'New' },
      });
      await http()
        .patch(`${o()}/privacy`)
        .set(bearer(tok.manager))
        .send({ guestRetentionDays: 365 })
        .expect(403);
      await http()
        .patch(`${o()}/privacy`)
        .set(bearer(tok.owner))
        .send({ guestRetentionDays: 365 })
        .expect(200);
      await app.get(GuestsService).retentionSweep();
      expect((await prisma.guest.findUniqueOrThrow({ where: { id: old.id } })).phone).toBeNull();
      expect((await prisma.guest.findUniqueOrThrow({ where: { id: fresh.id } })).phone).not.toBeNull();
    });
  });

  describe('online booking', () => {
    it('serves the booking page and slots; books a free slot; never double-books under concurrency', async () => {
      const page = await http().get(`/api/v1/b/${slug}`).expect(200);
      expect(page.body.booking).toMatchObject({ enabled: true, maxPartySize: 6 });
      await http().get('/api/v1/b/no-such-place').expect(404);

      const slots = await http()
        .get(`/api/v1/b/${slug}/slots`)
        .query({ date: tomorrow(), partySize: 4 })
        .expect(200);
      expect(slots.body[0]).toMatchObject({ time: '11:00', available: true });
      expect(slots.body.at(-1).time).toBe('22:00');

      // Six phones race for 13:00 with four 4-tops: exactly four bookings, all on different tables.
      const tries = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          http()
            .post(`/api/v1/b/${slug}/reservations`)
            .send({ startsAt: at('13:00'), partySize: 3, name: `Guest ${i}`, phone: phone() }),
        ),
      );
      const ok = tries.filter((r) => r.status === 201);
      expect(ok).toHaveLength(4);
      expect(
        tries.filter((r) => r.status === 409).every((r) => r.body.error.code === 'NO_AVAILABILITY'),
      ).toBe(true);
      const booked = await prisma.reservation.findMany({
        where: { outletId: t.outletId, startsAt: new Date(at('13:00')) },
      });
      expect(new Set(booked.flatMap((b) => b.tableIds)).size).toBe(4);
      const after = await http()
        .get(`/api/v1/b/${slug}/slots`)
        .query({ date: tomorrow(), partySize: 2 })
        .expect(200);
      expect(after.body.find((s: { time: string }) => s.time === '13:00').available).toBe(false);
      expect(after.body.find((s: { time: string }) => s.time === '15:00').available).toBe(true);

      // Not on the slot grid, outside hours, too big a party.
      for (const startsAt of [at('13:10'), at('08:00')])
        await http()
          .post(`/api/v1/b/${slug}/reservations`)
          .send({ startsAt, partySize: 2, name: 'X', phone: phone() })
          .expect(409);
      await http()
        .post(`/api/v1/b/${slug}/reservations`)
        .send({ startsAt: at('16:00'), partySize: 8, name: 'X', phone: phone() })
        .expect(409);
    });

    it('manage link: view, reschedule, withdraw consent, cancel', async () => {
      const p = phone();
      const made = await http()
        .post(`/api/v1/b/${slug}/reservations`)
        .send({
          startsAt: at('19:00'),
          partySize: 2,
          name: 'Meera',
          phone: p,
          consents: { WHATSAPP: true, MARKETING: true },
        })
        .expect(201);
      const token = made.body.manageToken as string;
      expect(made.body.booking).toMatchObject({
        time: '19:00',
        partySize: 2,
        status: 'CONFIRMED',
        canChange: true,
      });

      await http()
        .get(`/api/v1/b/manage/${token.split('.')[0]}.forged`)
        .expect(404);
      const moved = await http()
        .post(`/api/v1/b/manage/${token}/reschedule`)
        .send({ startsAt: at('20:30'), partySize: 4 })
        .expect(200);
      expect(moved.body).toMatchObject({ time: '20:30', partySize: 4 });
      await http()
        .post(`/api/v1/b/manage/${token}/reschedule`)
        .send({ startsAt: at('20:45') })
        .expect(409);

      const consent = await http()
        .patch(`/api/v1/b/manage/${token}/consents`)
        .send({ MARKETING: false })
        .expect(200);
      expect(consent.body.consents).toEqual({ WHATSAPP: true, MARKETING: false });
      const history = await prisma.guestConsent.findMany({
        where: { guest: { phone: e164(p) }, purpose: 'MARKETING' },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((h) => [h.granted, h.source])).toEqual([
        [true, 'BOOKING_PAGE'],
        [false, 'MANAGE_LINK'],
      ]);

      const cancelled = await http().post(`/api/v1/b/manage/${token}/cancel`).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', canChange: false });
      await http().post(`/api/v1/b/manage/${token}/cancel`).expect(409);
    });

    it('is closed when the outlet turns booking off', async () => {
      await prisma.outletSettings.update({
        where: { outletId: t.outletId },
        data: { bookingEnabled: false },
      });
      expect(
        (await http().get(`/api/v1/b/${slug}/slots`).query({ date: tomorrow(), partySize: 2 })).body,
      ).toEqual([]);
      await http()
        .post(`/api/v1/b/${slug}/reservations`)
        .send({ startsAt: at('17:00'), partySize: 2, name: 'X', phone: phone() })
        .expect(409)
        .expect((r) => expect(r.body.error.code).toBe('BOOKING_CLOSED'));
      await prisma.outletSettings.update({ where: { outletId: t.outletId }, data: { bookingEnabled: true } });
    });
  });

  describe('front desk', () => {
    it('phone booking on a chosen table, change, list the day, check in → seated with guest and booking', async () => {
      const p = phone();
      const made = await http()
        .post(`${o()}/reservations`)
        .set(bearer(tok.host))
        .send({ startsAt: at('21:00'), partySize: 4, phone: p, name: 'Kabir', tableIds: [t.tables.T4] })
        .expect(201);
      const id = made.body.reservation.id as string;
      await http()
        .post(`${o()}/reservations`)
        .set(bearer(tok.waiter))
        .send({ startsAt: at('21:00'), partySize: 2, phone: p })
        .expect(403);
      // Same table, overlapping time → refused.
      await http()
        .post(`${o()}/reservations`)
        .set(bearer(tok.host))
        .send({ startsAt: at('21:30'), partySize: 2, phone: phone(), tableIds: [t.tables.T4] })
        .expect(409);
      const changed = await http()
        .patch(`${o()}/reservations/${id}`)
        .set(bearer(tok.host))
        .send({ notes: 'Anniversary' })
        .expect(200);
      expect(changed.body).toMatchObject({ notes: 'Anniversary', tableIds: [t.tables.T4] });
      const day = await http()
        .get(`${o()}/reservations`)
        .query({ date: tomorrow() })
        .set(bearer(tok.host))
        .expect(200);
      expect(day.body.find((r: { id: string }) => r.id === id).guest).toMatchObject({
        name: 'Kabir',
        phoneMasked: expect.stringContaining('••'),
      });

      const seated = await http()
        .post(`${o()}/reservations/${id}/check-in`)
        .set(bearer(tok.host))
        .send({})
        .expect(200);
      expect(seated.body.reservation.status).toBe('SEATED');
      expect(await status(t.tables.T4)).toBe('OCCUPIED');
      const s = await prisma.seating.findUniqueOrThrow({ where: { id: seated.body.reservation.seatingId } });
      expect(s).toMatchObject({
        source: 'RESERVATION',
        reservationId: id,
        partySize: 4,
        notes: 'Anniversary',
      });
      expect(s.guestId).toBeTruthy();
      await http().post(`${o()}/reservations/${id}/check-in`).set(bearer(tok.host)).send({}).expect(409);
      await http()
        .post(`${o()}/tables/${t.tables.T4}/transitions`)
        .set(bearer(tok.manager))
        .send({ event: 'FORCE_STATE', to: 'VACANT' })
        .expect(200);
    });

    it('holds the table before the booking, alerts on walk-ins, releases no-shows', async () => {
      const svc = app.get(ReservationsService);
      const soon = new Date(Date.now() + 10 * 60_000);
      const make = async (tableId: string) =>
        (
          await http()
            .post(`${o()}/reservations`)
            .set(bearer(tok.host))
            .send({
              startsAt: soon.toISOString(),
              partySize: 2,
              phone: phone(),
              name: 'Soon',
              tableIds: [tableId],
            })
            .expect(201)
        ).body.reservation.id as string;
      const r2 = await make(t.tables.T2);
      // T3 is occupied by a walk-in when its booking's hold time comes.
      await http()
        .post(`${o()}/tables/${t.tables.T3}/seat`)
        .set(bearer(tok.host))
        .send({ partySize: 2 })
        .expect(200);
      const r3 = await make(t.tables.T3);

      await svc.sweep(new Date());
      expect(await status(t.tables.T2)).toBe('RESERVED');
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r2 } })).heldAt).toBeTruthy();
      await svc.sweep(new Date());
      const busyAlerts = await prisma.alert.findMany({
        where: {
          outletId: t.outletId,
          type: 'RESERVED_TABLE_TAKEN',
          payload: { path: ['reservationId'], equals: r3 },
        },
      });
      expect(busyAlerts).toHaveLength(1); // once, not every sweep

      // A walk-in seated on the held table: seated, and the host is warned to move the booking.
      await http()
        .post(`${o()}/tables/${t.tables.T2}/seat`)
        .set(bearer(tok.host))
        .send({ partySize: 2, source: 'WALK_IN' })
        .expect(200);
      expect(
        await prisma.alert.count({ where: { tableId: t.tables.T2, type: 'RESERVED_TABLE_TAKEN' } }),
      ).toBe(1);
      await http()
        .post(`${o()}/tables/${t.tables.T2}/transitions`)
        .set(bearer(tok.manager))
        .send({ event: 'FORCE_STATE', to: 'RESERVED' })
        .expect(200);

      // Nobody turns up: after the grace period both bookings are no-shows and the held table is free again.
      await svc.sweep(new Date(soon.getTime() + 16 * 60_000));
      const rows = await prisma.reservation.findMany({ where: { id: { in: [r2, r3] } } });
      expect(rows.map((r) => r.status)).toEqual(['NO_SHOW', 'NO_SHOW']);
      expect(await status(t.tables.T2)).toBe('VACANT');
      expect(await status(t.tables.T3)).toBe('OCCUPIED'); // never touched the walk-in
    });
  });
});
