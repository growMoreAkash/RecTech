'use client';

import { ERROR_CODES } from '@dinesense/shared';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';

const KNOWN = new Set<string>(ERROR_CODES);

/** Maps an API error to a translated message (never shows raw server text to staff). */
export function useErrorText() {
  const t = useTranslations('errors');
  return (e: unknown): string | null => {
    if (!e) return null;
    if (e instanceof ApiError) {
      if (e.code === 'NETWORK') return t('network');
      if (KNOWN.has(e.code) && t.has(e.code)) return t(e.code as 'FORBIDDEN');
    }
    return t('generic');
  };
}

export function ErrorText({ error }: { error: unknown }) {
  const text = useErrorText()(error);
  return text ? (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {text}
    </p>
  ) : null;
}
