import type { ApiErrorBody, ErrorCode } from '@dinesense/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Calls the guest API (proxied same-origin). `token` is the guest session token for this table. */
export async function guestApi<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/g${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { 'x-guest-token': init.token } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (body as Partial<ApiErrorBody> | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? res.statusText, err?.details);
  }
  return body as T;
}

const DEVICE_KEY = 'ds.device';
const tokenKey = (qr: string) => `ds.guest.${qr}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Stable random id for this phone (one GuestSession per device per seating). */
export function deviceId(): string {
  const s = storage();
  const existing = s?.getItem(DEVICE_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = Array.from(
    bytes,
    (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[b % 64],
  ).join('');
  s?.setItem(DEVICE_KEY, id);
  return id;
}

export const savedToken = (qr: string) => storage()?.getItem(tokenKey(qr)) ?? null;
export const saveToken = (qr: string, token: string | null) => {
  const s = storage();
  if (!s) return;
  if (token) s.setItem(tokenKey(qr), token);
  else s.removeItem(tokenKey(qr));
};
