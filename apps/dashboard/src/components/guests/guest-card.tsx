'use client';

import { Money } from '@dinesense/ui/money';
import { AlertTriangle, Repeat } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { GuestProfile } from '@/lib/types';

/** Who is at the door: visits, last visit, usual order, allergies (highlighted). No photos, phone only. */
export function GuestCard({ guest, compact }: { guest: GuestProfile; compact?: boolean }) {
  const t = useTranslations('guests');
  const format = useFormatter();
  return (
    <div className="space-y-1 rounded-md border border-sky-200 bg-sky-50 p-2 text-sm" role="status">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <Repeat aria-hidden className="size-4 text-sky-700" />
        {guest.name ?? t('unnamed')}
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
          {guest.visits ? t('visitNumber', { n: guest.visits + 1 }) : t('firstVisit')}
        </span>
      </p>
      {guest.allergies ? (
        <p className="flex items-center gap-1 font-medium text-red-700">
          <AlertTriangle aria-hidden className="size-4" />
          {t('allergiesValue', { value: guest.allergies })}
        </p>
      ) : null}
      {!compact && guest.lastVisitAt ? (
        <p className="text-xs text-slate-600">
          {t('lastVisit', { date: format.dateTime(new Date(guest.lastVisitAt), { dateStyle: 'medium' }) })}
          {guest.totalSpendPaise ? (
            <>
              {' · '}
              {t('spent')} <Money paise={guest.totalSpendPaise} />
            </>
          ) : null}
        </p>
      ) : null}
      {!compact && guest.favourites.length ? (
        <p className="text-xs text-slate-600">
          {t('usual', { items: guest.favourites.map((f) => f.name).join(', ') })}
        </p>
      ) : null}
      {guest.notes ? <p className="text-xs text-slate-700">“{guest.notes}”</p> : null}
    </div>
  );
}
