'use client';

import { localized, priceLine } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Money } from '@dinesense/ui/money';
import { Sheet } from '@dinesense/ui/sheet';
import { VegMark } from '@dinesense/ui/veg-mark';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { guestApi } from '@/lib/api';
import type { MenuItem } from '@/lib/types';

/** Item detail with options. Price and option rules come from the same `priceLine` the API enforces. */
export function ItemSheet({
  item,
  token,
  onClose,
}: {
  item: MenuItem | null;
  token: string | null;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={item ? localized(item.name, locale) : ''}
    >
      {item ? <ItemBody key={item.id} item={item} token={token} onDone={onClose} /> : null}
    </Sheet>
  );
}

function ItemBody({ item, token, onDone }: { item: MenuItem; token: string | null; onDone: () => void }) {
  const t = useTranslations('guest');
  const locale = useLocale();
  // Pre-select the first option of required single-choice groups (e.g. "Full").
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
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const price = priceLine(item, selected);
  const description = localized(item.description, locale);

  const toggle = (groupId: string, modId: string, single: boolean) =>
    setSelected((cur) => {
      const group = item.modifierGroups.find((g) => g.id === groupId)!;
      const inGroup = new Set(group.modifiers.map((m) => m.id));
      if (single) return [...cur.filter((id) => !inGroup.has(id)), modId];
      return cur.includes(modId) ? cur.filter((id) => id !== modId) : [...cur, modId];
    });

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await guestApi('/cart/lines', {
        method: 'POST',
        token,
        body: {
          menuItemId: item.id,
          quantity: qty,
          modifierIds: selected,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <VegMark vegType={item.vegType} />
        <div className="space-y-1 text-sm text-slate-600">
          {description ? <p>{description}</p> : null}
          {item.spiceLevel ? <p>{t('spice', { level: item.spiceLevel })}</p> : null}
          {item.allergens.length ? (
            <p>
              {t('contains', {
                list: item.allergens.map((a) => t(`allergens.${a}` as 'allergens.dairy')).join(', '),
              })}
            </p>
          ) : null}
        </div>
      </div>

      {item.modifierGroups.map((g) => {
        const single = g.maxSelect === 1;
        return (
          <fieldset key={g.id} className="space-y-2">
            <legend className="font-medium">
              {localized(g.name, locale)}{' '}
              <span className="text-xs font-normal text-slate-500">
                {g.minSelect > 0 ? t('required') : t('optionalUpTo', { n: g.maxSelect })}
              </span>
            </legend>
            {g.modifiers.map((mod) => (
              <label
                key={mod.id}
                className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 ${mod.isAvailable ? 'border-slate-200' : 'border-slate-100 text-slate-400'}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type={single ? 'radio' : 'checkbox'}
                    name={g.id}
                    disabled={!mod.isAvailable}
                    checked={selected.includes(mod.id)}
                    onChange={() => toggle(g.id, mod.id, single)}
                    className="size-4"
                  />
                  {localized(mod.name, locale)}
                </span>
                {mod.priceDeltaPaise ? (
                  <span className="text-sm text-slate-600">
                    {mod.priceDeltaPaise > 0 ? '+' : '−'}
                    <Money paise={Math.abs(mod.priceDeltaPaise)} />
                  </span>
                ) : null}
              </label>
            ))}
          </fieldset>
        );
      })}

      <label className="block space-y-1">
        <span className="font-medium">{t('noteLabel')}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={140}
          placeholder={t('notePlaceholder')}
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3"
        />
      </label>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3" role="group" aria-label={t('quantity')}>
          <Button
            variant="secondary"
            size="sm"
            className="size-11 p-0"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            aria-label={t('less')}
          >
            <Minus className="size-4" aria-hidden />
          </Button>
          <span className="w-6 text-center text-lg tabular-nums" aria-live="polite">
            {qty}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="size-11 p-0"
            onClick={() => setQty((q) => Math.min(50, q + 1))}
            aria-label={t('more')}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
        {price.ok ? <Money paise={price.unitPricePaise * qty} className="text-lg font-semibold" /> : null}
      </div>

      {!price.ok ? <p className="text-sm text-amber-700">{t('chooseOptions')}</p> : null}
      <ErrorText error={error} />
      <Button size="lg" className="w-full" disabled={!price.ok || busy || !token} onClick={() => void add()}>
        {t('addToOrder')}
      </Button>
    </div>
  );
}
