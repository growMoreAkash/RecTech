'use client';

import { isSeated, type Role } from '@dinesense/shared';
import { cn } from '@dinesense/ui/cn';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { StatusChip } from './status-chip';
import { TableSheet } from './table-sheet';
import { useFloor } from '@/lib/queries';
import type { Me } from '@/lib/types';

/** My tables first (I'm the serving waiter), then every other table by section. */
export function TablesTab({ outletId, me, roles }: { outletId: string; me: Me; roles: Role[] }) {
  const t = useTranslations('staffApp.tables');
  const floor = useFloor(outletId);
  const [selected, setSelected] = useState<string | null>(null);
  const tables = floor.data?.tables ?? [];
  const mine = tables.filter((x) => x.live.seating?.servingWaiter?.id === me.id);
  const table = tables.find((x) => x.id === selected) ?? null;

  const row = (x: (typeof tables)[number]) => (
    <li key={x.id}>
      <button
        type="button"
        onClick={() => setSelected(x.id)}
        className={cn(
          'flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 text-left',
          isSeated(x.live.status) ? 'border-slate-300' : 'border-slate-200',
        )}
      >
        <span className="font-semibold">{x.label}</span>
        <span className="flex items-center gap-2 text-xs text-slate-600">
          {x.live.seating?.partySize ? t('guests', { count: x.live.seating.partySize }) : null}
          <StatusChip status={x.live.status} />
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-5">
      <ErrorText error={floor.error} />
      <section aria-labelledby="mine-h" className="space-y-2">
        <h1 id="mine-h" className="text-lg font-semibold">
          {t('mine')}
        </h1>
        {mine.length ? (
          <ul className="space-y-2">{mine.map(row)}</ul>
        ) : (
          <p className="text-sm text-slate-500">{t('noneMine')}</p>
        )}
      </section>
      {floor.data?.sections.map((s) => {
        const rows = tables.filter((x) => x.sectionId === s.id);
        return rows.length ? (
          <section key={s.id} aria-labelledby={`s-${s.id}`} className="space-y-2">
            <h2 id={`s-${s.id}`} className="text-sm font-semibold text-slate-700">
              {s.name}
            </h2>
            <ul className="grid grid-cols-2 gap-2">{rows.map(row)}</ul>
          </section>
        ) : null;
      })}
      <TableSheet table={table} outletId={outletId} me={me} roles={roles} onClose={() => setSelected(null)} />
    </div>
  );
}
