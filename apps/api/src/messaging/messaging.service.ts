import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { messages } from '@dinesense/i18n';
import {
  type ConsentFlags,
  MESSAGE_VARIABLES,
  type MessagePurpose,
  normalizePhone,
  rooms,
} from '@dinesense/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { applyConsents } from '../guests/guest-identity';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ChannelError, MESSAGE_CHANNEL, type MessageChannel } from './message-channel';

type Tx = Prisma.TransactionClient;
const MAX_ATTEMPTS = 5;
const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'STOP ALL', 'बंद', 'रोकें']);
const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

export interface QueueInput {
  organizationId: string;
  outletId: string;
  guest: { id: string; phone: string | null; consentFlags: Prisma.JsonValue; locale: string };
  purpose: MessagePurpose;
  entityType: 'Reservation' | 'WaitlistEntry';
  entityId: string;
  /** Distinguishes repeat messages of one purpose (e.g. each change of a booking). */
  dedupeSuffix?: string;
  vars: Record<string, string>;
}

/** Locale-aware date/time text for messages (outlet time zone). */
export function guestDateTime(at: Date, timeZone: string, locale: string) {
  const loc = locale === 'hi' ? 'hi-IN' : 'en-IN';
  return {
    date: new Intl.DateTimeFormat(loc, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(
      at,
    ),
    time: new Intl.DateTimeFormat(loc, { timeZone, hour: 'numeric', minute: '2-digit' }).format(at),
  };
}

/**
 * Guest messaging outbox. Business code calls `queue` inside its own transaction; `dispatch` sends later (timer or
 * tests). WhatsApp consent is required when queuing and re-checked when sending; one row per purpose + entity.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(MESSAGE_CHANNEL) private readonly channel: MessageChannel,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get channelName() {
    return this.channel.name;
  }

  link(path: string) {
    return `${this.env.GUEST_APP_URL.replace(/\/$/, '')}${path}`;
  }

  async queue(tx: Tx, m: QueueInput) {
    if (!m.guest.phone) return;
    const allowed = (m.guest.consentFlags as ConsentFlags | null)?.WHATSAPP === true;
    const locale = m.guest.locale === 'hi' ? 'hi' : 'en';
    await tx.messageLog.createMany({
      data: [
        {
          organizationId: m.organizationId,
          outletId: m.outletId,
          guestId: m.guest.id,
          channel: this.channel.name,
          purpose: m.purpose,
          entityType: m.entityType,
          entityId: m.entityId,
          dedupeKey: `${m.purpose}:${m.entityId}${m.dedupeSuffix ? `:${m.dedupeSuffix}` : ''}`,
          toPhone: m.guest.phone,
          template: `ds_${m.purpose.toLowerCase()}`,
          locale,
          variables: m.vars,
          status: allowed ? 'QUEUED' : 'SKIPPED',
          error: allowed ? null : 'no WhatsApp consent',
        },
      ],
      skipDuplicates: true,
    });
  }

  render(purpose: MessagePurpose, locale: string, vars: Record<string, string>) {
    const cat = (locale === 'hi' ? messages.hi : messages.en).whatsapp as Record<string, string>;
    const body = (cat[purpose] ?? purpose).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
    return `${body}\n${cat.footer ?? ''}`.trim();
  }

  /** Sends due messages. Rows are leased with SKIP LOCKED, so several API replicas never double-send. */
  async dispatch(now = new Date(), batch = 50) {
    const leased = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "MessageLog"
        WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= ${now}
        ORDER BY "createdAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      await tx.messageLog.updateMany({
        where: { id: { in: ids } },
        data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 60_000) },
      });
      return tx.messageLog.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
    });
    let sent = 0;
    for (const m of leased) {
      const guest = await this.prisma.guest.findUnique({ where: { id: m.guestId } });
      const consent = (guest?.consentFlags as ConsentFlags | null)?.WHATSAPP === true;
      if (!guest?.phone || guest.deletedAt || !consent || !m.toPhone) {
        await this.prisma.messageLog.update({
          where: { id: m.id },
          data: { status: 'SKIPPED', error: 'consent withdrawn or data erased' },
        });
        continue;
      }
      const purpose = m.purpose as MessagePurpose;
      const vars = m.variables as Record<string, string>;
      try {
        const r = await this.channel.send({
          to: m.toPhone,
          template: m.template,
          locale: m.locale,
          params: (MESSAGE_VARIABLES[purpose] ?? []).map((k) => vars[k] ?? ''),
          text: this.render(purpose, m.locale, vars),
        });
        await this.prisma.messageLog.update({
          where: { id: m.id },
          data: {
            status: 'SENT',
            sentAt: now,
            providerMessageId: r.providerMessageId,
            channel: this.channel.name,
            error: null,
          },
        });
        sent++;
      } catch (e) {
        const retry = !(e instanceof ChannelError) || e.retryable;
        const giveUp = !retry || m.attempts >= MAX_ATTEMPTS;
        await this.prisma.messageLog.update({
          where: { id: m.id },
          data: giveUp
            ? { status: 'FAILED', error: String(e instanceof Error ? e.message : e).slice(0, 300) }
            : {
                error: String(e).slice(0, 300),
                nextAttemptAt: new Date(now.getTime() + 2 ** m.attempts * 30_000),
              },
        });
        this.logger.warn(`message ${m.id} (${m.purpose}) failed: ${String(e)}`);
      }
      this.announce(m);
    }
    return sent;
  }

  /** Messages about one booking / queue entry (for staff screens). Phone numbers are not included. */
  forEntity(organizationId: string, entityType: string, entityIds: string[]) {
    return this.prisma.messageLog.findMany({
      where: { organizationId, entityType, entityId: { in: entityIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        entityId: true,
        purpose: true,
        status: true,
        channel: true,
        sentAt: true,
        deliveredAt: true,
        readAt: true,
        error: true,
        createdAt: true,
      },
    });
  }

  // ───────── WhatsApp webhook ─────────

  verifyWebhookSignature(raw: Buffer | undefined, header: string | undefined): boolean {
    if (!raw || !header?.startsWith('sha256=') || !this.env.WHATSAPP_APP_SECRET) return false;
    const expected = Buffer.from(
      createHmac('sha256', this.env.WHATSAPP_APP_SECRET).update(raw).digest('hex'),
    );
    const given = Buffer.from(header.slice(7));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  verifyToken(token: string | undefined) {
    return !!this.env.WHATSAPP_VERIFY_TOKEN && token === this.env.WHATSAPP_VERIFY_TOKEN;
  }

  /** Delivery statuses and inbound replies (STOP withdraws WhatsApp consent for that number, everywhere). */
  async webhook(body: unknown) {
    const entries = (body as { entry?: { changes?: { value?: WebhookValue }[] }[] })?.entry ?? [];
    for (const change of entries.flatMap((e) => e.changes ?? [])) {
      const v = change.value ?? {};
      for (const s of v.statuses ?? []) await this.status(s);
      for (const msg of v.messages ?? []) {
        const text = msg.text?.body?.trim().toUpperCase();
        if (!text || !STOP_WORDS.has(text)) continue;
        const phone = normalizePhone(`+${msg.from}`);
        if (phone) await this.optOut(phone);
      }
    }
    return { ok: true };
  }

  private async status(s: { id?: string; status?: string; errors?: { title?: string }[] }) {
    if (!s.id || !s.status) return;
    const m = await this.prisma.messageLog.findUnique({ where: { providerMessageId: s.id } });
    if (!m) return;
    const now = new Date();
    if (s.status === 'failed') {
      await this.prisma.messageLog.update({
        where: { id: m.id },
        data: { status: 'FAILED', error: s.errors?.[0]?.title?.slice(0, 300) ?? 'failed' },
      });
    } else {
      const next = s.status.toUpperCase();
      if ((RANK[next] ?? -1) <= (RANK[m.status] ?? 99)) return; // never go backwards
      await this.prisma.messageLog.update({
        where: { id: m.id },
        data: {
          status: next as 'SENT' | 'DELIVERED' | 'READ',
          ...(next === 'DELIVERED' ? { deliveredAt: now } : {}),
          ...(next === 'READ' ? { readAt: now, deliveredAt: m.deliveredAt ?? now } : {}),
        },
      });
    }
    this.announce(m);
  }

  async optOut(phone: string) {
    const guests = await this.prisma.guest.findMany({ where: { phone, deletedAt: null } });
    for (const g of guests)
      await this.prisma.$transaction(async (tx) => {
        await applyConsents(tx, g, { WHATSAPP: false }, 'WHATSAPP_REPLY', null);
        await tx.messageLog.updateMany({
          where: { guestId: g.id, status: 'QUEUED' },
          data: { status: 'SKIPPED', error: 'guest replied STOP' },
        });
      });
    return guests.length;
  }

  private announce(m: { outletId: string; entityType: string; entityId: string }) {
    this.realtime.emit(rooms.outlet(m.outletId), 'message.updated', {
      outletId: m.outletId,
      entityType: m.entityType,
      entityId: m.entityId,
    });
  }
}

interface WebhookValue {
  statuses?: { id?: string; status?: string; errors?: { title?: string }[] }[];
  messages?: { from: string; text?: { body?: string } }[];
}
