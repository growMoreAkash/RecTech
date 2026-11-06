'use client';

import { Button } from '@dinesense/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from './error-text';
import { guestApi } from '@/lib/api';

/**
 * Mid-meal "How's everything?" — shown once per phone a while after the first food arrives. A thumbs-down goes
 * to the manager straight away (service recovery while the guests are still here).
 */
export function CheckIn({ token }: { token: string | null }) {
  const t = useTranslations('guest.checkIn');
  const qc = useQueryClient();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function send(positive: boolean) {
    setBusy(true);
    setError(null);
    try {
      await guestApi('/feedback', {
        method: 'POST',
        token,
        body: { positive, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
      setSent(positive);
      await qc.invalidateQueries({ queryKey: ['orders', token] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;
  if (sent !== null)
    return (
      <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
        {sent ? t('thanksGood') : t('thanksBad')}
      </p>
    );
  return (
    <section
      aria-labelledby="checkin-h"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-3"
    >
      <h2 id="checkin-h" className="font-semibold">
        {t('title')}
      </h2>
      <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="checkin-h">
        <Button
          variant={choice === true ? 'primary' : 'secondary'}
          size="lg"
          aria-pressed={choice === true}
          disabled={busy}
          onClick={() => void send(true)}
        >
          👍 {t('good')}
        </Button>
        <Button
          variant={choice === false ? 'primary' : 'secondary'}
          size="lg"
          aria-pressed={choice === false}
          disabled={busy}
          onClick={() => setChoice(false)}
        >
          👎 {t('bad')}
        </Button>
      </div>
      {choice === false ? (
        <div className="space-y-2">
          <label className="block text-sm">
            {t('commentLabel')}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={500}
              rows={2}
              className="mt-1 block w-full rounded-md border border-slate-300 p-2"
            />
          </label>
          <Button className="w-full" disabled={busy} onClick={() => void send(false)}>
            {t('send')}
          </Button>
        </div>
      ) : (
        <button type="button" className="text-xs text-slate-500 underline" onClick={() => setHidden(true)}>
          {t('later')}
        </button>
      )}
      <ErrorText error={error} />
    </section>
  );
}
