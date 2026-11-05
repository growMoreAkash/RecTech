import { z } from 'zod';
import { ASSIGNMENT_MODES, ROLES, SEATING_SOURCES, TABLE_SHAPES, TABLE_STATUSES } from '../enums';
import { STAFF_EVENTS } from '../table-machine/machine';

const id = z.string().min(1).max(64);
const label = z.string().trim().min(1).max(12);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour');

export const sectionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    color: color.optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export type SectionInput = z.infer<typeof sectionInputSchema>;

/** One table in the floor-plan editor. `id` is absent for new tables; `key` lets new tables reference each other. */
export const floorTableSchema = z
  .object({
    id: id.optional(),
    key: z.string().min(1).max(64),
    label,
    sectionId: id,
    capacity: z.number().int().min(1).max(40),
    minCapacity: z.number().int().min(1).max(40),
    shape: z.enum(TABLE_SHAPES),
    x: z.number().finite().min(-10_000).max(10_000),
    y: z.number().finite().min(-10_000).max(10_000),
    w: z.number().finite().min(20).max(2_000),
    h: z.number().finite().min(20).max(2_000),
    rotation: z.number().finite().min(-360).max(360),
    /** Keys (existing id or new key) of tables this one may be joined with. */
    joinableWith: z.array(z.string().min(1).max(64)).max(20),
  })
  .strict()
  .refine((t) => t.minCapacity <= t.capacity, {
    message: 'minCapacity cannot exceed capacity',
    path: ['minCapacity'],
  });
export type FloorTableInput = z.infer<typeof floorTableSchema>;

/** Bulk save from the editor: the full set of tables. Tables missing from the list are archived. */
export const floorPlanSchema = z
  .object({ tables: z.array(floorTableSchema).max(300) })
  .strict()
  .superRefine((plan, ctx) => {
    const labels = new Set<string>();
    const keys = new Set<string>();
    plan.tables.forEach((t, i) => {
      const l = t.label.toUpperCase();
      if (labels.has(l))
        ctx.addIssue({ code: 'custom', path: ['tables', i, 'label'], message: `Duplicate label ${t.label}` });
      labels.add(l);
      if (keys.has(t.key))
        ctx.addIssue({ code: 'custom', path: ['tables', i, 'key'], message: 'Duplicate key' });
      keys.add(t.key);
    });
    plan.tables.forEach((t, i) =>
      t.joinableWith.forEach((k) => {
        if (!keys.has(k) || k === t.key) {
          ctx.addIssue({
            code: 'custom',
            path: ['tables', i, 'joinableWith'],
            message: `Unknown join target ${k}`,
          });
        }
      }),
    );
  });
export type FloorPlanInput = z.infer<typeof floorPlanSchema>;

export const seatSchema = z
  .object({
    partySize: z.number().int().min(1).max(60),
    notes: z.string().trim().max(280).optional(),
    source: z.enum(SEATING_SOURCES).optional(),
    /** Extra tables to join into this seating. */
    joinTableIds: z.array(id).max(6).optional(),
  })
  .strict();
export type SeatInput = z.infer<typeof seatSchema>;

const staffEvent = z.enum(STAFF_EVENTS as [string, ...string[]]);

export const transitionSchema = z
  .object({
    event: staffEvent,
    /** Required for FORCE_STATE. */
    to: z.enum(TABLE_STATUSES).optional(),
    /** Optimistic concurrency: reject if the table changed since the client last saw it. */
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((t) => t.event !== 'FORCE_STATE' || t.to !== undefined, {
    message: 'FORCE_STATE needs `to`',
    path: ['to'],
  });
export type TransitionInput = z.infer<typeof transitionSchema>;

// ── Staff & shifts ──
const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits');

export const createStaffSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: z.enum(ROLES),
    pin,
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    password: z.string().min(8).max(200).optional(),
    phone: z.string().trim().max(20).optional(),
  })
  .strict()
  .refine((s) => !s.password || s.email, { message: 'A password needs an email', path: ['email'] });
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    roles: z.array(z.enum(ROLES)).min(1).max(7).optional(),
    pin: pin.optional(),
    active: z.boolean().optional(),
    phone: z.string().trim().max(20).nullable().optional(),
  })
  .strict();
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const shiftInputSchema = z
  .object({
    userId: id,
    role: z.enum(ROLES),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    sectionIds: z.array(id).max(20).default([]),
    maxTables: z.number().int().min(1).max(50).nullable().optional(),
    assignmentMode: z.enum(ASSIGNMENT_MODES).nullable().optional(),
  })
  .strict()
  .refine((s) => s.endsAt > s.startsAt, { message: 'Shift must end after it starts', path: ['endsAt'] })
  .refine((s) => s.endsAt.getTime() - s.startsAt.getTime() <= 16 * 3_600_000, {
    message: 'Shifts are at most 16 hours',
    path: ['endsAt'],
  });
export type ShiftInput = z.infer<typeof shiftInputSchema>;

export const updateShiftSchema = z
  .object({
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    sectionIds: z.array(id).max(20).optional(),
    maxTables: z.number().int().min(1).max(50).nullable().optional(),
    assignmentMode: z.enum(ASSIGNMENT_MODES).nullable().optional(),
  })
  .strict();
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

export const breakSchema = z.object({ onBreak: z.boolean() }).strict();

/** `YYYY-MM-DD` in the outlet's timezone. */
export const shiftQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const alertQuerySchema = z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional() });
