import { z } from 'zod';
import { ORDER_ITEM_STATUSES, VEG_TYPES } from '../enums';

const id = z.string().min(1).max(64);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Localized text: English required, other locales optional. */
export const i18nTextSchema = z
  .object({ en: z.string().trim().min(1).max(120), hi: z.string().trim().max(120).optional() })
  .catchall(z.string().trim().max(120));
const i18nLong = z
  .object({ en: z.string().trim().max(500), hi: z.string().trim().max(500).optional() })
  .catchall(z.string().max(500));

export const availabilityWindowSchema = z
  .object({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7), from: hhmm, to: hhmm })
  .strict()
  .refine((w) => w.from !== w.to, { message: 'Window cannot be empty' });
const windows = z.array(availabilityWindowSchema).max(10).nullable();

export const ALLERGENS = [
  'gluten',
  'dairy',
  'nuts',
  'peanuts',
  'egg',
  'soy',
  'fish',
  'shellfish',
  'sesame',
  'mustard',
] as const;

export const stationInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,20}$/),
    name: i18nTextSchema,
  })
  .strict();
export type StationInput = z.infer<typeof stationInputSchema>;

export const categoryInputSchema = z
  .object({
    name: i18nTextSchema,
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    availabilityWindows: windows.optional(),
  })
  .strict();
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const menuItemInputSchema = z
  .object({
    categoryId: id,
    stationId: id,
    name: i18nTextSchema,
    description: i18nLong.nullable().optional(),
    vegType: z.enum(VEG_TYPES),
    allergens: z.array(z.enum(ALLERGENS)).max(10).default([]),
    spiceLevel: z.number().int().min(0).max(3).default(0),
    /** Paise. ₹0.00 – ₹1,00,000. */
    pricePaise: z.number().int().min(0).max(10_000_000),
    /** Basis points; GST slabs for restaurants are 0, 5, 12, 18%. */
    taxRateBps: z
      .number()
      .int()
      .refine((v) => [0, 500, 1200, 1800].includes(v), 'GST must be 0, 5, 12 or 18%')
      .default(500),
    hsnSac: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/)
      .nullable()
      .optional(),
    imageUrl: z.string().url().max(500).nullable().optional(),
    isAvailable: z.boolean().default(true),
    availabilityWindows: windows.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    modifierGroupIds: z.array(id).max(10).default([]),
  })
  .strict();
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;
export const menuItemPatchSchema = menuItemInputSchema.partial().strict();
export type MenuItemPatch = z.infer<typeof menuItemPatchSchema>;

export const modifierGroupInputSchema = z
  .object({
    name: i18nTextSchema,
    minSelect: z.number().int().min(0).max(10),
    maxSelect: z.number().int().min(1).max(10),
    modifiers: z
      .array(
        z
          .object({
            id: id.optional(),
            name: i18nTextSchema,
            priceDeltaPaise: z.number().int().min(-1_000_000).max(1_000_000),
            isAvailable: z.boolean().default(true),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .refine((g) => g.minSelect <= g.maxSelect, {
    message: 'minSelect cannot exceed maxSelect',
    path: ['minSelect'],
  })
  .refine((g) => g.maxSelect <= g.modifiers.length, {
    message: 'maxSelect exceeds the number of options',
    path: ['maxSelect'],
  });
export type ModifierGroupInput = z.infer<typeof modifierGroupInputSchema>;

export const availabilitySchema = z.object({ isAvailable: z.boolean() }).strict();

// ── Ordering ──

export const orderLineSchema = z
  .object({
    menuItemId: id,
    quantity: z.number().int().min(1).max(50),
    modifierIds: z.array(id).max(20).default([]),
    note: z.string().trim().max(140).optional(),
  })
  .strict();
export type OrderLineInput = z.infer<typeof orderLineSchema>;

/** Waiter-taken order. */
export const waiterOrderSchema = z.object({ items: z.array(orderLineSchema).min(1).max(60) }).strict();
export type WaiterOrderInput = z.infer<typeof waiterOrderSchema>;

export const rejectOrderSchema = z.object({ reason: z.string().trim().min(1).max(140) }).strict();

/** KDS / floor item status changes. VOID needs a reason. */
export const itemStatusSchema = z
  .object({
    status: z.enum(ORDER_ITEM_STATUSES).exclude(['QUEUED']),
    voidReason: z.string().trim().min(1).max(140).optional(),
  })
  .strict()
  .refine((s) => s.status !== 'VOID' || !!s.voidReason, {
    message: 'A reason is required to void',
    path: ['voidReason'],
  });
export type ItemStatusInput = z.infer<typeof itemStatusSchema>;

export const kdsQuerySchema = z.object({ station: z.string().trim().min(1).max(20) });
export const ordersQuerySchema = z.object({
  status: z.enum(['PENDING_APPROVAL', 'ACCEPTED', 'REJECTED']).optional(),
});

// ── Guest (QR) ──

export const guestSessionSchema = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict();

export const cartAddSchema = orderLineSchema;
export const cartPatchSchema = z.object({ quantity: z.number().int().min(0).max(50) }).strict();

export const GUEST_ACTIONS = ['CALL_WAITER', 'WATER', 'CUTLERY', 'BILL'] as const;
export type GuestAction = (typeof GUEST_ACTIONS)[number];
export const guestActionSchema = z.object({ type: z.enum(GUEST_ACTIONS) }).strict();

/** Guard rails against prank orders. */
export const CART_LIMITS = { maxLines: 40, maxQuantityPerLine: 50, maxItemsPerOrder: 100 } as const;
