'use client';

import { MAX_SPLIT_SHARES, type BillSplitInput } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { Input } from '@dinesense/ui/field';
import { Money } from '@dinesense/ui/money';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { rupeesToPaise } from '@/lib/money-input';
import { useOutletMutation } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { Bill, BillShare } from '@/lib/types';
import { cn } from '@/lib/utils';

type Mode = BillSplitInput['mode'];
const MAX_PEOPLE = 8;

export const shareName = (
  t: (k: string, v?: Record<string, string | number>) => string,
  s: BillShare,
  i: number,
) => s.label || t('split.share', { n: i + 1 });

/** Split a bill between guests: equally, by item (shared dishes divided), or custom amounts. */
export function SplitPanel({ bill }: { bill: Bill }) {
  const t = useTranslations('billing');
  const { outlet } = useSession();
  const [editing, setEditing] = useState(false);
  const base = `/outlets/${outlet.id}/bills/${bill.id}/split`;
  const clear = useOutletMutation(outlet.id, () => api(base, { method: 'DELETE' }));
  const anyPaid = bill.payments.some((p) => p.status === 'CAPTURED');
  const canChange = !anyPaid && (bill.status === 'OPEN' || bill.status === 'FINALIZED');

  return (
    <section aria-label={t('split.title')} className="space-y-2 rounded-md bg-slate-50 p-2">
      {bill.split ? (
        <>
          <p className="text-xs font-medium text-slate-600">{t(`split.modes.${bill.split.mode}`)}</p>
          <ul className="space-y-1">
            {bill.split.shares.map((s, i) => (
              <li key={s.key} className="flex items-center justify-between gap-2">
                <span>{shareName(t, s, i)}</span>
                <span className="flex items-center gap-2">
                  <Money paise={s.amountPaise} />
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      s.duePaise ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800',
                    )}
                  >
                    {s.duePaise ? t('split.due', { amount: (s.duePaise / 100).toFixed(2) }) : t('split.paid')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {canChange && !editing ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {bill.split ? t('split.change') : t('split.start')}
          </Button>
          {bill.split ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => clear.mutate(undefined)}
              disabled={clear.isPending}
            >
              {t('split.remove')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing ? <SplitEditor bill={bill} onDone={() => setEditing(false)} /> : null}
      <ErrorText error={clear.error} />
    </section>
  );
}

function SplitEditor({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const t = useTranslations('billing');
  const { outlet } = useSession();
  const [mode, setMode] = useState<Mode>('EQUAL');
  const [ways, setWays] = useState(2);
  const [people, setPeople] = useState<string[]>(['', '']);
  const [amounts, setAmounts] = useState<string[]>(['', '']);
  // lineId → set of person indexes
  const [assign, setAssign] = useState<Record<string, number[]>>({});
  const save = useOutletMutation(outlet.id, (body: BillSplitInput) =>
    api(`/outlets/${outlet.id}/bills/${bill.id}/split`, { method: 'PUT', body }),
  );

  const setCount = (n: number) => {
    const k = Math.max(2, Math.min(MAX_PEOPLE, n));
    setPeople((p) => Array.from({ length: k }, (_, i) => p[i] ?? ''));
    setAmounts((a) => Array.from({ length: k }, (_, i) => a[i] ?? ''));
    setAssign((a) => Object.fromEntries(Object.entries(a).map(([l, w]) => [l, w.filter((x) => x < k)])));
  };
  const toggle = (lineId: string, person: number) =>
    setAssign((a) => {
      const cur = a[lineId] ?? [];
      return { ...a, [lineId]: cur.includes(person) ? cur.filter((x) => x !== person) : [...cur, person] };
    });

  const customPaise = amounts.map((a) => rupeesToPaise(a) ?? 0);
  const left = bill.totalPaise - customPaise.reduce((s, x) => s + x, 0);
  const unassigned = bill.lines.filter((l) => !assign[l.id]?.length).length;

  const body = (): BillSplitInput | null => {
    if (mode === 'EQUAL') return { mode, ways };
    if (mode === 'CUSTOM') {
      if (left !== 0 || customPaise.some((x) => x <= 0)) return null;
      return {
        mode,
        shares: customPaise.map((amountPaise, i) => ({
          amountPaise,
          ...(people[i]?.trim() ? { label: people[i].trim() } : {}),
        })),
      };
    }
    if (unassigned) return null;
    const shares = people.map((name, i) => ({
      ...(name.trim() ? { label: name.trim() } : {}),
      lineIds: bill.lines.filter((l) => assign[l.id]?.includes(i)).map((l) => l.id),
    }));
    return shares.every((s) => s.lineIds.length) ? { mode, shares } : null;
  };
  const ready = body();

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t('split.title')}</legend>
      <div role="radiogroup" aria-label={t('split.mode')} className="flex flex-wrap gap-1">
        {(['EQUAL', 'BY_ITEM', 'CUSTOM'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'rounded-md border px-3 py-1 text-xs',
              mode === m ? 'border-brand bg-orange-50 text-brand' : 'border-slate-300 bg-white',
            )}
          >
            {t(`split.modes.${m}`)}
          </button>
        ))}
      </div>

      {mode === 'EQUAL' ? (
        <label className="flex items-center gap-2">
          {t('split.ways')}
          <Input
            type="number"
            min={2}
            max={MAX_SPLIT_SHARES}
            value={ways}
            onChange={(e) => setWays(Math.max(2, Math.min(MAX_SPLIT_SHARES, Number(e.target.value) || 2)))}
            className="w-20"
          />
          <span className="text-xs text-slate-500">
            ≈ <Money paise={Math.floor(bill.totalPaise / ways)} />
          </span>
        </label>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            {t('split.people')}
            <Input
              type="number"
              min={2}
              max={MAX_PEOPLE}
              value={people.length}
              onChange={(e) => setCount(Number(e.target.value) || 2)}
              className="w-20"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {people.map((p, i) => (
              <div key={i} className="flex gap-1">
                <Input
                  aria-label={t('split.name', { n: i + 1 })}
                  placeholder={t('split.share', { n: i + 1 })}
                  value={p}
                  maxLength={30}
                  onChange={(e) => setPeople((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
                />
                {mode === 'CUSTOM' ? (
                  <Input
                    aria-label={t('split.amountFor', { n: i + 1 })}
                    inputMode="decimal"
                    placeholder="₹"
                    value={amounts[i]}
                    onChange={(e) => setAmounts((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
                    className="w-24"
                  />
                ) : null}
              </div>
            ))}
          </div>
          {mode === 'CUSTOM' ? (
            <p className={cn('text-xs', left ? 'text-amber-700' : 'text-emerald-700')} aria-live="polite">
              {left ? t('split.left', { amount: (left / 100).toFixed(2) }) : t('split.balanced')}
            </p>
          ) : (
            <table className="w-full text-xs">
              <caption className="sr-only">{t('split.byItemHint')}</caption>
              <thead>
                <tr>
                  <th className="text-left font-medium">{t('split.item')}</th>
                  {people.map((p, i) => (
                    <th key={i} scope="col" className="px-1 font-medium">
                      {p.trim() || i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-200">
                    <th scope="row" className="py-1 text-left font-normal">
                      {l.quantity} × {l.description}
                    </th>
                    {people.map((p, i) => (
                      <td key={i} className="text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          aria-label={t('split.assign', { item: l.description, person: p.trim() || i + 1 })}
                          checked={assign[l.id]?.includes(i) ?? false}
                          onChange={() => toggle(l.id, i)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {mode === 'BY_ITEM' && unassigned ? (
            <p className="text-xs text-amber-700">{t('split.unassigned', { count: unassigned })}</p>
          ) : null}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!ready || save.isPending}
          onClick={() => ready && save.mutate(ready, { onSuccess: onDone })}
        >
          {t('split.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('split.cancel')}
        </Button>
      </div>
      {bill.status === 'OPEN' ? <p className="text-xs text-slate-500">{t('split.finalises')}</p> : null}
      <ErrorText error={save.error} />
    </fieldset>
  );
}
