'use client';

import { localized } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { useLocale, useTranslations } from 'next-intl';
import { use } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { formatDuration } from '@/lib/floor-style';
import { nextKitchenStatus, type TicketAge, ticketAge } from '@/lib/kds';
import { useKds, useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { OrderItemStatus } from '@/lib/types';
import { cn, useNow } from '@/lib/utils';

const AGE_STYLE: Record<TicketAge, string> = {
  fresh: 'border-slate-300',
  aging: 'border-amber-500 bg-amber-50',
  late: 'border-red-600 bg-red-50',
};
const ITEM_STYLE: Record<OrderItemStatus, string> = {
  QUEUED: 'bg-white',
  COOKING: 'bg-amber-100',
  READY: 'bg-emerald-100 text-emerald-900',
  SERVED: 'bg-slate-100',
  VOID: 'bg-slate-100 line-through',
};

/** Kitchen display for one station. Tap an item to advance it; Bump marks the whole ticket ready. */
export default function KdsStation({ params }: { params: Promise<{ station: string }> }) {
  const { station } = use(params);
  const t = useTranslations('kds');
  const ts = useTranslations('guest.itemStatus');
  const locale = useLocale();
  const now = useNow(1000);
  const { outlet } = useSession();
  const board = useKds(outlet.id, station);
  const move = useOutletMutation(outlet.id, ({ id, status }: { id: string; status: OrderItemStatus }) =>
    api(`/outlets/${outlet.id}/order-items/${id}`, { method: 'PATCH', body: { status } }),
  );
  const bump = useOutletMutation(outlet.id, (orderId: string) =>
    api(`/outlets/${outlet.id}/kds/orders/${orderId}/bump?station=${encodeURIComponent(station)}`, {
      method: 'POST',
    }),
  );

  const tickets = board.data?.tickets ?? [];
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {board.data ? localized(board.data.station.name, locale) : station}
        </h1>
        <span className="text-sm text-slate-600">{t('open', { count: tickets.length })}</span>
      </div>
      <ErrorText error={board.error ?? move.error ?? bump.error} />
      {board.data && !tickets.length ? (
        <p className="py-12 text-center text-slate-500">{t('allClear')}</p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tickets.map((k) => {
          const age = ticketAge(k.firedAt, now);
          const pending = k.items.some((i) => i.status !== 'READY');
          return (
            <li
              key={k.orderId}
              className={cn('flex flex-col rounded-xl border-2 bg-white', AGE_STYLE[age])}
              aria-label={t('ticket', { n: k.number })}
            >
              <div className="flex items-baseline justify-between border-b border-slate-200 px-3 py-2">
                <span className="text-lg font-bold">#{k.number}</span>
                <span className="text-sm font-medium">{k.tables.join(' + ')}</span>
                <time
                  className={cn('tabular-nums text-sm', age === 'late' && 'font-bold text-red-700')}
                  dateTime={k.firedAt}
                >
                  {formatDuration(Math.max(0, now - Date.parse(k.firedAt)) / 1000)}
                </time>
              </div>
              <ul className="flex-1 divide-y divide-slate-100">
                {k.items.map((i) => {
                  const next = nextKitchenStatus(i.status);
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        disabled={!next || move.isPending}
                        onClick={() => next && move.mutate({ id: i.id, status: next })}
                        className={cn(
                          'flex w-full items-start justify-between gap-2 px-3 py-2 text-left',
                          ITEM_STYLE[i.status],
                        )}
                      >
                        <span>
                          <span className="font-semibold">
                            {i.quantity} × {localized(i.name, locale)}
                          </span>
                          {i.modifiers.length ? (
                            <span className="block text-sm">
                              {i.modifiers.map((m) => localized(m.name, locale)).join(', ')}
                            </span>
                          ) : null}
                          {i.note ? (
                            <span className="block text-sm font-medium text-red-700">“{i.note}”</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs uppercase">{ts(i.status)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-slate-200 p-2">
                <Button
                  className="w-full"
                  disabled={!pending || bump.isPending}
                  onClick={() => bump.mutate(k.orderId)}
                >
                  {t('bump')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
