'use client';

import { CheckCheck, Check, Clock, MessageCircleOff, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GuestMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The latest message to the guest about this booking / queue entry: icon + words (never colour alone). */
export function MessageStatus({ messages }: { messages: GuestMessage[] | undefined }) {
  const t = useTranslations('messages');
  const m = messages?.at(-1);
  if (!m) return null;
  const Icon =
    m.status === 'READ' || m.status === 'DELIVERED'
      ? CheckCheck
      : m.status === 'SENT'
        ? Check
        : m.status === 'QUEUED'
          ? Clock
          : m.status === 'FAILED'
            ? TriangleAlert
            : MessageCircleOff;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        m.status === 'READ' ? 'text-sky-700' : m.status === 'FAILED' ? 'text-red-700' : 'text-slate-500',
      )}
      title={m.error ?? undefined}
    >
      <Icon aria-hidden className="size-3" />
      {t(`purpose.${m.purpose}`)}:{' '}
      {m.channel === 'console' && m.status !== 'SKIPPED' && m.status !== 'FAILED'
        ? t('console')
        : t(`status.${m.status}`)}
    </span>
  );
}
