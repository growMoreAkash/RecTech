import type { GuestBill } from './types';

/** What can be paid right now: one button per unpaid share, or the whole amount due. */
export function payTargets(
  bill: GuestBill,
): { shareKey?: string; label: string | null; index: number; duePaise: number }[] {
  if (bill.status === 'PAID') return [];
  if (bill.split)
    return bill.split.shares
      .map((s, index) => ({ shareKey: s.key, label: s.label, index, duePaise: s.duePaise }))
      .filter((s) => s.duePaise > 0);
  const due = bill.status === 'OPEN' ? bill.totalPaise : bill.duePaise;
  return due > 0 ? [{ label: null, index: -1, duePaise: due }] : [];
}
