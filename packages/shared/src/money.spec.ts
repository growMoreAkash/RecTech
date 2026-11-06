import { describe, expect, it } from 'vitest';
import { applyBps, financialYear, formatInr, gstForLine, roundOffToRupee } from './money';

describe('money', () => {
  it('splits 5% GST equally into CGST and SGST', () => {
    expect(gstForLine(10_000, 500)).toEqual({
      taxableValuePaise: 10_000,
      cgstPaise: 250,
      sgstPaise: 250,
      totalTaxPaise: 500,
      grossPaise: 10_500,
    });
  });

  it('rounds each half independently so CGST always equals SGST', () => {
    // 2.5% of 33 paise = 0.825 → 1 each
    const line = gstForLine(33, 500);
    expect(line.cgstPaise).toBe(line.sgstPaise);
    expect(line.cgstPaise).toBe(1);
  });

  it('applies basis points with half-up rounding', () => {
    expect(applyBps(12_345, 1000)).toBe(1235); // 1234.5 → 1235
    expect(applyBps(0, 1000)).toBe(0);
  });

  it('rejects non-integer money', () => {
    expect(() => gstForLine(10.5, 500)).toThrow(TypeError);
    expect(() => applyBps(100, 2.5)).toThrow(TypeError);
  });

  it('rounds off to the nearest rupee', () => {
    expect(roundOffToRupee(12_349)).toEqual({ roundedPaise: 12_300, roundOffPaise: -49 });
    expect(roundOffToRupee(12_350)).toEqual({ roundedPaise: 12_400, roundOffPaise: 50 });
  });

  it('formats INR with Indian grouping', () => {
    expect(formatInr(12_345_600)).toBe('₹1,23,456.00');
  });

  it('computes Indian financial year in IST', () => {
    expect(financialYear(new Date('2026-11-05T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-03-31T17:00:00Z'))).toBe('2026-27'); // 22:30 IST Mar 31
    expect(financialYear(new Date('2027-03-31T19:00:00Z'))).toBe('2027-28'); // 00:30 IST Apr 1
  });
});
