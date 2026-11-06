import { z } from 'zod';
import type { Role } from '../enums';

/** Which unassigned tasks each role picks up (and gets pushed). */
const FLOOR_TASKS = [
  'GREET',
  'CALL_WAITER',
  'WATER',
  'CUTLERY',
  'BILL',
  'SERVE',
  'APPROVE_ORDER',
  'CHECK_TABLE',
  'FIRE_COURSE',
  'OFFER_DESSERT',
] as const;

export const ROLE_TASK_TYPES: Record<Role, readonly string[]> = {
  OWNER: [...FLOOR_TASKS, 'CLEAN', 'SERVICE_RECOVERY'],
  MANAGER: [...FLOOR_TASKS, 'CLEAN', 'SERVICE_RECOVERY'],
  HOST: [],
  WAITER: FLOOR_TASKS,
  BUSSER: ['CLEAN'],
  CHEF: [],
  CASHIER: ['BILL'],
};

/** Tasks that are simply done by hand; the rest complete through their action (greet, serve, pay, clean, approve). */
export const MANUAL_TASK_TYPES = [
  'CALL_WAITER',
  'WATER',
  'CUTLERY',
  'CHECK_TABLE',
  'OFFER_DESSERT',
  'SERVICE_RECOVERY',
] as const;

export const taskQuerySchema = z.object({ scope: z.enum(['mine', 'all']).default('mine') });

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }).strict(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) }).strict();
