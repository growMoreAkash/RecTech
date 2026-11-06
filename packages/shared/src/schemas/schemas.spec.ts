import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTLET_SETTINGS, outletSettingsSchema, updateOutletSettingsSchema } from './outlet';
import { loginSchema, pinLoginSchema } from './auth';

describe('schemas', () => {
  it('defaults satisfy the settings schema', () => {
    expect(outletSettingsSchema.parse(DEFAULT_OUTLET_SETTINGS)).toEqual(DEFAULT_OUTLET_SETTINGS);
  });

  it('rejects unknown and empty settings updates', () => {
    expect(updateOutletSettingsSchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(updateOutletSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateOutletSettingsSchema.safeParse({ greetSlaSeconds: 240 }).success).toBe(true);
  });

  it('normalises login email and validates PIN shape', () => {
    expect(loginSchema.parse({ email: ' Manager@Demo.IN ', password: 'password123' }).email).toBe(
      'manager@demo.in',
    );
    expect(pinLoginSchema.safeParse({ userId: 'u1', pin: '12a4' }).success).toBe(false);
    expect(pinLoginSchema.safeParse({ userId: 'u1', pin: '1234' }).success).toBe(true);
  });
});
