'use client';

import { normalizePhone } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Field, Input } from '@dinesense/ui/field';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Minus, Plus, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Shell } from '../booking/booking-page';
import { ErrorText } from '../error-text';
import { queueApi } from '@/lib/api';
import type { Consents, QueuePage, QueueStatus } from '@/lib/types';

const PURPOSES = ['WHATSAPP', 'FEEDBACK', 'MARKETING'] as const;

/** Door QR: join the queue with a phone number; then follow your place on the status page. */
export function JoinQueue({ slug }: { slug: string }) {
  const t = useTranslations('queue');
  const tb = useTranslations('booking');
  const locale = useLocale();
  const router = useRouter();
  const page = useQuery({
    queryKey: ['queue-page', slug],
    queryFn: () => queueApi<QueuePage>(`/${slug}`),
    refetchInterval: 30_000,
  });
  const [party, setParty] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consents, setConsents] = useState<Consents>({ WHATSAPP: false });
  const join = useMutation({
    mutationFn: () =>
      queueApi<{ token: string; entry: QueueStatus }>(`/${slug}/entries`, {
        method: 'POST',
        body: { name: name.trim(), phone, partySize: party, consents, locale: locale === 'hi' ? 'hi' : 'en' },
      }),
    onSuccess: (r) => {
      try {
        window.localStorage.setItem(`ds.queue.${slug}`, r.token);
      } catch {
        /* private mode: the status page URL still works */
      }
      router.push(`/w/status/${r.token}`);
    },
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
        <p aria-busy="true">…</p>
      </Shell>
    );
  const p = page.data;
  if (!p.waitlist.enabled)
    return (
      <Shell title={p.name} address={p.address}>
        <p className="text-slate-600">{t('closed')}</p>
      </Shell>
    );
  const valid = !!normalizePhone(phone) && !!name.trim();

  return (
    <Shell title={p.name} address={p.address}>
      <section className="rounded-xl bg-slate-50 p-4">
        <p className="text-sm text-slate-600">{t('now', { count: p.waiting })}</p>
        <p className="text-2xl font-semibold">{p.waitForTwo ? t('waitRange', p.waitForTwo) : t('askHost')}</p>
        <p className="text-xs text-slate-500">{t('estimateNote')}</p>
      </section>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) join.mutate();
        }}
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium">
            <Users className="size-4" aria-hidden />
            {tb('guests')}
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              aria-label={tb('fewer')}
              disabled={party <= 1}
              onClick={() => setParty(party - 1)}
            >
              <Minus className="size-4" aria-hidden />
            </Button>
            <span className="w-6 text-center text-lg font-semibold tabular-nums" aria-live="polite">
              {party}
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={tb('more')}
              disabled={party >= p.waitlist.maxPartySize}
              onClick={() => setParty(party + 1)}
            >
              <Plus className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        <Field label={tb('name')}>
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
        <Field
          label={tb('phone')}
          hint={phone && !normalizePhone(phone) ? tb('phoneInvalid') : t('phoneHint')}
        >
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
        <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          <legend className="sr-only">{tb('consentsTitle')}</legend>
          {PURPOSES.map((k) => (
            <label key={k} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={consents[k] ?? false}
                onChange={(e) => setConsents((c) => ({ ...c, [k]: e.target.checked }))}
              />
              {k === 'WHATSAPP' ? t('waConsent') : tb(`consent.${k}`)}
            </label>
          ))}
          <p className="text-xs text-slate-500">{tb('privacy')}</p>
        </fieldset>
        <ErrorText error={join.error} />
        <Button type="submit" size="lg" className="w-full" disabled={!valid || join.isPending}>
          {t('join')}
        </Button>
      </form>
    </Shell>
  );
}
