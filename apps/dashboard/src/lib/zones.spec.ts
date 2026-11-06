import { describe, expect, it } from 'vitest';
import {
  boundsPercent,
  cameraHealth,
  closesPolygon,
  deviceOnline,
  isValidZone,
  rectPolygon,
  zonesBody,
} from './zones';

describe('camera health', () => {
  const base = { enabled: true, healthy: true, lastHealthAt: '2026-11-05T10:00:00Z', lastHealth: null };
  it('maps API fields to a label', () => {
    expect(cameraHealth({ ...base, lastHealthAt: null })).toBe('unknown');
    expect(cameraHealth({ ...base, enabled: false })).toBe('unknown');
    expect(cameraHealth({ ...base, healthy: false })).toBe('down');
    expect(cameraHealth(base)).toBe('ok');
    expect(
      cameraHealth({
        ...base,
        lastHealth: { status: 'degraded', fps: 1, latencyMs: 5, lastFrameAt: null, reconnects: 2 },
      }),
    ).toBe('degraded');
  });
  it('device online window', () => {
    const now = Date.parse('2026-11-05T10:02:00Z');
    expect(deviceOnline('2026-11-05T10:01:00Z', now)).toBe(true);
    expect(deviceOnline('2026-11-05T09:59:00Z', now)).toBe(false);
    expect(deviceOnline(null, now)).toBe(false);
  });
});

describe('zones', () => {
  it('rectangles from percentages, in any corner order, clamped', () => {
    expect(rectPolygon(60, 50, 10, 20)).toEqual([
      [0.1, 0.2],
      [0.6, 0.2],
      [0.6, 0.5],
      [0.1, 0.5],
    ]);
    expect(rectPolygon(-5, 0, 120, 100)[1]).toEqual([1, 0]);
    expect(boundsPercent(rectPolygon(10, 20, 60, 50))).toEqual({ left: 10, top: 20, right: 60, bottom: 50 });
  });
  it('validity needs 3+ points and some area', () => {
    expect(
      isValidZone([
        [0, 0],
        [1, 0],
      ]),
    ).toBe(false);
    expect(
      isValidZone([
        [0, 0],
        [0.5, 0.5],
        [1, 1],
      ]),
    ).toBe(false);
    expect(isValidZone(rectPolygon(10, 10, 30, 30))).toBe(true);
  });
  it('closing click near the first vertex', () => {
    const draft: [number, number][] = [
      [0.1, 0.1],
      [0.5, 0.1],
      [0.5, 0.5],
    ];
    expect(closesPolygon(draft, [0.105, 0.1], { w: 1000, h: 500 })).toBe(true);
    expect(closesPolygon(draft, [0.2, 0.1], { w: 1000, h: 500 })).toBe(false);
    expect(closesPolygon(draft.slice(0, 2), [0.1, 0.1], { w: 1000, h: 500 })).toBe(false);
  });
  it('save body drops removed tables and invalid polygons', () => {
    const body = zonesBody(
      {
        t1: rectPolygon(0, 0, 50, 50),
        gone: rectPolygon(0, 0, 50, 50),
        t2: [
          [0, 0],
          [1, 1],
          [0.5, 0.5],
        ],
      },
      new Set(['t1', 't2']),
    );
    expect(body.zones.map((z) => z.tableId)).toEqual(['t1']);
  });
});
