'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { LocaleToggle } from '@/components/locale-toggle';
import { Button } from '@dinesense/ui/button';
import { Field, Input } from '@dinesense/ui/field';
import { login } from '@/lib/api';
import { formText } from '@/lib/utils';

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(formText(form, 'email'), formText(form, 'password'));
      router.replace('/floor');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t('login.title')}</h1>
            <p className="text-sm text-slate-500">{t('login.subtitle')}</p>
          </div>
          <LocaleToggle />
        </div>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Field label={t('auth.email')}>
            {(p) => <Input {...p} name="email" type="email" autoComplete="username" required />}
          </Field>
          <Field label={t('auth.password')}>
            {(p) => (
              <Input
                {...p}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t('login.signingIn') : t('login.submit')}
          </Button>
        </form>
      </div>
    </main>
  );
}
