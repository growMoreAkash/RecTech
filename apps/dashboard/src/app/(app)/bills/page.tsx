'use client';

import { localDate } from '@dinesense/shared';
import { Field, Input } from '@dinesense/ui/field';
import { Money } from '@dinesense/ui/money';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { useDayBills } from '@/lib/queries';
import { useSession } from '@/lib/session';

/** Cash desk: the day's bills with totals by payment method. */
export default function BillsPage() {
  const t = useTranslations('billing');
  const format = useFormatter();
  const { outlet, can } = useSession();
  const [date, setDate] = useState(() => localDate(new Date(), outlet.timezone));
  const bills = useDayBills(outlet.id, date);
  if (!can('OWNER', 'MANAGER', 'CASHIER')) return <p className="p-4 text-slate-600">{t('cashDeskOnly')}</p>;

  const paid = (bills.data ?? []).filter((b) => b.status !== 'VOID');
  const byMethod = new Map<string, number>();
  for (const b of paid)
    for (const p of b.payments)
      if (p.status === 'CAPTURED') byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountPaise);
  const collected = [...byMethod.values()].reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="mr-auto text-xl font-semibold">{t('dayTitle')}</h1>
        <Field label={t('date')}>
          {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
      </div>
      <ErrorText error={bills.error} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label={t('collected')} paise={collected} />
        {[...byMethod.entries()].map(([m, v]) => (
          <Stat key={m} label={t(`methods.${m}` as 'methods.CASH')} paise={v} />
        ))}
      </dl>
      <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-600">
          <tr>
            <th className="p-2">{t('invoice')}</th>
            <th className="p-2">{t('time')}</th>
            <th className="p-2">{t('statusLabel')}</th>
            <th className="p-2 text-right">{t('total')}</th>
            <th className="p-2 text-right">{t('due')}</th>
          </tr>
        </thead>
        <tbody>
          {bills.data?.map((b) => (
            <tr key={b.id} className="border-t border-slate-100">
              <td className="p-2">
                <a href={b.invoiceUrl} target="_blank" rel="noopener" className="text-brand underline">
                  {b.invoiceNumber ?? t('draft')}
                </a>
              </td>
              <td className="p-2">
                {format.dateTime(new Date(b.createdAt), { hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="p-2">{t(`status.${b.status}`)}</td>
              <td className="p-2 text-right">
                <Money paise={b.totalPaise} />
              </td>
              <td className="p-2 text-right">{b.status === 'VOID' ? '—' : <Money paise={b.duePaise} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bills.data && !bills.data.length ? <p className="text-slate-500">{t('none')}</p> : null}
    </div>
  );
}

function Stat({ label, paise }: { label: string; paise: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold">
        <Money paise={paise} />
      </dd>
    </div>
  );
}
