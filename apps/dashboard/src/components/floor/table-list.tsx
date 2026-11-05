'use client';

import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/ui/badge';
import { elapsedSince, formatDuration, slaLevel } from '@/lib/floor-style';
import type { FloorTable, Section } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Keyboard- and screen-reader-accessible equivalent of the canvas map. */
export function TableList({
  tables,
  sections,
  greetSlaSeconds,
  now,
  selectedId,
  onSelect,
}: {
  tables: FloorTable[];
  sections: Section[];
  greetSlaSeconds: number;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('floor');
  return (
    <div className="space-y-4">
      {sections.map((s) => {
        const rows = tables.filter((x) => x.sectionId === s.id);
        if (!rows.length) return null;
        return (
          <section key={s.id} aria-labelledby={`sec-${s.id}`}>
            <h2
              id={`sec-${s.id}`}
              className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700"
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: s.color ?? '#64748b' }}
                aria-hidden
              />
              {s.name}
            </h2>
            <ul className="space-y-1">
              {rows.map((x) => {
                const seating = x.live.seating;
                const level = slaLevel(
                  x.live.status,
                  seating?.seatedAt ?? null,
                  seating?.greetedAt ?? null,
                  greetSlaSeconds,
                  now,
                );
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(x.id)}
                      aria-pressed={x.id === selectedId}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm hover:bg-slate-50',
                        x.id === selectedId ? 'border-slate-900' : 'border-slate-200',
                        level === 'breach' && 'border-red-500 bg-red-50',
                        level === 'warn' && 'border-amber-500 bg-amber-50',
                      )}
                    >
                      <span className="font-semibold">{x.label}</span>
                      <span className="flex items-center gap-2">
                        {seating ? (
                          <span className="text-xs text-slate-600">
                            {seating.partySize ? t('guests', { count: seating.partySize }) : ''}{' '}
                            {formatDuration(elapsedSince(seating.seatedAt, now))}
                          </span>
                        ) : null}
                        <StatusBadge status={x.live.status} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
