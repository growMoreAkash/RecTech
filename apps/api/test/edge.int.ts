import type { INestApplication } from '@nestjs/common';
import { edgeSignature } from '@dinesense/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EdgeService } from '../src/edge/edge.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { SlaEngine } from '../src/sla/sla-engine.service';
import { bearer, createApp, createTenant, loginAll, randomId, type Tenant } from './fixtures';

describe('edge devices, cameras, zones and camera events (M6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let tok: Awaited<ReturnType<typeof loginAll>>;
  let device: { deviceId: string; secret: string };
  let cameraId: string;
  const http = () => request(app.getHttpServer());
  const o = () => `/api/v1/outlets/${t.outletId}`;
  const RTSP = 'rtsp://admin:SuperSecret123@10.0.0.21:554/Streaming/Channels/101';
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
  const square = [
    [0.1, 0.1],
    [0.4, 0.1],
    [0.4, 0.4],
    [0.1, 0.4],
  ];

  /** Signs like the Python edge client: HMAC(secret, ts.METHOD.path.sha256(body)). */
  function signed(
    method: 'GET' | 'POST',
    path: string,
    body: string | Buffer = '',
    over: { ts?: number; secret?: string; device?: string } = {},
  ) {
    const ts = String(over.ts ?? Math.floor(Date.now() / 1000));
    const sig = edgeSignature(over.secret ?? device.secret, ts, method, path, body);
    const r = method === 'GET' ? http().get(path) : http().post(path);
    void r.set({
      'x-ds-device': over.device ?? device.deviceId,
      'x-ds-timestamp': ts,
      'x-ds-signature': sig,
    });
    if (method === 'POST') {
      if (Buffer.isBuffer(body)) void r.set('content-type', 'image/jpeg').send(body);
      else void r.set('content-type', 'application/json').send(body);
    }
    return r;
  }
  const events = (evts: object[]) => {
    const body = JSON.stringify({
      deviceId: device.deviceId,
      sentAt: new Date().toISOString(),
      events: evts,
    });
    return signed('POST', '/api/v1/edge/events', body);
  };
  const evt = (type: string, extra: object) => ({
    eventId: `evt_${randomId()}${randomId()}`,
    occurredAt: new Date().toISOString(),
    cameraId,
    type,
    ...extra,
  });
  const status = async (id: string) => (await prisma.table.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    t = await createTenant(prisma, { floor: true });
    tok = await loginAll(app, t);
  });
  afterAll(async () => app.close());

  it('managers register an edge device (secret shown once) and add cameras with write-only stream URLs', async () => {
    await http().post(`${o()}/edge-devices`).set(bearer(tok.host)).send({ name: 'Edge box' }).expect(403);
    const reg = await http()
      .post(`${o()}/edge-devices`)
      .set(bearer(tok.manager))
      .send({ name: 'Edge box 1' })
      .expect(201);
    device = { deviceId: reg.body.deviceId, secret: reg.body.secret };
    expect(device.secret).toMatch(/^es_/);
    const list = await http().get(`${o()}/edge-devices`).set(bearer(tok.manager)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(device.secret);

    const cam = await http()
      .post(`${o()}/cameras`)
      .set(bearer(tok.manager))
      .send({ name: 'Main hall NE', edgeDeviceId: device.deviceId, rtspUrl: RTSP, fps: 3 })
      .expect(201);
    cameraId = cam.body.id;
    expect(cam.body.streamHost).toBe('rtsp://10.0.0.21:554');
    expect(JSON.stringify(cam.body)).not.toContain('SuperSecret123');
    const row = await prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    expect(row.rtspUrlEncrypted).not.toContain('SuperSecret123'); // encrypted at rest

    await http()
      .put(`${o()}/cameras/${cameraId}/zones`)
      .set(bearer(tok.manager))
      .send({ zones: [{ tableId: 'nope', polygon: square }] })
      .expect(400);
    await http()
      .put(`${o()}/cameras/${cameraId}/zones`)
      .set(bearer(tok.manager))
      .send({
        zones: [
          { tableId: t.tables.T1, polygon: square },
          { tableId: t.tables.T2, polygon: square.map(([x, y]) => [x! + 0.5, y!]) },
        ],
      })
      .expect(200);
  });

  it('serves config only to correctly signed requests', async () => {
    const cfg = await signed('GET', '/api/v1/edge/config').expect(200);
    expect(cfg.body).toMatchObject({
      outletId: t.outletId,
      settings: { occupancyConfirmSeconds: 30, vacancyConfirmSeconds: 90 },
      cameras: [
        {
          id: cameraId,
          rtspUrl: RTSP,
          fps: 3,
          snapshotWanted: true,
          zones: expect.arrayContaining([{ tableId: t.tables.T1, polygon: square }]),
        },
      ],
    });
    expect(cfg.body.configVersion).toMatch(/^[0-9a-f]{16}$/);

    await signed('GET', '/api/v1/edge/config', '', { secret: 'es_wrong' }).expect(401);
    await signed('GET', '/api/v1/edge/config', '', { ts: Math.floor(Date.now() / 1000) - 3600 }).expect(401);
    await signed('GET', '/api/v1/edge/config', '', { device: 'nope' }).expect(401);
    await http().get('/api/v1/edge/config').expect(401);
    // A signature for one endpoint is useless on another.
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = edgeSignature(device.secret, ts, 'GET', '/api/v1/edge/config', '');
    await http()
      .post('/api/v1/edge/events')
      .set({ 'x-ds-device': device.deviceId, 'x-ds-timestamp': ts, 'x-ds-signature': sig })
      .send({})
      .expect(401);
  });

  it('takes a blurred calibration snapshot and shows it to managers only', async () => {
    await signed('POST', `/api/v1/edge/cameras/${cameraId}/snapshot`, Buffer.from('not a jpeg')).expect(400);
    await signed('POST', `/api/v1/edge/cameras/${cameraId}/snapshot`, JPEG).expect(204);
    const img = await http()
      .get(`${o()}/cameras/${cameraId}/snapshot`)
      .set(bearer(tok.manager))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(img.body as Buffer, JPEG)).toBe(0);
    await http().get(`${o()}/cameras/${cameraId}/snapshot`).set(bearer(tok.waiter)).expect(403);
    expect((await signed('GET', '/api/v1/edge/config').expect(200)).body.cameras[0].snapshotWanted).toBe(
      false,
    );
    await http().post(`${o()}/cameras/${cameraId}/request-snapshot`).set(bearer(tok.manager)).expect(202);
    expect((await signed('GET', '/api/v1/edge/config').expect(200)).body.cameras[0].snapshotWanted).toBe(
      true,
    );
  });

  it('turns camera observations into table events: occupied, dedupe, rejections', async () => {
    const occ = evt('table.occupied', {
      tableId: t.tables.T1,
      confidence: 0.93,
      payload: { guestCount: 3, dwellSeconds: 30 },
    });
    const r = await events([occ]).expect(200);
    expect(r.body).toEqual({ accepted: [occ.eventId], duplicates: [], rejected: [], retry: [] });
    expect(await status(t.tables.T1)).toBe('OCCUPIED');
    const seating = await prisma.seating.findFirstOrThrow({
      where: { tables: { some: { tableId: t.tables.T1, isOpen: true } } },
    });
    expect(seating).toMatchObject({ seatedBy: 'CAMERA', partySize: 3 });

    const again = await events([occ]).expect(200);
    expect(again.body.duplicates).toEqual([occ.eventId]);

    const noZone = evt('table.occupied', {
      tableId: t.tables.T3,
      confidence: 0.9,
      payload: { guestCount: 2, dwellSeconds: 30 },
    });
    const stale = {
      ...evt('table.vacated', { tableId: t.tables.T2, confidence: 0.9, payload: { emptySeconds: 90 } }),
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    };
    const badCam = {
      ...evt('table.occupied', {
        tableId: t.tables.T1,
        confidence: 0.9,
        payload: { guestCount: 2, dwellSeconds: 30 },
      }),
      cameraId: 'other',
    };
    const junk = { eventId: 'evt_junk00000', type: 'table.occupied' };
    const res = await events([noZone, stale, badCam, junk]).expect(200);
    expect(res.body.rejected).toEqual([
      { eventId: noZone.eventId, reason: 'NO_ZONE' },
      { eventId: stale.eventId, reason: 'STALE' },
      { eventId: badCam.eventId, reason: 'UNKNOWN_CAMERA' },
      { eventId: 'evt_junk00000', reason: 'INVALID' },
    ]);

    // Batches are bound to the signing device.
    const body = JSON.stringify({
      deviceId: 'someone-else',
      sentAt: new Date().toISOString(),
      events: [occ],
    });
    await signed('POST', '/api/v1/edge/events', body).expect(403);
  });

  it('M6 chain: camera seats the table → nobody greets → assigned at 5:00 → waiter greets', async () => {
    const now = Date.now();
    const shift = await http()
      .post(`${o()}/shifts`)
      .set(bearer(tok.manager))
      .send({
        userId: t.users.waiter.id,
        role: 'WAITER',
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        sectionIds: [],
      })
      .expect(201);
    await http().post(`${o()}/shifts/${shift.body.id}/check-in`).set(bearer(tok.manager)).expect(200);

    await events([
      evt('table.occupied', {
        tableId: t.tables.T2,
        confidence: 0.9,
        payload: { guestCount: 2, dwellSeconds: 30 },
      }),
    ]).expect(200);
    expect(await status(t.tables.T2)).toBe('OCCUPIED');
    const seating = await prisma.seating.findFirstOrThrow({
      where: { tables: { some: { tableId: t.tables.T2, isOpen: true } } },
    });
    await app.get(SlaEngine).evaluate(seating.id, new Date(seating.seatedAt.getTime() + 300_000));
    expect(await prisma.assignment.findFirst({ where: { seatingId: seating.id } })).toMatchObject({
      waiterId: t.users.waiter.id,
    });
    await http()
      .post(`${o()}/tables/${t.tables.T2}/transitions`)
      .set(bearer(tok.waiter))
      .send({ event: 'GREET' })
      .expect(200);
    expect(await status(t.tables.T2)).toBe('GREETED');

    // The camera then sees them leave before ordering: nothing owed, so no alert and no auto-close.
    const left = await events([
      evt('table.vacated', { tableId: t.tables.T2, confidence: 0.9, payload: { emptySeconds: 90 } }),
    ]).expect(200);
    expect(left.body.accepted).toHaveLength(1);
    expect(await status(t.tables.T2)).toBe('GREETED');
  });

  it('tracks camera health and raises/resolves CAMERA_OFFLINE', async () => {
    const health = (s: string) =>
      evt('camera.health', {
        payload: {
          status: s,
          fps: s === 'down' ? 0 : 3,
          latencyMs: 40,
          lastFrameAt: s === 'down' ? null : new Date().toISOString(),
          reconnects: 1,
        },
      });
    await events([health('ok')]).expect(200);
    expect((await prisma.camera.findUniqueOrThrow({ where: { id: cameraId } })).healthy).toBe(true);
    await events([health('down')]).expect(200);
    const open = await prisma.alert.findMany({ where: { cameraId, type: 'CAMERA_OFFLINE', status: 'OPEN' } });
    expect(open).toHaveLength(1);
    await events([health('down')]).expect(200);
    expect(
      await prisma.alert.count({ where: { cameraId, type: 'CAMERA_OFFLINE', status: { not: 'RESOLVED' } } }),
    ).toBe(1);
    await events([health('ok')]).expect(200);
    expect(
      await prisma.alert.count({ where: { cameraId, type: 'CAMERA_OFFLINE', status: { not: 'RESOLVED' } } }),
    ).toBe(0);

    // Silence for longer than the stale window → the sweep marks it offline again (a new episode).
    await prisma.camera.update({
      where: { id: cameraId },
      data: { lastHealthAt: new Date(Date.now() - 300_000) },
    });
    await app.get(EdgeService).sweep();
    expect(await prisma.alert.count({ where: { cameraId, type: 'CAMERA_OFFLINE', status: 'OPEN' } })).toBe(1);

    const cams = await http().get(`${o()}/cameras`).set(bearer(tok.manager)).expect(200);
    expect(cams.body[0]).toMatchObject({ healthy: false, hasSnapshot: true, zones: expect.any(Array) });
  });

  it('revoking a device locks it out and disables its cameras', async () => {
    await http().delete(`${o()}/edge-devices/${device.deviceId}`).set(bearer(tok.manager)).expect(204);
    await signed('GET', '/api/v1/edge/config').expect(401);
    expect((await prisma.camera.findUniqueOrThrow({ where: { id: cameraId } })).enabled).toBe(false);
  });
});
