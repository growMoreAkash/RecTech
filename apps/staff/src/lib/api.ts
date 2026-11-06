import type { ApiErrorBody, AuthTokens, ErrorCode } from '@dinesense/shared';

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

const DEVICE_KEY = 'ds.staff.device';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const getAccessToken = () => accessToken;

/** The registered terminal's token (stored once at setup; PIN login is only valid with it). */
export function deviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}
export function setDeviceToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* storage blocked: the device must be set up again next time */
  }
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  try {
    return await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = res.status === 204 ? '' : await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (body as Partial<ApiErrorBody> | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? res.statusText, err?.details);
  }
  return body as T;
}

export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await call('/auth/refresh', { method: 'POST', body: {} });
      if (!res.ok) return false;
      accessToken = ((await res.json()) as AuthTokens).accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res = await call(path, init);
  if (res.status === 401 && (await refresh())) res = await call(path, init);
  return parse<T>(res);
}

/** Calls that authenticate with the device token instead of a user session. */
export const deviceApi = <T>(path: string, init: { method?: string; body?: unknown } = {}) =>
  call(path, { ...init, headers: { 'x-device-token': deviceToken() ?? '' } }).then((r) => parse<T>(r));

export async function emailLogin(email: string, password: string) {
  accessToken = (
    await parse<AuthTokens>(await call('/auth/login', { method: 'POST', body: { email, password } }))
  ).accessToken;
}

export async function pinLogin(userId: string, pin: string) {
  accessToken = (await deviceApi<AuthTokens>('/auth/pin-login', { method: 'POST', body: { userId, pin } }))
    .accessToken;
}

export async function logout() {
  await call('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
  accessToken = null;
}
