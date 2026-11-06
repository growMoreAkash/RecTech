'use client';

import { localized } from '@dinesense/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMenu } from '@/lib/queries';
import { useSession } from '@/lib/session';

export default function KdsIndex() {
  const t = useTranslations('kds');
  const locale = useLocale();
  const { outlet } = useSession();
  const menu = useMenu(outlet.id);
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">{t('pickStation')}</h1>
      <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {menu.data?.stations.map((s) => (
          <li key={s.id}>
            <Link
              href={`/kds/${s.code}`}
              className="flex min-h-24 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-semibold hover:bg-orange-50"
            >
              {localized(s.name, locale)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
