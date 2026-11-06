import { MAX_TIP_PAISE, tipForPct } from '@dinesense/shared';
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

export type TipChoice = { kind: 'pct'; pct: number } | { kind: 'custom'; rupees: string };

/** Tip in paise for this payment (percentage of what is being paid, rounded to whole rupees), or null if invalid. */
export function tipPaise(choice: TipChoice, amountPaise: number): number | null {
  if (choice.kind === 'pct') return tipForPct(amountPaise, choice.pct);
  const text = choice.rupees.trim();
  if (!text) return 0;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(text)) return null;
  const paise = Math.round(Number(text) * 100);
  return paise <= MAX_TIP_PAISE ? paise : null;
}
