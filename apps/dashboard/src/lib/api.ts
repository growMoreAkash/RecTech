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

/** In-memory access token. The refresh token lives in an httpOnly cookie (proxied same-origin via Next rewrites). */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export const getAccessToken = () => accessToken;
export const setOnSignedOut = (fn: () => void) => {
  onSignedOut = fn;
};

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : undefined;
}

function toError(res: Response, body: unknown): ApiError {
  const err = (body as Partial<ApiErrorBody> | undefined)?.error;
  return new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? res.statusText, err?.details);
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
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

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await parse(res);
  if (!res.ok) throw toError(res, body);
  accessToken = (body as AuthTokens).accessToken;
}

export async function logout(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => undefined);
  accessToken = null;
}

/** Binary GET (e.g. camera snapshots) with bearer auth; returns an object URL the caller must revoke. */
export async function apiObjectUrl(path: string): Promise<string> {
  const send = () =>
    fetch(`/api/v1${path}`, { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} });
  let res = await send();
  if (res.status === 401 && (await refresh())) res = await send();
  if (!res.ok) throw toError(res, await parse(res).catch(() => undefined));
  return URL.createObjectURL(await res.blob());
}

/** JSON API call with bearer auth and one transparent refresh on 401. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const send = () =>
    fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && (await refresh())) res = await send();
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  const body = await parse(res);
  if (res.status === 401) {
    accessToken = null;
    onSignedOut?.();
  }
  if (!res.ok) throw toError(res, body);
  return body as T;
}
