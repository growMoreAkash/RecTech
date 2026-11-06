import { describe, expect, it } from 'vitest';
import { displayStatus, etaMinutes } from './orders-sheet';

const order = (status: 'ACCEPTED' | 'PENDING_APPROVAL', items: string[]) =>
  ({
    id: 'o',
    number: 1,
    status,
    rejectedReason: null,
    createdAt: '',
    items: items.map((s, i) => ({
      id: `${i}`,
      name: 'x',
      quantity: 1,
      modifiers: [],
      status: s,
      unitPricePaise: 1,
    })),
  }) as never;

describe('guest order status', () => {
  it('reads Served once every item is served or cancelled', () => {
    expect(displayStatus(order('ACCEPTED', ['SERVED', 'VOID']))).toBe('DONE');
    expect(displayStatus(order('ACCEPTED', ['SERVED', 'READY']))).toBe('ACCEPTED');
    expect(displayStatus(order('PENDING_APPROVAL', ['QUEUED']))).toBe('PENDING_APPROVAL');
  });
});

describe('order ETA', () => {
  it('rounds up to whole minutes and never goes negative', () => {
    const now = Date.parse('2026-11-06T13:00:00Z');
    expect(etaMinutes('2026-11-06T13:11:10Z', now)).toBe(12);
    expect(etaMinutes('2026-11-06T12:50:00Z', now)).toBe(0);
    expect(etaMinutes(null, now)).toBeNull();
  });
});
