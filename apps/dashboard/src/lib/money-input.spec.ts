import { describe, expect, it } from 'vitest';
import { paiseToRupees, rupeesToPaise } from './money-input';

describe('money input', () => {
  it('parses rupees as text', () => {
    expect(rupeesToPaise('340')).toBe(34_000);
    expect(rupeesToPaise('340.5')).toBe(34_050);
    expect(rupeesToPaise('₹1,340.05')).toBe(134_005);
    expect(rupeesToPaise('0.1')).toBe(10);
  });
  it('rejects garbage and over-precise values', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1e3']) expect(rupeesToPaise(bad)).toBeNull();
  });
  it('round-trips', () => {
    expect(paiseToRupees(34_050)).toBe('340.50');
    expect(rupeesToPaise(paiseToRupees(9_999))).toBe(9_999);
  });
});
