import { z } from 'zod';
import { normalizePhone } from './phone';

const id = z.string().min(1).max(64);
const isoTime = z.string().datetime({ offset: true });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);

export const CONSENT_PURPOSES = ['WHATSAPP', 'FEEDBACK', 'MARKETING'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentFlags = Partial<Record<ConsentPurpose, boolean>>;

/** Phone in any common Indian format (or +CC…), normalised to E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number' });
      return z.NEVER;
    }
    return n;
  });

/** Opt-ins are explicit and per purpose; booking itself only needs the phone to manage the booking. */
export const consentInputSchema = z
  .object({
    WHATSAPP: z.boolean().optional(),
    FEEDBACK: z.boolean().optional(),
    MARKETING: z.boolean().optional(),
  })
  .strict();

const name = z.string().trim().min(1).max(60);
const notes = z.string().trim().max(280);

export const publicReservationSchema = z
  .object({
    startsAt: isoTime,
    partySize: z.number().int().min(1).max(60),
    name,
    phone: phoneSchema,
    notes: notes.optional(),
    sectionId: id.optional(),
    consents: consentInputSchema.default({}),
    /** Language of the booking page, for messages. */
    locale: z.enum(['en', 'hi']).default('en'),
  })
  .strict();
export type PublicReservationInput = z.infer<typeof publicReservationSchema>;

export const rescheduleSchema = z
  .object({ startsAt: isoTime, partySize: z.number().int().min(1).max(60).optional() })
  .strict();
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

export const staffReservationSchema = z
  .object({
    startsAt: isoTime,
    partySize: z.number().int().min(1).max(60),
    phone: phoneSchema,
    name: name.optional(),
    notes: notes.optional(),
    sectionId: id.optional(),
    /** Staff may pick tables; otherwise the best free fit is assigned. */
    tableIds: z.array(id).min(1).max(6).optional(),
    durationMinutes: z.number().int().min(15).max(360).optional(),
    consents: consentInputSchema.default({}),
  })
  .strict();
export type StaffReservationInput = z.infer<typeof staffReservationSchema>;

export const reservationPatchSchema = z
  .object({
    startsAt: isoTime.optional(),
    partySize: z.number().int().min(1).max(60).optional(),
    tableIds: z.array(id).min(1).max(6).optional(),
    durationMinutes: z.number().int().min(15).max(360).optional(),
    notes: notes.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to change' });
export type ReservationPatchInput = z.infer<typeof reservationPatchSchema>;

export const slotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.coerce.number().int().min(1).max(60),
});

export const guestLookupSchema = z.object({ phone: phoneSchema });

export const guestPatchSchema = z
  .object({
    name: name.nullable().optional(),
    notes: notes.nullable().optional(),
    allergies: z.string().trim().max(140).nullable().optional(),
    /** "MM-DD" (no year: we don't need age). */
    birthday: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      .nullable()
      .optional(),
    consents: consentInputSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to change' });
export type GuestPatchInput = z.infer<typeof guestPatchSchema>;

/** Seating a party can attach a guest (by phone) and/or a reservation. */
export const seatGuestSchema = z
  .object({ phone: phoneSchema, name: name.optional(), consents: consentInputSchema.optional() })
  .strict();

export const openingHoursSchema = z
  .object({
    windows: z
      .array(
        z
          .object({ dayOfWeek: z.number().int().min(0).max(6), opens: hhmm, closes: hhmm })
          .strict()
          .refine((w) => w.opens < w.closes, { message: 'Closing must be after opening' }),
      )
      .max(28),
  })
  .strict();
export type OpeningHoursInput = z.infer<typeof openingHoursSchema>;

export const privacySettingsSchema = z
  .object({
    /** Inactive guests' personal data is erased after this many days; 0 keeps it until deleted by request. */
    guestRetentionDays: z.number().int().min(0).max(3650),
  })
  .strict();
