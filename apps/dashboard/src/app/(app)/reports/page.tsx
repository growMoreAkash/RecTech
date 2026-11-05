'use client';

import { localDate } from '@dinesense/shared';
import { Field, Input } from '@dinesense/ui/field';
import { Money } from '@dinesense/ui/money';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { hourSeries, minSec } from '@/lib/report-chart';
import { useSession } from '@/lib/session';
import type { DayReport } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function ReportsPage() {
  const t = useTranslations('reports');
  const { outlet, can } = useSession();
  const [date, setDate] = useState(() => localDate(new Date(), outlet.timezone));
  const report = useQuery({
    queryKey: [...qk.outlet(outlet.id), 'reports', date],
    queryFn: () => api<DayReport>(`/outlets/${outlet.id}/reports/day?date=${date}`),
    enabled: can('OWNER', 'MANAGER'),
  });
  if (!can('OWNER', 'MANAGER')) return <p className="p-4 text-sm text-slate-600">{t('managersOnly')}</p>;
  const r = report.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Field label={t('date')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          )}
        </Field>
      </div>
      <ErrorText error={report.error} />
      {r ? (
        <>
          <section aria-labelledby="h-floor" className="space-y-2">
            <h2 id="h-floor" className="font-semibold">
              {t('floor')}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile
                label={t('seatings')}
                value={String(r.seatings.total)}
                sub={t('covers', { count: r.seatings.covers })}
              />
              <Tile
                label={t('avgGreet')}
                value={minSec(r.seatings.avgSeatToGreetSeconds)}
                sub={t('median', { value: minSec(r.seatings.medianSeatToGreetSeconds) })}
              />
              <Tile
                label={t('withinSla', { minutes: Math.round(r.greetSlaSeconds / 60) })}
                value={r.seatings.greetedWithinSlaPct === null ? '—' : `${r.seatings.greetedWithinSlaPct}%`}
                sub={t('greeted', { count: r.seatings.greeted })}
              />
              <Tile
                label={t('breaches')}
                value={String(r.seatings.slaBreaches)}
                sub={t('escalations', { count: r.seatings.escalations })}
                warn={r.seatings.slaBreaches > 0}
              />
            </div>
            {r.seatings.leftWithoutPaying ? (
              <p role="status" className="text-sm text-red-700">
                ⚠ {t('lwp', { count: r.seatings.leftWithoutPaying })}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="h-waiters" className="space-y-2">
            <h2 id="h-waiters" className="font-semibold">
              {t('waiters')}
            </h2>
            {r.waiters.length ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr>
                      <th className="p-2 font-medium">{t('waiter')}</th>
                      <th className="p-2 text-right font-medium">{t('greets')}</th>
                      <th className="p-2 text-right font-medium">{t('assignments')}</th>
                      <th className="p-2 text-right font-medium">{t('acknowledged')}</th>
                      <th className="p-2 text-right font-medium">{t('missed')}</th>
                      <th className="p-2 text-right font-medium">{t('avgAck')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.waiters.map((w) => (
                      <tr key={w.waiterId}>
                        <th scope="row" className="p-2 text-left font-normal">
                          {w.name}
                        </th>
                        <td className="p-2 text-right tabular-nums">{w.greets}</td>
                        <td className="p-2 text-right tabular-nums">{w.assignments}</td>
                        <td className="p-2 text-right tabular-nums">{w.acknowledged}</td>
                        <td
                          className={cn(
                            'p-2 text-right tabular-nums',
                            w.missed && 'font-semibold text-red-700',
                          )}
                        >
                          {w.missed}
                        </td>
                        <td className="p-2 text-right tabular-nums">{minSec(w.avgAckSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t('noWaiters')}</p>
            )}
          </section>

          <section aria-labelledby="h-sales" className="space-y-2">
            <h2 id="h-sales" className="font-semibold">
              {t('sales')}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile
                label={t('salesTotal')}
                value={<Money paise={r.sales.totalPaise} />}
                sub={t('bills', { count: r.sales.bills })}
              />
              <Tile
                label={t('avgBill')}
                value={r.sales.avgBillPaise === null ? '—' : <Money paise={r.sales.avgBillPaise} />}
              />
            </div>
            <SalesByHour rows={r.salesByHour} />
            {r.payments.length ? (
              <table className="w-full max-w-md text-sm">
                <caption className="text-left text-xs font-medium text-slate-600">{t('byMethod')}</caption>
                <tbody className="divide-y divide-slate-100">
                  {r.payments.map((p) => (
                    <tr key={p.method}>
                      <th scope="row" className="py-1 text-left font-normal">
                        {t(`methods.${p.method}`)}
                      </th>
                      <td className="py-1 text-right text-slate-500 tabular-nums">{p.count}</td>
                      <td className="py-1 text-right tabular-nums">
                        <Money paise={p.amountPaise} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-600">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums', warn ? 'text-red-700' : 'text-slate-900')}>
        {value}
      </p>
      {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

/** One series (invoiced sales per local hour): single hue, no legend, hover tooltip, table equivalent. */
function SalesByHour({ rows }: { rows: DayReport['salesByHour'] }) {
  const t = useTranslations('reports');
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const series = hourSeries(rows);
  if (!series.length) return <p className="text-sm text-slate-500">{t('noSales')}</p>;
  const max = Math.max(...series.map((s) => s.totalPaise), 1);
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

  return (
    <figure className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <figcaption className="flex items-center justify-between text-sm">
        <span className="font-medium">{t('byHour')}</span>
        <button type="button" className="text-xs text-brand underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('showChart') : t('showTable')}
        </button>
      </figcaption>
      {asTable ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-600">
            <tr>
              <th className="py-1 font-medium">{t('hour')}</th>
              <th className="py-1 text-right font-medium">{t('billsCol')}</th>
              <th className="py-1 text-right font-medium">{t('salesTotal')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {series.map((s) => (
              <tr key={s.hour}>
                <th scope="row" className="py-1 text-left font-normal">
                  {hourLabel(s.hour)}
                </th>
                <td className="py-1 text-right tabular-nums">{s.bills}</td>
                <td className="py-1 text-right tabular-nums">
                  <Money paise={s.totalPaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          {/* recessive guide at the max value */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-200"
            aria-hidden
          />
          <ol className="flex h-44 items-end gap-0.5" aria-label={t('byHour')}>
            {series.map((s) => {
              const pct = (s.totalPaise / max) * 100;
              const active = hover === s.hour;
              return (
                <li
                  key={s.hour}
                  className="relative flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(s.hour)}
                  onFocus={() => setHover(s.hour)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${hourLabel(s.hour)}: ${t('billsCount', { count: s.bills })}, ₹${(s.totalPaise / 100).toFixed(2)}`}
                >
                  <div
                    className={cn('mx-auto w-full max-w-12 rounded-t', active ? 'bg-orange-800' : 'bg-brand')}
                    style={{ height: `${Math.max(pct, s.totalPaise ? 1.5 : 0)}%` }}
                  />
                  {active ? (
                    <div className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow">
                      <span className="block font-medium">{hourLabel(s.hour)}</span>
                      <Money paise={s.totalPaise} /> · {t('billsCount', { count: s.bills })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div
            className="mt-1 flex gap-0.5 border-t border-slate-300 pt-1 text-[10px] text-slate-500"
            aria-hidden
          >
            {series.map((s, i) => (
              <span key={s.hour} className="flex-1 text-center">
                {i % Math.ceil(series.length / 8) === 0 ? String(s.hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}
