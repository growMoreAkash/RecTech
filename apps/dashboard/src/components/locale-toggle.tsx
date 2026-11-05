'use client';

import { LOCALES } from '@dinesense/i18n';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

const NAMES: Record<string, string> = { en: 'English', hi: 'हिन्दी' };

/** Switches UI language; stored in a cookie read by src/i18n/request.ts. */
export function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('nav');
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t('language')}</span>
      <select
        value={locale}
        onChange={(e) => {
          document.cookie = `ds.locale=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="rounded-md border border-slate-300 bg-white px-2 py-1"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {NAMES[l] ?? l}
          </option>
        ))}
      </select>
    </label>
  );
}
