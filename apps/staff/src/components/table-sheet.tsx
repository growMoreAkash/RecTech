'use client';

import { type Actor, localized, type Role, transition } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Money } from '@dinesense/ui/money';
import { Sheet } from '@dinesense/ui/sheet';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { OrderPicker } from './order-picker';
import { StatusChip } from './status-chip';
import { api } from '@/lib/api';
import { useOutletMutation, useTableBills, useTableOrders } from '@/lib/queries';
import type { Bill, FloorTable, Me } from '@/lib/types';

const ACTIONS = ['GREET', 'REQUEST_BILL', 'STAFF_MARK_LEFT', 'CLEAN_CONFIRMED'] as const;

/** Offer exactly what the shared state machine (and so the API) allows this person to do. */
function allowed(table: FloorTable, actor: Actor, type: (typeof ACTIONS)[number]): boolean {
  const s = table.live.seating;
  const r = transition(
    table.live.status,
    { type },
    {
      settings: {
        cameraGreetEnabled: false,
        staffPresentSeconds: 10,
        staffPresentMinConfidence: 0.7,
        qrOrderSatisfiesGreet: false,
      },
      seating: s
        ? { hasAcceptedOrder: !!s.firstOrderAt, allFirstOrderServed: false, isPaid: !!s.paidAt }
        : null,
      actor,
    },
  );
  return r.ok && !r.noop;
}

export function TableSheet({
  table,
  outletId,
  me,
  roles,
  onClose,
}: {
  table: FloorTable | null;
  outletId: string;
  me: Me;
  roles: Role[];
  onClose: () => void;
}) {
  const t = useTranslations('staffApp.table');
  return (
    <Sheet
      open={!!table}
      onOpenChange={(o) => !o && onClose()}
      title={table ? t('title', { label: table.label }) : ''}
    >
      {table ? <Body key={table.id} table={table} outletId={outletId} me={me} roles={roles} /> : null}
    </Sheet>
  );
}

function Body({
  table,
  outletId,
  me,
  roles,
}: {
  table: FloorTable;
  outletId: string;
  me: Me;
  roles: Role[];
}) {
  const t = useTranslations('staffApp.table');
  const tact = useTranslations('actions');
  const ts = useTranslations('guest.itemStatus');
  const locale = useLocale();
  const actor: Actor = { kind: 'STAFF', userId: me.id, roles };
  const [picking, setPicking] = useState(false);
  const orders = useTableOrders(outletId, table.id);
  const bills = useTableBills(outletId, table.id);
  const seated = !!table.live.seating;
  const canOrder = seated && roles.some((r) => r === 'WAITER' || r === 'MANAGER' || r === 'OWNER');

  const send = useOutletMutation(outletId, (event: string) =>
    api(`/outlets/${outletId}/tables/${table.id}/transitions`, {
      method: 'POST',
      body: { event, expectedVersion: table.live.version },
    }),
  );
  const decide = useOutletMutation(
    outletId,
    ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      api(`/outlets/${outletId}/orders/${id}/${action}`, {
        method: 'POST',
        ...(reason ? { body: { reason } } : {}),
      }),
  );
  const serve = useOutletMutation(outletId, (itemId: string) =>
    api(`/outlets/${outletId}/order-items/${itemId}`, { method: 'PATCH', body: { status: 'SERVED' } }),
  );
  const fire = useOutletMutation(outletId, () =>
    api(`/outlets/${outletId}/tables/${table.id}/fire`, { method: 'POST' }),
  );
  const printBill = useOutletMutation(outletId, async () => {
    const bill = await api<Bill>(`/outlets/${outletId}/tables/${table.id}/bills`, { method: 'POST' });
    window.open(bill.invoiceUrl, '_blank', 'noopener');
  });
  const [reason, setReason] = useState('');

  if (picking) return <OrderPicker outletId={outletId} tableId={table.id} onDone={() => setPicking(false)} />;

  const actions = ACTIONS.filter((a) => allowed(table, actor, a));
  const held = (orders.data ?? []).flatMap((o) => o.items).filter((i) => i.status === 'HELD').length;
  const due = (bills.data ?? []).filter((b) => b.status !== 'VOID').reduce((s, b) => s + b.duePaise, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <StatusChip status={table.live.status} />
        {table.live.seating?.partySize ? (
          <span className="text-sm text-slate-600">
            {t('guests', { count: table.live.seating.partySize })}
          </span>
        ) : null}
      </div>

      {actions.length || canOrder ? (
        <div className="grid grid-cols-2 gap-2">
          {canOrder ? (
            <Button size="lg" onClick={() => setPicking(true)}>
              {t('takeOrder')}
            </Button>
          ) : null}
          {actions.map((a) => (
            <Button
              key={a}
              size="lg"
              variant={a === 'GREET' || a === 'CLEAN_CONFIRMED' ? 'primary' : 'secondary'}
              disabled={send.isPending}
              onClick={() => send.mutate(a)}
            >
              {tact(a)}
            </Button>
          ))}
        </div>
      ) : null}
      <ErrorText error={send.error ?? decide.error ?? serve.error ?? printBill.error ?? fire.error} />

      {orders.data?.length ? (
        <section aria-labelledby="o-h" className="space-y-2">
          <h3 id="o-h" className="font-semibold">
            {t('orders')}
          </h3>
          {held ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm">
              <span>{t('held', { count: held })}</span>
              <Button size="sm" onClick={() => fire.mutate(undefined)} disabled={fire.isPending}>
                {t('fire')}
              </Button>
            </div>
          ) : null}
          {orders.data.map((o) => (
            <div key={o.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <p className="flex justify-between text-sm font-medium">
                <span>{t('order', { n: o.number })}</span>
                <span className="text-slate-500">{t(`orderStatus.${o.status}`)}</span>
              </p>
              <ul className="space-y-1 text-sm">
                {o.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span>
                      {i.quantity} × {localized(i.nameSnapshot, locale)}
                      {i.modifiers.length ? (
                        <span className="text-xs text-slate-500">
                          {' '}
                          ({i.modifiers.map((m) => localized(m.name, locale)).join(', ')})
                        </span>
                      ) : null}
                    </span>
                    {i.status === 'READY' ? (
                      <Button size="sm" onClick={() => serve.mutate(i.id)} disabled={serve.isPending}>
                        {t('served')}
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500">{ts(i.status)}</span>
                    )}
                  </li>
                ))}
              </ul>
              {o.status === 'PENDING_APPROVAL' ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => decide.mutate({ id: o.id, action: 'approve' })}>
                    {t('approve')}
                  </Button>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('rejectReason')}
                    aria-label={t('rejectReason')}
                    className="min-h-9 min-w-0 flex-1 basis-32 rounded-md border border-slate-300 px-2 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!reason.trim()}
                    onClick={() => decide.mutate({ id: o.id, action: 'reject', reason: reason.trim() })}
                  >
                    {t('reject')}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {seated && orders.data?.some((o) => o.status === 'ACCEPTED') ? (
        <section aria-labelledby="b-h" className="space-y-2 rounded-xl bg-slate-100 p-3">
          <h3 id="b-h" className="font-semibold">
            {t('bill')}
          </h3>
          {due ? (
            <p className="text-sm">
              {t('due')} <Money paise={due} className="font-semibold" />
            </p>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => printBill.mutate(undefined)}
            disabled={printBill.isPending}
          >
            {t('printBill')}
          </Button>
          <p className="text-xs text-slate-500">{t('cashierHint')}</p>
        </section>
      ) : null}
    </div>
  );
}
