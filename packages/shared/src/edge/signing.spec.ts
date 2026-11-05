import { describe, expect, it } from 'vitest';
import { edgeBatchSchema, edgeEventSchema, zonesInputSchema } from './contracts';
import { EDGE_SIGNING_VECTOR as V, edgeSignature } from './signing';

describe('edge signing', () => {
  it('matches the known-answer vector (also asserted by the Python service)', () => {
    expect(edgeSignature(V.secret, V.timestamp, V.method, V.path, V.body)).toBe(V.signature);
  });

  it('binds method, path, time and body', () => {
    const sig = (over: Partial<typeof V>) => {
      const v = { ...V, ...over };
      return edgeSignature(v.secret, v.timestamp, v.method, v.path, v.body);
    };
    for (const over of [
      { method: 'GET' },
      { path: '/api/v1/edge/config' },
      { timestamp: '1762300801' },
      { body: '{}' },
      { secret: 'x' },
    ]) {
      expect(sig(over as Partial<typeof V>)).not.toBe(V.signature);
    }
  });
});

describe('edge contracts', () => {
  const t = '2026-11-05T10:00:00Z';
  it('accepts each event type and rejects junk', () => {
    const ok = [
      {
        type: 'table.occupied',
        eventId: 'evt_00000001',
        occurredAt: t,
        cameraId: 'c',
        tableId: 't',
        confidence: 0.9,
        payload: { guestCount: 2, dwellSeconds: 30 },
      },
      {
        type: 'table.vacated',
        eventId: 'evt_00000002',
        occurredAt: t,
        cameraId: 'c',
        tableId: 't',
        confidence: 0.9,
        payload: { emptySeconds: 90 },
      },
      {
        type: 'camera.health',
        eventId: 'evt_00000003',
        occurredAt: t,
        cameraId: 'c',
        payload: { status: 'ok', fps: 3, latencyMs: 40, lastFrameAt: t, reconnects: 0 },
      },
      {
        type: 'device.heartbeat',
        eventId: 'evt_00000004',
        occurredAt: t,
        payload: { version: '0.1.0', uptimeS: 10, queueDepth: 0 },
      },
    ];
    for (const e of ok) expect(edgeEventSchema.safeParse(e).success, e.type).toBe(true);
    expect(
      edgeEventSchema.safeParse({ ...ok[0], payload: { guestCount: -1, dwellSeconds: 1 } }).success,
    ).toBe(false);
    expect(edgeEventSchema.safeParse({ ...ok[0], type: 'table.exploded' }).success).toBe(false);
    expect(edgeEventSchema.safeParse({ ...ok[0], eventId: 'x' }).success).toBe(false);
    expect(edgeBatchSchema.safeParse({ deviceId: 'd', sentAt: t, events: [] }).success).toBe(false);
  });

  it('validates zone polygons in normalised coordinates', () => {
    const tri = [
      [0.1, 0.1],
      [0.5, 0.1],
      [0.3, 0.4],
    ];
    expect(zonesInputSchema.safeParse({ zones: [{ tableId: 't', polygon: tri }] }).success).toBe(true);
    expect(zonesInputSchema.safeParse({ zones: [{ tableId: 't', polygon: tri.slice(0, 2) }] }).success).toBe(
      false,
    );
    expect(
      zonesInputSchema.safeParse({
        zones: [
          {
            tableId: 't',
            polygon: [
              [1.2, 0],
              [0, 0],
              [0, 1],
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      zonesInputSchema.safeParse({
        zones: [
          { tableId: 't', polygon: tri },
          { tableId: 't', polygon: tri },
        ],
      }).success,
    ).toBe(false);
  });
});
