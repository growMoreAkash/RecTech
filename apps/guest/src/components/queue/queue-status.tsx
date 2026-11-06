'use client';

import { Button } from '@dinesense/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Shell } from '../booking/booking-page';
import { ErrorText } from '../error-text';
import { queueApi } from '@/lib/api';
import type { QueueStatus as Status } from '@/lib/types';

/** Live place in line (refreshes every 15 s; buzzes when the table is ready). */
export function QueueStatus({ token }: { token: string }) {
  const t = useTranslations('queue');
  const qc = useQueryClient();
  const key = ['queue-status', token];
  const s = useQuery({
    queryKey: key,
    queryFn: () => queueApi<Status>(`/status/${token}`),
    refetchInterval: 15_000,
  });
  const leave = useMutation({
    mutationFn: () => queueApi<Status>(`/status/${token}/leave`, { method: 'POST' }),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(i);
  }, []);
  const ready = s.data?.status === 'NOTIFIED';
  useEffect(() => {
    if (ready) navigator.vibrate?.([300, 150, 300]);
  }, [ready]);

  if (s.error)
    return (
      <Shell>
        <ErrorText error={s.error} />
      </Shell>
    );
  if (!s.data)
    return (
      <Shell>
        <p aria-busy="true">…</p>
      </Shell>
    );
  const d = s.data;
  const holdLeft = d.holdUntil
    ? Math.max(0, Math.ceil((new Date(d.holdUntil).getTime() - now) / 60_000))
    : null;

  return (
    <Shell title={d.outlet.name}>
      {d.status === 'WAITING' ? (
        <section className="space-y-2 rounded-xl border border-slate-200 p-5 text-center" aria-live="polite">
          <p className="text-sm text-slate-600">{t('yourPlace')}</p>
          <p className="text-6xl font-bold tabular-nums">{d.position}</p>
          <p className="text-lg">{d.wait ? t('waitRange', d.wait) : t('askHost')}</p>
          <p className="text-xs text-slate-500">{t('keepOpen')}</p>
        </section>
      ) : null}
      {ready ? (
        <section role="alert" className="space-y-2 rounded-xl bg-emerald-600 p-5 text-center text-white">
          <BellRing className="mx-auto size-10" aria-hidden />
          <p className="text-2xl font-bold">{t('ready')}</p>
          {d.tables.length ? <p className="text-lg">{t('table', { table: d.tables.join(' + ') })}</p> : null}
          <p>{holdLeft ? t('comeIn', { minutes: holdLeft }) : t('comeInNow')}</p>
        </section>
      ) : null}
      {d.status === 'SEATED' ? (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-emerald-900">
          <CheckCircle2 className="size-6" aria-hidden />
          {t('seated')}
        </p>
      ) : null}
      {d.status === 'LEFT' || d.status === 'REMOVED' ? (
        <p className="rounded-xl bg-slate-100 p-4">{t('gone')}</p>
      ) : null}
      <p className="text-sm text-slate-600">{t('partyOf', { count: d.partySize, name: d.name ?? '' })}</p>
      {d.status === 'WAITING' || d.status === 'NOTIFIED' ? (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => window.confirm(t('confirmLeave')) && leave.mutate()}
          disabled={leave.isPending}
        >
          {t('leave')}
        </Button>
      ) : null}
      <ErrorText error={leave.error} />
    </Shell>
  );
}
