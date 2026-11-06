'use client';

import { Button } from '@dinesense/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '../error-text';
import { Shell } from './booking-page';
import { SlotPicker } from './slot-picker';
import { bookingApi } from '@/lib/api';
import type { Consents, GuestBooking } from '@/lib/types';

const PURPOSES = ['WHATSAPP', 'FEEDBACK', 'MARKETING'] as const;

/** The guest's own booking page from the signed link: change time/party, cancel, change what we may send them. */
export function ManageBooking({ token }: { token: string }) {
  const t = useTranslations('booking');
  const format = useFormatter();
  const qc = useQueryClient();
  const key = ['manage', token];
  const b = useQuery({ queryKey: key, queryFn: () => bookingApi<GuestBooking>(`/manage/${token}`) });
  const [moving, setMoving] = useState(false);
  const [party, setParty] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const done = (data: GuestBooking) => {
    qc.setQueryData(key, data);
    setMoving(false);
    setSlot(null);
  };
  const cancel = useMutation({
    mutationFn: () => bookingApi<GuestBooking>(`/manage/${token}/cancel`, { method: 'POST' }),
    onSuccess: done,
  });
  const move = useMutation({
    mutationFn: () =>
      bookingApi<GuestBooking>(`/manage/${token}/reschedule`, {
        method: 'POST',
        body: { startsAt: slot, ...(party ? { partySize: party } : {}) },
      }),
    onSuccess: done,
  });
  const consent = useMutation({
    mutationFn: (c: Consents) =>
      bookingApi<GuestBooking>(`/manage/${token}/consents`, { method: 'PATCH', body: c }),
    onSuccess: (data) => qc.setQueryData(key, data),
  });

  if (b.error)
    return (
      <Shell>
        <ErrorText error={b.error} />
      </Shell>
    );
  if (!b.data)
    return (
      <Shell>
        <p aria-busy="true">…</p>
      </Shell>
    );
  const r = b.data;

  return (
    <Shell title={r.outlet.name} address={r.outlet.address}>
      <section className="space-y-1 rounded-xl border border-slate-200 p-4">
        <p className="text-sm text-slate-600">{t(`status.${r.status}`)}</p>
        <p className="text-2xl font-semibold">
          {format.dateTime(new Date(r.startsAt), { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
          {r.time}
        </p>
        <p>
          {t('partyOf', { count: r.partySize })}
          {r.name ? ` · ${r.name}` : ''}
        </p>
        {r.notes ? <p className="text-sm text-slate-600">“{r.notes}”</p> : null}
      </section>

      {r.canChange && !moving ? (
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setMoving(true)}>
            {t('change')}
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            onClick={() => window.confirm(t('confirmCancel')) && cancel.mutate()}
            disabled={cancel.isPending}
          >
            {t('cancel')}
          </Button>
        </div>
      ) : null}

      {moving ? (
        <section className="space-y-3">
          <SlotPicker
            slug={r.outlet.slug}
            today={r.date}
            horizonDays={14}
            maxPartySize={r.maxPartySize}
            party={party ?? r.partySize}
            date={date ?? r.date}
            slot={slot}
            onParty={setParty}
            onDate={setDate}
            onSlot={setSlot}
          />
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              disabled={!slot || move.isPending}
              onClick={() => move.mutate()}
            >
              {t('saveChange')}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setMoving(false)}>
              {t('back')}
            </Button>
          </div>
        </section>
      ) : null}
      <ErrorText error={cancel.error ?? move.error} />

      <fieldset className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
        <legend className="font-medium">{t('consentsTitle')}</legend>
        {PURPOSES.map((k) => (
          <label key={k} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={r.consents[k] ?? false}
              disabled={consent.isPending}
              onChange={(e) => consent.mutate({ [k]: e.target.checked })}
            />
            {t(`consent.${k}`)}
          </label>
        ))}
        <p className="text-xs text-slate-500">{t('privacy')}</p>
        <ErrorText error={consent.error} />
      </fieldset>
    </Shell>
  );
}
