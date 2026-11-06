import type { INestApplication } from '@nestjs/common';
import { addDays, localDate, localDateTime } from '@dinesense/shared';
import { edgeSignature } from '@dinesense/shared/edge-signing';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MessagingService } from '../src/messaging/messaging.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ReservationsService } from '../src/reservations/reservations.service';
import { WaitlistService } from '../src/waitlist/waitlist.service';
import { bearer, createApp, createTenant, loginAll, randomId, type Tenant } from './fixtures';

const TZ = 'Asia/Kolkata';
const phone = () => `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const octet = () => Math.floor(Math.random() * 200) + 20;

describe('guest messaging, waitlist and door arrivals (M9)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  let slug: string;
  const http = () => {
    const agent = request(app.getHttpServer());
    const ip = `${octet()}.${octet()}.${octet()}.${octet()}`;
    return {
      get: (u: string) => agent.get(u).set('x-forwarded-for', ip),
      post: (u: string) => agent.post(u).set('x-forwarded-for', ip),
      patch: (u: string) => agent.patch(u).set('x-forwarded-for', ip),
      put: (u: string) => agent.put(u).set('x-forwarded-for', ip),
    };
  };
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const tomorrow = () => addDays(localDate(new Date(), TZ), 1);
  const at = (hhmm: string) => localDateTime(tomorrow(), hhmm, TZ).toISOString();
  const status = async (id: string) => (await prisma.table.findUniqueOrThrow({ where: { id } })).status;
  const messagesFor = (entityId: string) =>
    prisma.messageLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });
  const waSign = (body: string) =>
    `sha256=${createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(body).digest('hex')}`;
  const webhook = (payload: object, sig?: string) => {
    const body = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post('/api/v1/messaging/whatsapp/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig ?? waSign(body))
      .send(body);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
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
      .send({ bookingEnabled: true, waitlistEnabled: true, waitlistHoldMinutes: 10 })
      .expect(200);
  });
  afterAll(async () => app.close());

  describe('booking messages', () => {
    it('queues a confirmation only with WhatsApp consent, sends it, and dedupes', async () => {
      const yes = await http()
        .post(`/api/v1/b/${slug}/reservations`)
        .send({
          startsAt: at('19:00'),
          partySize: 2,
          name: 'Asha',
          phone: phone(),
          consents: { WHATSAPP: true },
          locale: 'hi',
        })
        .expect(201);
      await http()
        .post(`/api/v1/b/${slug}/reservations`)
        .send({ startsAt: at('19:00'), partySize: 2, name: 'Ravi', phone: phone() })
        .expect(201);
      const all = await prisma.messageLog.findMany({
        where: { outletId: t.outletId, purpose: 'BOOKING_CONFIRMED' },
      });
      expect(all.map((m) => m.status).sort()).toEqual(['QUEUED', 'SKIPPED']);
      const queued = all.find((m) => m.status === 'QUEUED')!;
      expect(queued).toMatchObject({ template: 'ds_booking_confirmed', locale: 'hi', channel: 'console' });
      expect((queued.variables as Record<string, string>).link).toMatch(
        /^http:\/\/localhost:3001\/b\/manage\/.+\..+/,
      );

      expect(await app.get(MessagingService).dispatch()).toBeGreaterThanOrEqual(1);
      const sent = await prisma.messageLog.findUniqueOrThrow({ where: { id: queued.id } });
      expect(sent).toMatchObject({ status: 'SENT', attempts: 1 });
      expect(sent.providerMessageId).toMatch(/^console_/);

      // A change sends one "changed" message per distinct change.
      const token = yes.body.manageToken as string;
      await http()
        .post(`/api/v1/b/manage/${token}/reschedule`)
        .send({ startsAt: at('20:00') })
        .expect(200);
      await http().patch(`/api/v1/b/manage/${token}/consents`).send({ FEEDBACK: true }).expect(200);
      const changed = await prisma.messageLog.findMany({
        where: { entityId: queued.entityId, purpose: 'BOOKING_CHANGED' },
      });
      expect(changed).toHaveLength(1);
    });

    it('reminds once, only for bookings made well before', async () => {
      const r = await http()
        .post(`${o()}/reservations`)
        .set(bearer(tok.host))
        .send({
          startsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
          partySize: 2,
          phone: phone(),
          name: 'Meera',
          consents: { WHATSAPP: true },
        })
        .expect(201);
      const id = r.body.reservation.id as string;
      const sweep = app.get(ReservationsService);
      await sweep.sweep();
      expect((await messagesFor(id)).map((m) => m.purpose)).toEqual(['BOOKING_CONFIRMED']); // booked 90 min ahead
      await prisma.reservation.update({
        where: { id },
        data: { createdAt: new Date(Date.now() - 6 * 3600_000) },
      });
      await sweep.sweep();
      await sweep.sweep();
      expect((await messagesFor(id)).map((m) => m.purpose)).toEqual([
        'BOOKING_CONFIRMED',
        'BOOKING_REMINDER',
      ]);
    });
  });

  describe('WhatsApp webhook', () => {
    it('verifies the subscription and signatures; applies delivery statuses without going backwards', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/messaging/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test_wa_verify_token',
          'hub.challenge': '12345',
        })
        .expect(200)
        .expect('12345');
      await request(app.getHttpServer())
        .get('/api/v1/messaging/whatsapp/webhook')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' })
        .expect(403);

      const m = await prisma.messageLog.findFirstOrThrow({ where: { outletId: t.outletId, status: 'SENT' } });
      const st = (s: string) => ({
        entry: [{ changes: [{ value: { statuses: [{ id: m.providerMessageId, status: s }] } }] }],
      });
      await webhook(st('delivered'), 'sha256=forged').expect(401);
      await webhook(st('delivered')).expect(200);
      await webhook(st('sent')).expect(200);
      expect((await prisma.messageLog.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('DELIVERED');
      await webhook(st('read')).expect(200);
      const read = await prisma.messageLog.findUniqueOrThrow({ where: { id: m.id } });
      expect(read.status).toBe('READ');
      expect(read.readAt).toBeTruthy();
    });

    it('a STOP reply withdraws WhatsApp consent and cancels queued messages', async () => {
      const p = phone();
      await http()
        .post(`/api/v1/b/${slug}/reservations`)
        .send({ startsAt: at('15:00'), partySize: 2, name: 'Kabir', phone: p, consents: { WHATSAPP: true } })
        .expect(201);
      await webhook({
        entry: [
          {
            changes: [{ value: { messages: [{ from: `91${p}`, type: 'text', text: { body: ' stop ' } }] } }],
          },
        ],
      }).expect(200);
      const guest = await prisma.guest.findFirstOrThrow({ where: { phone: `+91${p}` } });
      expect(guest.consentFlags).toMatchObject({ WHATSAPP: false });
      expect(
        await prisma.guestConsent.findFirst({
          where: { guestId: guest.id, source: 'WHATSAPP_REPLY', granted: false },
        }),
      ).toBeTruthy();
      const msg = await prisma.messageLog.findFirstOrThrow({ where: { guestId: guest.id } });
      expect(msg).toMatchObject({ status: 'SKIPPED', error: 'guest replied STOP' });
    });
  });

  describe('waitlist', () => {
    it('join by QR, ETA, host notifies → table held + message, guest status page, seat', async () => {
      const info = await http().get(`/api/v1/w/${slug}`).expect(200);
      expect(info.body).toMatchObject({
        waitlist: { enabled: true },
        waiting: 0,
        waitForTwo: { low: 0, high: 5 },
      });

      const p = phone();
      const join = await http()
        .post(`/api/v1/w/${slug}/entries`)
        .send({ name: 'Neha', phone: p, partySize: 3, consents: { WHATSAPP: true } })
        .expect(201);
      const token = join.body.token as string;
      expect(join.body.entry).toMatchObject({ status: 'WAITING', position: 1, wait: { low: 0, high: 5 } });
      // Same phone again → same place in line.
      const again = await http()
        .post(`/api/v1/w/${slug}/entries`)
        .send({ name: 'Neha', phone: p, partySize: 3 })
        .expect(201);
      expect(again.body.token).toBe(token);

      const list = await http().get(`${o()}/waitlist`).set(bearer(tok.host)).expect(200);
      const entry = list.body[0];
      expect(entry).toMatchObject({ position: 1, partySize: 3, guest: { name: 'Neha' } });
      expect(entry.suggestedTableIds).toHaveLength(1);
      expect(entry.messages.map((m: { purpose: string }) => m.purpose)).toEqual(['WAITLIST_JOINED']);

      const tableId = entry.suggestedTableIds[0] as string;
      await http()
        .post(`${o()}/waitlist/${entry.id}/notify`)
        .set(bearer(tok.waiter))
        .send({ tableIds: [tableId] })
        .expect(403);
      await http()
        .post(`${o()}/waitlist/${entry.id}/notify`)
        .set(bearer(tok.host))
        .send({ tableIds: [tableId] })
        .expect(200);
      expect(await status(tableId)).toBe('RESERVED');
      const ready = await prisma.messageLog.findFirstOrThrow({
        where: { entityId: entry.id, purpose: 'TABLE_READY' },
      });
      expect(ready.variables).toMatchObject({ minutes: '10' });
      const page = await http().get(`/api/v1/w/status/${token}`).expect(200);
      expect(page.body).toMatchObject({ status: 'NOTIFIED', tables: [expect.any(String)] });

      const seated = await http()
        .post(`${o()}/waitlist/${entry.id}/seat`)
        .set(bearer(tok.host))
        .send({})
        .expect(200);
      expect(seated.body.entry.status).toBe('SEATED');
      expect(await status(tableId)).toBe('OCCUPIED');
      const s = await prisma.seating.findUniqueOrThrow({ where: { id: seated.body.entry.seatingId } });
      expect(s).toMatchObject({ source: 'WAITLIST', partySize: 3 });
      expect(s.guestId).toBeTruthy();
      await http()
        .get(`/api/v1/w/status/${token.split('.')[0]}.forged`)
        .expect(404);
    });

    it('a full room gives real waits; leaving and removing; expired holds are released', async () => {
      // Fill every table.
      for (const id of [t.tables.T1, t.tables.T2, t.tables.T3, t.tables.T4])
        if ((await status(id)) === 'VACANT')
          await http()
            .post(`${o()}/tables/${id}/seat`)
            .set(bearer(tok.host))
            .send({ partySize: 2 })
            .expect(200);
      const a = await http()
        .post(`/api/v1/w/${slug}/entries`)
        .send({ name: 'A', phone: phone(), partySize: 2 })
        .expect(201);
      expect(a.body.entry.wait.high).toBeGreaterThan(5);
      const b = await http()
        .post(`${o()}/waitlist`)
        .set(bearer(tok.host))
        .send({ name: 'Walk-in, no phone', partySize: 2 })
        .expect(201);
      const list = await http().get(`${o()}/waitlist`).set(bearer(tok.host)).expect(200);
      expect(list.body.map((e: { position: number }) => e.position)).toEqual([1, 2]);
      expect(list.body[1].wait.high).toBeGreaterThanOrEqual(list.body[0].wait.high);
      expect(list.body[0].suggestedTableIds).toEqual([]); // nothing free

      await http().post(`/api/v1/w/status/${a.body.token}/leave`).expect(200);
      await http().post(`/api/v1/w/status/${a.body.token}/leave`).expect(409);
      await http().post(`${o()}/waitlist/${b.body.id}/remove`).set(bearer(tok.host)).expect(200);
      expect((await http().get(`${o()}/waitlist`).set(bearer(tok.host))).body).toEqual([]);

      // A notified party who never comes: the hold runs out and the table is free again.
      await http()
        .post(`${o()}/tables/${t.tables.T4}/transitions`)
        .set(bearer(tok.manager))
        .send({ event: 'FORCE_STATE', to: 'VACANT' })
        .expect(200);
      const c = await http()
        .post(`${o()}/waitlist`)
        .set(bearer(tok.host))
        .send({ name: 'C', partySize: 2 })
        .expect(201);
      await http()
        .post(`${o()}/waitlist/${c.body.id}/notify`)
        .set(bearer(tok.host))
        .send({ tableIds: [t.tables.T4] })
        .expect(200);
      expect(await status(t.tables.T4)).toBe('RESERVED');
      await app.get(WaitlistService).sweep(new Date(Date.now() + 11 * 60_000));
      expect(await status(t.tables.T4)).toBe('VACANT');
    });
  });

  describe('door camera', () => {
    it('a party seen at the entrance becomes a host suggestion', async () => {
      const reg = await http()
        .post(`${o()}/edge-devices`)
        .set(bearer(tok.manager))
        .send({ name: 'Door box' })
        .expect(201);
      const cam = await http()
        .post(`${o()}/cameras`)
        .set(bearer(tok.manager))
        .send({ name: 'Entrance', edgeDeviceId: reg.body.deviceId, rtspUrl: 'rtsp://10.0.0.9/door', fps: 3 })
        .expect(201);
      const send = (count: number) => {
        const body = JSON.stringify({
          deviceId: reg.body.deviceId,
          sentAt: new Date().toISOString(),
          events: [
            {
              eventId: `evt_${randomId()}${randomId()}`,
              occurredAt: new Date().toISOString(),
              type: 'party.arrived',
              cameraId: cam.body.id,
              confidence: 0.9,
              payload: { count, trackIds: [1, 2, 3].slice(0, count) },
            },
          ],
        });
        const ts = String(Math.floor(Date.now() / 1000));
        return request(app.getHttpServer())
          .post('/api/v1/edge/events')
          .set({
            'content-type': 'application/json',
            'x-ds-device': reg.body.deviceId,
            'x-ds-timestamp': ts,
            'x-ds-signature': edgeSignature(reg.body.secret, ts, 'POST', '/api/v1/edge/events', body),
          })
          .send(body);
      };
      const noDoor = await send(3).expect(200);
      expect(noDoor.body.rejected[0].reason).toBe('NO_DOOR_ZONE');

      const door = [
        [0, 0.7],
        [0.3, 0.7],
        [0.3, 1],
        [0, 1],
      ];
      await http()
        .put(`${o()}/cameras/${cam.body.id}/zones`)
        .set(bearer(tok.manager))
        .send({ zones: [], door })
        .expect(200);
      const cfgBody = '';
      const ts = String(Math.floor(Date.now() / 1000));
      const cfg = await request(app.getHttpServer())
        .get('/api/v1/edge/config')
        .set({
          'x-ds-device': reg.body.deviceId,
          'x-ds-timestamp': ts,
          'x-ds-signature': edgeSignature(reg.body.secret, ts, 'GET', '/api/v1/edge/config', cfgBody),
        })
        .expect(200);
      expect(cfg.body.cameras[0].door).toEqual(door);

      const ok = await send(2).expect(200);
      expect(ok.body.accepted).toHaveLength(1);
      const arrivals = await http().get(`${o()}/door-arrivals`).set(bearer(tok.host)).expect(200);
      expect(arrivals.body[0]).toMatchObject({ count: 2, suggestedTableIds: [t.tables.T4] });
      await http()
        .post(`${o()}/door-arrivals/${arrivals.body[0].id}/dismiss`)
        .set(bearer(tok.host))
        .expect(200);
      expect((await http().get(`${o()}/door-arrivals`).set(bearer(tok.host))).body).toEqual([]);
    });
  });
});

describe('WhatsApp Cloud API channel (mock)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mock: Server;
  const calls: { auth: string; body: Record<string, unknown>; url: string }[] = [];
  let fail = 0;

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        calls.push({ auth: req.headers.authorization ?? '', body: JSON.parse(data), url: req.url ?? '' });
        if (fail-- > 0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'Template does not exist' } }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ messages: [{ id: `wamid.${randomId()}` }] }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    process.env.WHATSAPP_ACCESS_TOKEN = 'test_wa_token_0123456789';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_API_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v21.0`;
    ({ app, prisma } = await createApp());
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_API_URL;
  });
  afterAll(async () => {
    await app.close();
    await new Promise((r) => mock.close(r));
  });

  it('sends approved templates with ordered parameters; permanent errors fail without retry', async () => {
    const t = await createTenant(prisma, { floor: true });
    const tok = await loginAll(app, t);
    await request(app.getHttpServer())
      .post(`/api/v1/outlets/${t.outletId}/reservations`)
      .set(bearer(tok.host))
      .send({
        startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        partySize: 4,
        phone: phone(),
        name: 'Zoya',
        consents: { WHATSAPP: true },
      })
      .expect(201);
    const svc = app.get(MessagingService);
    expect(svc.channelName).toBe('whatsapp');
    await svc.dispatch();
    const call = calls.at(-1)!;
    expect(call.url).toBe('/v21.0/1234567890/messages');
    expect(call.auth).toBe('Bearer test_wa_token_0123456789');
    expect(call.body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'template',
      template: { name: 'ds_booking_confirmed', language: { code: 'en' } },
    });
    const params = (call.body.template as { components: { parameters: { text: string }[] }[] }).components[0]!
      .parameters;
    expect(params.map((p) => p.text).slice(0, 3)).toEqual(['Zoya', expect.stringContaining('Outlet'), '4']);
    const sent = await prisma.messageLog.findFirstOrThrow({ where: { outletId: t.outletId } });
    expect(sent.providerMessageId).toMatch(/^wamid\./);

    fail = 1;
    await request(app.getHttpServer())
      .post(`/api/v1/outlets/${t.outletId}/reservations`)
      .set(bearer(tok.host))
      .send({
        startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        partySize: 2,
        phone: phone(),
        name: 'Ira',
        consents: { WHATSAPP: true },
      })
      .expect(201);
    await svc.dispatch();
    const failed = await prisma.messageLog.findFirstOrThrow({
      where: { outletId: t.outletId, status: 'FAILED' },
    });
    expect(failed.error).toBe('Template does not exist');
  });
});
