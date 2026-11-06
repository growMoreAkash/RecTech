'use client';

import { localized } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Money } from '@dinesense/ui/money';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, string> = {
  HELD: 'bg-slate-50 text-slate-500 italic',
  QUEUED: 'bg-slate-100',
  COOKING: 'bg-amber-100 text-amber-900',
  READY: 'bg-emerald-100 text-emerald-900',
  SERVED: 'bg-slate-100 text-slate-500',
  VOID: 'bg-slate-100 text-slate-400 line-through',
};

/** One order with approval (pending QR orders), "served" for ready items and "fire mains" for held courses. */
export function OrderCard({ order, showTable = false }: { order: Order; showTable?: boolean }) {
  const t = useTranslations('orders');
  const ts = useTranslations('guest.itemStatus');
  const locale = useLocale();
  const { outlet, can } = useSession();
  const [reason, setReason] = useState('');
  const canApprove = can('OWNER', 'MANAGER', 'WAITER');
  const canServe = can('OWNER', 'MANAGER', 'WAITER', 'HOST');

  const decide = useOutletMutation(outlet.id, (body: { action: 'approve' | 'reject'; reason?: string }) =>
    api(`/outlets/${outlet.id}/orders/${order.id}/${body.action}`, {
      method: 'POST',
      ...(body.reason ? { body: { reason: body.reason } } : {}),
    }),
  );
  const serve = useOutletMutation(outlet.id, (id: string) =>
    api(`/outlets/${outlet.id}/order-items/${id}`, { method: 'PATCH', body: { status: 'SERVED' } }),
  );
  const fire = useOutletMutation(outlet.id, (tableId: string) =>
    api(`/outlets/${outlet.id}/tables/${tableId}/fire`, { method: 'POST' }),
  );
  const held = order.items.filter((i) => i.status === 'HELD').length;
  const tableId = order.seating.tables[0]?.table.id;
  const total = order.items
    .filter((i) => i.status !== 'VOID')
    .reduce((s, i) => s + i.unitPricePaise * i.quantity, 0);

  return (
    <article
      className="space-y-2 rounded-lg border border-slate-200 p-3"
      aria-label={t('order', { n: order.number })}
    >
      <header className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">
          {t('order', { n: order.number })}
          {showTable ? ` · ${order.seating.tables.map((x) => x.table.label).join(' + ')}` : ''}
        </span>
        <span className="text-xs text-slate-600">
          {t(`source.${order.source}`)} · {t(`status.${order.status}`)}
        </span>
      </header>
      <ul className="space-y-1 text-sm">
        {order.items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2">
            <span>
              {i.quantity} × {localized(i.nameSnapshot, locale)}
              {i.modifiers.length ? (
                <span className="text-xs text-slate-500">
                  {' '}
                  ({i.modifiers.map((m) => localized(m.name, locale)).join(', ')})
                </span>
              ) : null}
              {i.note ? <span className="block text-xs text-slate-500">“{i.note}”</span> : null}
            </span>
            <span className="flex items-center gap-1">
              <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[i.status])}>
                {ts(i.status)}
              </span>
              {i.status === 'READY' && canServe ? (
                <Button size="sm" onClick={() => serve.mutate(i.id)} disabled={serve.isPending}>
                  {t('served')}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {held && tableId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 p-2 text-xs">
          <span>{t('held', { count: held })}</span>
          {canServe ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fire.mutate(tableId)}
              disabled={fire.isPending}
            >
              {t('fire')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-right text-sm">
        <Money paise={total} /> <span className="text-xs text-slate-500">{t('beforeTax')}</span>
      </p>
      {order.status === 'PENDING_APPROVAL' && canApprove ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => decide.mutate({ action: 'approve' })}
              disabled={decide.isPending}
            >
              {t('approve')}
            </Button>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('rejectReason')}
              aria-label={t('rejectReason')}
              maxLength={140}
              className="min-h-8 min-w-0 flex-1 basis-32 rounded-md border border-slate-300 px-2 text-sm"
            />
            <Button
              size="sm"
              variant="danger"
              disabled={!reason.trim() || decide.isPending}
              onClick={() => decide.mutate({ action: 'reject', reason: reason.trim() })}
            >
              {t('reject')}
            </Button>
          </div>
        </div>
      ) : null}
      {order.status === 'REJECTED' && order.rejectedReason ? (
        <p className="text-xs text-red-700">{order.rejectedReason}</p>
      ) : null}
      <ErrorText error={decide.error ?? serve.error ?? fire.error} />
    </article>
  );
}

/** Orders waiting for approval across the floor (QR orders when approval is on). */
export function PendingOrders({ orders }: { orders: Order[] }) {
  const t = useTranslations('orders');
  if (!orders.length) return null;
  return (
    <section
      aria-labelledby="pending-h"
      className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3"
    >
      <h2 id="pending-h" className="text-sm font-semibold">
        {t('pending', { count: orders.length })}
      </h2>
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} showTable />
      ))}
    </section>
  );
}
