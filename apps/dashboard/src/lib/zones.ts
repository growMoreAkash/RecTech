import type { Camera, Point } from './types';

/** Pure helpers for the camera page: health labels and zone polygons (normalised 0..1 coordinates). */

export type CameraHealth = 'ok' | 'degraded' | 'down' | 'unknown';

export function cameraHealth(
  c: Pick<Camera, 'enabled' | 'healthy' | 'lastHealthAt' | 'lastHealth'>,
): CameraHealth {
  if (!c.enabled || !c.lastHealthAt) return 'unknown';
  if (!c.healthy) return 'down';
  return c.lastHealth?.status === 'degraded' ? 'degraded' : 'ok';
}

/** An edge device is online if it reported within the last two minutes. */
export function deviceOnline(lastSeenAt: string | null, now: number, windowMs = 120_000): boolean {
  return !!lastSeenAt && now - new Date(lastSeenAt).getTime() <= windowMs;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 10_000) / 10_000;

export function normalise(p: Point): Point {
  return [round(clamp01(p[0])), round(clamp01(p[1]))];
}

/** Rectangle from percentages (the keyboard way to set a zone). */
export function rectPolygon(left: number, top: number, right: number, bottom: number): Point[] {
  const [x1, x2] = [Math.min(left, right) / 100, Math.max(left, right) / 100];
  const [y1, y2] = [Math.min(top, bottom) / 100, Math.max(top, bottom) / 100];
  return [normalise([x1, y1]), normalise([x2, y1]), normalise([x2, y2]), normalise([x1, y2])];
}

/** Bounding box of a polygon in percent (shown in the accessible list). */
export function boundsPercent(poly: Point[]): { left: number; top: number; right: number; bottom: number } {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const pct = (v: number) => Math.round(v * 100);
  return {
    left: pct(Math.min(...xs)),
    top: pct(Math.min(...ys)),
    right: pct(Math.max(...xs)),
    bottom: pct(Math.max(...ys)),
  };
}

/** Twice the signed area; a valid zone has ≥ 3 points and a non-trivial area (≥ 0.1 % of the frame). */
export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export const MAX_POINTS = 32;

export function isValidZone(poly: Point[]): boolean {
  return poly.length >= 3 && poly.length <= MAX_POINTS && polygonArea(poly) >= 0.001;
}

/** True when a click lands close enough to the first vertex to close the polygon (in pixels). */
export function closesPolygon(
  draft: Point[],
  click: Point,
  size: { w: number; h: number },
  radiusPx = 12,
): boolean {
  if (draft.length < 3) return false;
  const [x0, y0] = draft[0]!;
  return Math.hypot((click[0] - x0) * size.w, (click[1] - y0) * size.h) <= radiusPx;
}

/** Body for PUT /cameras/:id/zones — only tables that still exist, valid polygons, one per table. */
export function zonesBody(zones: Record<string, Point[]>, tableIds: ReadonlySet<string>) {
  return {
    zones: Object.entries(zones)
      .filter(([tableId, poly]) => tableIds.has(tableId) && isValidZone(poly))
      .map(([tableId, polygon]) => ({ tableId, polygon: polygon.map(normalise) })),
  };
}
