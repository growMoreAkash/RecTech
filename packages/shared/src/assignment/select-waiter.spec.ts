import { describe, expect, it } from 'vitest';
import { OUTLET_CURSOR, selectWaiter, type WaiterCandidate } from './select-waiter';

const w = (userId: string, checkInSeq: number, over: Partial<WaiterCandidate> = {}): WaiterCandidate => ({
  userId,
  checkInSeq,
  sectionIds: ['A'],
  activeTables: 0,
  maxTables: 4,
  onBreak: false,
  ...over,
});

const pick = (candidates: WaiterCandidate[], extra: Partial<Parameters<typeof selectWaiter>[0]> = {}) =>
  selectWaiter({ candidates, mode: 'ROUND_ROBIN', sectionId: 'A', cursors: {}, ...extra });

describe('selectWaiter', () => {
  it('round-robins fairly over 100 seatings', () => {
    const team = Array.from({ length: 6 }, (_, i) => w(`w${i + 1}`, i + 1, { maxTables: 100 }));
    const counts = new Map<string, number>();
    const cursors: Record<string, number> = {};
    const order: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = pick(team, { cursors });
      if (!r.ok) throw new Error('no pick');
      cursors[r.cursorKey] = r.checkInSeq;
      counts.set(r.userId, (counts.get(r.userId) ?? 0) + 1);
      order.push(r.userId);
    }
    // 100 / 6 = 16 r 4: the first four in rotation get one extra — never more than one apart.
    expect([...counts.values()].sort()).toEqual([16, 16, 17, 17, 17, 17]);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBe(1);
    expect(order.slice(0, 7)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w1']);
  });

  it('follows check-in order, not list order, and wraps after the cursor', () => {
    const team = [w('late', 9), w('early', 2), w('mid', 5)];
    expect(pick(team)).toMatchObject({ userId: 'early' });
    expect(pick(team, { cursors: { A: 5 } })).toMatchObject({ userId: 'late' });
    expect(pick(team, { cursors: { A: 9 } })).toMatchObject({ userId: 'early' });
  });

  it('skips waiters on break or at their table limit', () => {
    const team = [w('w1', 1, { onBreak: true }), w('w2', 2, { activeTables: 4 }), w('w3', 3)];
    expect(pick(team)).toMatchObject({ userId: 'w3' });
  });

  it('falls back outlet-wide when nobody covers the section, using the outlet cursor', () => {
    const team = [w('b1', 1, { sectionIds: ['B'] }), w('b2', 2, { sectionIds: ['B'] })];
    expect(pick(team)).toMatchObject({ userId: 'b1', cursorKey: OUTLET_CURSOR, fallback: true });
    expect(pick(team, { cursors: { [OUTLET_CURSOR]: 1 } })).toMatchObject({ userId: 'b2' });
  });

  it('treats an empty section list as covering every section', () => {
    expect(pick([w('all', 1, { sectionIds: [] })])).toMatchObject({ userId: 'all', fallback: false });
  });

  it('skips waiters already tried, unless nobody else is left', () => {
    const team = [w('w1', 1), w('w2', 2)];
    expect(pick(team, { exclude: new Set(['w1']) })).toMatchObject({ userId: 'w2', retried: false });
    expect(pick(team, { exclude: new Set(['w1', 'w2']) })).toMatchObject({ ok: true, retried: true });
  });

  it('reports when nobody can take the table', () => {
    expect(pick([w('w1', 1, { onBreak: true })])).toEqual({ ok: false, reason: 'NO_ELIGIBLE_WAITER' });
    expect(pick([])).toEqual({ ok: false, reason: 'NO_ELIGIBLE_WAITER' });
  });

  it('least-loaded picks the lightest waiter, ties broken round-robin', () => {
    const team = [
      w('w1', 1, { activeTables: 2 }),
      w('w2', 2, { activeTables: 1 }),
      w('w3', 3, { activeTables: 1 }),
    ];
    expect(pick(team, { mode: 'LEAST_LOADED' })).toMatchObject({ userId: 'w2' });
    expect(pick(team, { mode: 'LEAST_LOADED', cursors: { A: 2 } })).toMatchObject({ userId: 'w3' });
  });

  it('fixed-section prefers waiters whose primary section is the table, then round-robins', () => {
    const team = [w('helper', 1, { sectionIds: ['B', 'A'] }), w('owner', 2, { sectionIds: ['A'] })];
    expect(pick(team, { mode: 'FIXED_SECTION' })).toMatchObject({ userId: 'owner' });
    expect(pick(team, { mode: 'ROUND_ROBIN' })).toMatchObject({ userId: 'helper' });
    expect(pick([w('helper', 1, { sectionIds: ['B', 'A'] })], { mode: 'FIXED_SECTION' })).toMatchObject({
      userId: 'helper',
    });
  });

  it('is deterministic for the same input', () => {
    const team = [w('w2', 2), w('w1', 1)];
    expect(pick(team)).toEqual(pick([...team].reverse()));
  });
});
