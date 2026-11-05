import { beforeEach, describe, expect, it } from 'vitest';
import { deviceId, savedToken, saveToken } from './api';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('guest device and session storage', () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = { localStorage: fakeStorage() };
  });

  it('creates one stable device id matching the API format', () => {
    const id = deviceId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(deviceId()).toBe(id);
  });

  it('stores the session token per table QR and clears it', () => {
    saveToken('qr1', 'tok');
    expect(savedToken('qr1')).toBe('tok');
    expect(savedToken('qr2')).toBeNull();
    saveToken('qr1', null);
    expect(savedToken('qr1')).toBeNull();
  });

  it('still works when storage is blocked (private mode)', () => {
    (globalThis as unknown as { window: unknown }).window = {
      get localStorage(): never {
        throw new Error('blocked');
      },
    };
    expect(deviceId()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(savedToken('qr1')).toBeNull();
  });
});
