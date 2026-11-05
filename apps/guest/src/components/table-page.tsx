'use client';

import { type GuestAction, localized } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Money } from '@dinesense/ui/money';
import { VegMark } from '@dinesense/ui/veg-mark';
import {
  Bell,
  ClipboardList,
  GlassWater,
  ReceiptIndianRupee,
  ShoppingBag,
  UtensilsCrossed,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { CartSheet } from './cart-sheet';
import { ErrorText } from './error-text';
import { ItemSheet } from './item-sheet';
import { LocaleToggle } from './locale-toggle';
import { OrdersSheet } from './orders-sheet';
import { guestApi } from '@/lib/api';
import { useTableSession } from '@/lib/table-session';
import type { MenuItem } from '@/lib/types';

export function TablePage({ qr }: { qr: string }) {
  const t = useTranslations('guest');
  const locale = useLocale();
  const s = useTableSession(qr);
  const [item, setItem] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (s.phase === 'loading') return <main className="p-6" aria-busy="true" />;
  if (s.phase === 'error') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <p>{t('badQr')}</p>
      </main>
    );
  }
  if (s.phase === 'ended') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-2xl font-semibold">{t('thanks')}</p>
        <p className="text-slate-600">{t('sessionEnded')}</p>
      </main>
    );
  }

  const { landing } = s;
  if (!landing) return null;
  const ordering = s.phase === 'ordering';
  const cartCount = s.cart?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;

  async function act(type: GuestAction) {
    setActionError(null);
    try {
      await guestApi('/actions', { method: 'POST', token: s.token, body: { type } });
      setNotice(t(`actionSent.${type}`));
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      s.onError(e);
      setActionError(e);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-40">
      <header className="sticky top-0 z-10 space-y-2 border-b border-orange-100 bg-[#fffbf5]/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">{landing.outlet.name}</h1>
            <p className="text-sm text-slate-600">{t('table', { label: landing.table.label })}</p>
          </div>
          <LocaleToggle />
        </div>
        <nav aria-label={t('categories')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {landing.menu.categories.map((c) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              className="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm"
            >
              {localized(c.name, locale)}
            </a>
          ))}
        </nav>
      </header>

      {!ordering ? (
        <p role="status" className="mx-4 mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">
          {t('waitToBeSeated')}
        </p>
      ) : null}

      <main className="space-y-6 px-4 pt-4">
        {landing.menu.categories.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`h-${c.id}`} className="scroll-mt-28">
            <h2 id={`h-${c.id}`} className="mb-2 text-lg font-semibold">
              {localized(c.name, locale)}
            </h2>
            <ul className="space-y-2">
              {c.items.map((i) => {
                const name = localized(i.name, locale);
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      disabled={!ordering || !i.isAvailable}
                      onClick={() => setItem(i)}
                      className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left disabled:opacity-70"
                    >
                      <span className="flex gap-2">
                        <VegMark vegType={i.vegType} />
                        <span>
                          <span className="block font-medium">{name}</span>
                          {i.spiceLevel ? (
                            <span
                              className="text-xs text-red-700"
                              aria-label={t('spice', { level: i.spiceLevel })}
                            >
                              {'🌶'.repeat(i.spiceLevel)}
                            </span>
                          ) : null}
                          {!i.isAvailable ? (
                            <span className="ml-1 rounded bg-slate-200 px-1.5 text-xs text-slate-600">
                              {t('soldOut')}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Money paise={i.pricePaise} className="font-medium" />
                        {ordering && i.isAvailable ? (
                          <span className="rounded-full bg-brand px-3 py-1 text-xs text-white">
                            {t('add')}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>

      {ordering ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white p-3 shadow-lg">
          <div className="mx-auto max-w-xl space-y-2">
            {notice ? (
              <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {notice}
              </p>
            ) : null}
            <ErrorText error={actionError} />
            <div className="grid grid-cols-4 gap-2 text-xs">
              {(
                [
                  ['CALL_WAITER', Bell],
                  ['WATER', GlassWater],
                  ['CUTLERY', UtensilsCrossed],
                  ['BILL', ReceiptIndianRupee],
                ] as const
              ).map(([type, Icon]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => void act(type)}
                  className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border border-slate-200"
                >
                  <Icon className="size-5" aria-hidden />
                  {t(`actions.${type}`)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" className="flex-1" onClick={() => setOrdersOpen(true)}>
                <ClipboardList className="size-5" aria-hidden />
                {t('myOrders')}
              </Button>
              <Button size="lg" className="flex-[2]" onClick={() => setCartOpen(true)}>
                <ShoppingBag className="size-5" aria-hidden />
                {t('viewCart', { count: cartCount })}
                {s.cart && s.cart.totals.totalPaise ? <Money paise={s.cart.totals.totalPaise} /> : null}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ItemSheet item={item} token={s.token} onClose={() => setItem(null)} />
      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        cart={s.cart}
        token={s.token}
        onPlaced={() => {
          setCartOpen(false);
          setOrdersOpen(true);
        }}
      />
      <OrdersSheet open={ordersOpen} onOpenChange={setOrdersOpen} orders={s.orders} />
    </div>
  );
}
