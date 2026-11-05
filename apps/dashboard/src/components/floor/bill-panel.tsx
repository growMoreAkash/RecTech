'use client';

import { MANUAL_PAYMENT_METHODS } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Input, Select } from '@dinesense/ui/field';
import { Money } from '@dinesense/ui/money';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { paiseToRupees, rupeesToPaise } from '@/lib/money-input';
import { useOutletMutation, useTableBills } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Bill } from '@/lib/types';
import { shareName, SplitPanel } from './split-panel';

/** Bill for the table: build it, adjust (cash desk), finalise, take payments, print the invoice. */
export function BillPanel({ tableId }: { tableId: string }) {
  const t = useTranslations('billing');
  const { outlet, can } = useSession();
  const bills = useTableBills(outlet.id, tableId);
  const prepare = useOutletMutation(outlet.id, () =>
    api<Bill>(`/outlets/${outlet.id}/tables/${tableId}/bills`, { method: 'POST' }),
  );
  const canPrepare = can('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'HOST');
  const live = (bills.data ?? []).filter((b) => b.status !== 'VOID');
  const hasOpen = live.some((b) => b.status === 'OPEN');

  return (
    <section aria-labelledby="bill-h" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 id="bill-h" className="text-sm font-semibold">
          {t('title')}
        </h3>
        {canPrepare ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => prepare.mutate(undefined)}
            disabled={prepare.isPending}
          >
            {hasOpen ? t('refresh') : t('create')}
          </Button>
        ) : null}
      </div>
      <ErrorText error={prepare.error} />
      {(bills.data ?? []).map((b) => (
        // Re-key on due/status so the amount field resets after each payment.
        <BillCard key={`${b.id}-${b.status}-${b.duePaise}`} bill={b} />
      ))}
    </section>
  );
}

function BillCard({ bill }: { bill: Bill }) {
  const t = useTranslations('billing');
  const { outlet, can } = useSession();
  const desk = can('OWNER', 'MANAGER', 'CASHIER');
  const [discount, setDiscount] = useState(bill.discountPaise ? paiseToRupees(bill.discountPaise) : '');
  const [reason, setReason] = useState(bill.discountReason ?? '');
  const [sc, setSc] = useState(String(bill.serviceChargeBps / 100));
  const [method, setMethod] = useState<(typeof MANUAL_PAYMENT_METHODS)[number]>('CASH');
  const [amount, setAmount] = useState(
    paiseToRupees(bill.split?.shares.find((s) => s.duePaise)?.duePaise ?? bill.duePaise),
  );
  const [reference, setReference] = useState('');
  const firstDue = bill.split?.shares.find((s) => s.duePaise);
  const [shareKey, setShareKey] = useState(firstDue?.key ?? '');
  const splitter = desk || can('WAITER');
  const live = bill.status === 'OPEN' || bill.status === 'FINALIZED';
  const onlinePending = bill.payments.some((p) => p.status === 'PENDING' && p.provider);
  const base = `/outlets/${outlet.id}/bills/${bill.id}`;

  const adjust = useOutletMutation(outlet.id, (body: object) => api(base, { method: 'PATCH', body }));
  const finalize = useOutletMutation(outlet.id, () => api(`${base}/finalize`, { method: 'POST' }));
  const pay = useOutletMutation(outlet.id, (body: object) =>
    api(`${base}/payments`, { method: 'POST', body }),
  );
  const error = adjust.error ?? finalize.error ?? pay.error;

  const applyAdjust = () => {
    const d = discount.trim() ? rupeesToPaise(discount) : 0;
    const scPct = Number(sc);
    if (d === null || !Number.isFinite(scPct)) return;
    adjust.mutate({
      discountPaise: d,
      discountReason: d ? reason.trim() || null : null,
      serviceChargeBps: Math.round(scPct * 100),
    });
  };
  const amountPaise = rupeesToPaise(amount);

  return (
    <article
      className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm"
      aria-label={bill.invoiceNumber ?? t('draft')}
    >
      <header className="flex items-center justify-between">
        <span className="font-medium">{bill.invoiceNumber ?? t('draft')}</span>
        <span className="text-xs text-slate-600">{t(`status.${bill.status}`)}</span>
      </header>
      <dl className="space-y-0.5">
        <Row label={t('subtotal')} paise={bill.subtotalPaise} />
        {bill.discountPaise ? (
          <Row
            label={`${t('discount')}${bill.discountReason ? ` (${bill.discountReason})` : ''}`}
            paise={-bill.discountPaise}
          />
        ) : null}
        {bill.serviceChargePaise ? (
          <Row
            label={t('serviceCharge', { pct: bill.serviceChargeBps / 100 })}
            paise={bill.serviceChargePaise}
          />
        ) : null}
        <Row label={t('cgst')} paise={bill.cgstPaise} />
        <Row label={t('sgst')} paise={bill.sgstPaise} />
        {bill.roundOffPaise ? <Row label={t('roundOff')} paise={bill.roundOffPaise} /> : null}
        <Row label={t('total')} paise={bill.totalPaise} strong />
        {bill.paidPaise ? <Row label={t('paid')} paise={bill.paidPaise} /> : null}
        {bill.status !== 'VOID' && bill.duePaise ? (
          <Row label={t('due')} paise={bill.duePaise} strong />
        ) : null}
      </dl>

      {(live && splitter) || bill.split ? <SplitPanel bill={bill} /> : null}
      {onlinePending ? (
        <p role="status" className="rounded-md bg-sky-50 p-2 text-xs text-sky-900">
          {t('onlinePending')}
        </p>
      ) : null}
      {bill.payments.some((p) => p.status === 'CAPTURED') ? (
        <ul aria-label={t('payments')} className="space-y-0.5 text-xs text-slate-600">
          {bill.payments
            .filter((p) => p.status === 'CAPTURED')
            .map((p) => {
              const i = bill.split?.shares.findIndex((s) => s.key === p.shareKey) ?? -1;
              return (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>
                    {t(`methods.${p.method}`)}
                    {i >= 0 && bill.split ? ` · ${shareName(t, bill.split.shares[i]!, i)}` : ''}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  <Money paise={p.amountPaise} />
                </li>
              );
            })}
        </ul>
      ) : null}

      {bill.status === 'OPEN' && desk ? (
        <fieldset className="space-y-2 rounded-md bg-slate-50 p-2">
          <legend className="sr-only">{t('adjust')}</legend>
          <div className="flex gap-2">
            <Input
              aria-label={t('discountRupees')}
              placeholder={t('discountRupees')}
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-28"
            />
            <Input
              aria-label={t('discountReason')}
              placeholder={t('discountReason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={140}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              {t('serviceChargePct')}
              <Input
                type="number"
                min={0}
                max={25}
                step={0.5}
                value={sc}
                onChange={(e) => setSc(e.target.value)}
                className="w-20"
              />
            </label>
            <Button size="sm" variant="secondary" onClick={applyAdjust} disabled={adjust.isPending}>
              {t('apply')}
            </Button>
          </div>
        </fieldset>
      ) : null}

      {(bill.status === 'OPEN' || bill.status === 'FINALIZED') && desk ? (
        <div className="space-y-2">
          {bill.status === 'OPEN' ? (
            <Button size="sm" onClick={() => finalize.mutate(undefined)} disabled={finalize.isPending}>
              {t('finalize')}
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {bill.split ? (
              <Select
                aria-label={t('split.payShare')}
                value={shareKey}
                onChange={(e) => {
                  setShareKey(e.target.value);
                  const s = bill.split?.shares.find((x) => x.key === e.target.value);
                  setAmount(paiseToRupees(s ? s.duePaise : bill.duePaise));
                }}
                className="w-36"
              >
                {bill.split.shares.map((s, i) =>
                  s.duePaise ? (
                    <option key={s.key} value={s.key}>
                      {shareName(t, s, i)}
                    </option>
                  ) : null,
                )}
                <option value="">{t('split.wholeBill')}</option>
              </Select>
            ) : null}
            <Select
              aria-label={t('method')}
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              className="w-28"
            >
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`methods.${m}`)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t('amount')}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28"
            />
            {method !== 'CASH' ? (
              <Input
                aria-label={t('reference')}
                placeholder={t('reference')}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-32"
              />
            ) : null}
            <Button
              size="sm"
              disabled={pay.isPending || !amountPaise}
              onClick={() =>
                amountPaise &&
                pay.mutate(
                  {
                    method,
                    amountPaise,
                    ...(reference.trim() ? { reference: reference.trim() } : {}),
                    ...(bill.split && shareKey ? { shareKey } : {}),
                  },
                  { onSuccess: () => setReference('') },
                )
              }
            >
              {t('recordPayment')}
            </Button>
          </div>
        </div>
      ) : null}
      <ErrorText error={error} />
      <a
        href={bill.invoiceUrl}
        target="_blank"
        rel="noopener"
        className="inline-block text-sm text-brand underline"
      >
        {bill.status === 'OPEN' ? t('printDraft') : t('printInvoice')}
      </a>
    </article>
  );
}

function Row({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : 'text-slate-700'}`}>
      <dt>{label}</dt>
      <dd>
        {paise < 0 ? '−' : ''}
        <Money paise={Math.abs(paise)} />
      </dd>
    </div>
  );
}
