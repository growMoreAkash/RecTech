'use client';

import { normalizePhone } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Field, Input } from '@dinesense/ui/field';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarCheck, MapPin } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '../error-text';
import { LocaleToggle } from '../locale-toggle';
import { SlotPicker } from './slot-picker';
import { bookingApi } from '@/lib/api';
import type { BookingPage as Page, Consents, GuestBooking } from '@/lib/types';

const PURPOSES = ['WHATSAPP', 'FEEDBACK', 'MARKETING'] as const;

export function BookingPage({ slug }: { slug: string }) {
  const t = useTranslations('booking');
  const format = useFormatter();
  const page = useQuery({ queryKey: ['booking-page', slug], queryFn: () => bookingApi<Page>(`/${slug}`) });
  const [party, setParty] = useState(2);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [consents, setConsents] = useState<Consents>({});
  const book = useMutation({
    mutationFn: () =>
      bookingApi<{ manageToken: string; booking: GuestBooking }>(`/${slug}/reservations`, {
        method: 'POST',
        body: {
          startsAt: slot,
          partySize: party,
          name: name.trim(),
          phone,
          consents,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      }),
  });

  if (page.error)
    return (
      <Shell>
        <ErrorText error={page.error} />
      </Shell>
    );
  if (!page.data)
    return (
      <Shell>
        <p className="text-slate-500" aria-busy="true">
          …
        </p>
      </Shell>
    );
  const p = page.data;
  const day = date ?? p.today;

  if (book.data) {
    const manage = `/b/manage/${book.data.manageToken}`;
    return (
      <Shell title={p.name}>
        <div className="space-y-4 rounded-xl bg-emerald-50 p-4 text-emerald-900" role="status">
          <CalendarCheck className="size-8" aria-hidden />
          <h2 className="text-xl font-semibold">{t('confirmedTitle')}</h2>
          <p>
            {t('confirmedBody', {
              party: book.data.booking.partySize,
              date: format.dateTime(new Date(book.data.booking.startsAt), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              }),
              time: book.data.booking.time,
            })}
          </p>
          <p className="text-sm">{t('manageHint')}</p>
          <a href={manage} className="inline-block font-medium underline">
            {t('manageLink')}
          </a>
        </div>
      </Shell>
    );
  }

  if (!p.booking.enabled)
    return (
      <Shell title={p.name} address={p.address}>
        <p className="text-slate-600">{t('closedOnline')}</p>
      </Shell>
    );

  const validPhone = !!normalizePhone(phone);
  return (
    <Shell title={p.name} address={p.address}>
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <SlotPicker
        slug={slug}
        today={p.today}
        horizonDays={p.booking.horizonDays}
        maxPartySize={p.booking.maxPartySize}
        party={party}
        date={day}
        slot={slot}
        onParty={setParty}
        onDate={setDate}
        onSlot={setSlot}
      />
      {slot ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && validPhone) book.mutate();
          }}
        >
          <Field label={t('name')}>
            {(f) => (
              <Input
                {...f}
                required
                maxLength={60}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('phone')} hint={phone && !validPhone ? t('phoneInvalid') : t('phoneHint')}>
            {(f) => (
              <Input
                {...f}
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('notes')}>
            {(f) => (
              <Input
                {...f}
                maxLength={280}
                placeholder={t('notesPlaceholder')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
          <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
            <legend className="sr-only">{t('consentsTitle')}</legend>
            {PURPOSES.map((k) => (
              <label key={k} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={consents[k] ?? false}
                  onChange={(e) => setConsents((c) => ({ ...c, [k]: e.target.checked }))}
                />
                {t(`consent.${k}`)}
              </label>
            ))}
            <p className="text-xs text-slate-500">{t('privacy')}</p>
          </fieldset>
          <ErrorText error={book.error} />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={book.isPending || !name.trim() || !validPhone}
          >
            {t('confirm')}
          </Button>
        </form>
      ) : null}
    </Shell>
  );
}

export function Shell({
  title,
  address,
  children,
}: {
  title?: string;
  address?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-dvh max-w-xl space-y-5 p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          {title ? <h1 className="text-2xl font-bold">{title}</h1> : null}
          {address ? (
            <p className="flex items-center gap-1 text-sm text-slate-600">
              <MapPin className="size-4" aria-hidden />
              {address}
            </p>
          ) : null}
        </div>
        <LocaleToggle />
      </header>
      {children}
    </div>
  );
}
