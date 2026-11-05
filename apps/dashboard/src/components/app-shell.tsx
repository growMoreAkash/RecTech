'use client';

import {
  Bell,
  ChefHat,
  History,
  LayoutGrid,
  LogOut,
  PencilRuler,
  ReceiptIndianRupee,
  Settings,
  Siren,
  UtensilsCrossed,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { AlertsPanel } from '@/components/alerts-panel';
import { LocaleToggle } from '@/components/locale-toggle';
import { Button } from '@dinesense/ui/button';
import { useLiveOutlet } from '@/lib/live';
import { useAlerts } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { me, outlets, outlet, selectOutlet, signOut, can } = useSession();
  const connected = useLiveOutlet(outlet.id);
  const seesAlerts = can('OWNER', 'MANAGER', 'HOST');
  const alerts = useAlerts(outlet.id, seesAlerts);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const openAlerts = alerts.data?.filter((a) => a.status === 'OPEN').length ?? 0;

  const nav = [
    { href: '/floor', label: t('nav.floor'), icon: LayoutGrid, show: true },
    { href: '/floor/edit', label: t('nav.editor'), icon: PencilRuler, show: can('OWNER', 'MANAGER') },
    { href: '/staff', label: t('nav.staff'), icon: Users, show: can('OWNER', 'MANAGER', 'HOST') },
    { href: '/menu', label: t('nav.menu'), icon: UtensilsCrossed, show: can('OWNER', 'MANAGER', 'CHEF') },
    { href: '/kds', label: t('nav.kitchen'), icon: ChefHat, show: can('OWNER', 'MANAGER', 'CHEF') },
    {
      href: '/bills',
      label: t('nav.bills'),
      icon: ReceiptIndianRupee,
      show: can('OWNER', 'MANAGER', 'CASHIER'),
    },
    { href: '/alerts', label: t('nav.alertsCentre'), icon: Siren, show: can('OWNER', 'MANAGER', 'HOST') },
    { href: '/audit', label: t('nav.audit'), icon: History, show: can('OWNER', 'MANAGER') },
    { href: '/settings', label: t('nav.settings'), icon: Settings, show: can('OWNER', 'MANAGER') },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <span className="font-semibold text-brand">{t('common.appName')}</span>
        <label className="text-sm">
          <span className="sr-only">{t('nav.outlet')}</span>
          <select
            value={outlet.id}
            onChange={(e) => selectOutlet(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <nav className="flex gap-1" aria-label="Main">
          {nav
            .filter((n) => n.show)
            .map(({ href, label, icon: Icon }) => {
              const active = href === '/floor' ? pathname === '/floor' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm',
                    active ? 'bg-orange-50 text-brand' : 'hover:bg-slate-100',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              'flex items-center gap-1 text-xs',
              connected ? 'text-emerald-700' : 'text-amber-700',
            )}
            role="status"
          >
            <span
              className={cn('size-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500')}
              aria-hidden
            />
            {connected ? t('common.live') : t('common.offline')}
          </span>
          {seesAlerts ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAlertsOpen(true)}
              aria-label={t('nav.alerts')}
            >
              <Bell className="size-4" aria-hidden />
              {openAlerts ? (
                <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{openAlerts}</span>
              ) : null}
            </Button>
          ) : null}
          <LocaleToggle />
          <span className="hidden text-sm text-slate-600 sm:inline">{me.name}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()} aria-label={t('nav.signOut')}>
            <LogOut className="size-4" aria-hidden />
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      {seesAlerts ? (
        <AlertsPanel open={alertsOpen} onOpenChange={setAlertsOpen} alerts={alerts.data ?? []} />
      ) : null}
    </div>
  );
}
