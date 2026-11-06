'use client';

import { addDays } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { bookingApi } from '@/lib/api';
import type { BookingSlot } from '@/lib/types';

/** Party size, day and time — the three choices a guest makes before giving any personal data. */
export function SlotPicker({
  slug,
  today,
  horizonDays,
  maxPartySize,
  party,
  date,
  slot,
  onParty,
  onDate,
  onSlot,
}: {
  slug: string;
  today: string;
  horizonDays: number;
  maxPartySize: number;
  party: number;
  date: string;
  slot: string | null;
  onParty: (n: number) => void;
  onDate: (d: string) => void;
  onSlot: (startsAt: string | null) => void;
}) {
  const t = useTranslations('booking');
  const format = useFormatter();
  const slots = useQuery({
    queryKey: ['slots', slug, date, party],
    queryFn: () => bookingApi<BookingSlot[]>(`/${slug}/slots?date=${date}&partySize=${party}`),
  });
  const days = Array.from({ length: Math.min(horizonDays, 14) }, (_, i) => addDays(today, i));
  const label = (d: string) =>
    d === today
      ? t('today')
      : format.dateTime(new Date(`${d}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{t('guests')}</span>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('fewer')}
            disabled={party <= 1}
            onClick={() => (onParty(party - 1), onSlot(null))}
          >
            <Minus className="size-4" aria-hidden />
          </Button>
          <span className="w-6 text-center text-lg font-semibold tabular-nums" aria-live="polite">
            {party}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('more')}
            disabled={party >= maxPartySize}
            onClick={() => (onParty(party + 1), onSlot(null))}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">{t('largerGroups', { max: maxPartySize })}</p>
      <div role="radiogroup" aria-label={t('day')} className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={d === date}
            onClick={() => (onDate(d), onSlot(null))}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${d === date ? 'border-brand bg-orange-50 font-medium text-brand' : 'border-slate-300'}`}
          >
            {label(d)}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t('time')} className="grid grid-cols-4 gap-2">
        {slots.data?.map((s) => (
          <button
            key={s.startsAt}
            type="button"
            role="radio"
            aria-checked={slot === s.startsAt}
            disabled={!s.available}
            onClick={() => onSlot(s.startsAt)}
            className={`min-h-11 rounded-lg border text-sm tabular-nums ${
              slot === s.startsAt
                ? 'border-brand bg-brand text-white'
                : s.available
                  ? 'border-slate-300'
                  : 'border-slate-100 text-slate-300 line-through'
            }`}
          >
            {s.time}
          </button>
        ))}
      </div>
      {slots.data && !slots.data.some((s) => s.available) ? (
        <p className="text-sm text-slate-600">{t('noSlots')}</p>
      ) : null}
    </div>
  );
}
