'use client';

import type { Role } from '@dinesense/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, logout as apiLogout, refresh, setOnSignedOut } from './api';
import type { Me, Outlet } from './types';

const OUTLET_KEY = 'ds.outlet';

interface Session {
  me: Me;
  outlets: Outlet[];
  outlet: Outlet;
  roles: Role[];
  can: (...roles: Role[]) => boolean;
  selectOutlet: (id: string) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

const readOutlet = () => {
  try {
    return localStorage.getItem(OUTLET_KEY);
  } catch {
    return null;
  }
};

/** Restores the session from the refresh cookie, or sends the user to /login. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [state, setState] = useState<{ me: Me; outlets: Outlet[] } | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);

  useEffect(() => {
    setOnSignedOut(() => router.replace('/login'));
    let cancelled = false;
    void (async () => {
      if (!(await refresh())) return router.replace('/login');
      try {
        const [me, outlets] = await Promise.all([api<Me>('/me'), api<Outlet[]>('/outlets')]);
        if (cancelled) return;
        const saved = readOutlet();
        setOutletId(outlets.some((o) => o.id === saved) ? saved : (outlets[0]?.id ?? null));
        setState({ me, outlets });
      } catch {
        router.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const selectOutlet = useCallback(
    (id: string) => {
      setOutletId(id);
      try {
        localStorage.setItem(OUTLET_KEY, id);
      } catch {
        /* private mode: selection just isn't remembered */
      }
      qc.clear();
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    qc.clear();
    router.replace('/login');
  }, [qc, router]);

  const value = useMemo<Session | null>(() => {
    const outlet = state?.outlets.find((o) => o.id === outletId);
    if (!state || !outlet) return null;
    const roles = state.me.outlets[outlet.id] ?? [];
    return {
      ...state,
      outlet,
      roles,
      can: (...r) => r.some((x) => roles.includes(x)),
      selectOutlet,
      signOut,
    };
  }, [state, outletId, selectOutlet, signOut]);

  if (!value) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
