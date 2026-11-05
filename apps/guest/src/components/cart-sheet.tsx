'use client';

import { localized } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Money } from '@dinesense/ui/money';
import { Sheet } from '@dinesense/ui/sheet';
import { VegMark } from '@dinesense/ui/veg-mark';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { Totals } from './totals';
import { guestApi } from '@/lib/api';
import type { Cart } from '@/lib/types';

/** The table's shared cart: everyone at the table sees and edits the same lines. */
export function CartSheet({
  open,
  onOpenChange,
  cart,
  token,
  onPlaced,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cart: Cart | undefined;
  token: string | null;
  onPlaced: () => void;
}) {
  const t = useTranslations('guest');
  const locale = useLocale();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const setQty = (id: string, quantity: number) =>
    guestApi(`/cart/lines/${id}`, { method: 'PATCH', token, body: { quantity } }).catch(setError);

  async function place() {
    setBusy(true);
    setError(null);
    try {
      await guestApi('/orders', { method: 'POST', token });
      onPlaced();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const lines = cart?.lines ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('yourTable')} description={t('sharedCartHint')}>
      {lines.length === 0 ? <p className="text-slate-500">{t('cartEmpty')}</p> : null}
      <ul className="divide-y divide-slate-200">
        {lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 py-3">
            <div className="flex gap-2">
              <VegMark vegType={l.vegType} size={14} />
              <div>
                <p className="font-medium">{localized(l.name, locale)}</p>
                {l.modifiers.length ? (
                  <p className="text-xs text-slate-500">
                    {l.modifiers.map((m) => localized(m.name, locale)).join(', ')}
                  </p>
                ) : null}
                {l.note ? <p className="text-xs text-slate-500">“{l.note}”</p> : null}
                {l.mine ? <p className="text-xs text-emerald-700">{t('addedByYou')}</p> : null}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Money paise={l.unitPricePaise * l.quantity} />
              <div className="flex items-center gap-1" role="group" aria-label={t('quantity')}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="size-9 p-0"
                  onClick={() => void setQty(l.id, l.quantity - 1)}
                  aria-label={t('less')}
                >
                  <Minus className="size-4" aria-hidden />
                </Button>
                <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="size-9 p-0"
                  onClick={() => void setQty(l.id, l.quantity + 1)}
                  aria-label={t('more')}
                >
                  <Plus className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {lines.length ? (
        <div className="mt-4 space-y-3">
          <Totals totals={cart!.totals} />
          {!cart!.canOrder ? <p className="text-sm text-amber-700">{t('someUnavailable')}</p> : null}
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={busy || !cart!.canOrder}
            onClick={() => void place()}
          >
            {t('placeOrder')}
          </Button>
          <p className="text-center text-xs text-slate-500">{t('approvalHint')}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
