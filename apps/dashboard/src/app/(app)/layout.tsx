'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { SessionProvider } from '@/lib/session';

export default function AuthedLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider fallback={<div className="p-8 text-slate-500" aria-busy="true" />}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
