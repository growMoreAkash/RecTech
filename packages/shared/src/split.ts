import { z } from 'zod';
import { allocate } from './billing';

/**
 * Splitting a finalised bill into shares that are paid separately (pure, integer paise).
 * The shares always add up to the bill total exactly; the invoice itself is never split.
 */

export const MAX_SPLIT_SHARES = 20;
const label = z.string().trim().max(30).optional();

export const billSplitSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('EQUAL'), ways: z.number().int().min(2).max(MAX_SPLIT_SHARES) }).strict(),
  z
    .object({
      mode: z.literal('BY_ITEM'),
      /** A line listed in several shares (a shared dish) is divided equally between them. */
      shares: z
        .array(z.object({ label, lineIds: z.array(z.string().min(1)).min(1).max(200) }).strict())
        .min(2)
        .max(MAX_SPLIT_SHARES),
    })
    .strict(),
  z
    .object({
      mode: z.literal('CUSTOM'),
      shares: z
        .array(z.object({ label, amountPaise: z.number().int().min(1).max(100_000_000) }).strict())
        .min(2)
        .max(MAX_SPLIT_SHARES),
    })
    .strict(),
]);
export type BillSplitInput = z.infer<typeof billSplitSchema>;
export type SplitMode = BillSplitInput['mode'];

export interface SplitShare {
  key: string;
  label: string | null;
  amountPaise: number;
  /** BY_ITEM only: the bill lines this share covers. */
  lineIds?: string[];
}

export interface SplitPlan {
  mode: SplitMode;
  shares: SplitShare[];
}

export interface SplittableLine {
  id: string;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  serviceChargePaise: number;
  serviceChargeCgstPaise: number;
  serviceChargeSgstPaise: number;
}

export class SplitError extends Error {
  constructor(
    readonly code: 'UNKNOWN_LINE' | 'LINE_NOT_ASSIGNED' | 'SPLIT_TOTAL_MISMATCH' | 'SPLIT_TOO_SMALL',
    message: string,
  ) {
    super(message);
  }
}

/** What the guest pays for a line: item + its service charge + all GST on both. */
export function lineGrossPaise(l: SplittableLine): number {
  return (
    l.taxableValuePaise +
    l.cgstPaise +
    l.sgstPaise +
    l.serviceChargePaise +
    l.serviceChargeCgstPaise +
    l.serviceChargeSgstPaise
  );
}

export function computeSplit(
  input: BillSplitInput,
  bill: { totalPaise: number; lines: readonly SplittableLine[] },
): SplitPlan {
  const total = bill.totalPaise;
  const key = (i: number) => `s${i + 1}`;
  if (input.mode === 'EQUAL') {
    if (total < input.ways) throw new SplitError('SPLIT_TOO_SMALL', 'Bill is too small to split');
    // Whole rupees when the total is whole rupees (it is, after round-off), so nobody pays ₹333.33.
    const amounts =
      total % 100 === 0 && total / 100 >= input.ways
        ? allocate(total / 100, Array(input.ways).fill(1)).map((r) => r * 100)
        : allocate(total, Array(input.ways).fill(1));
    return {
      mode: 'EQUAL',
      shares: amounts.map((amountPaise, i) => ({ key: key(i), label: null, amountPaise })),
    };
  }
  if (input.mode === 'CUSTOM') {
    const sum = input.shares.reduce((s, x) => s + x.amountPaise, 0);
    if (sum !== total)
      throw new SplitError('SPLIT_TOTAL_MISMATCH', `Shares add up to ${sum} paise, the bill is ${total}`);
    return {
      mode: 'CUSTOM',
      shares: input.shares.map((s, i) => ({
        key: key(i),
        label: s.label || null,
        amountPaise: s.amountPaise,
      })),
    };
  }
  // BY_ITEM
  const lines = new Map(bill.lines.map((l) => [l.id, l]));
  const holders = new Map<string, number[]>();
  input.shares.forEach((s, i) => {
    for (const id of new Set(s.lineIds)) {
      if (!lines.has(id)) throw new SplitError('UNKNOWN_LINE', `Line ${id} is not on this bill`);
      holders.set(id, [...(holders.get(id) ?? []), i]);
    }
  });
  for (const id of lines.keys())
    if (!holders.has(id)) throw new SplitError('LINE_NOT_ASSIGNED', 'Every item must go to someone');
  // Each line divided exactly between its holders, then the bill total (incl. round-off) spread pro rata.
  const weights = input.shares.map(() => 0);
  for (const [id, who] of holders) {
    const parts = allocate(lineGrossPaise(lines.get(id)!), Array(who.length).fill(1));
    who.forEach((w, k) => (weights[w]! += parts[k]!));
  }
  const amounts = allocate(total, weights);
  if (amounts.some((a) => a <= 0)) throw new SplitError('SPLIT_TOO_SMALL', 'A share would be empty');
  return {
    mode: 'BY_ITEM',
    shares: input.shares.map((s, i) => ({
      key: key(i),
      label: s.label || null,
      amountPaise: amounts[i]!,
      lineIds: [...new Set(s.lineIds)],
    })),
  };
}

export interface ShareStatus extends SplitShare {
  paidPaise: number;
  duePaise: number;
}

/** Paid/due per share from captured payments carrying that share key. */
export function shareStatus(
  plan: SplitPlan,
  payments: readonly { shareKey: string | null; amountPaise: number; status: string }[],
): ShareStatus[] {
  return plan.shares.map((s) => {
    const paid = payments
      .filter((p) => p.status === 'CAPTURED' && p.shareKey === s.key)
      .reduce((sum, p) => sum + p.amountPaise, 0);
    return { ...s, paidPaise: paid, duePaise: Math.max(0, s.amountPaise - paid) };
  });
}

/** Guest pay-at-table: pay the whole bill (what is still due) or one split share. */
export const guestPaySchema = z
  .object({
    billId: z.string().min(1).max(64),
    shareKey: z
      .string()
      .regex(/^s\d{1,2}$/)
      .optional(),
  })
  .strict();
export type GuestPayInput = z.infer<typeof guestPaySchema>;

/** What the provider's checkout hands back to the browser (Razorpay: razorpay_order_id / _payment_id / _signature). */
export const guestPayVerifySchema = z
  .object({
    orderId: z.string().min(1).max(64),
    paymentId: z.string().min(1).max(64),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type GuestPayVerifyInput = z.infer<typeof guestPayVerifySchema>;

export const guestPayAbandonSchema = z.object({ orderId: z.string().min(1).max(64) }).strict();
