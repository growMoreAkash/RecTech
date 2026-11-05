'use client';

import { ERROR_CODES } from '@dinesense/shared';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';

const KNOWN = new Set<string>(ERROR_CODES);

export function ErrorText({ error }: { error: unknown }) {
  const t = useTranslations('errors');
  if (!error) return null;
  let text = t('generic');
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK') text = t('network');
    else if (KNOWN.has(error.code) && t.has(error.code)) text = t(error.code as 'FORBIDDEN');
  }
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {text}
    </p>
  );
}
