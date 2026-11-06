import { dayOfWeek, localDateTime } from '../time';

/**
 * Reservation availability (pure). The API feeds it tables, existing bookings and live occupancy; it answers
 * "which table(s) can take this party from `from` to `to`" and "which slots are bookable on a day".
 * A table is never offered for two overlapping intervals — property-tested in availability.spec.ts.
 */

export interface BookTable {
  id: string;
  capacity: number;
  minCapacity: number;
  sectionId: string | null;
  onlineBookable: boolean;
  joinableWith: readonly string[];
  /** OUT_OF_SERVICE tables are never offered. */
  outOfService?: boolean;
}

/** An interval during which tables are taken (a booking, or a party seated right now). */
export interface Busy {
  tableIds: readonly string[];
  from: Date;
  to: Date;
  /** Ignored when checking that same reservation (reschedule). */
  reservationId?: string;
  partySize?: number;
}

export interface TurnTimes {
  /** Parties of 1–2. */
  small: number;
  /** 3–4. */
  medium: number;
  /** 5+. */
  large: number;
}

export interface BookingRules {
  slotMinutes: number;
  leadMinutes: number;
  horizonDays: number;
  maxPartySize: number;
  /** No booking starts later than this many minutes before closing. */
  lastSeatingMinutes: number;
  turnMinutes: TurnTimes;
  /** Total covers that may start in one slot (kitchen pacing); 0 = no limit. */
  maxCoversPerSlot: number;
}

export interface OpeningWindow {
  dayOfWeek: number; // 0 = Sunday
  opens: string; // "12:00"
  closes: string; // "23:00" ("24:00" allowed)
}

export function turnMinutes(partySize: number, t: TurnTimes): number {
  return partySize <= 2 ? t.small : partySize <= 4 ? t.medium : t.large;
}

const overlaps = (a: { from: Date; to: Date }, b: { from: Date; to: Date }) => a.from < b.to && b.from < a.to;

export interface PickRequest {
  partySize: number;
  from: Date;
  to: Date;
  /** Preferred section: tried first, others after. */
  sectionId?: string | null;
  /** Online bookings only use tables marked bookable online. */
  online: boolean;
  /** Reservation being moved: its own interval doesn't block it. */
  ignoreReservationId?: string;
}

/**
 * Smallest table that fits (capacity ≥ party ≥ min capacity), else the smallest joinable pair. Preferred section
 * first. Returns table ids, or null when nothing is free.
 */
export function pickTables(
  tables: readonly BookTable[],
  busy: readonly Busy[],
  req: PickRequest,
): string[] | null {
  const blocking = busy.filter(
    (b) => b.reservationId === undefined || b.reservationId !== req.ignoreReservationId,
  );
  const taken = new Set<string>();
  for (const b of blocking) if (overlaps(b, req)) b.tableIds.forEach((id) => taken.add(id));
  const usable = tables.filter(
    (t) => !t.outOfService && !taken.has(t.id) && (!req.online || t.onlineBookable),
  );
  const byId = new Map(usable.map((t) => [t.id, t]));
  const pref = (ids: string[]) =>
    req.sectionId && ids.every((id) => byId.get(id)?.sectionId === req.sectionId) ? 0 : 1;

  const singles = usable
    .filter((t) => t.capacity >= req.partySize && t.minCapacity <= req.partySize)
    .map((t) => ({ ids: [t.id], cap: t.capacity }));
  const pairs: { ids: string[]; cap: number }[] = [];
  for (const t of usable)
    for (const j of t.joinableWith) {
      const o = byId.get(j);
      if (!o || o.id <= t.id) continue; // each pair once
      const cap = t.capacity + o.capacity;
      if (cap >= req.partySize) pairs.push({ ids: [t.id, o.id], cap });
    }
  const rank = (xs: { ids: string[]; cap: number }[]) =>
    [...xs].sort((a, b) => pref(a.ids) - pref(b.ids) || a.cap - b.cap || a.ids[0]!.localeCompare(b.ids[0]!));
  const best = rank(singles)[0] ?? rank(pairs)[0];
  return best ? best.ids : null;
}

export interface Slot {
  /** Local "HH:MM". */
  time: string;
  startsAt: Date;
  available: boolean;
}

/** Bookable slots of a local day for a party size. */
export function listSlots(input: {
  date: string;
  timeZone: string;
  now: Date;
  partySize: number;
  hours: readonly OpeningWindow[];
  rules: BookingRules;
  tables: readonly BookTable[];
  busy: readonly Busy[];
  online: boolean;
  sectionId?: string | null;
}): Slot[] {
  const { rules } = input;
  if (input.partySize < 1 || input.partySize > rules.maxPartySize) return [];
  const dow = dayOfWeek(input.date);
  const earliest = input.now.getTime() + rules.leadMinutes * 60_000;
  const latest = input.now.getTime() + rules.horizonDays * 86_400_000;
  const length = turnMinutes(input.partySize, rules.turnMinutes) * 60_000;
  const out: Slot[] = [];
  const seen = new Set<number>();
  for (const w of input.hours.filter((h) => h.dayOfWeek === dow)) {
    const [oh, om] = w.opens.split(':').map(Number) as [number, number];
    const [ch, cm] = w.closes.split(':').map(Number) as [number, number];
    const lastStart = ch * 60 + cm - rules.lastSeatingMinutes;
    for (let m = oh * 60 + om; m <= lastStart; m += rules.slotMinutes) {
      const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      if (m >= 24 * 60) break;
      const startsAt = localDateTime(input.date, time, input.timeZone);
      if (seen.has(startsAt.getTime())) continue;
      seen.add(startsAt.getTime());
      const t = startsAt.getTime();
      let available = t >= earliest && t <= latest;
      if (available && rules.maxCoversPerSlot > 0) {
        const slotEnd = t + rules.slotMinutes * 60_000;
        const covers = input.busy
          .filter((b) => b.reservationId && b.from.getTime() >= t && b.from.getTime() < slotEnd)
          .reduce((s, b) => s + (b.partySize ?? 0), 0);
        available = covers + input.partySize <= rules.maxCoversPerSlot;
      }
      if (available)
        available =
          pickTables(input.tables, input.busy, {
            partySize: input.partySize,
            from: startsAt,
            to: new Date(t + length),
            sectionId: input.sectionId ?? null,
            online: input.online,
          }) !== null;
      out.push({ time, startsAt, available });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
