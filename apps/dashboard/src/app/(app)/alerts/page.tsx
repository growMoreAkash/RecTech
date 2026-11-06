'use client';

import { Button } from '@dinesense/ui/button';
import { cn } from '@dinesense/ui/cn';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { useAlertHistory, useFloor, useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';

const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;

/** Alerts centre: what needs attention now, plus history. */
export default function AlertsPage() {
  const t = useTranslations('alerts');
  const format = useFormatter();
  const { outlet } = useSession();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('OPEN');
  const alerts = useAlertHistory(outlet.id, status);
  const floor = useFloor(outlet.id);
  const label = new Map(floor.data?.tables.map((x) => [x.id, x.label]));
  const act = useOutletMutation(outlet.id, ({ id, action }: { id: string; action: 'ack' | 'resolve' }) =>
    api(`/outlets/${outlet.id}/alerts/${id}/${action}`, { method: 'POST' }),
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{t('centre')}</h1>
        <div role="tablist" className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="tab"
              type="button"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'rounded-md px-3 py-2 text-sm',
                status === s ? 'bg-orange-50 text-brand' : 'hover:bg-slate-100',
              )}
            >
              {t(`statuses.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <ErrorText error={alerts.error ?? act.error} />
      {alerts.data && !alerts.data.length ? <p className="text-slate-500">{t('empty')}</p> : null}
      <ul className="space-y-2">
        {alerts.data?.map((a) => (
          <li
            key={a.id}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3',
              a.severity === 'CRITICAL'
                ? 'border-red-300'
                : a.severity === 'WARNING'
                  ? 'border-amber-300'
                  : 'border-slate-200',
            )}
          >
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                a.severity === 'CRITICAL' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800',
              )}
            >
              {t(`severity.${a.severity}`)}
            </span>
            <div className="flex-1">
              <p className="font-medium">{t.has(a.type) ? t(a.type as 'SLA_BREACH') : a.type}</p>
              <p className="text-xs text-slate-500">
                {a.tableId && label.get(a.tableId)
                  ? `${t('table', { label: label.get(a.tableId)! })} · `
                  : ''}
                {format.dateTime(new Date(a.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
            {a.status === 'OPEN' ? (
              <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: a.id, action: 'ack' })}>
                {t('ack')}
              </Button>
            ) : null}
            {a.status !== 'RESOLVED' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act.mutate({ id: a.id, action: 'resolve' })}
              >
                {t('resolve')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
