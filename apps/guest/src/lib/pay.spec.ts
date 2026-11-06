import { describe, expect, it } from 'vitest';
import { checkoutOptions } from './checkout';
import { payTargets, tipPaise } from './pay';
import type { GuestBill } from './types';

const bill = (over: Partial<GuestBill>): GuestBill => ({
  id: 'b1',
  status: 'FINALIZED',
  invoiceNumber: 'INV/2026-27/00001',
  totalPaise: 75_600,
  paidPaise: 0,
  duePaise: 75_600,
  invoiceUrl: '/x',
  split: null,
  lines: [],
  checkoutInProgress: false,
  ...over,
});

describe('pay targets', () => {
  it('whole amount due, or the open bill total', () => {
    expect(payTargets(bill({}))).toEqual([{ label: null, index: -1, duePaise: 75_600 }]);
    expect(payTargets(bill({ status: 'OPEN', duePaise: 0 }))[0]!.duePaise).toBe(75_600);
    expect(payTargets(bill({ status: 'PAID' }))).toEqual([]);
    expect(payTargets(bill({ duePaise: 0 }))).toEqual([]);
  });
  it('one target per unpaid share', () => {
    const split = {
      mode: 'EQUAL',
      shares: [
        { key: 's1', label: 'Asha', amountPaise: 37_800, paidPaise: 37_800, duePaise: 0 },
        { key: 's2', label: null, amountPaise: 37_800, paidPaise: 0, duePaise: 37_800 },
      ],
    };
    expect(payTargets(bill({ split }))).toEqual([
      { shareKey: 's2', label: null, index: 1, duePaise: 37_800 },
    ]);
  });
});

describe('checkout options', () => {
  it('never pre-fills guest personal data', () => {
    const o = checkoutOptions(
      {
        provider: 'razorpay',
        keyId: 'rzp_test_x',
        orderId: 'order_1',
        amountPaise: 100,
        currency: 'INR',
        name: 'Spice',
        description: 'INV',
      },
      'hi',
    );
    expect(o).toMatchObject({ key: 'rzp_test_x', order_id: 'order_1', amount: 100, currency: 'INR' });
    expect(o).not.toHaveProperty('prefill');
  });
});

describe('tips', () => {
  it('works out percentage tips in whole rupees and validates custom amounts', () => {
    expect(tipPaise({ kind: 'pct', pct: 10 }, 75_600)).toBe(7_600);
    expect(tipPaise({ kind: 'pct', pct: 0 }, 75_600)).toBe(0);
    expect(tipPaise({ kind: 'custom', rupees: '50' }, 75_600)).toBe(5_000);
    expect(tipPaise({ kind: 'custom', rupees: '' }, 75_600)).toBe(0);
    expect(tipPaise({ kind: 'custom', rupees: '-5' }, 75_600)).toBeNull();
    expect(tipPaise({ kind: 'custom', rupees: '99999' }, 75_600)).toBeNull();
  });
});
