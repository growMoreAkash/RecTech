import { z } from 'zod';
import { consentInputSchema, phoneSchema } from './schemas';

export const LOCALES = ['en', 'hi'] as const;
export const localeSchema = z.enum(LOCALES).default('en');

/** Guest joins at the door (QR). */
export const waitlistJoinSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    phone: phoneSchema,
    partySize: z.number().int().min(1).max(60),
    notes: z.string().trim().max(280).optional(),
    consents: consentInputSchema.default({}),
    locale: localeSchema,
  })
  .strict();
export type WaitlistJoinInput = z.infer<typeof waitlistJoinSchema>;

/** Host adds a walk-in to the queue (phone optional: some guests just wait at the door). */
export const waitlistAddSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    phone: phoneSchema.optional(),
    partySize: z.number().int().min(1).max(60),
    notes: z.string().trim().max(280).optional(),
    consents: consentInputSchema.default({}),
  })
  .strict();
export type WaitlistAddInput = z.infer<typeof waitlistAddSchema>;

export const waitlistNotifySchema = z
  .object({ tableIds: z.array(z.string().min(1).max(64)).min(1).max(6) })
  .strict();

export const waitlistSeatSchema = z
  .object({ tableIds: z.array(z.string().min(1).max(64)).min(1).max(6).optional() })
  .strict();

export const MESSAGE_PURPOSES = [
  'BOOKING_CONFIRMED',
  'BOOKING_CHANGED',
  'BOOKING_REMINDER',
  'WAITLIST_JOINED',
  'TABLE_READY',
] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

/**
 * Template variables in order ({{1}}, {{2}} … in the WhatsApp templates; named in the i18n catalog text).
 * Template names registered at Meta: `ds_<purpose lowercase>` (docs/whatsapp-templates.md).
 */
export const MESSAGE_VARIABLES: Record<MessagePurpose, readonly string[]> = {
  BOOKING_CONFIRMED: ['name', 'outlet', 'party', 'date', 'time', 'link'],
  BOOKING_CHANGED: ['name', 'outlet', 'party', 'date', 'time', 'link'],
  BOOKING_REMINDER: ['name', 'outlet', 'time', 'link'],
  WAITLIST_JOINED: ['name', 'outlet', 'position', 'wait', 'link'],
  TABLE_READY: ['name', 'outlet', 'table', 'minutes'],
};
