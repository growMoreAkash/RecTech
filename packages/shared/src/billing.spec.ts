import { describe, expect, it } from 'vitest';
import { allocate, BillError, computeBill } from './billing';

const opts = { discountPaise: 0, serviceChargeBps: 0, pricesIncludeTax: false };
const line = (key: string, unitPricePaise: number, quantity = 1, taxRateBps = 500) => ({
  key,
  unitPricePaise,
  quantity,
  taxRateBps,
});

describe('allocate', () => {
  it('splits exactly, pro rata, largest remainder first', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [30_000, 10_000])).toEqual([750, 250]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
  });
});

describe('computeBill', () => {
  it('plain 5% GST bill with round-off', () => {
    const b = computeBill([line('dal', 29_000), line('naan', 7_000, 3)], opts);
    expect(b).toMatchObject({
      subtotalPaise: 50_000,
      cgstPaise: 1_250,
      sgstPaise: 1_250,
      roundOffPaise: 0,
      totalPaise: 52_500,
    });
  });

  it('applies discount before tax and service charge on the discounted value, taxed too', () => {
    const b = computeBill([line('a', 40_000), line('b', 10_000)], {
      ...opts,
      discountPaise: 5_000,
      serviceChargeBps: 1_000,
    });
    // taxable items 45,000 (a 36,000, b 9,000); SC 10% = 4,500; GST 5% on 49,500 = 2,475 → 1,237.5 per half.
    expect(b.lines.map((l) => [l.discountPaise, l.taxableValuePaise, l.serviceChargePaise])).toEqual([
      [4_000, 36_000, 3_600],
      [1_000, 9_000, 900],
    ]);
    expect(b.serviceChargePaise).toBe(4_500);
    expect(b.taxablePaise).toBe(49_500);
    expect(b.cgstPaise).toBe(b.sgstPaise);
    expect(b.totalPaise % 100).toBe(0);
    expect(b.totalPaise).toBe(b.taxablePaise + b.cgstPaise + b.sgstPaise + b.roundOffPaise);
  });

  it('computes GST on each rate total so the printed "@ 2.5% on ₹X" line is exact', () => {
    // Caught on a real invoice screenshot: ₹930 of food − ₹50 discount = ₹880 at 5%; per-line rounding gave ₹22.01.
    const b = computeBill([line('chicken', 42_000), line('naan', 9_000, 3), line('lassi', 12_000, 2)], {
      ...opts,
      discountPaise: 5_000,
    });
    expect(b.taxablePaise).toBe(88_000);
    expect(b.cgstPaise).toBe(2_200);
    expect(b.lines.reduce((s, l) => s + l.cgstPaise + l.serviceChargeCgstPaise, 0)).toBe(2_200);
    expect(b.totalPaise).toBe(92_400);
  });

  it('keeps a GST summary per rate for mixed-rate bills', () => {
    const b = computeBill([line('food', 10_000, 1, 500), line('drink', 10_000, 1, 1800)], {
      ...opts,
      serviceChargeBps: 500,
    });
    expect(b.taxByRate).toEqual([
      { taxRateBps: 500, taxablePaise: 10_500, cgstPaise: 263, sgstPaise: 263 },
      { taxRateBps: 1800, taxablePaise: 10_500, cgstPaise: 945, sgstPaise: 945 },
    ]);
  });

  it('backs GST out of tax-inclusive prices', () => {
    const b = computeBill([line('dal', 10_500)], { ...opts, pricesIncludeTax: true });
    expect(b).toMatchObject({ subtotalPaise: 10_000, cgstPaise: 250, sgstPaise: 250, totalPaise: 10_500 });
  });

  it('rejects discounts larger than the bill and bad input', () => {
    expect(() => computeBill([line('a', 100)], { ...opts, discountPaise: 101 })).toThrow(BillError);
    expect(() => computeBill([line('a', 100, 0)], opts)).toThrow(BillError);
  });

  it('invariants hold over many random bills', () => {
    let seed = 42;
    const rnd = (n: number) => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) % n;
    for (let i = 0; i < 500; i++) {
      const lines = Array.from({ length: 1 + rnd(8) }, (_, k) =>
        line(`l${k}`, rnd(60_000), 1 + rnd(5), [0, 500, 1200, 1800][rnd(4)]),
      );
      const subtotal = lines.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);
      const b = computeBill(lines, {
        discountPaise: rnd(subtotal + 1),
        serviceChargeBps: rnd(1500),
        pricesIncludeTax: false,
      });
      expect(b.lines.reduce((s, l) => s + l.discountPaise, 0)).toBe(b.discountPaise);
      expect(b.cgstPaise).toBe(b.sgstPaise);
      expect(b.taxablePaise).toBe(b.subtotalPaise - b.discountPaise + b.serviceChargePaise);
      expect(b.totalPaise).toBe(b.taxablePaise + b.cgstPaise + b.sgstPaise + b.roundOffPaise);
      expect(b.totalPaise % 100).toBe(0);
      expect(Math.abs(b.roundOffPaise)).toBeLessThanOrEqual(50);
      for (const r of b.taxByRate) {
        // Printed rate × printed base = printed tax (half-up), and the lines add up to it exactly.
        expect(r.cgstPaise).toBe(Math.round((r.taxablePaise * r.taxRateBps) / 20_000));
        const lineTax = b.lines
          .filter((l) => l.taxRateBps === r.taxRateBps)
          .reduce((s, l) => s + l.cgstPaise + l.serviceChargeCgstPaise, 0);
        expect(lineTax).toBe(r.cgstPaise);
      }
      expect(b.lines.every((l) => l.taxableValuePaise >= 0)).toBe(true);
    }
  });
});
