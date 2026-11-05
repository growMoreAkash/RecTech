'use client';

import { normalizePhone } from '@dinesense/shared';
import { Field, Input } from '@dinesense/ui/field';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useGuestLookup } from '@/lib/queries';
import { useSession } from '@/lib/session';
import type { ConsentFlags } from '@/lib/types';
import { GuestCard } from './guest-card';

export interface GuestDraft {
  phone: string;
  name?: string;
  consents?: ConsentFlags;
}

const PURPOSES = ['WHATSAPP', 'FEEDBACK', 'MARKETING'] as const;

/**
 * Phone first: a known number shows the guest card (recognition); a new one asks for a name and the guest's
 * opt-ins, which are never pre-ticked. Calls `onChange(null)` while the number is empty or incomplete.
 */
export function GuestFields({
  onChange,
  required,
}: {
  onChange: (g: GuestDraft | null) => void;
  required?: boolean;
}) {
  const t = useTranslations('guests');
  const { outlet } = useSession();
  const [raw, setRaw] = useState('');
  const [name, setName] = useState('');
  const [consents, setConsents] = useState<ConsentFlags>({});
  const phone = raw.trim() ? normalizePhone(raw) : null;
  const lookup = useGuestLookup(outlet.id, phone);
  const known = lookup.data?.guest ?? null;

  const emit = (p: string | null, n: string, c: ConsentFlags) =>
    onChange(p ? { phone: p, ...(n.trim() ? { name: n.trim() } : {}), consents: c } : null);

  return (
    <div className="space-y-2">
      <Field
        label={required ? t('phone') : t('phoneOptional')}
        hint={raw.trim() && !phone ? t('phoneInvalid') : t('phoneHint')}
      >
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            required={required}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              emit(e.target.value.trim() ? normalizePhone(e.target.value) : null, name, consents);
            }}
            placeholder="98765 43210"
          />
        )}
      </Field>
      {phone && known ? <GuestCard guest={known} /> : null}
      {phone && lookup.isSuccess && !known ? (
        <>
          <Field label={t('name')}>
            {(p) => (
              <Input
                {...p}
                value={name}
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value);
                  emit(phone, e.target.value, consents);
                }}
              />
            )}
          </Field>
          <fieldset className="space-y-1 text-sm">
            <legend className="text-sm font-medium text-slate-700">{t('consentsAsk')}</legend>
            {PURPOSES.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={consents[k] ?? false}
                  onChange={(e) => {
                    const c = { ...consents, [k]: e.target.checked };
                    setConsents(c);
                    emit(phone, name, c);
                  }}
                />
                {t(`consent.${k}`)}
              </label>
            ))}
          </fieldset>
        </>
      ) : null}
    </div>
  );
}
