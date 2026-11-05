'use client';

import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { AlertTriangle, DoorOpen, QrCode, Users } from 'lucide-react';
import QRCode from 'qrcode';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { MessageStatus } from '@/components/messages/message-status';
import { api } from '@/lib/api';
import { useDoorArrivals, useFloor, useOutletMutation, useWaitlist } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { FloorTable, WaitlistItem } from '@/lib/types';
import { cn, formText, useNow } from '@/lib/utils';

const GUEST_URL = process.env.NEXT_PUBLIC_GUEST_URL ?? 'http://localhost:3001';

export default function WaitlistPage() {
  const t = useTranslations('waitlist');
  const { outlet, can } = useSession();
  const list = useWaitlist(outlet.id);
  const floor = useFloor(outlet.id);
  const [adding, setAdding] = useState(false);
  const front = can('OWNER', 'MANAGER', 'HOST');
  const tables = floor.data?.tables ?? [];
  const waiting = (list.data ?? []).filter((e) => e.status === 'WAITING');

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-slate-600">
            {t('summary', { parties: waiting.length, guests: waiting.reduce((s, e) => s + e.partySize, 0) })}
          </p>
        </div>
        {front ? (
          <Button onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {t('add')}
          </Button>
        ) : null}
      </div>
      <DoorArrivals tables={tables} />
      {adding ? <AddParty onDone={() => setAdding(false)} /> : null}
      <ErrorText error={list.error} />
      {list.data?.length === 0 ? <p className="text-sm text-slate-500">{t('empty')}</p> : null}
      <ol className="space-y-2">
        {list.data?.map((e) => (
          <Entry key={e.id} e={e} tables={tables} canAct={front} />
        ))}
      </ol>
      <DoorQr />
    </div>
  );
}

function DoorArrivals({ tables }: { tables: FloorTable[] }) {
  const t = useTranslations('waitlist');
  const format = useFormatter();
  const { outlet } = useSession();
  const arrivals = useDoorArrivals(outlet.id);
  const label = new Map(tables.map((x) => [x.id, x.label]));
  const dismiss = useOutletMutation(outlet.id, (id: string) =>
    api(`/outlets/${outlet.id}/door-arrivals/${id}/dismiss`, { method: 'POST' }),
  );
  if (!arrivals.data?.length) return null;
  return (
    <section aria-label={t('door.title')} className="space-y-2">
      {arrivals.data.map((a) => (
        <div
          key={a.id}
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3"
        >
          <DoorOpen aria-hidden className="size-5 text-amber-700" />
          <p className="flex-1 text-sm">
            <strong>{t('door.party', { count: a.count })}</strong>{' '}
            <span className="text-slate-600">
              · {format.relativeTime(new Date(a.at), new Date())}
              {a.suggestedTableIds.length
                ? ` · ${t('door.suggest', { tables: a.suggestedTableIds.map((id) => label.get(id) ?? '?').join(' + ') })}`
                : ` · ${t('door.noTable')}`}
            </span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(a.id)}>
            {t('door.dismiss')}
          </Button>
        </div>
      ))}
    </section>
  );
}

function Entry({ e, tables, canAct }: { e: WaitlistItem; tables: FloorTable[]; canAct: boolean }) {
  const t = useTranslations('waitlist');
  const now = useNow(15_000);
  const { outlet } = useSession();
  const label = new Map(tables.map((x) => [x.id, x.label]));
  const fitting = tables.filter(
    (x) => x.capacity >= e.partySize && ['VACANT', 'NEEDS_CLEANING'].includes(x.live.status),
  );
  const [table, setTable] = useState(e.suggestedTableIds[0] ?? fitting[0]?.id ?? '');
  const base = `/outlets/${outlet.id}/waitlist/${e.id}`;
  const act = useOutletMutation(outlet.id, ({ path, body }: { path: string; body?: object }) =>
    api(`${base}/${path}`, { method: 'POST', body: body ?? {} }),
  );
  const waited = Math.floor((now - new Date(e.createdAt).getTime()) / 60_000);
  const holdLeft = e.holdUntil ? Math.ceil((new Date(e.holdUntil).getTime() - now) / 60_000) : null;

  return (
    <li
      className={cn(
        'space-y-2 rounded-lg border bg-white p-3',
        e.status === 'NOTIFIED' ? 'border-emerald-300' : 'border-slate-200',
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="grid size-9 place-items-center rounded-full bg-slate-100 font-semibold tabular-nums"
          aria-label={t('position')}
        >
          {e.position ?? '✓'}
        </span>
        <div className="min-w-48 flex-1">
          <p className="font-medium">
            {e.guest.name ?? t('noName')}{' '}
            <span className="font-normal text-slate-600">
              · <Users aria-hidden className="inline size-3" /> {e.partySize}
            </span>
            {e.guest.visits ? (
              <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                {t('regular', { count: e.guest.visits })}
              </span>
            ) : null}
            {e.source === 'QR' ? <span className="ml-2 text-xs text-slate-500">QR</span> : null}
          </p>
          <p className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span>{t('waited', { minutes: waited })}</span>
            {e.wait ? <span>· {t('eta', { low: e.wait.low, high: e.wait.high })}</span> : null}
            {e.wait === null && e.status === 'WAITING' ? (
              <span className="text-amber-700">· {t('noFit')}</span>
            ) : null}
            {e.guest.phone ? (
              <a className="underline" href={`tel:${e.guest.phone}`}>
                {e.guest.phone}
              </a>
            ) : null}
            <MessageStatus messages={e.messages} />
          </p>
          {e.guest.allergies ? (
            <p className="flex items-center gap-1 text-xs font-medium text-red-700">
              <AlertTriangle aria-hidden className="size-3" />
              {e.guest.allergies}
            </p>
          ) : null}
          {e.notes ? <p className="text-xs text-slate-700">“{e.notes}”</p> : null}
          {e.status === 'NOTIFIED' ? (
            <p className="text-sm font-medium text-emerald-800">
              {t('notified', {
                tables: e.notifiedTableIds.map((id) => label.get(id) ?? '?').join(' + ') || '—',
              })}
              {holdLeft !== null
                ? ` · ${holdLeft > 0 ? t('holdLeft', { minutes: holdLeft }) : t('holdOver')}`
                : ''}
            </p>
          ) : null}
        </div>
        {canAct ? (
          <div className="flex flex-wrap items-end gap-2">
            {e.status === 'WAITING' ? (
              <>
                <Select
                  aria-label={t('table')}
                  value={table}
                  onChange={(ev) => setTable(ev.target.value)}
                  className="w-28"
                >
                  <option value="">{t('pickTable')}</option>
                  {fitting.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label} ({x.capacity}){e.suggestedTableIds.includes(x.id) ? ' ★' : ''}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  disabled={!table || act.isPending}
                  onClick={() => act.mutate({ path: 'notify', body: { tableIds: [table] } })}
                >
                  {t('ready')}
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant={e.status === 'NOTIFIED' ? 'primary' : 'secondary'}
              disabled={act.isPending || (e.status === 'WAITING' && !table && !e.suggestedTableIds.length)}
              onClick={() =>
                act.mutate({
                  path: 'seat',
                  body: e.status === 'WAITING' && table ? { tableIds: [table] } : {},
                })
              }
            >
              {t('seat')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.confirm(t('confirmRemove')) && act.mutate({ path: 'remove' })}
            >
              {t('remove')}
            </Button>
          </div>
        ) : null}
      </div>
      <ErrorText error={act.error} />
    </li>
  );
}

function AddParty({ onDone }: { onDone: () => void }) {
  const t = useTranslations('waitlist');
  const { outlet } = useSession();
  const add = useOutletMutation(outlet.id, (body: object) =>
    api(`/outlets/${outlet.id}/waitlist`, { method: 'POST', body }),
  );
  return (
    <form
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
      onSubmit={(ev: FormEvent<HTMLFormElement>) => {
        ev.preventDefault();
        const d = new FormData(ev.currentTarget);
        const phone = formText(d, 'phone').trim();
        add.mutate(
          {
            name: formText(d, 'name').trim(),
            partySize: Number(formText(d, 'party')),
            ...(phone ? { phone, consents: { WHATSAPP: d.get('wa') === 'on' } } : {}),
          },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label={t('name')}>{(p) => <Input {...p} name="name" required maxLength={60} />}</Field>
      <Field label={t('party')}>
        {(p) => <Input {...p} name="party" type="number" min={1} max={60} defaultValue={2} required />}
      </Field>
      <Field label={t('phone')}>
        {(p) => <Input {...p} name="phone" type="tel" placeholder="98765 43210" />}
      </Field>
      <label className="flex items-end gap-2 pb-2 text-sm">
        <input type="checkbox" name="wa" className="size-4" />
        {t('waConsent')}
      </label>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" disabled={add.isPending}>
          {t('addSubmit')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <ErrorText error={add.error} />
      </div>
    </form>
  );
}

/** Printable door QR: guests scan it to join the queue themselves. */
function DoorQr() {
  const t = useTranslations('waitlist');
  const { outlet } = useSession();
  const link = `${GUEST_URL}/w/${outlet.slug}`;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 240 }).then(setSrc);
  }, [link]);
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <QrCode aria-hidden className="size-4" />
        {t('qrTitle')}
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        {src ? <img src={src} alt={t('qrAlt')} width={160} height={160} /> : null}
        <p className="text-sm text-slate-600">
          {t('qrHint')}{' '}
          <a className="break-all text-brand underline" href={link} target="_blank" rel="noopener">
            {link}
          </a>
        </p>
      </div>
    </details>
  );
}
