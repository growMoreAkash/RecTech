import { z } from 'zod';
import { ASSIGNMENT_MODES } from '../enums';

const seconds = (min: number, max: number) => z.number().int().min(min).max(max);

/** Editable OutletSettings. Defaults match the brief and the Prisma schema. */
export const outletSettingsSchema = z
  .object({
    greetSlaSeconds: seconds(30, 3600),
    reassignAfterSeconds: seconds(30, 1800),
    escalateAfterSeconds: seconds(60, 7200),
    assignmentMode: z.enum(ASSIGNMENT_MODES),
    occupancyConfirmSeconds: seconds(5, 600),
    vacancyConfirmSeconds: seconds(10, 1800),
    staffPresentSeconds: seconds(2, 120),
    staffPresentMinConfidence: z.number().min(0).max(1),
    cameraGreetEnabled: z.boolean(),
    qrOrderSatisfiesGreet: z.boolean(),
    qrOrderNeedsApproval: z.boolean(),
    serviceChargeBps: z.number().int().min(0).max(2500),
    pricesIncludeTax: z.boolean(),
    defaultMaxTables: z.number().int().min(1).max(50),
    onlinePaymentsEnabled: z.boolean(),
    bookingEnabled: z.boolean(),
    bookingSlotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    bookingLeadMinutes: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60),
    bookingHorizonDays: z.number().int().min(1).max(180),
    bookingMaxPartySize: z.number().int().min(1).max(60),
    bookingLastSeatingMinutes: z.number().int().min(0).max(240),
    bookingMaxCoversPerSlot: z.number().int().min(0).max(1000),
    turnSmallMinutes: z.number().int().min(15).max(360),
    turnMediumMinutes: z.number().int().min(15).max(360),
    turnLargeMinutes: z.number().int().min(15).max(480),
    /** Table is held (RESERVED) this long before a booking. */
    reservationHoldMinutes: z.number().int().min(0).max(180),
    /** A booking not checked in this long after its time becomes a no-show and the table is released. */
    noShowGraceMinutes: z.number().int().min(5).max(120),
    bookingReminderMinutes: z.number().int().min(0).max(1440),
    waitlistEnabled: z.boolean(),
    waitlistHoldMinutes: z.number().int().min(2).max(60),
    waitlistMaxPartySize: z.number().int().min(1).max(60),
  })
  .strict();
export type OutletSettingsInput = z.infer<typeof outletSettingsSchema>;

export const updateOutletSettingsSchema = outletSettingsSchema
  .partial()
  .strict()
  .refine((s) => Object.keys(s).length > 0, { message: 'At least one setting is required' });

export const DEFAULT_OUTLET_SETTINGS: OutletSettingsInput = {
  greetSlaSeconds: 300,
  reassignAfterSeconds: 120,
  escalateAfterSeconds: 600,
  assignmentMode: 'ROUND_ROBIN',
  occupancyConfirmSeconds: 30,
  vacancyConfirmSeconds: 90,
  staffPresentSeconds: 10,
  staffPresentMinConfidence: 0.7,
  cameraGreetEnabled: false,
  qrOrderSatisfiesGreet: false,
  qrOrderNeedsApproval: true,
  serviceChargeBps: 0,
  pricesIncludeTax: false,
  defaultMaxTables: 4,
  onlinePaymentsEnabled: false,
  bookingEnabled: false,
  bookingSlotMinutes: 30,
  bookingLeadMinutes: 60,
  bookingHorizonDays: 30,
  bookingMaxPartySize: 8,
  bookingLastSeatingMinutes: 60,
  bookingMaxCoversPerSlot: 0,
  turnSmallMinutes: 75,
  turnMediumMinutes: 90,
  turnLargeMinutes: 120,
  reservationHoldMinutes: 20,
  noShowGraceMinutes: 15,
  bookingReminderMinutes: 120,
  waitlistEnabled: false,
  waitlistHoldMinutes: 10,
  waitlistMaxPartySize: 10,
};

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
});
