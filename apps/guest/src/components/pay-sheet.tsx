'use client';

import { Button } from '@dinesense/ui/button';
import { Money } from '@dinesense/ui/money';
import { Sheet } from '@dinesense/ui/sheet';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { guestApi } from '@/lib/api';
import { CheckoutUnavailable, openCheckout } from '@/lib/checkout';
import { payTargets } from '@/lib/pay';
import type { CheckoutStart, GuestBills } from '@/lib/types';

export function PaySheet({
  open,
  onOpenChange,
  bills,
  token,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bills: GuestBills | undefined;
  token: string | null;
}) {
  const t = useTranslations('guest.pay');
  const locale = useLocale();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  async function pay(billId: string, shareKey?: string) {
    setError(null);
    setFailed(null);
    setPaid(false);
    setBusy(`${billId}:${shareKey ?? ''}`);
    try {
      const start = await guestApi<CheckoutStart>('/payments', {
        method: 'POST',
        token,
        body: { billId, shareKey },
      });
      let result;
      try {
        result = await openCheckout(start, locale);
      } catch (e) {
        if (e instanceof CheckoutUnavailable)
          // Never opened: release the reservation so the bill isn't held for a payment that can't happen.
          await guestApi('/payments/abandon', {
            method: 'POST',
            token,
            body: { orderId: start.orderId },
          }).catch(() => undefined);
        throw e;
      }
      if (result) {
        await guestApi('/payments/verify', {
          method: 'POST',
          token,
          body: {
            orderId: result.razorpay_order_id,
            paymentId: result.razorpay_payment_id,
            signature: result.razorpay_signature,
          },
        });
        setPaid(true);
      }
    } catch (e) {
      if (e instanceof Error && !('code' in e)) setFailed(e.message);
      else setError(e);
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['bills', token] });
    }
  }

  const list = bills?.bills.filter((b) => b.totalPaise > 0) ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('title')}>
      <div className="space-y-4">
        {paid ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800"
          >
            <CheckCircle2 className="size-5" aria-hidden />
            {t('thanks')}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {t('failed', { reason: failed })}
          </p>
        ) : null}
        <ErrorText error={error} />
        {!list.length ? <p className="text-slate-500">{t('nothing')}</p> : null}
        {list.map((b) => (
          <section key={b.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{b.invoiceNumber ?? t('yourBill')}</span>
              <Money paise={b.totalPaise} className="text-lg font-semibold" />
            </div>
            {b.split ? (
              <ul className="space-y-1 text-sm">
                {b.split.shares.map((s, i) => (
                  <li key={s.key} className="flex justify-between">
                    <span>{s.label || t('share', { n: i + 1 })}</span>
                    <span className={s.duePaise ? '' : 'text-emerald-700'}>
                      {s.duePaise ? <Money paise={s.amountPaise} /> : t('sharePaid')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {b.status === 'PAID' ? (
              <p className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="size-5" aria-hidden />
                {t('paid')}
              </p>
            ) : bills?.onlinePayments ? (
              <div className="space-y-2">
                {payTargets(b).map((x) => (
                  <Button
                    key={x.shareKey ?? 'all'}
                    size="lg"
                    className="w-full"
                    disabled={!!busy}
                    onClick={() => void pay(b.id, x.shareKey)}
                  >
                    {x.shareKey
                      ? x.label
                        ? t('payShare', { name: x.label })
                        : t('payShareN', { n: x.index + 1 })
                      : t('payAll')}{' '}
                    <Money paise={x.duePaise} />
                  </Button>
                ))}
                {b.status === 'OPEN' ? <p className="text-xs text-slate-500">{t('finalNote')}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-slate-600">{t('atCounter')}</p>
            )}
            {b.invoiceUrl ? (
              <a
                href={b.invoiceUrl}
                target="_blank"
                rel="noopener"
                className="inline-block text-sm text-brand underline"
              >
                {t('invoice')}
              </a>
            ) : null}
          </section>
        ))}
        <p className="text-xs text-slate-500">{t('secure')}</p>
      </div>
    </Sheet>
  );
}
