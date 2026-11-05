'use client';

import type { Role } from '@dinesense/shared';
import { Button } from '@dinesense/ui/button';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { TableSheet } from './table-sheet';
import { api } from '@/lib/api';
import { useFloor, useOutletMutation, useTasks } from '@/lib/queries';
import { sortTasks, taskAction } from '@/lib/task-actions';
import type { Me, Task } from '@/lib/types';

export function TasksTab({ outletId, me, roles }: { outletId: string; me: Me; roles: Role[] }) {
  const t = useTranslations('staffApp.tasks');
  const format = useFormatter();
  const tasks = useTasks(outletId);
  const floor = useFloor(outletId);
  const [openTable, setOpenTable] = useState<string | null>(null);

  const act = useOutletMutation(outletId, async (task: Task) => {
    const a = taskAction(task.type);
    if (task.status === 'OPEN' && !task.mine)
      await api(`/outlets/${outletId}/tasks/${task.id}/accept`, { method: 'POST' });
    if (a === 'done') return api(`/outlets/${outletId}/tasks/${task.id}/done`, { method: 'POST' });
    if (a === 'greet')
      return api(`/outlets/${outletId}/tables/${task.tableId}/transitions`, {
        method: 'POST',
        body: { event: 'GREET' },
      });
    if (a === 'clean')
      return api(`/outlets/${outletId}/tables/${task.tableId}/transitions`, {
        method: 'POST',
        body: { event: 'CLEAN_CONFIRMED' },
      });
    return undefined;
  });
  const accept = useOutletMutation(outletId, (task: Task) =>
    api(`/outlets/${outletId}/tasks/${task.id}/accept`, { method: 'POST' }),
  );

  const list = sortTasks(tasks.data ?? []);
  const table = floor.data?.tables.find((x) => x.id === openTable) ?? null;

  return (
    <section aria-labelledby="tasks-h" className="space-y-3">
      <h1 id="tasks-h" className="text-lg font-semibold">
        {t('title')}
      </h1>
      <ErrorText error={tasks.error ?? act.error ?? accept.error} />
      {tasks.data && !list.length ? <p className="py-10 text-center text-slate-500">{t('empty')}</p> : null}
      <ul className="space-y-2">
        {list.map((task) => {
          const a = taskAction(task.type);
          return (
            <li key={task.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{t(`type.${task.type}`, { table: task.tableLabel ?? '—' })}</p>
                  <p className="text-xs text-slate-500">
                    {format.relativeTime(new Date(task.createdAt))} ·{' '}
                    {task.mine ? t('yours') : task.assigneeId ? t('taken') : t('unassigned')}
                  </p>
                </div>
                {task.status === 'OPEN' && !task.mine && a === 'openTable' ? (
                  <Button size="sm" variant="secondary" onClick={() => accept.mutate(task)}>
                    {t('accept')}
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 flex gap-2">
                {a === 'openTable' ? (
                  <Button
                    className="flex-1"
                    onClick={() => setOpenTable(task.tableId)}
                    disabled={!task.tableId}
                  >
                    {t('openTable')}
                  </Button>
                ) : (
                  <Button className="flex-1" disabled={act.isPending} onClick={() => act.mutate(task)}>
                    {t(`action.${a}`)}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <TableSheet
        table={table}
        outletId={outletId}
        me={me}
        roles={roles}
        onClose={() => setOpenTable(null)}
      />
    </section>
  );
}
