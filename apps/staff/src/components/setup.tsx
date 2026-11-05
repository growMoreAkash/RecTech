'use client';

import { Button } from '@dinesense/ui/button';
import { Field, Input, Select } from '@dinesense/ui/field';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ErrorText } from './error-text';
import { LocaleToggle } from './locale-toggle';
import { api, emailLogin, logout, setDeviceToken } from '@/lib/api';

const text = (d: FormData, k: string) => {
  const v = d.get(k);
  return typeof v === 'string' ? v : '';
};

/** One-time device registration by a manager. The device token is stored; the manager is signed out again. */
export function Setup({ onDone }: { onDone: () => void }) {
  const t = useTranslations('staffApp.setup');
  const [outlets, setOutlets] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await emailLogin(text(d, 'email'), text(d, 'password'));
      setOutlets(await api<{ id: string; name: string }[]>('/outlets'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ deviceToken: string }>(`/outlets/${text(d, 'outletId')}/devices`, {
        method: 'POST',
        body: { name: text(d, 'name').trim(), kind: 'STAFF_TERMINAL' },
      });
      setDeviceToken(res.deviceToken);
      await logout();
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-slate-600">{t('intro')}</p>
        </div>
        <LocaleToggle />
      </div>
      {!outlets ? (
        <form onSubmit={(e) => void signIn(e)} className="space-y-4">
          <Field label={t('managerEmail')}>
            {(p) => <Input {...p} name="email" type="email" required autoComplete="username" />}
          </Field>
          <Field label={t('password')}>
            {(p) => (
              <Input
                {...p}
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
              />
            )}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {t('continue')}
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => void register(e)} className="space-y-4">
          <Field label={t('outlet')}>
            {(p) => (
              <Select {...p} name="outletId" required>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('deviceName')}>
            {(p) => <Input {...p} name="name" required maxLength={80} defaultValue={t('defaultName')} />}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {t('register')}
          </Button>
        </form>
      )}
    </main>
  );
}
