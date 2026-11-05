'use client';

import { Button } from '@dinesense/ui/button';
import { Field, Input } from '@dinesense/ui/field';
import { Money } from '@dinesense/ui/money';
import { useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { ConsentFlags, GuestProfile } from '@/lib/types';
import { cn, formText } from '@/lib/utils';

const PURPOSES = ['WHATSAPP', 'FEEDBACK', 'MARKETING'] as const;

export default function GuestsPage() {
  const t = useTranslations('guests');
  const format = useFormatter();
  const { outlet, can } = useSession();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['outlet', outlet.id, 'guests', q],
    queryFn: () => api<GuestProfile[]>(`/outlets/${outlet.id}/guests?q=${encodeURIComponent(q)}`),
    enabled: can('OWNER', 'MANAGER'),
  });
  if (!can('OWNER', 'MANAGER')) return <p className="p-4 text-sm text-slate-600">{t('managersOnly')}</p>;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_24rem]">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="flex items-start gap-2 text-sm text-slate-600">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-700" />
          {t('privacyNote')}
        </p>
        <Field label={t('search')}>
          {(p) => (
            <Input
              {...p}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
            />
          )}
        </Field>
        <ErrorText error={list.error} />
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {list.data?.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => setSelected(g.id)}
                aria-pressed={selected === g.id}
                className={cn(
                  'flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-slate-50',
                  selected === g.id && 'bg-orange-50',
                )}
              >
                <span className="min-w-40 flex-1 font-medium">{g.name ?? t('unnamed')}</span>
                <span className="text-sm text-slate-600 tabular-nums">{g.phoneMasked}</span>
                <span className="text-sm text-slate-600">{t('visits', { count: g.visits })}</span>
                <span className="w-28 text-right text-xs text-slate-500">
                  {g.lastVisitAt ? format.dateTime(new Date(g.lastVisitAt), { dateStyle: 'medium' }) : '—'}
                </span>
              </button>
            </li>
          ))}
          {list.data?.length === 0 ? <li className="p-3 text-sm text-slate-500">{t('noResults')}</li> : null}
        </ul>
      </section>
      {selected ? <Profile id={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function Profile({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('guests');
  const format = useFormatter();
  const { outlet } = useSession();
  const g = useQuery({
    queryKey: ['outlet', outlet.id, 'guests', 'profile', id],
    queryFn: () => api<GuestProfile>(`/outlets/${outlet.id}/guests/${id}`),
  });
  const save = useOutletMutation(outlet.id, (body: object) =>
    api(`/outlets/${outlet.id}/guests/${id}`, { method: 'PATCH', body }),
  );
  const erase = useOutletMutation(outlet.id, () =>
    api(`/outlets/${outlet.id}/guests/${id}`, { method: 'DELETE' }),
  );
  const [exporting, setExporting] = useState<unknown>(null);

  async function download() {
    setExporting(null);
    try {
      const data = await api<unknown>(`/outlets/${outlet.id}/guests/${id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `guest-data-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExporting(e);
    }
  }

  if (!g.data) return <ErrorText error={g.error} />;
  const p = g.data;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const v = (k: string) => formText(d, k).trim() || null;
    const consents: ConsentFlags = Object.fromEntries(PURPOSES.map((k) => [k, d.get(`c-${k}`) === 'on']));
    save.mutate({
      name: v('name'),
      notes: v('notes'),
      allergies: v('allergies'),
      birthday: v('birthday'),
      consents,
    });
  };

  return (
    <aside className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-label={t('profile')}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{p.erased ? t('erasedTitle') : (p.name ?? t('unnamed'))}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
      {p.erased ? (
        <p className="text-sm text-slate-600">{t('erasedBody')}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-slate-500">{t('phone')}</dt>
            <dd>
              <a href={`tel:${p.phone}`} className="underline">
                {p.phone}
              </a>
            </dd>
            <dt className="text-slate-500">{t('visitsLabel')}</dt>
            <dd>{p.visits}</dd>
            <dt className="text-slate-500">{t('spent')}</dt>
            <dd>
              <Money paise={p.totalSpendPaise} />
            </dd>
            <dt className="text-slate-500">{t('lastVisitLabel')}</dt>
            <dd>{p.lastVisitAt ? format.dateTime(new Date(p.lastVisitAt), { dateStyle: 'medium' }) : '—'}</dd>
            {p.favourites.length ? (
              <>
                <dt className="text-slate-500">{t('favourites')}</dt>
                <dd>{p.favourites.map((f) => `${f.name} ×${f.count}`).join(', ')}</dd>
              </>
            ) : null}
          </dl>
          <form key={p.id + p.createdAt} onSubmit={onSubmit} className="space-y-2">
            <Field label={t('name')}>
              {(f) => <Input {...f} name="name" defaultValue={p.name ?? ''} maxLength={60} />}
            </Field>
            <Field label={t('allergies')}>
              {(f) => <Input {...f} name="allergies" defaultValue={p.allergies ?? ''} maxLength={140} />}
            </Field>
            <Field label={t('birthday')} hint={t('birthdayHint')}>
              {(f) => (
                <Input
                  {...f}
                  name="birthday"
                  defaultValue={p.birthday ?? ''}
                  pattern="(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])"
                  placeholder="MM-DD"
                />
              )}
            </Field>
            <Field label={t('notes')}>
              {(f) => <Input {...f} name="notes" defaultValue={p.notes ?? ''} maxLength={280} />}
            </Field>
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium text-slate-700">{t('consentsTitle')}</legend>
              {PURPOSES.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name={`c-${k}`} defaultChecked={p.consents[k] ?? false} />
                  {t(`consent.${k}`)}
                </label>
              ))}
            </fieldset>
            <Button size="sm" type="submit" disabled={save.isPending}>
              {t('save')}
            </Button>
            {save.isSuccess ? <span className="ml-2 text-sm text-emerald-700">{t('saved')}</span> : null}
          </form>
          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            <Button size="sm" variant="secondary" onClick={() => void download()}>
              <Download aria-hidden className="size-3" />
              {t('export')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => window.confirm(t('confirmErase')) && erase.mutate(undefined)}
              disabled={erase.isPending}
            >
              <Trash2 aria-hidden className="size-3" />
              {t('erase')}
            </Button>
          </div>
        </>
      )}
      <ErrorText error={save.error ?? erase.error ?? exporting} />
    </aside>
  );
}
