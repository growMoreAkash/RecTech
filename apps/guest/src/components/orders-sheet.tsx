'use client';

import { localized } from '@dinesense/shared';
import { Sheet } from '@dinesense/ui/sheet';
import { useLocale, useTranslations } from 'next-intl';
import { Totals } from './totals';
import type { Orders } from '@/lib/types';

const ITEM_TONE: Record<string, string> = {
  QUEUED: 'bg-slate-100 text-slate-700',
  COOKING: 'bg-amber-100 text-amber-800',
  READY: 'bg-sky-100 text-sky-800',
  SERVED: 'bg-emerald-100 text-emerald-800',
  VOID: 'bg-slate-100 text-slate-400 line-through',
};

/** Guests care whether food is coming: an accepted order whose items are all served reads "Served". */
export function displayStatus(o: Orders['orders'][number]): Orders['orders'][number]['status'] | 'DONE' {
  return o.status === 'ACCEPTED' &&
    o.items.length > 0 &&
    o.items.every((i) => i.status === 'SERVED' || i.status === 'VOID')
    ? 'DONE'
    : o.status;
}

export function OrdersSheet({
  open,
  onOpenChange,
  orders,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orders: Orders | undefined;
}) {
  const t = useTranslations('guest');
  const locale = useLocale();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('myOrders')}>
      {!orders?.orders.length ? <p className="text-slate-500">{t('noOrders')}</p> : null}
      <ol className="space-y-4">
        {orders?.orders.map((o) => (
          <li key={o.id} className="rounded-xl border border-slate-200 p-3">
            <p className="flex justify-between font-medium">
              <span>{t('orderNumber', { n: o.number })}</span>
              <span className="text-sm">{t(`orderStatus.${displayStatus(o)}`)}</span>
            </p>
            {o.status === 'REJECTED' && o.rejectedReason ? (
              <p className="text-sm text-red-700">{o.rejectedReason}</p>
            ) : null}
            <ul className="mt-2 space-y-1">
              {o.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {i.quantity} × {localized(i.name, locale)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${ITEM_TONE[i.status] ?? ''}`}>
                    {t(`itemStatus.${i.status}` as 'itemStatus.QUEUED')}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {orders && orders.bill.totalPaise > 0 ? (
        <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3">
          <p className="font-medium">{t('runningBill')}</p>
          <Totals totals={orders.bill} />
          <p className="text-xs text-slate-500">{t('billNote')}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
