/**
 * Prep-time prediction (pure). Base time per dish is the median QUEUED→READY of its last 28 days (at least
 * MIN_SAMPLES), else the station's median, else a default; it is stretched by how busy the station is right now.
 * The order ETA is the latest item ETA. Everything is explainable: no model, no training.
 */
import { median } from '../booking/wait-time';

export const PREP_MIN_SAMPLES = 5;
export const PREP_DEFAULT_SECONDS = 15 * 60;
/** Each item already waiting at the station adds this share of the base time, up to MAX_LOAD_FACTOR. */
export const LOAD_PER_ITEM = 0.05;
export const MAX_LOAD_FACTOR = 2;

export interface PrepSample {
  menuItemId: string;
  stationId: string;
  seconds: number;
}

export interface PrepStats {
  byItem: Map<string, number>;
  byStation: Map<string, number>;
}

export function prepStats(samples: PrepSample[]): PrepStats {
  const group = (key: (s: PrepSample) => string) => {
    const m = new Map<string, number[]>();
    for (const s of samples) {
      if (!(s.seconds > 0)) continue;
      const k = key(s);
      m.set(k, [...(m.get(k) ?? []), s.seconds]);
    }
    const out = new Map<string, number>();
    for (const [k, xs] of m) if (xs.length >= PREP_MIN_SAMPLES) out.set(k, Math.round(median(xs)!));
    return out;
  };
  return { byItem: group((s) => s.menuItemId), byStation: group((s) => s.stationId) };
}

export function loadFactor(itemsAhead: number): number {
  return Math.min(MAX_LOAD_FACTOR, 1 + LOAD_PER_ITEM * Math.max(0, itemsAhead));
}

/** Predicted seconds from reaching the kitchen to ready. */
export function predictPrepSeconds(
  item: { menuItemId: string; stationId: string },
  stats: PrepStats,
  itemsAhead: number,
): number {
  const base =
    stats.byItem.get(item.menuItemId) ?? stats.byStation.get(item.stationId) ?? PREP_DEFAULT_SECONDS;
  return Math.round(base * loadFactor(itemsAhead));
}

export interface EtaItem {
  status: string;
  queuedAt: Date;
  etaReadyAt: Date | null;
}

/**
 * When the still-cooking part of an order should be ready (null if nothing is cooking). Held courses have no
 * ETA yet. A late item never shows a time in the past: it shows "any minute" (now + 1 min).
 */
export function orderEta(items: EtaItem[], now: Date): Date | null {
  const cooking = items.filter((i) => (i.status === 'QUEUED' || i.status === 'COOKING') && i.etaReadyAt);
  if (!cooking.length) return null;
  const latest = Math.max(...cooking.map((i) => i.etaReadyAt!.getTime()));
  return new Date(Math.max(latest, now.getTime() + 60_000));
}

/** Prediction accuracy over finished items: mean absolute error and share within ±5 min. */
export function prepAccuracy(items: { queuedAt: Date; etaReadyAt: Date | null; readyAt: Date | null }[]) {
  const errs = items
    .filter((i) => i.etaReadyAt && i.readyAt)
    .map((i) => Math.abs(i.readyAt!.getTime() - i.etaReadyAt!.getTime()) / 1000);
  if (!errs.length) return { items: 0, meanAbsErrorSeconds: null, within5MinPct: null };
  return {
    items: errs.length,
    meanAbsErrorSeconds: Math.round(errs.reduce((a, b) => a + b, 0) / errs.length),
    within5MinPct: Math.round((errs.filter((e) => e <= 300).length / errs.length) * 100),
  };
}
