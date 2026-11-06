/**
 * Waitlist ETAs (pure). Each table gets an expected "free at" time from its stage and the outlet's recent dwell
 * history; the queue is then played forward in order — each party takes the fitting table(s) that free up first.
 * Shown as a range (people forgive "15–25 min" more than a missed "15 min").
 */

export interface WaitTable {
  id: string;
  capacity: number;
  minCapacity: number;
  joinableWith: readonly string[];
  /** Epoch ms when the table is expected to be ready (≤ now = free now). Infinity = not usable. */
  freeAt: number;
}

export interface QueueParty {
  id: string;
  partySize: number;
}

export interface WaitPrediction {
  /** Minutes until seated, or null when no table (or joinable pair) can ever fit the party. */
  minutes: number | null;
  tableIds: string[];
}

/** Minimum minutes a seated table still needs, by stage (even if it is past the usual dwell). */
const STAGE_FLOOR: Record<string, number> = {
  OCCUPIED: 20,
  GREETED: 20,
  ORDERED: 15,
  SERVED: 10,
  BILL_REQUESTED: 5,
  PAID: 2,
};
export const CLEAN_MINUTES = 5;

export function expectedFreeAt(
  t: { status: string; seatedAt?: Date | null; partySize?: number | null },
  now: number,
  medianDwellMinutes: (partySize: number) => number,
): number {
  switch (t.status) {
    case 'VACANT':
      return now;
    case 'NEEDS_CLEANING':
      return now + CLEAN_MINUTES * 60_000;
    case 'OUT_OF_SERVICE':
    case 'RESERVED':
      return Infinity;
    default: {
      const floor = STAGE_FLOOR[t.status];
      if (floor === undefined || !t.seatedAt) return Infinity;
      const elapsed = (now - t.seatedAt.getTime()) / 60_000;
      const remaining = Math.max(floor, medianDwellMinutes(t.partySize ?? 2) - elapsed);
      return now + (remaining + CLEAN_MINUTES) * 60_000;
    }
  }
}

export function predictWaits(
  tables: readonly WaitTable[],
  queue: readonly QueueParty[],
  now: number,
  turnMinutes: (partySize: number) => number,
): Map<string, WaitPrediction> {
  const freeAt = new Map(tables.map((t) => [t.id, Math.max(now, t.freeAt)]));
  const byId = new Map(tables.map((t) => [t.id, t]));
  const out = new Map<string, WaitPrediction>();
  for (const p of queue) {
    let best: { ids: string[]; start: number; cap: number } | null = null;
    const consider = (ids: string[], cap: number) => {
      const start = Math.max(...ids.map((id) => freeAt.get(id)!));
      if (!Number.isFinite(start)) return;
      if (
        !best ||
        start < best.start ||
        (start === best.start &&
          (ids.length < best.ids.length || (ids.length === best.ids.length && cap < best.cap)))
      )
        best = { ids, start, cap };
    };
    for (const t of tables) {
      if (t.capacity >= p.partySize && t.minCapacity <= p.partySize) consider([t.id], t.capacity);
      for (const j of t.joinableWith) {
        const o = byId.get(j);
        if (o && o.id > t.id && t.capacity + o.capacity >= p.partySize)
          consider([t.id, o.id], t.capacity + o.capacity);
      }
    }
    const chosen = best as { ids: string[]; start: number; cap: number } | null;
    if (!chosen) {
      out.set(p.id, { minutes: null, tableIds: [] });
      continue;
    }
    const until = chosen.start + (turnMinutes(p.partySize) + CLEAN_MINUTES) * 60_000;
    chosen.ids.forEach((id) => freeAt.set(id, until));
    out.set(p.id, { minutes: Math.max(0, Math.round((chosen.start - now) / 60_000)), tableIds: chosen.ids });
  }
  return out;
}

/** "15–25 min" style range in 5-minute steps; a table free now reads 0–5. */
export function waitRange(minutes: number): { low: number; high: number } {
  if (minutes <= 2) return { low: 0, high: 5 };
  const low = Math.floor((minutes * 0.8) / 5) * 5;
  const high = Math.max(low + 5, Math.ceil((minutes * 1.25) / 5) * 5);
  return { low, high };
}

/** Median of a list (minutes); null when empty. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
