import { describe, expect, it } from 'vitest';
import { displayStatus } from './orders-sheet';

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
