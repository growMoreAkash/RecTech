import { describe, expect, it } from 'vitest';
import { computeBill } from './billing';
import { computeSplit, lineGrossPaise, shareStatus, SplitError } from './split';

const line = (id: string, gross: number) => ({
  id,
  taxableValuePaise: gross,
  cgstPaise: 0,
  sgstPaise: 0,
  serviceChargePaise: 0,
  serviceChargeCgstPaise: 0,
  serviceChargeSgstPaise: 0,
});
const sum = (xs: { amountPaise: number }[]) => xs.reduce((s, x) => s + x.amountPaise, 0);

describe('split bill', () => {
  it('equal split in whole rupees, extra rupees to the first shares', () => {
    const p = computeSplit({ mode: 'EQUAL', ways: 3 }, { totalPaise: 100_100, lines: [] });
    expect(p.shares.map((s) => s.amountPaise)).toEqual([33_400, 33_400, 33_300]);
    expect(p.shares.map((s) => s.key)).toEqual(['s1', 's2', 's3']);
  });

  it('equal split falls back to paise for odd totals and tiny bills', () => {
    const p = computeSplit({ mode: 'EQUAL', ways: 4 }, { totalPaise: 1001, lines: [] });
    expect(sum(p.shares)).toBe(1001);
    expect(
      Math.max(...p.shares.map((s) => s.amountPaise)) - Math.min(...p.shares.map((s) => s.amountPaise)),
    ).toBe(1);
    expect(() => computeSplit({ mode: 'EQUAL', ways: 5 }, { totalPaise: 3, lines: [] })).toThrow(SplitError);
  });

  it('custom split must add up exactly', () => {
    const ok = computeSplit(
      { mode: 'CUSTOM', shares: [{ amountPaise: 700, label: 'Asha' }, { amountPaise: 300 }] },
      { totalPaise: 1000, lines: [] },
    );
    expect(ok.shares).toEqual([
      { key: 's1', label: 'Asha', amountPaise: 700 },
      { key: 's2', label: null, amountPaise: 300 },
    ]);
    expect(() =>
      computeSplit(
        { mode: 'CUSTOM', shares: [{ amountPaise: 700 }, { amountPaise: 200 }] },
        { totalPaise: 1000, lines: [] },
      ),
    ).toThrow(/add up/);
  });

  it('by item: shared dishes divided, round-off absorbed, exact total', () => {
    const lines = [line('a', 30_000), line('b', 20_001), line('c', 9_999)];
    // Bill total 600.00 (round-off 0) ; c is shared by both.
    const p = computeSplit(
      { mode: 'BY_ITEM', shares: [{ lineIds: ['a', 'c'] }, { lineIds: ['b', 'c', 'c'] }] },
      { totalPaise: 60_000, lines },
    );
    expect(sum(p.shares)).toBe(60_000);
    expect(p.shares[0]!.amountPaise).toBe(30_000 + 5_000);
    expect(p.shares[1]!.amountPaise).toBe(20_001 + 4_999);
    expect(p.shares[1]!.lineIds).toEqual(['b', 'c']);
  });

  it('by item rejects unknown or unassigned lines', () => {
    const lines = [line('a', 100), line('b', 100)];
    expect(() =>
      computeSplit(
        { mode: 'BY_ITEM', shares: [{ lineIds: ['a'] }, { lineIds: ['x'] }] },
        { totalPaise: 200, lines },
      ),
    ).toThrow(/not on this bill/);
    expect(() =>
      computeSplit(
        { mode: 'BY_ITEM', shares: [{ lineIds: ['a'] }, { lineIds: ['a'] }] },
        { totalPaise: 200, lines },
      ),
    ).toThrow(/Every item/);
  });

  it('by item on a real GST bill with service charge and discount always sums to the total', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let run = 0; run < 300; run++) {
      const input = Array.from({ length: 1 + rnd(8) }, (_, i) => ({
        key: `l${i}`,
        quantity: 1 + rnd(3),
        unitPricePaise: 1_000 + rnd(80_000),
        taxRateBps: [500, 1200, 1800][rnd(3)]!,
      }));
      const bill = computeBill(input, {
        discountPaise: rnd(500),
        serviceChargeBps: rnd(2) ? 1000 : 0,
        pricesIncludeTax: false,
      });
      const lines = bill.lines.map((l) => ({ ...l, id: l.key }));
      const ways = 2 + rnd(3);
      const shares = Array.from({ length: ways }, (_, w) => ({
        lineIds: lines.filter((_, i) => i % ways === w || rnd(4) === 0).map((l) => l.id),
      })).filter((s) => s.lineIds.length);
      if (shares.length < 2 || new Set(shares.flatMap((s) => s.lineIds)).size !== lines.length) continue;
      const p = computeSplit({ mode: 'BY_ITEM', shares }, { totalPaise: bill.totalPaise, lines });
      expect(sum(p.shares)).toBe(bill.totalPaise);
      expect(
        Math.abs(lines.reduce((s, l) => s + lineGrossPaise(l), 0) - bill.totalPaise),
      ).toBeLessThanOrEqual(50);
    }
  });

  it('share status from captured payments', () => {
    const plan = computeSplit({ mode: 'EQUAL', ways: 2 }, { totalPaise: 1000, lines: [] });
    const st = shareStatus(plan, [
      { shareKey: 's1', amountPaise: 500, status: 'CAPTURED' },
      { shareKey: 's2', amountPaise: 200, status: 'CAPTURED' },
      { shareKey: 's2', amountPaise: 300, status: 'PENDING' },
    ]);
    expect(st.map((s) => s.duePaise)).toEqual([0, 300]);
  });
});
