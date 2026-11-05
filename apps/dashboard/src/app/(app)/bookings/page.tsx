'use client';

import { addDays, localDate } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Globe, Lock, Phone } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { type GuestDraft, GuestFields } from '@/components/guests/guest-fields';
import { api } from '@/lib/api';
import { useFloor, useOutletMutation, useReservations } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { BookingSlot, Reservation } from '@/lib/types';
import { cn, formText } from '@/lib/utils';

const STATUS_STYLE: Record<Reservation['status'], string> = {
  CONFIRMED: 'bg-violet-100 text-violet-800',
  SEATED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
  NO_SHOW: 'bg-red-100 text-red-700',
};

export default function BookingsPage() {
  const t = useTranslations('bookings');
  const { outlet, can } = useSession();
  const today = localDate(new Date(), outlet.timezone);
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState(false);
  const list = useReservations(outlet.id, date);
  const front = can('OWNER', 'MANAGER', 'HOST');
  const rows = list.data ?? [];
  const active = rows.filter((r) => r.status === 'CONFIRMED' || r.status === 'SEATED');
  const covers = active.reduce((s, r) => s + r.partySize, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-slate-600">{t('summary', { bookings: active.length, covers })}</p>
        </div>
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDate(addDays(date, -1))}
            aria-label={t('prevDay')}
          >
            ‹
          </Button>
          <Field label={t('date')}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            )}
          </Field>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDate(addDays(date, 1))}
            aria-label={t('nextDay')}
          >
            ›
          </Button>
          {date !== today ? (
            <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
              {t('today')}
            </Button>
          ) : null}
          {front ? (
            <Button onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              {t('new')}
            </Button>
          ) : null}
        </div>
      </div>
      {adding ? <NewBooking date={date} onDone={() => setAdding(false)} /> : null}
      <ErrorText error={list.error} />
      {rows.length === 0 && list.isSuccess ? <p className="text-sm text-slate-500">{t('none')}</p> : null}
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {rows.map((r) => (
          <BookingRow key={r.id} r={r} isToday={date === today} canEdit={front} />
        ))}
      </ul>
    </div>
  );
}

function BookingRow({ r, isToday, canEdit }: { r: Reservation; isToday: boolean; canEdit: boolean }) {
  const t = useTranslations('bookings');
  const format = useFormatter();
  const { outlet } = useSession();
  const floor = useFloor(outlet.id);
  const label = new Map(floor.data?.tables.map((x) => [x.id, x.label]));
  const [moving, setMoving] = useState(false);
  const base = `/outlets/${outlet.id}/reservations/${r.id}`;
  const act = useOutletMutation(outlet.id, ({ path, body }: { path: string; body?: object }) =>
    api(`${base}/${path}`, { method: 'POST', body: body ?? {} }),
  );
  const patch = useOutletMutation(outlet.id, (body: object) => api(base, { method: 'PATCH', body }));
  const open = r.status === 'CONFIRMED';

  return (
    <li className={cn('space-y-2 p-3', !open && r.status !== 'SEATED' && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-14 text-lg font-semibold tabular-nums">
          {format.dateTime(new Date(r.startsAt), { hour: '2-digit', minute: '2-digit', hour12: false })}
        </span>
        <div className="min-w-48 flex-1">
          <p className="font-medium">
            {r.guest.erased ? t('erased') : (r.guest.name ?? t('noName'))}{' '}
            <span className="font-normal text-slate-600">· {t('party', { count: r.partySize })}</span>
            {r.guest.visits ? (
              <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                {t('regular', { count: r.guest.visits })}
              </span>
            ) : null}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {r.channel === 'ONLINE' ? (
              <Globe aria-hidden className="size-3" />
            ) : (
              <Phone aria-hidden className="size-3" />
            )}
            {t(`channel.${r.channel}`)}
            {r.guest.phone ? (
              <a href={`tel:${r.guest.phone}`} className="underline">
                {r.guest.phone}
              </a>
            ) : null}
            · {r.tableIds.map((id) => label.get(id) ?? '?').join(' + ') || t('noTable')}
            {r.heldAt && open ? (
              <span className="inline-flex items-center gap-1 text-violet-700">
                <Lock aria-hidden className="size-3" />
                {t('held')}
              </span>
            ) : null}
          </p>
          {r.guest.allergies ? (
            <p className="flex items-center gap-1 text-xs font-medium text-red-700">
              <AlertTriangle aria-hidden className="size-3" />
              {r.guest.allergies}
            </p>
          ) : null}
          {r.notes ? <p className="text-xs text-slate-700">“{r.notes}”</p> : null}
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[r.status])}>
          {t(`status.${r.status}`)}
        </span>
        {canEdit && open ? (
          <div className="flex flex-wrap gap-2">
            {isToday ? (
              <Button size="sm" onClick={() => act.mutate({ path: 'check-in' })} disabled={act.isPending}>
                {t('checkIn')}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setMoving((v) => !v)} aria-expanded={moving}>
              {t('changeTable')}
            </Button>
            {isToday ? (
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: 'no-show' })}>
                {t('noShow')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.confirm(t('confirmCancel')) && act.mutate({ path: 'cancel' })}
            >
              {t('cancel')}
            </Button>
          </div>
        ) : null}
      </div>
      {moving ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const v = formText(new FormData(e.currentTarget), 'table');
            if (v) patch.mutate({ tableIds: [v] }, { onSuccess: () => setMoving(false) });
          }}
        >
          <Field label={t('table')}>
            {(p) => (
              <Select {...p} name="table" defaultValue={r.tableIds[0]}>
                {floor.data?.tables
                  .filter((x) => x.capacity >= r.partySize)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label} ({x.capacity})
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Button size="sm" type="submit" disabled={patch.isPending}>
            {t('save')}
          </Button>
        </form>
      ) : null}
      <ErrorText error={act.error ?? patch.error} />
    </li>
  );
}

function NewBooking({ date: initialDate, onDone }: { date: string; onDone: () => void }) {
  const t = useTranslations('bookings');
  const { outlet } = useSession();
  const [date, setDate] = useState(initialDate);
  const [party, setParty] = useState(2);
  const [slot, setSlot] = useState<string | null>(null);
  const [guest, setGuest] = useState<GuestDraft | null>(null);
  const [notes, setNotes] = useState('');
  const slots = useQuery({
    queryKey: ['outlet', outlet.id, 'reservations', 'slots', date, party],
    queryFn: () =>
      api<BookingSlot[]>(`/outlets/${outlet.id}/reservations/slots?date=${date}&partySize=${party}`),
  });
  const create = useOutletMutation(outlet.id, (body: object) =>
    api(`/outlets/${outlet.id}/reservations`, { method: 'POST', body }),
  );

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!guest || !slot) return;
        create.mutate(
          { startsAt: slot, partySize: party, ...guest, ...(notes.trim() ? { notes: notes.trim() } : {}) },
          { onSuccess: onDone },
        );
      }}
    >
      <h2 className="font-semibold">{t('new')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <GuestFields onChange={setGuest} required />
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('date')}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={date}
                  onChange={(e) => (setDate(e.target.value), setSlot(null))}
                />
              )}
            </Field>
            <Field label={t('partySize')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={60}
                  value={party}
                  onChange={(e) => (setParty(Math.max(1, Number(e.target.value) || 1)), setSlot(null))}
                />
              )}
            </Field>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">{t('time')}</legend>
            {slots.data && !slots.data.length ? (
              <p className="text-sm text-slate-500">{t('closed')}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label={t('time')}>
              {slots.data?.map((s) => (
                <button
                  key={s.startsAt}
                  type="button"
                  role="radio"
                  aria-checked={slot === s.startsAt}
                  disabled={!s.available}
                  onClick={() => setSlot(s.startsAt)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs tabular-nums',
                    slot === s.startsAt
                      ? 'border-brand bg-orange-50 text-brand'
                      : 'border-slate-300 bg-white',
                    !s.available && 'cursor-not-allowed text-slate-300 line-through',
                  )}
                >
                  {s.time}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label={t('notes')}>
            {(p) => <Input {...p} value={notes} maxLength={280} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
      </div>
      <ErrorText error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!guest || !slot || create.isPending}>
          {t('book')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('close')}
        </Button>
      </div>
    </form>
  );
}
