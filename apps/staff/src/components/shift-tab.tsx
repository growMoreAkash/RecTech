'use client';

import { Button } from '@dinesense/ui/button';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ErrorText } from './error-text';
import { api } from '@/lib/api';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { useOutletMutation, useShifts } from '@/lib/queries';
import type { Me } from '@/lib/types';

export function ShiftTab({ outletId, me }: { outletId: string; me: Me }) {
  const t = useTranslations('staffApp.shift');
  const format = useFormatter();
  const shifts = useShifts(outletId);
  const mine = shifts.data?.shifts.filter((s) => s.userId === me.id) ?? [];
  const act = useOutletMutation(outletId, ({ id, path, body }: { id: string; path: string; body?: object }) =>
    api(`/outlets/${outletId}/shifts/${id}/${path}`, { method: 'POST', body }),
  );
  const [push, setPush] = useState<PushState | null>(null);
  const [pushError, setPushError] = useState<unknown>(null);
  useEffect(() => {
    pushState().then(setPush, () => setPush('unsupported'));
  }, []);
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6">
      <section aria-labelledby="shift-h" className="space-y-3">
        <h1 id="shift-h" className="text-lg font-semibold">
          {t('title')}
        </h1>
        <ErrorText error={shifts.error ?? act.error} />
        {shifts.data && !mine.length ? <p className="text-slate-500">{t('none')}</p> : null}
        {mine.map((s) => {
          const on = !!s.checkedInAt && !s.checkedOutAt;
          return (
            <div key={s.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-lg">
                {time(s.startsAt)} – {time(s.endsAt)}
              </p>
              <p className="text-sm text-slate-600">
                {s.checkedOutAt
                  ? t('finished')
                  : on
                    ? s.onBreak
                      ? t('onBreak')
                      : t('onShift')
                    : t('notStarted')}
                {s.checkInSeq ? ` · ${t('rotation', { n: s.checkInSeq })}` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {!s.checkedInAt ? (
                  <Button size="lg" onClick={() => act.mutate({ id: s.id, path: 'check-in' })}>
                    {t('checkIn')}
                  </Button>
                ) : null}
                {on ? (
                  <>
                    <Button
                      size="lg"
                      variant="secondary"
                      onClick={() => act.mutate({ id: s.id, path: 'break', body: { onBreak: !s.onBreak } })}
                    >
                      {s.onBreak ? t('endBreak') : t('startBreak')}
                    </Button>
                    <Button
                      size="lg"
                      variant="secondary"
                      onClick={() => act.mutate({ id: s.id, path: 'check-out' })}
                    >
                      {t('checkOut')}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>
      <section aria-labelledby="push-h" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="push-h" className="font-semibold">
          {t('alerts')}
        </h2>
        <p className="text-sm text-slate-600">{push ? t(`push.${push}`) : ''}</p>
        {push === 'off' ? (
          <Button
            onClick={() =>
              void enablePush().then(setPush, (e: unknown) => {
                setPushError(e);
              })
            }
          >
            {t('enablePush')}
          </Button>
        ) : null}
        <ErrorText error={pushError} />
      </section>
    </div>
  );
}
