'use client';

import { Button } from '@dinesense/ui/button';
import { Delete } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ErrorText } from './error-text';
import { LocaleToggle } from './locale-toggle';
import { ApiError, deviceApi, pinLogin, setDeviceToken } from '@/lib/api';
import type { DeviceInfo } from '@/lib/types';
import { cn } from '@dinesense/ui/cn';

/** Pick your name, type your PIN. Works only on a registered device (the API enforces it). */
export function PinLogin({ onLoggedIn, onDeviceGone }: { onLoggedIn: () => void; onDeviceGone: () => void }) {
  const t = useTranslations('staffApp.pin');
  const tr = useTranslations('roles');
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    deviceApi<DeviceInfo>('/auth/device-staff')
      .then(setInfo)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'DEVICE_NOT_REGISTERED') {
          setDeviceToken(null);
          onDeviceGone();
        } else setError(e);
      });
  }, [onDeviceGone]);

  async function submit(code: string) {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await pinLogin(userId, code);
      onLoggedIn();
    } catch (e) {
      setError(e);
      setPin('');
      setBusy(false);
    }
  }

  const press = (d: string) => setPin((p) => (p + d).slice(0, 6));

  const person = info?.staff.find((s) => s.id === userId);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{info?.outlet.name ?? ''}</h1>
          <p className="text-xs text-slate-500">{info?.device.name}</p>
        </div>
        <LocaleToggle />
      </header>
      {!person ? (
        <>
          <h2 className="font-medium">{t('whoAreYou')}</h2>
          <ul className="grid grid-cols-2 gap-2">
            {info?.staff.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setUserId(s.id)}
                  className="flex min-h-16 w-full flex-col items-start justify-center rounded-xl border border-slate-200 bg-white px-3 text-left"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-slate-500">{s.roles.map((r) => tr(r)).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <ErrorText error={error} />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-4">
          <p className="text-lg">{t('hello', { name: person.name })}</p>
          <div className="flex gap-3" aria-label={t('pinEntered', { count: pin.length })} role="status">
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'size-4 rounded-full border-2 border-slate-700',
                  i < pin.length && 'bg-slate-700',
                )}
              />
            ))}
          </div>
          <ErrorText error={error} />
          <div className="grid w-full max-w-xs grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Button
                key={d}
                variant="secondary"
                size="lg"
                className="h-16 text-2xl"
                disabled={busy}
                onClick={() => press(d)}
              >
                {d}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="lg"
              className="h-16"
              onClick={() => (setUserId(null), setPin(''), setError(null))}
            >
              {t('back')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="h-16 text-2xl"
              disabled={busy}
              onClick={() => press('0')}
            >
              0
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-16"
              aria-label={t('erase')}
              onClick={() => setPin((p) => p.slice(0, -1))}
            >
              <Delete className="size-6" aria-hidden />
            </Button>
          </div>
          <Button
            size="lg"
            className="w-full max-w-xs"
            disabled={busy || pin.length < 4}
            onClick={() => void submit(pin)}
          >
            {t('signIn')}
          </Button>
        </div>
      )}
    </main>
  );
}
