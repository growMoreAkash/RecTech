'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useFloor, useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Alert } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AlertsPanel({
  open,
  onOpenChange,
  alerts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  alerts: Alert[];
}) {
  const t = useTranslations('alerts');
  const format = useFormatter();
  const { outlet } = useSession();
  const floor = useFloor(outlet.id);
  const labels = new Map(floor.data?.tables.map((x) => [x.id, x.label]));
  const act = useOutletMutation(outlet.id, ({ id, action }: { id: string; action: 'ack' | 'resolve' }) =>
    api(`/outlets/${outlet.id}/alerts/${id}/${action}`, { method: 'POST' }),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('title')}>
      {alerts.length === 0 ? <p className="text-sm text-slate-500">{t('empty')}</p> : null}
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li
            key={a.id}
            className={cn(
              'rounded-md border p-3',
              a.severity === 'CRITICAL' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50',
            )}
          >
            <p className="font-medium">{t.has(a.type) ? t(a.type as 'SLA_BREACH') : a.type}</p>
            <p className="text-xs text-slate-600">
              {a.tableId && labels.get(a.tableId)
                ? `${t('table', { label: labels.get(a.tableId)! })} · `
                : ''}
              {format.relativeTime(new Date(a.createdAt))}
            </p>
            <div className="mt-2 flex gap-2">
              {a.status === 'OPEN' ? (
                <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: a.id, action: 'ack' })}>
                  {t('ack')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act.mutate({ id: a.id, action: 'resolve' })}
              >
                {t('resolve')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
