/**
 * Day report (pure): seatings, greet times, SLA misses per waiter, sales by hour, payments by method.
 * The API loads the rows for one local day; everything here is arithmetic, so it is unit-tested with fixtures.
 */

export interface ReportSeating {
  seatedAt: Date;
  greetedAt: Date | null;
  greetedById: string | null;
  partySize: number | null;
  slaBreachedAt: Date | null;
  escalatedAt: Date | null;
}

export interface ReportAssignment {
  waiterId: string;
  assignedAt: Date;
  acknowledgedAt: Date | null;
  /** Set when the table was passed on to the next waiter (not acknowledged in time). */
  expiredAt: Date | null;
}

export interface ReportBill {
  finalizedAt: Date;
  totalPaise: number;
}

export interface ReportPayment {
  method: string;
  amountPaise: number;
  /** Tip on top (not part of sales). */
  tipPaise?: number;
  tipWaiterId?: string | null;
}

export interface DayReport {
  seatings: {
    total: number;
    covers: number;
    greeted: number;
    avgSeatToGreetSeconds: number | null;
    medianSeatToGreetSeconds: number | null;
    greetedWithinSlaPct: number | null;
    slaBreaches: number;
    escalations: number;
    leftWithoutPaying: number;
  };
  waiters: {
    waiterId: string;
    name: string;
    greets: number;
    assignments: number;
    acknowledged: number;
    /** Assignments passed on because this waiter did not acknowledge in time. */
    missed: number;
    avgAckSeconds: number | null;
    /** Tips attributed to this waiter (serving waiter at payment time). */
    tipsPaise: number;
  }[];
  salesByHour: { hour: number; bills: number; totalPaise: number }[];
  payments: { method: string; count: number; amountPaise: number }[];
  sales: { bills: number; totalPaise: number; avgBillPaise: number | null };
  /** Tips are never part of sales or GST; tips with no serving waiter are "unattributed". */
  tips: { totalPaise: number; unattributedPaise: number };
}

const secs = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at));
}

export function summarizeDay(input: {
  seatings: ReportSeating[];
  assignments: ReportAssignment[];
  bills: ReportBill[];
  payments: ReportPayment[];
  leftWithoutPaying: number;
  greetSlaSeconds: number;
  timeZone: string;
  names: ReadonlyMap<string, string>;
}): DayReport {
  const greetTimes = input.seatings
    .filter((s) => s.greetedAt)
    .map((s) => Math.max(0, secs(s.seatedAt, s.greetedAt!)));
  const waiters = new Map<string, DayReport['waiters'][number] & { ackTimes: number[] }>();
  const w = (id: string) => {
    let row = waiters.get(id);
    if (!row) {
      row = {
        waiterId: id,
        name: input.names.get(id) ?? '?',
        greets: 0,
        assignments: 0,
        acknowledged: 0,
        missed: 0,
        avgAckSeconds: null,
        tipsPaise: 0,
        ackTimes: [],
      };
      waiters.set(id, row);
    }
    return row;
  };
  for (const s of input.seatings) if (s.greetedById) w(s.greetedById).greets++;
  for (const a of input.assignments) {
    const row = w(a.waiterId);
    row.assignments++;
    if (a.acknowledgedAt) {
      row.acknowledged++;
      row.ackTimes.push(Math.max(0, secs(a.assignedAt, a.acknowledgedAt)));
    } else if (a.expiredAt) row.missed++;
  }

  const hours = new Map<number, { hour: number; bills: number; totalPaise: number }>();
  for (const b of input.bills) {
    const h = localHour(b.finalizedAt, input.timeZone);
    const row = hours.get(h) ?? { hour: h, bills: 0, totalPaise: 0 };
    row.bills++;
    row.totalPaise += b.totalPaise;
    hours.set(h, row);
  }
  const methods = new Map<string, { method: string; count: number; amountPaise: number }>();
  for (const p of input.payments) {
    const row = methods.get(p.method) ?? { method: p.method, count: 0, amountPaise: 0 };
    row.count++;
    row.amountPaise += p.amountPaise;
    methods.set(p.method, row);
  }
  const salesTotal = input.bills.reduce((s, b) => s + b.totalPaise, 0);
  let tipsTotal = 0;
  let unattributed = 0;
  for (const p of input.payments) {
    const tip = p.tipPaise ?? 0;
    if (!tip) continue;
    tipsTotal += tip;
    if (p.tipWaiterId) w(p.tipWaiterId).tipsPaise += tip;
    else unattributed += tip;
  }

  return {
    seatings: {
      total: input.seatings.length,
      covers: input.seatings.reduce((s, x) => s + (x.partySize ?? 0), 0),
      greeted: greetTimes.length,
      avgSeatToGreetSeconds: round1(mean(greetTimes)),
      medianSeatToGreetSeconds: round1(median(greetTimes)),
      greetedWithinSlaPct: greetTimes.length
        ? round1((100 * greetTimes.filter((g) => g <= input.greetSlaSeconds).length) / greetTimes.length)
        : null,
      slaBreaches: input.seatings.filter((s) => s.slaBreachedAt).length,
      escalations: input.seatings.filter((s) => s.escalatedAt).length,
      leftWithoutPaying: input.leftWithoutPaying,
    },
    waiters: [...waiters.values()]
      .map(({ ackTimes, ...r }) => ({ ...r, avgAckSeconds: round1(mean(ackTimes)) }))
      .sort((a, b) => b.missed - a.missed || b.assignments - a.assignments || a.name.localeCompare(b.name)),
    salesByHour: [...hours.values()].sort((a, b) => a.hour - b.hour),
    payments: [...methods.values()].sort((a, b) => b.amountPaise - a.amountPaise),
    sales: {
      bills: input.bills.length,
      totalPaise: salesTotal,
      avgBillPaise: input.bills.length ? Math.round(salesTotal / input.bills.length) : null,
    },
    tips: { totalPaise: tipsTotal, unattributedPaise: unattributed },
  };
}
