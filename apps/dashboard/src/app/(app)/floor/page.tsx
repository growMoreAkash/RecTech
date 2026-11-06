'use client';

import { SEATED_STATUSES, type TableStatus } from '@dinesense/shared';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { TableDrawer } from '@/components/floor/table-drawer';
import { PendingOrders } from '@/components/floor/orders-panel';
import { TableList } from '@/components/floor/table-list';
import { StatusBadge } from '@/components/ui/badge';
import { useFloor, usePendingOrders } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useNow } from '@/lib/utils';

// Konva needs the browser canvas.
const FloorCanvas = dynamic(() => import('@/components/floor/floor-canvas'), {
  ssr: false,
  // Hold the grid cell while the canvas bundle loads so the layout doesn't jump.
  loading: () => <div className="h-[28rem] rounded-lg border border-slate-200 bg-white" aria-busy="true" />,
});

const SEATED = new Set<TableStatus>(SEATED_STATUSES);

export default function FloorPage() {
  const t = useTranslations('floor');
  const { outlet, can } = useSession();
  const floor = useFloor(outlet.id);
  const pending = usePendingOrders(outlet.id, can('OWNER', 'MANAGER', 'WAITER', 'HOST'));
  const now = useNow(1000);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (floor.error)
    return (
      <div className="p-4">
        <ErrorText error={floor.error} />
      </div>
    );
  if (!floor.data) return <div className="p-4 text-slate-500" aria-busy="true" />;

  const { tables, sections, greetSlaSeconds } = floor.data;
  const selected = tables.find((x) => x.id === selectedId) ?? null;
  const counts = tables.reduce<Partial<Record<TableStatus, number>>>(
    (m, x) => ({ ...m, [x.live.status]: (m[x.live.status] ?? 0) + 1 }),
    {},
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-slate-600">
          {t('summary', {
            occupied: tables.filter((x) => SEATED.has(x.live.status)).length,
            total: tables.length,
          })}
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Legend">
          {(Object.keys(counts) as TableStatus[]).map((s) => (
            <li key={s} className="flex items-center gap-1 text-xs">
              <StatusBadge status={s} /> <span className="tabular-nums">{counts[s]}</span>
            </li>
          ))}
        </ul>
      </div>
      {tables.length === 0 ? (
        <p className="text-slate-500">{t('noTables')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <FloorCanvas
            tables={tables}
            sections={sections}
            greetSlaSeconds={greetSlaSeconds}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
            labels={{ seats: (n) => t('seats', { count: n }), guests: (n) => t('guests', { count: n }) }}
          />
          <div className="space-y-4">
            <PendingOrders orders={pending.data ?? []} />
            <TableList
              tables={tables}
              sections={sections}
              greetSlaSeconds={greetSlaSeconds}
              now={now}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>
      )}
      <TableDrawer table={selected} floor={floor.data} onClose={() => setSelectedId(null)} />
    </div>
  );
}
