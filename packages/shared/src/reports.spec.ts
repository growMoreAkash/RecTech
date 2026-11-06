import { describe, expect, it } from 'vitest';
import { localHour, summarizeDay } from './reports';

const at = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00+05:30`);

describe('day report', () => {
  it('summarises greet times, SLA misses per waiter, sales by local hour and payments', () => {
    const r = summarizeDay({
      seatings: [
        {
          seatedAt: at('12:00'),
          greetedAt: at('12:02'),
          greetedById: 'w1',
          partySize: 2,
          slaBreachedAt: null,
          escalatedAt: null,
        },
        {
          seatedAt: at('12:10'),
          greetedAt: at('12:18'),
          greetedById: 'w2',
          partySize: 4,
          slaBreachedAt: at('12:15'),
          escalatedAt: null,
        },
        {
          seatedAt: at('13:00'),
          greetedAt: null,
          greetedById: null,
          partySize: null,
          slaBreachedAt: at('13:05'),
          escalatedAt: at('13:10'),
        },
      ],
      assignments: [
        { waiterId: 'w1', assignedAt: at('12:15'), acknowledgedAt: null, expiredAt: at('12:17') },
        { waiterId: 'w2', assignedAt: at('12:17'), acknowledgedAt: at('12:17'), expiredAt: null },
        { waiterId: 'w1', assignedAt: at('13:05'), acknowledgedAt: null, expiredAt: at('13:07') },
      ],
      bills: [
        { finalizedAt: at('12:45'), totalPaise: 75_600 },
        { finalizedAt: at('12:59'), totalPaise: 24_400 },
        { finalizedAt: at('14:01'), totalPaise: 50_000 },
      ],
      payments: [
        { method: 'UPI', amountPaise: 100_000, tipPaise: 10_000, tipWaiterId: 'w2' },
        { method: 'CASH', amountPaise: 50_000, tipPaise: 2_000, tipWaiterId: null },
        { method: 'UPI', amountPaise: 0 },
      ],
      leftWithoutPaying: 1,
      greetSlaSeconds: 300,
      timeZone: 'Asia/Kolkata',
      names: new Map([
        ['w1', 'Anil'],
        ['w2', 'Sunita'],
      ]),
    });
    expect(r.seatings).toEqual({
      total: 3,
      covers: 6,
      greeted: 2,
      avgSeatToGreetSeconds: 300,
      medianSeatToGreetSeconds: 300,
      greetedWithinSlaPct: 50,
      slaBreaches: 2,
      escalations: 1,
      leftWithoutPaying: 1,
    });
    expect(r.waiters).toEqual([
      {
        waiterId: 'w1',
        name: 'Anil',
        greets: 1,
        assignments: 2,
        acknowledged: 0,
        missed: 2,
        avgAckSeconds: null,
        tipsPaise: 0,
      },
      {
        waiterId: 'w2',
        name: 'Sunita',
        greets: 1,
        assignments: 1,
        acknowledged: 1,
        missed: 0,
        avgAckSeconds: 0,
        tipsPaise: 10_000,
      },
    ]);
    expect(r.salesByHour).toEqual([
      { hour: 12, bills: 2, totalPaise: 100_000 },
      { hour: 14, bills: 1, totalPaise: 50_000 },
    ]);
    expect(r.payments[0]).toEqual({ method: 'UPI', count: 2, amountPaise: 100_000 });
    expect(r.sales).toEqual({ bills: 3, totalPaise: 150_000, avgBillPaise: 50_000 });
    // Tips never count as sales; the counter tip with no serving waiter is unattributed.
    expect(r.tips).toEqual({ totalPaise: 12_000, unattributedPaise: 2_000 });
  });

  it('empty day', () => {
    const r = summarizeDay({
      seatings: [],
      assignments: [],
      bills: [],
      payments: [],
      leftWithoutPaying: 0,
      greetSlaSeconds: 300,
      timeZone: 'Asia/Kolkata',
      names: new Map(),
    });
    expect(r.seatings.avgSeatToGreetSeconds).toBeNull();
    expect(r.sales.avgBillPaise).toBeNull();
  });

  it('local hours honour the outlet time zone', () => {
    expect(localHour(new Date('2026-11-05T18:30:00Z'), 'Asia/Kolkata')).toBe(0);
    expect(localHour(new Date('2026-11-05T18:29:00Z'), 'Asia/Kolkata')).toBe(23);
  });
});
