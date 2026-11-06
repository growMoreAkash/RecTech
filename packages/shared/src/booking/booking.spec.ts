import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, localDateTime, localTime } from '../time';
import {
  type BookingRules,
  type BookTable,
  type Busy,
  listSlots,
  pickTables,
  turnMinutes,
} from './availability';
import { maskPhone, normalizePhone } from './phone';
import { phoneSchema, publicReservationSchema } from './schemas';

const RULES: BookingRules = {
  slotMinutes: 30,
  leadMinutes: 60,
  horizonDays: 30,
  maxPartySize: 8,
  lastSeatingMinutes: 60,
  turnMinutes: { small: 75, medium: 90, large: 120 },
  maxCoversPerSlot: 0,
};
const T = (id: string, capacity: number, extra: Partial<BookTable> = {}): BookTable => ({
  id,
  capacity,
  minCapacity: 1,
  sectionId: 'main',
  onlineBookable: true,
  joinableWith: [],
  ...extra,
});
const at = (hhmm: string, date = '2026-11-06') => localDateTime(date, hhmm, 'Asia/Kolkata');
const iv = (from: string, to: string) => ({ from: at(from), to: at(to) });

describe('phone numbers', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['+44 7700 900123', '+447700900123'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));
  it.each(['12345', '5876543210', '+91 12345 67890', 'abc', ''])('rejects %s', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
  it('masks for staff screens and validates in schemas', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ••••••3210');
    expect(phoneSchema.parse(' 98765 43210 ')).toBe('+919876543210');
    expect(phoneSchema.safeParse('123').success).toBe(false);
    const r = publicReservationSchema.parse({
      startsAt: '2026-11-06T19:00:00+05:30',
      partySize: 2,
      name: 'Asha',
      phone: '9876543210',
    });
    expect(r.consents).toEqual({});
  });
});

describe('local time helpers', () => {
  it('converts wall-clock times in the outlet zone', () => {
    expect(at('19:30').toISOString()).toBe('2026-11-06T14:00:00.000Z');
    expect(localTime(at('19:30'), 'Asia/Kolkata')).toBe('19:30');
    expect(dayOfWeek('2026-11-06')).toBe(5); // Friday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('table picking', () => {
  const tables = [
    T('t2a', 2),
    T('t2b', 2, { joinableWith: ['t2c'] }),
    T('t2c', 2, { joinableWith: ['t2b'] }),
    T('t4', 4),
    T('t6', 6, { minCapacity: 4 }),
  ];
  const req = (partySize: number, extra = {}) => ({
    partySize,
    ...iv('19:00', '20:30'),
    online: true,
    ...extra,
  });

  it('smallest single table that fits, respecting minimum capacity', () => {
    expect(pickTables(tables, [], req(2))).toEqual(['t2a']);
    expect(pickTables(tables, [], req(3))).toEqual(['t4']);
    expect(pickTables(tables, [], req(6))).toEqual(['t6']);
    expect(pickTables(tables, [], req(1))).toEqual(['t2a']); // t6 needs 4+
  });
  it('overlapping bookings block a table; touching ones do not', () => {
    const busy: Busy[] = [{ tableIds: ['t4'], ...iv('18:00', '19:30') }];
    expect(pickTables(tables, busy, req(4))).toEqual(['t6']);
    const touching: Busy[] = [{ tableIds: ['t4'], ...iv('17:30', '19:00') }];
    expect(pickTables(tables, touching, req(4))).toEqual(['t4']);
  });
  it('falls back to a joinable pair', () => {
    const busy: Busy[] = [{ tableIds: ['t4', 't6'], ...iv('18:00', '22:00') }];
    expect(pickTables(tables, busy, req(4))).toEqual(['t2b', 't2c']);
    expect(pickTables(tables, [...busy, { tableIds: ['t2c'], ...iv('19:00', '19:15') }], req(4))).toBeNull();
  });
  it('online bookings skip tables not bookable online; out-of-service never', () => {
    const t = [T('a', 4, { onlineBookable: false }), T('b', 4, { outOfService: true })];
    expect(pickTables(t, [], req(4))).toBeNull();
    expect(pickTables(t, [], req(4, { online: false }))).toEqual(['a']);
  });
  it('prefers the requested section, then any', () => {
    const t = [T('m', 4), T('p', 4, { sectionId: 'patio' })];
    expect(pickTables(t, [], req(4, { sectionId: 'patio' }))).toEqual(['p']);
    expect(pickTables([T('m', 4)], [], req(4, { sectionId: 'patio' }))).toEqual(['m']);
  });
  it('a reservation being moved does not block itself', () => {
    const busy: Busy[] = [{ tableIds: ['t4'], ...iv('19:00', '20:30'), reservationId: 'r1' }];
    expect(pickTables([T('t4', 4)], busy, req(4))).toBeNull();
    expect(pickTables([T('t4', 4)], busy, req(4, { ignoreReservationId: 'r1' }))).toEqual(['t4']);
  });

  it('property: booking slots one after another never double-books a table', () => {
    let seed = 42;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let run = 0; run < 50; run++) {
      const ts = Array.from({ length: 2 + rnd(8) }, (_, i) =>
        T(`t${i}`, [2, 2, 4, 4, 6][rnd(5)]!, { joinableWith: [`t${i + 1}`, `t${i - 1}`] }),
      );
      const busy: Busy[] = [];
      for (let k = 0; k < 40; k++) {
        const start = 12 * 60 + rnd(20) * 30;
        const party = 1 + rnd(8);
        const from = new Date(at('00:00').getTime() + start * 60_000);
        const to = new Date(from.getTime() + turnMinutes(party, RULES.turnMinutes) * 60_000);
        const ids = pickTables(ts, busy, { partySize: party, from, to, online: false });
        if (ids) busy.push({ tableIds: ids, from, to });
      }
      for (let a = 0; a < busy.length; a++)
        for (let b = a + 1; b < busy.length; b++) {
          const x = busy[a]!;
          const y = busy[b]!;
          if (x.from < y.to && y.from < x.to)
            expect(x.tableIds.some((id) => y.tableIds.includes(id))).toBe(false);
        }
    }
  });
});

describe('slots', () => {
  const tables = [T('t2', 2), T('t4', 4)];
  const base = {
    date: '2026-11-06',
    timeZone: 'Asia/Kolkata',
    now: at('10:00'),
    partySize: 2,
    hours: [
      { dayOfWeek: 5, opens: '12:00', closes: '15:00' },
      { dayOfWeek: 5, opens: '19:00', closes: '23:00' },
      { dayOfWeek: 6, opens: '12:00', closes: '23:00' },
    ],
    rules: RULES,
    tables,
    busy: [] as Busy[],
    online: true,
  };
  it('lists the day’s windows up to last seating', () => {
    const s = listSlots(base);
    expect(s.map((x) => x.time)).toEqual([
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
      '19:00',
      '19:30',
      '20:00',
      '20:30',
      '21:00',
      '21:30',
      '22:00',
    ]);
    expect(s.every((x) => x.available)).toBe(true);
  });
  it('respects lead time, party limits, existing bookings and covers per slot', () => {
    expect(listSlots({ ...base, now: at('12:10') })[0]).toMatchObject({ time: '12:00', available: false });
    expect(listSlots({ ...base, now: at('12:10') }).find((x) => x.time === '13:30')!.available).toBe(true);
    expect(listSlots({ ...base, partySize: 9 })).toEqual([]);
    const busy: Busy[] = [
      { tableIds: ['t2'], ...iv('19:00', '20:15'), reservationId: 'a', partySize: 2 },
      { tableIds: ['t4'], ...iv('19:00', '20:30'), reservationId: 'b', partySize: 4 },
    ];
    const s = listSlots({ ...base, busy });
    expect(s.find((x) => x.time === '19:30')!.available).toBe(false);
    expect(s.find((x) => x.time === '20:30')!.available).toBe(true);
    const capped = listSlots({
      ...base,
      rules: { ...RULES, maxCoversPerSlot: 5 },
      busy: [busy[1]!],
      tables: [T('t2', 2), T('x', 4)],
    });
    expect(capped.find((x) => x.time === '19:00')!.available).toBe(false); // 4 + 2 > 5
  });
  it('closed days have no slots', () => {
    expect(listSlots({ ...base, date: '2026-11-08' })).toEqual([]);
  });
});
