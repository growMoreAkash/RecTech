import { z } from 'zod';
import { DEVICE_KINDS } from '../enums';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** PIN login only works from a registered StaffDevice (device token in `x-device-token`). */
export const pinLoginSchema = z.object({
  userId: z.string().min(1).max(64),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits'),
});
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

export const registerDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(DEVICE_KINDS),
    station: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(512).optional() });

export interface AuthTokens {
  accessToken: string;
  /** Also set as an httpOnly cookie; returned in the body for native/PWA clients. */
  refreshToken: string;
  expiresIn: number;
}
