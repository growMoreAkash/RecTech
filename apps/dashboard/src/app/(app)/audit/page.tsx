'use client';

import { Button } from '@dinesense/ui/button';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { diffSnapshots, show } from '@/lib/audit-diff';
import { useAuditPage, useStaff } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { AuditEntry } from '@/lib/types';

/** Who changed what, when — newest first, with field-level before/after. */
export default function AuditPage() {
  const t = useTranslations('audit');
  const { outlet, can } = useSession();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const page = useAuditPage(outlet.id, cursors.at(-1) ?? null);
  const staff = useStaff(outlet.id, can('OWNER', 'MANAGER'));
  const names = new Map(staff.data?.map((s) => [s.id, s.name]));
  if (!can('OWNER', 'MANAGER')) return <p className="p-4 text-slate-600">{t('managersOnly')}</p>;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorText error={page.error} />
      <ol className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {page.data?.items.map((e) => (
          <Entry
            key={e.id}
            entry={e}
            actor={
              e.actorId
                ? (names.get(e.actorId) ?? t(`actorType.${e.actorType}` as 'actorType.USER'))
                : t(`actorType.${e.actorType}` as 'actorType.SYSTEM')
            }
          />
        ))}
      </ol>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={cursors.length < 2}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          {t('newer')}
        </Button>
        <Button
          variant="secondary"
          disabled={!page.data?.nextCursor}
          onClick={() => setCursors((c) => [...c, page.data!.nextCursor])}
        >
          {t('older')}
        </Button>
      </div>
    </div>
  );
}

function Entry({ entry, actor }: { entry: AuditEntry; actor: string }) {
  const t = useTranslations('audit');
  const format = useFormatter();
  const changes = diffSnapshots(entry.before, entry.after);
  return (
    <li className="p-3 text-sm">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3">
          <time className="w-36 shrink-0 tabular-nums text-slate-500" dateTime={entry.createdAt}>
            {format.dateTime(new Date(entry.createdAt), { dateStyle: 'short', timeStyle: 'medium' })}
          </time>
          <span className="font-medium">{actor}</span>
          <code className="rounded bg-slate-100 px-1.5 text-xs">{entry.action}</code>
          <span className="text-xs text-slate-500">
            {entry.entityType} · {entry.entityId.slice(-8)}
          </span>
        </summary>
        {changes.length ? (
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 pr-2">{t('field')}</th>
                <th className="py-1 pr-2">{t('before')}</th>
                <th className="py-1">{t('after')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.key} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-2 font-mono">{c.key || '—'}</td>
                  <td className="max-w-xs break-all py-1 pr-2 text-red-700">{show(c.before)}</td>
                  <td className="max-w-xs break-all py-1 text-emerald-700">{show(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-xs text-slate-500">{t('noDetails')}</p>
        )}
      </details>
    </li>
  );
}
