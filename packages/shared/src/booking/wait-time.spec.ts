import { describe, expect, it } from 'vitest';
import { CLEAN_MINUTES, expectedFreeAt, median, predictWaits, type WaitTable, waitRange } from './wait-time';

const NOW = Date.parse('2026-11-05T13:00:00Z');
const min = (m: number) => NOW + m * 60_000;
const T = (id: string, capacity: number, freeInMin: number, extra: Partial<WaitTable> = {}): WaitTable => ({
  id,
  capacity,
  minCapacity: 1,
  joinableWith: [],
  freeAt: min(freeInMin),
  ...extra,
});
const turn = (p: number) => (p <= 2 ? 60 : p <= 4 ? 75 : 100);

describe('expected free time', () => {
  const dwell = () => 70;
  it('by stage, never below the stage floor, plus cleaning', () => {
    expect(expectedFreeAt({ status: 'VACANT' }, NOW, dwell)).toBe(NOW);
    expect(expectedFreeAt({ status: 'NEEDS_CLEANING' }, NOW, dwell)).toBe(min(CLEAN_MINUTES));
    expect(expectedFreeAt({ status: 'OUT_OF_SERVICE' }, NOW, dwell)).toBe(Infinity);
    // Seated 30 min ago, usual dwell 70 → 40 more + clean.
    expect(
      expectedFreeAt({ status: 'ORDERED', seatedAt: new Date(min(-30)), partySize: 2 }, NOW, dwell),
    ).toBe(min(45));
    // Seated 2 h ago but only just asked for the bill → at least 5 + clean.
    expect(expectedFreeAt({ status: 'BILL_REQUESTED', seatedAt: new Date(min(-120)) }, NOW, dwell)).toBe(
      min(10),
    );
  });
});

describe('queue prediction', () => {
  it('free table now → 0; the next party waits for the next table', () => {
    const tables = [T('a', 4, 0), T('b', 4, 20)];
    const r = predictWaits(
      tables,
      [
        { id: 'p1', partySize: 4 },
        { id: 'p2', partySize: 3 },
        { id: 'p3', partySize: 2 },
      ],
      NOW,
      turn,
    );
    expect(r.get('p1')).toEqual({ minutes: 0, tableIds: ['a'] });
    expect(r.get('p2')).toEqual({ minutes: 20, tableIds: ['b'] });
    // a is busy until 0 + 75 + 5 = 80
    expect(r.get('p3')).toEqual({ minutes: 80, tableIds: ['a'] });
  });

  it('respects capacity and minimum capacity; joins two tables for big parties', () => {
    const tables = [
      T('two', 2, 0),
      T('six', 6, 30, { minCapacity: 4 }),
      T('x', 4, 10, { joinableWith: ['y'] }),
      T('y', 4, 15, { joinableWith: ['x'] }),
    ];
    const r = predictWaits(
      tables,
      [
        { id: 'solo', partySize: 1 },
        { id: 'big', partySize: 8 },
        { id: 'huge', partySize: 20 },
      ],
      NOW,
      turn,
    );
    expect(r.get('solo')!.tableIds).toEqual(['two']);
    expect(r.get('big')).toEqual({ minutes: 15, tableIds: ['x', 'y'] });
    expect(r.get('huge')).toEqual({ minutes: null, tableIds: [] });
  });

  it('a later party can take a small table that frees first (no head-of-line blocking)', () => {
    const tables = [T('four', 4, 40), T('two', 2, 5)];
    const r = predictWaits(
      tables,
      [
        { id: 'p4', partySize: 4 },
        { id: 'p2', partySize: 2 },
      ],
      NOW,
      turn,
    );
    expect(r.get('p4')!.minutes).toBe(40);
    expect(r.get('p2')!.minutes).toBe(5);
  });

  it('ranges and medians', () => {
    expect(waitRange(0)).toEqual({ low: 0, high: 5 });
    expect(waitRange(20)).toEqual({ low: 15, high: 25 });
    expect(waitRange(40)).toEqual({ low: 30, high: 50 });
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
