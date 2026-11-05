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
};

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
});
