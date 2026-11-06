'use client';

import type { Role } from '@dinesense/shared';
import { cn } from '@dinesense/ui/cn';
import { Brush, ClipboardList, LayoutGrid, LogOut, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { CleanTab } from './clean-tab';
import { LocaleToggle } from './locale-toggle';
import { ShiftTab } from './shift-tab';
import { TablesTab } from './tables-tab';
import { TasksTab } from './tasks-tab';
import { logout } from '@/lib/api';
import { useLive } from '@/lib/live';
import { syncPush } from '@/lib/push';
import { useTasks } from '@/lib/queries';
import type { Me } from '@/lib/types';

type Tab = 'tasks' | 'tables' | 'clean' | 'shift';

const TABS: { id: Tab; roles: Role[]; icon: typeof ClipboardList }[] = [
  { id: 'tasks', roles: ['WAITER', 'BUSSER', 'MANAGER', 'OWNER', 'CASHIER'], icon: ClipboardList },
  { id: 'tables', roles: ['WAITER', 'HOST', 'MANAGER', 'OWNER', 'CASHIER'], icon: LayoutGrid },
  { id: 'clean', roles: ['BUSSER', 'MANAGER', 'OWNER', 'HOST'], icon: Brush },
  {
    id: 'shift',
    roles: ['OWNER', 'MANAGER', 'HOST', 'WAITER', 'BUSSER', 'CHEF', 'CASHIER'],
    icon: UserRound,
  },
];

export function Shell({ me, outletId, onSignOut }: { me: Me; outletId: string; onSignOut: () => void }) {
  const t = useTranslations('staffApp');
  const roles = me.outlets[outletId] ?? [];
  const tabs = TABS.filter((x) => x.roles.some((r) => roles.includes(r)));
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'shift');
  const connected = useLive(outletId);
  const tasks = useTasks(outletId);
  const openTasks = tasks.data?.length ?? 0;

  // A shared terminal keeps one browser push subscription; point it at whoever is signed in.
  useEffect(() => {
    void syncPush();
  }, [me.id]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{me.name}</p>
          <p className={cn('text-xs', connected ? 'text-emerald-700' : 'text-amber-700')} role="status">
            {connected ? t('live') : t('reconnecting')}
          </p>
        </div>
        <LocaleToggle />
        <button
          type="button"
          onClick={() => void logout().then(onSignOut)}
          className="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm hover:bg-slate-100"
        >
          <LogOut className="size-4" aria-hidden />
          {t('switchUser')}
        </button>
      </header>
      <main className="flex-1 p-4 pb-24">
        {tab === 'tasks' ? <TasksTab outletId={outletId} me={me} roles={roles} /> : null}
        {tab === 'tables' ? <TablesTab outletId={outletId} me={me} roles={roles} /> : null}
        {tab === 'clean' ? <CleanTab outletId={outletId} /> : null}
        {tab === 'shift' ? <ShiftTab outletId={outletId} me={me} /> : null}
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white" aria-label={t('nav')}>
        <ul className="mx-auto flex max-w-xl">
          {tabs.map(({ id, icon: Icon }) => (
            <li key={id} className="flex-1">
              <button
                type="button"
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}
                className={cn(
                  'relative flex min-h-16 w-full flex-col items-center justify-center gap-1 text-xs',
                  tab === id ? 'text-brand' : 'text-slate-600',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {t(`tabs.${id}`)}
                {id === 'tasks' && openTasks ? (
                  <span className="absolute right-1/4 top-2 rounded-full bg-red-600 px-1.5 text-[10px] text-white">
                    {openTasks}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
