import { describe, expect, it } from 'vitest';
import { isWithinWindows, localized, priceLine, type PricedItem, runningTotal } from './menu';

const ist = (local: string) => new Date(`${local}+05:30`);

describe('availability windows', () => {
  const lunch = [{ days: [1, 2, 3, 4, 5], from: '11:00', to: '15:30' }];

  it('is always available without windows', () => {
    expect(isWithinWindows(null, new Date())).toBe(true);
    expect(isWithinWindows([], new Date())).toBe(true);
  });

  it('respects day and time in IST', () => {
    // 2026-11-05 is a Thursday.
    expect(isWithinWindows(lunch, ist('2026-11-05T11:00:00'))).toBe(true);
    expect(isWithinWindows(lunch, ist('2026-11-05T15:30:00'))).toBe(false);
    expect(isWithinWindows(lunch, ist('2026-11-05T10:59:00'))).toBe(false);
    expect(isWithinWindows(lunch, ist('2026-11-08T12:00:00'))).toBe(false); // Sunday
  });

  it('handles windows past midnight on the start day', () => {
    const late = [{ days: [5], from: '22:00', to: '02:00' }]; // Friday night
    expect(isWithinWindows(late, ist('2026-11-06T23:30:00'))).toBe(true); // Fri
    expect(isWithinWindows(late, ist('2026-11-07T01:30:00'))).toBe(true); // Sat early = Fri window
    expect(isWithinWindows(late, ist('2026-11-07T23:30:00'))).toBe(false); // Sat night
  });
});

describe('priceLine', () => {
  const item: PricedItem = {
    pricePaise: 34_000,
    modifierGroups: [
      {
        id: 'portion',
        minSelect: 1,
        maxSelect: 1,
        modifiers: [
          { id: 'full', priceDeltaPaise: 0, isAvailable: true, name: 'Full' },
          { id: 'half', priceDeltaPaise: -9_000, isAvailable: true, name: 'Half' },
        ],
      },
      {
        id: 'addons',
        minSelect: 0,
        maxSelect: 2,
        modifiers: [
          { id: 'butter', priceDeltaPaise: 3_000, isAvailable: true, name: 'Butter' },
          { id: 'cheese', priceDeltaPaise: 4_000, isAvailable: true, name: 'Cheese' },
          { id: 'truffle', priceDeltaPaise: 9_000, isAvailable: false, name: 'Truffle' },
        ],
      },
    ],
  };

  it('adds modifier deltas to the base price', () => {
    const r = priceLine(item, ['half', 'butter', 'cheese']);
    expect(r).toMatchObject({ ok: true, unitPricePaise: 34_000 - 9_000 + 3_000 + 4_000 });
  });

  it('enforces required and maximum selections', () => {
    expect(priceLine(item, [])).toEqual({
      ok: false,
      errors: [{ code: 'TOO_FEW', groupId: 'portion', min: 1 }],
    });
    expect(priceLine(item, ['full', 'half'])).toEqual({
      ok: false,
      errors: [{ code: 'TOO_MANY', groupId: 'portion', max: 1 }],
    });
  });

  it('rejects unknown and unavailable modifiers, and ignores duplicates', () => {
    expect(priceLine(item, ['full', 'nope'])).toMatchObject({
      ok: false,
      errors: [{ code: 'UNKNOWN_MODIFIER' }],
    });
    expect(priceLine(item, ['full', 'truffle'])).toMatchObject({
      ok: false,
      errors: [{ code: 'MODIFIER_UNAVAILABLE' }],
    });
    expect(priceLine(item, ['full', 'butter', 'butter'])).toMatchObject({ ok: true, unitPricePaise: 37_000 });
  });

  it('never prices below zero', () => {
    const cheap = { pricePaise: 5_000, modifierGroups: item.modifierGroups };
    expect(priceLine(cheap, ['half'])).toMatchObject({ ok: false, errors: [{ code: 'NEGATIVE_PRICE' }] });
  });
});

describe('runningTotal', () => {
  it('sums per-line GST with CGST = SGST', () => {
    expect(
      runningTotal([
        { unitPricePaise: 34_000, quantity: 2, taxRateBps: 500 },
        { unitPricePaise: 7_000, quantity: 3, taxRateBps: 500 },
      ]),
    ).toEqual({ subtotalPaise: 89_000, cgstPaise: 2_225, sgstPaise: 2_225, totalPaise: 93_450 });
  });
});

describe('localized', () => {
  it('falls back to English', () => {
    expect(localized({ en: 'Dal', hi: 'दाल' }, 'hi')).toBe('दाल');
    expect(localized({ en: 'Dal' }, 'hi')).toBe('Dal');
    expect(localized('plain', 'hi')).toBe('plain');
  });
});
