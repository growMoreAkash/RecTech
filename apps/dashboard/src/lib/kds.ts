import type { OrderItemStatus } from './types';

/** Ticket ageing on the KDS (minutes since fired). */
export const KDS_AGING_MIN = 8;
export const KDS_LATE_MIN = 15;

export type TicketAge = 'fresh' | 'aging' | 'late';

export function ticketAge(firedAt: string, now: number): TicketAge {
  const min = Math.max(0, now - Date.parse(firedAt)) / 60_000;
  return min >= KDS_LATE_MIN ? 'late' : min >= KDS_AGING_MIN ? 'aging' : 'fresh';
}

/** What a tap on an item does in the kitchen: queued → cooking → ready (ready waits for the waiter). */
export function nextKitchenStatus(s: OrderItemStatus): OrderItemStatus | null {
  return s === 'QUEUED' ? 'COOKING' : s === 'COOKING' ? 'READY' : null;
}
