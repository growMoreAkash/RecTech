'use client';

import { LOCALES } from '@dinesense/i18n';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

const NAMES: Record<string, string> = { en: 'EN', hi: 'हिं' };

export function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('nav');
  return (
    <div
      role="group"
      aria-label={t('language')}
      className="flex overflow-hidden rounded-full border border-slate-300 text-sm"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === locale}
          onClick={() => {
            document.cookie = `ds.locale=${l}; path=/; max-age=31536000; samesite=lax`;
            router.refresh();
          }}
          className={`min-h-9 px-3 ${l === locale ? 'bg-slate-900 text-white' : 'bg-white'}`}
        >
          {NAMES[l] ?? l}
        </button>
      ))}
    </div>
  );
}
