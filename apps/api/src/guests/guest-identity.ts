import type { Prisma } from '@prisma/client';
import { CONSENT_PURPOSES, type ConsentFlags } from '@dinesense/shared';

type Tx = Prisma.TransactionClient;

export type ConsentSource =
  'BOOKING_PAGE' | 'HOST' | 'MANAGE_LINK' | 'STAFF' | 'WAITLIST_PAGE' | 'WHATSAPP_REPLY';

/**
 * Records the consents that changed (append-only history) and returns the new current flags.
 * Plain function over a transaction so any module can use it without module cycles.
 */
export async function applyConsents(
  tx: Tx,
  guest: { id: string; organizationId: string; consentFlags: Prisma.JsonValue },
  input: ConsentFlags | undefined,
  source: ConsentSource,
  actorId: string | null,
): Promise<ConsentFlags> {
  const current = (guest.consentFlags ?? {}) as ConsentFlags;
  const next: ConsentFlags = { ...current };
  for (const purpose of CONSENT_PURPOSES) {
    const v = input?.[purpose];
    if (v === undefined || current[purpose] === v) continue;
    next[purpose] = v;
    await tx.guestConsent.create({
      data: { organizationId: guest.organizationId, guestId: guest.id, purpose, granted: v, source, actorId },
    });
  }
  if (JSON.stringify(next) !== JSON.stringify(current))
    await tx.guest.update({ where: { id: guest.id }, data: { consentFlags: next } });
  return next;
}

/**
 * The guest for a phone number in this organisation (created on first sight; a previously erased profile is
 * re-identified only by this fresh contact, with no old data). Name is filled in if we didn't have one.
 */
export async function upsertGuestByPhone(
  tx: Tx,
  organizationId: string,
  phone: string,
  opts: {
    name?: string;
    consents?: ConsentFlags;
    source: ConsentSource;
    actorId: string | null;
    locale?: string;
  },
) {
  const existing = await tx.guest.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
  const guest =
    existing && !existing.deletedAt
      ? existing.name || !opts.name
        ? existing
        : await tx.guest.update({ where: { id: existing.id }, data: { name: opts.name } })
      : await tx.guest.create({ data: { organizationId, phone, name: opts.name ?? null } });
  const located =
    opts.locale && guest.locale !== opts.locale
      ? await tx.guest.update({ where: { id: guest.id }, data: { locale: opts.locale } })
      : guest;
  const flags = await applyConsents(tx, located, opts.consents, opts.source, opts.actorId);
  return { ...located, consentFlags: flags as Prisma.JsonValue, isNew: !existing || !!existing.deletedAt };
}
