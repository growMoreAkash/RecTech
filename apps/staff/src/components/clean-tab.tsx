'use client';

import { Button } from '@dinesense/ui/button';
import { useTranslations } from 'next-intl';
import { ErrorText } from './error-text';
import { api } from '@/lib/api';
import { useFloor, useOutletMutation } from '@/lib/queries';

/** Busser queue: tables waiting to be cleaned, oldest first. */
export function CleanTab({ outletId }: { outletId: string }) {
  const t = useTranslations('staffApp.clean');
  const floor = useFloor(outletId);
  const clean = useOutletMutation(outletId, (tableId: string) =>
    api(`/outlets/${outletId}/tables/${tableId}/transitions`, {
      method: 'POST',
      body: { event: 'CLEAN_CONFIRMED' },
    }),
  );
  const dirty = (floor.data?.tables ?? [])
    .filter((x) => x.live.status === 'NEEDS_CLEANING')
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  return (
    <section aria-labelledby="clean-h" className="space-y-3">
      <h1 id="clean-h" className="text-lg font-semibold">
        {t('title')}
      </h1>
      <ErrorText error={floor.error ?? clean.error} />
      {floor.data && !dirty.length ? <p className="py-10 text-center text-slate-500">{t('empty')}</p> : null}
      <ul className="space-y-2">
        {dirty.map((x) => (
          <li
            key={x.id}
            className="flex items-center justify-between rounded-xl border border-red-200 bg-white p-3"
          >
            <span className="text-lg font-semibold">{x.label}</span>
            <Button disabled={clean.isPending} onClick={() => clean.mutate(x.id)}>
              {t('cleaned')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
