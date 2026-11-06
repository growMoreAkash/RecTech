'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';

export function useErrorText() {
  const t = useTranslations('guest.errors');
  return (e: unknown): string | null => {
    if (!e) return null;
    if (e instanceof ApiError) {
      if (e.code === 'NETWORK') return t('network');
      if (t.has(e.code)) return t(e.code as 'generic');
    }
    return t('generic');
  };
}

export function ErrorText({ error }: { error: unknown }) {
  const text = useErrorText()(error);
  return text ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {text}
    </p>
  ) : null;
}
