import { z } from 'zod';

export const midMealFeedbackSchema = z
  .object({ positive: z.boolean(), comment: z.string().trim().max(500).optional() })
  .strict();
export type MidMealFeedbackInput = z.infer<typeof midMealFeedbackSchema>;

/** Tip on a payment, in paise; never part of the bill. Capped so a typo can't become a ₹1 lakh tip. */
export const MAX_TIP_PAISE = 1_000_000;
export const tipSchema = z.number().int().min(0).max(MAX_TIP_PAISE);

/** Suggested tip percentages on the guest pay sheet (of the amount being paid). */
export const TIP_PRESETS_PCT = [0, 5, 10, 15] as const;
export const tipForPct = (amountPaise: number, pct: number) =>
  Math.round((amountPaise * pct) / 100 / 100) * 100;
