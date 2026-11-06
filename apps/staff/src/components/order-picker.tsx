'use client';

import { localized, priceLine } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { cn } from '@dinesense/ui/cn';
import { Money } from '@dinesense/ui/money';
import { VegMark } from '@dinesense/ui/veg-mark';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { api } from '@/lib/api';
import { addLine, type DraftLine, draftTotal, setQuantity, toOrderItems } from '@/lib/order-draft';
import { useMenu, useOutletMutation } from '@/lib/queries';
import type { MenuItem } from '@/lib/types';

/** Waiter takes the order at the table; it goes straight to the kitchen (and counts as the greet). */
export function OrderPicker({
  outletId,
  tableId,
  onDone,
}: {
  outletId: string;
  tableId: string;
  onDone: () => void;
}) {
  const t = useTranslations('staffApp.picker');
  const locale = useLocale();
  const menu = useMenu(outletId);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [item, setItem] = useState<MenuItem | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const send = useOutletMutation(outletId, () =>
    api(`/outlets/${outletId}/tables/${tableId}/orders`, {
      method: 'POST',
      body: { items: toOrderItems(lines) },
    }),
  );

  if (!menu.data) return <div aria-busy="true" />;
  const cat = category ?? menu.data.categories[0]?.id;
  const q = query.trim().toLowerCase();
  const items = menu.data.items.filter((i) =>
    q
      ? localized(i.name, locale).toLowerCase().includes(q) ||
        localized(i.name, 'en').toLowerCase().includes(q)
      : i.categoryId === cat,
  );
  const names = new Map(menu.data.items.map((i) => [i.id, i]));

  const quickAdd = (i: MenuItem) => {
    if (i.modifierGroups.length) return setItem(i);
    setLines((l) =>
      addLine(l, { menuItemId: i.id, modifierIds: [], quantity: 1, unitPricePaise: i.pricePaise }),
    );
  };

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
        className="min-h-11 w-full rounded-lg border border-slate-300 px-3"
      />
      {!q ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {menu.data.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === cat}
              onClick={() => setCategory(c.id)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm',
                c.id === cat ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white',
              )}
            >
              {localized(c.name, locale)}
            </button>
          ))}
        </div>
      ) : null}

      {item ? (
        <Options
          item={item}
          onCancel={() => setItem(null)}
          onAdd={(l) => (setLines((x) => addLine(x, l)), setItem(null))}
        />
      ) : (
        <ul className="max-h-[45dvh] space-y-1 overflow-y-auto">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                disabled={!i.isAvailable}
                onClick={() => quickAdd(i)}
                className="flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <VegMark vegType={i.vegType} size={14} />
                  {localized(i.name, locale)}
                  {!i.isAvailable ? <span className="text-xs text-slate-500">({t('soldOut')})</span> : null}
                </span>
                <Money paise={i.pricePaise} className="text-sm" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="draft-h" className="space-y-2 border-t border-slate-200 pt-3">
        <h3 id="draft-h" className="font-semibold">
          {t('order', { count: lines.reduce((n, l) => n + l.quantity, 0) })}
        </h3>
        <ul className="space-y-1">
          {lines.map((l, i) => (
            <li key={`${l.menuItemId}-${i}`} className="flex items-center justify-between gap-2 text-sm">
              <span>{localized(names.get(l.menuItemId)?.name, locale)}</span>
              <span className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  className="size-9 p-0"
                  aria-label={t('less')}
                  onClick={() => setLines((x) => setQuantity(x, i, l.quantity - 1))}
                >
                  <Minus className="size-4" aria-hidden />
                </Button>
                <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="size-9 p-0"
                  aria-label={t('more')}
                  onClick={() => setLines((x) => setQuantity(x, i, l.quantity + 1))}
                >
                  <Plus className="size-4" aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <ErrorText error={send.error} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            {t('cancel')}
          </Button>
          <Button
            className="flex-1"
            size="lg"
            disabled={!lines.length || send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onDone })}
          >
            {t('send')} · <Money paise={draftTotal(lines)} />
          </Button>
        </div>
      </section>
    </div>
  );
}

function Options({
  item,
  onAdd,
  onCancel,
}: {
  item: MenuItem;
  onAdd: (l: DraftLine) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('staffApp.picker');
  const locale = useLocale();
  const [selected, setSelected] = useState<string[]>(() =>
    item.modifierGroups
      .filter((g) => g.minSelect === 1 && g.maxSelect === 1)
      .flatMap((g) =>
        g.modifiers
          .filter((m) => m.isAvailable)
          .slice(0, 1)
          .map((m) => m.id),
      ),
  );
  const [note, setNote] = useState('');
  const price = priceLine(item, selected);
  const toggle = (groupId: string, id: string, single: boolean) =>
    setSelected((cur) => {
      const inGroup = new Set(item.modifierGroups.find((g) => g.id === groupId)!.modifiers.map((m) => m.id));
      if (single) return [...cur.filter((x) => !inGroup.has(x)), id];
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  return (
    <div className="space-y-3 rounded-xl border border-slate-300 bg-white p-3">
      <p className="font-semibold">{localized(item.name, locale)}</p>
      {item.modifierGroups.map((g) => (
        <fieldset key={g.id} className="space-y-1">
          <legend className="text-sm font-medium">{localized(g.name, locale)}</legend>
          <div className="flex flex-wrap gap-2">
            {g.modifiers.map((m) => (
              <label
                key={m.id}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"
              >
                <input
                  type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                  name={g.id}
                  disabled={!m.isAvailable}
                  checked={selected.includes(m.id)}
                  onChange={() => toggle(g.id, m.id, g.maxSelect === 1)}
                />
                {localized(m.name, locale)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={140}
        placeholder={t('note')}
        aria-label={t('note')}
        className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
      />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          className="flex-1"
          disabled={!price.ok}
          onClick={() =>
            price.ok &&
            onAdd({
              menuItemId: item.id,
              modifierIds: selected,
              quantity: 1,
              unitPricePaise: price.unitPricePaise,
              ...(note.trim() ? { note: note.trim() } : {}),
            })
          }
        >
          {t('add')}
        </Button>
      </div>
    </div>
  );
}
