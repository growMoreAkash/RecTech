'use client';

import { useCallback, useEffect, useState } from 'react';
import { PinLogin } from '@/components/pin-login';
import { Setup } from '@/components/setup';
import { Shell } from '@/components/shell';
import { api, deviceToken, refresh } from '@/lib/api';
import type { Me } from '@/lib/types';

type Phase =
  { kind: 'boot' } | { kind: 'setup' } | { kind: 'pin' } | { kind: 'app'; me: Me; outletId: string };

/** Shared terminal flow: device setup (once) → PIN login per person → the app; "switch user" returns to the PIN pad. */
export default function StaffApp() {
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' });

  const enter = useCallback(async () => {
    const me = await api<Me>('/me');
    const outletId = Object.keys(me.outlets)[0];
    setPhase(outletId ? { kind: 'app', me, outletId } : { kind: 'pin' });
  }, []);

  useEffect(() => {
    void (async () => {
      if (!deviceToken()) return setPhase({ kind: 'setup' });
      if (await refresh()) {
        try {
          return await enter();
        } catch {
          /* fall through to PIN */
        }
      }
      setPhase({ kind: 'pin' });
    })();
  }, [enter]);

  if (phase.kind === 'boot') return <main className="p-6" aria-busy="true" />;
  if (phase.kind === 'setup') return <Setup onDone={() => setPhase({ kind: 'pin' })} />;
  if (phase.kind === 'pin')
    return <PinLogin onLoggedIn={() => void enter()} onDeviceGone={() => setPhase({ kind: 'setup' })} />;
  return <Shell me={phase.me} outletId={phase.outletId} onSignOut={() => setPhase({ kind: 'pin' })} />;
}
