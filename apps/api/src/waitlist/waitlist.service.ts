import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OutletSettings, WaitlistEntry } from '@prisma/client';
import {
  type Actor,
  type ConsentFlags,
  expectedFreeAt,
  maskPhone,
  median,
  predictWaits,
  rooms,
  turnMinutes,
  type WaitlistAddInput,
  type WaitlistJoinInput,
  waitRange,
  type WaitTable,
} from '@dinesense/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { ENV, type Env } from '../config/env';
import { upsertGuestByPhone } from '../guests/guest-identity';
import { MessagingService } from '../messaging/messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ReservationsService, rulesOf } from '../reservations/reservations.service';
import { TableStateService } from '../table-state/table-state.service';

const ACTIVE = ['WAITING', 'NOTIFIED'] as const;
type EntryWithGuest = WaitlistEntry & {
  guest: {
    id: string;
    name: string | null;
    phone: string | null;
    visits: number;
    allergies: string | null;
    deletedAt: Date | null;
  };
};

/**
 * Digital waitlist: guests queue by QR at the door (or the host adds them); ETAs come from the pure `predictWaits`
 * over live table stages and this outlet's recent dwell times; "table ready" holds the table and messages the guest.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly messaging: MessagingService,
    private readonly tables: TableStateService,
    private readonly reservations: ReservationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────── tokens ─────────

  token(id: string) {
    return `${id}.${this.sign(id)}`;
  }

  verify(token: string): string | null {
    const [id, sig] = token.split('.');
    if (!id || !sig) return null;
    const a = Buffer.from(this.sign(id));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  }

  private sign(id: string) {
    return createHmac('sha256', `waitlist:${this.env.JWT_ACCESS_SECRET}`)
      .update(id)
      .digest('base64url')
      .slice(0, 27);
  }

  // ───────── prediction ─────────

  /** Median minutes from seating to leaving at this outlet over the last 4 weeks, by party size bucket. */
  private async dwell(outletId: string, settings: OutletSettings) {
    const since = new Date(Date.now() - 28 * 86_400_000);
    const rows = await this.prisma.seating.findMany({
      where: { outletId, status: 'CLOSED', seatedAt: { gte: since }, closedAt: { not: null } },
      select: { seatedAt: true, closedAt: true, partySize: true },
      take: 2000,
      orderBy: { seatedAt: 'desc' },
    });
    const bucket = (p: number) => (p <= 2 ? 0 : p <= 4 ? 1 : 2);
    const minutes: number[][] = [[], [], []];
    for (const r of rows)
      minutes[bucket(r.partySize ?? 2)]!.push((r.closedAt!.getTime() - r.seatedAt.getTime()) / 60_000);
    const rules = rulesOf(settings);
    return (p: number) => {
      const xs = minutes[bucket(p)]!;
      // Too little history: fall back to the configured turn times.
      return xs.length >= 10 ? median(xs)! : turnMinutes(p, rules.turnMinutes);
    };
  }

  /** Predicted wait for every active entry, plus a hypothetical party of `extra` people at the back. */
  async predict(outletId: string, extra?: number) {
    const settings = await this.prisma.outletSettings.findUniqueOrThrow({ where: { outletId } });
    const now = Date.now();
    const [tables, entries, bookings, dwell] = await Promise.all([
      this.prisma.table.findMany({
        where: { outletId, archivedAt: null },
        include: { seatings: { where: { isOpen: true }, include: { seating: true } } },
      }),
      this.active(outletId),
      this.prisma.reservation.findMany({
        where: {
          outletId,
          status: 'CONFIRMED',
          startsAt: { lt: new Date(now + 3 * 3600_000) },
          endsAt: { gt: new Date(now) },
        },
      }),
      this.dwell(outletId, settings),
    ]);
    const held = new Set(entries.filter((e) => e.status === 'NOTIFIED').flatMap((e) => e.notifiedTableIds));
    const waitTables: WaitTable[] = tables.map((t) => {
      const s = t.seatings[0]?.seating;
      // A table held for a notified party is theirs; RESERVED for a booking is unavailable meanwhile.
      let freeAt = held.has(t.id)
        ? Infinity
        : t.status === 'RESERVED'
          ? Infinity
          : expectedFreeAt({ status: t.status, seatedAt: s?.seatedAt, partySize: s?.partySize }, now, dwell);
      for (const b of bookings)
        if (b.tableIds.includes(t.id) && b.startsAt.getTime() < freeAt + 90 * 60_000)
          freeAt = Math.max(freeAt, b.endsAt.getTime());
      return {
        id: t.id,
        capacity: t.capacity,
        minCapacity: t.minCapacity,
        joinableWith: t.joinableWith,
        freeAt,
      };
    });
    const queue = entries
      .filter((e) => e.status === 'WAITING')
      .map((e) => ({ id: e.id, partySize: e.partySize }));
    if (extra) queue.push({ id: '__extra', partySize: extra });
    const rules = rulesOf(settings);
    return {
      predictions: predictWaits(waitTables, queue, now, (p) => turnMinutes(p, rules.turnMinutes)),
      entries,
      settings,
      tables,
    };
  }

  private active(outletId: string) {
    return this.prisma.waitlistEntry.findMany({
      where: { outletId, status: { in: [...ACTIVE] } },
      include: { guest: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ───────── public (door QR) ─────────

  async publicInfo(slug: string) {
    const o = await this.reservations.outletBySlug(slug);
    const { predictions, entries } = await this.predict(o.id, 2);
    const two = predictions.get('__extra')?.minutes;
    return {
      name: o.name,
      address: o.address,
      slug: o.slug,
      waitlist: { enabled: o.settings.waitlistEnabled, maxPartySize: o.settings.waitlistMaxPartySize },
      waiting: entries.filter((e) => e.status === 'WAITING').length,
      waitForTwo: two === null || two === undefined ? null : waitRange(two),
    };
  }

  async join(slug: string, input: WaitlistJoinInput, ip: string) {
    const o = await this.reservations.outletBySlug(slug);
    if (!o.settings.waitlistEnabled)
      throw new AppError('BOOKING_CLOSED', HttpStatus.CONFLICT, 'The waitlist is closed right now');
    if (input.partySize > o.settings.waitlistMaxPartySize)
      throw new AppError('NO_AVAILABILITY', HttpStatus.CONFLICT, 'Please speak to the host for large groups');
    const entry = await this.create(
      o.organizationId,
      o.id,
      { ...input, source: 'QR' },
      { organizationId: o.organizationId, type: 'GUEST', ip },
    );
    return { token: this.token(entry.id), entry: await this.view(entry.id) };
  }

  private async create(
    organizationId: string,
    outletId: string,
    input: {
      name: string;
      phone?: string;
      partySize: number;
      notes?: string;
      consents?: ConsentFlags;
      locale?: 'en' | 'hi';
      source: 'QR' | 'HOST';
    },
    audit: AuditActor,
  ) {
    const outlet = await this.prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wait:' + outletId}))`;
      const guest = input.phone
        ? await upsertGuestByPhone(tx, organizationId, input.phone, {
            name: input.name,
            consents: input.consents,
            source: input.source === 'QR' ? 'WAITLIST_PAGE' : 'HOST',
            actorId: audit.type === 'USER' ? (audit.id ?? null) : null,
            locale: input.locale,
          })
        : await tx.guest.create({ data: { organizationId, name: input.name } });
      // The same phone joining twice gets its existing place back.
      const existing = await tx.waitlistEntry.findFirst({
        where: { outletId, guestId: guest.id, status: { in: [...ACTIVE] } },
      });
      if (existing) return { entry: existing, guest, isNew: false };
      const entry = await tx.waitlistEntry.create({
        data: {
          organizationId,
          outletId,
          guestId: guest.id,
          partySize: input.partySize,
          source: input.source,
          notes: input.notes ?? null,
        },
      });
      await this.audit.recordAs(
        audit.type === 'GUEST' ? { ...audit, id: guest.id } : audit,
        {
          action: 'waitlist.join',
          entityType: 'WaitlistEntry',
          entityId: entry.id,
          outletId,
          after: { partySize: entry.partySize, source: input.source },
        },
        tx,
      );
      return { entry, guest, isNew: true };
    });
    if (created.isNew) {
      const { predictions, entries } = await this.predict(outletId);
      const minutes = predictions.get(created.entry.id)?.minutes ?? null;
      const range = minutes === null ? null : waitRange(minutes);
      const position = entries.findIndex((e) => e.id === created.entry.id) + 1;
      await this.prisma.$transaction(async (tx) => {
        await tx.waitlistEntry.update({
          where: { id: created.entry.id },
          data: { quotedMinutes: range?.high ?? null },
        });
        await this.messaging.queue(tx, {
          organizationId,
          outletId,
          guest: created.guest,
          purpose: 'WAITLIST_JOINED',
          entityType: 'WaitlistEntry',
          entityId: created.entry.id,
          vars: {
            name: created.guest.name ?? '',
            outlet: outlet.name,
            position: String(position),
            wait: range ? `${range.low}–${range.high} min` : '—',
            link: this.messaging.link(`/w/status/${this.token(created.entry.id)}`),
          },
        });
      });
      this.announce(created.entry);
    }
    return created.entry;
  }

  /** What the guest's status page shows. */
  async view(entryId: string) {
    const e = await this.prisma.waitlistEntry.findUnique({
      where: { id: entryId },
      include: { outlet: true, guest: true },
    });
    if (!e) throw AppError.notFound('Waitlist entry');
    let position: number | null = null;
    let wait: { low: number; high: number } | null = null;
    if (e.status === 'WAITING') {
      const { predictions, entries } = await this.predict(e.outletId);
      position = entries.filter((x) => x.status === 'WAITING').findIndex((x) => x.id === e.id) + 1;
      const m = predictions.get(e.id)?.minutes;
      wait = m === null || m === undefined ? null : waitRange(m);
    }
    const labels = e.notifiedTableIds.length
      ? (
          await this.prisma.table.findMany({
            where: { id: { in: e.notifiedTableIds } },
            select: { label: true },
          })
        ).map((t) => t.label)
      : [];
    return {
      status: e.status,
      name: e.guest.name,
      partySize: e.partySize,
      position,
      wait,
      notifiedAt: e.notifiedAt,
      holdUntil: e.holdUntil,
      tables: labels,
      outlet: { name: e.outlet.name, slug: e.outlet.slug },
      joinedAt: e.createdAt,
    };
  }

  async leave(entryId: string, ip: string) {
    const e = await this.prisma.waitlistEntry.findUnique({ where: { id: entryId } });
    if (!e) throw AppError.notFound('Waitlist entry');
    await this.close(e, 'LEFT', { organizationId: e.organizationId, type: 'GUEST', id: e.guestId, ip });
    return this.view(e.id);
  }

  // ───────── host ─────────

  async list(organizationId: string, outletId: string) {
    const { predictions, entries, tables } = await this.predict(outletId);
    const free = new Set(tables.filter((t) => t.status === 'VACANT').map((t) => t.id));
    const messages = await this.messaging.forEntity(
      organizationId,
      'WaitlistEntry',
      entries.map((e) => e.id),
    );
    const suggestions = new Map<string, string[]>();
    for (const e of entries.filter((x) => x.status === 'WAITING')) {
      const ids = (await this.reservations.suggestNow(outletId, e.partySize)).filter((id) => free.has(id));
      if (ids.length) {
        suggestions.set(e.id, ids);
        ids.forEach((id) => free.delete(id));
      }
    }
    let waiting = 0;
    return entries.map((e) => {
      const m = predictions.get(e.id)?.minutes;
      return {
        ...this.staffView(e),
        position: e.status === 'WAITING' ? ++waiting : null,
        wait: e.status === 'WAITING' && m !== null && m !== undefined ? waitRange(m) : null,
        suggestedTableIds: suggestions.get(e.id) ?? [],
        messages: messages.filter((x) => x.entityId === e.id),
      };
    });
  }

  staffView(e: EntryWithGuest) {
    return {
      id: e.id,
      status: e.status,
      partySize: e.partySize,
      source: e.source,
      notes: e.notes,
      quotedMinutes: e.quotedMinutes,
      notifiedAt: e.notifiedAt,
      notifiedTableIds: e.notifiedTableIds,
      holdUntil: e.holdUntil,
      createdAt: e.createdAt,
      guest: {
        id: e.guest.id,
        name: e.guest.name,
        phone: e.guest.phone,
        phoneMasked: e.guest.phone ? maskPhone(e.guest.phone) : null,
        visits: e.guest.visits,
        allergies: e.guest.allergies,
      },
    };
  }

  add(organizationId: string, outletId: string, input: WaitlistAddInput, audit: AuditActor) {
    return this.create(organizationId, outletId, { ...input, source: 'HOST' }, audit);
  }

  private async load(organizationId: string, outletId: string, id: string) {
    const e = await this.prisma.waitlistEntry.findFirst({
      where: { id, organizationId, outletId },
      include: { guest: true },
    });
    if (!e) throw AppError.notFound('Waitlist entry');
    return e;
  }

  /** Table ready: hold the table(s) and tell the guest (WhatsApp if they opted in, and their status page). */
  async notify(organizationId: string, outletId: string, id: string, tableIds: string[], audit: AuditActor) {
    const e = await this.load(organizationId, outletId, id);
    if (e.status !== 'WAITING' && e.status !== 'NOTIFIED')
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, `This party is ${e.status.toLowerCase()}`);
    const settings = await this.prisma.outletSettings.findUniqueOrThrow({ where: { outletId } });
    const outlet = await this.prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
    const tables = await this.prisma.table.findMany({
      where: { id: { in: tableIds }, outletId, archivedAt: null },
    });
    if (tables.length !== tableIds.length) throw AppError.notFound('Table');
    for (const t of tables)
      if (t.status === 'VACANT')
        await this.tables.apply({
          organizationId,
          outletId,
          tableId: t.id,
          event: { type: 'HOLD_FOR_RESERVATION' },
          actor: { kind: 'SYSTEM' },
          audit,
          source: 'SYSTEM',
          payload: { waitlistEntryId: e.id },
        });
    const now = new Date();
    const holdUntil = new Date(now.getTime() + settings.waitlistHoldMinutes * 60_000);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.waitlistEntry.update({
        where: { id: e.id },
        data: { status: 'NOTIFIED', notifiedAt: now, notifiedTableIds: tableIds, holdUntil },
      });
      await this.messaging.queue(tx, {
        organizationId,
        outletId,
        guest: e.guest,
        purpose: 'TABLE_READY',
        entityType: 'WaitlistEntry',
        entityId: e.id,
        dedupeSuffix: String(now.getTime()),
        vars: {
          name: e.guest.name ?? '',
          outlet: outlet.name,
          table: tables.map((t) => t.label).join(' + '),
          minutes: String(settings.waitlistHoldMinutes),
        },
      });
      await this.audit.recordAs(
        audit,
        {
          action: 'waitlist.notify',
          entityType: 'WaitlistEntry',
          entityId: e.id,
          outletId,
          after: { tableIds },
        },
        tx,
      );
      return u;
    });
    this.announce(updated);
    return updated;
  }

  async seat(
    organizationId: string,
    outletId: string,
    id: string,
    tableIds: string[] | undefined,
    actor: Actor,
    audit: AuditActor,
  ) {
    const e = await this.load(organizationId, outletId, id);
    if (e.status !== 'WAITING' && e.status !== 'NOTIFIED')
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, `This party is ${e.status.toLowerCase()}`);
    const chosen = tableIds?.length
      ? tableIds
      : e.notifiedTableIds.length
        ? e.notifiedTableIds
        : await this.reservations.suggestNow(outletId, e.partySize);
    const [primary, ...join] = chosen;
    if (!primary)
      throw new AppError('NO_AVAILABILITY', HttpStatus.CONFLICT, 'No table is free for this party');
    const out = await this.tables.apply({
      organizationId,
      outletId,
      tableId: primary,
      event: { type: 'HOST_SEAT', partySize: e.partySize, source: 'WAITLIST' },
      actor,
      audit,
      source: 'STAFF',
      seat: { joinTableIds: join, guestId: e.guestId, notes: e.notes ?? undefined },
    });
    const link = await this.prisma.seatingTable.findFirst({
      where: { tableId: primary, isOpen: true },
      select: { seatingId: true },
    });
    const updated = await this.prisma.waitlistEntry.update({
      where: { id: e.id },
      data: {
        status: 'SEATED',
        seatedAt: new Date(),
        closedAt: new Date(),
        seatingId: link?.seatingId ?? null,
      },
    });
    const unused = e.notifiedTableIds.filter((t) => !chosen.includes(t));
    if (unused.length) await this.reservations.releaseHolds(organizationId, outletId, unused, '');
    this.announce(updated);
    return { entry: updated, tables: out.tables };
  }

  async remove(organizationId: string, outletId: string, id: string, audit: AuditActor) {
    const e = await this.load(organizationId, outletId, id);
    await this.close(e, 'REMOVED', audit);
    return { ok: true };
  }

  private async close(e: WaitlistEntry, status: 'LEFT' | 'REMOVED', audit: AuditActor) {
    if (e.status !== 'WAITING' && e.status !== 'NOTIFIED')
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, `Already ${e.status.toLowerCase()}`);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.waitlistEntry.update({
        where: { id: e.id },
        data: { status, closedAt: new Date() },
      });
      await this.audit.recordAs(
        audit,
        {
          action: `waitlist.${status.toLowerCase()}`,
          entityType: 'WaitlistEntry',
          entityId: e.id,
          outletId: e.outletId,
        },
        tx,
      );
      return u;
    });
    if (e.notifiedTableIds.length)
      await this.reservations.releaseHolds(e.organizationId, e.outletId, e.notifiedTableIds, '');
    this.announce(updated);
  }

  /** Holds that ran out are released (the party stays "notified" until the host seats or removes them). */
  async sweep(now = new Date()) {
    const expired = await this.prisma.waitlistEntry.findMany({
      where: { status: 'NOTIFIED', holdUntil: { lt: now }, notifiedTableIds: { isEmpty: false } },
    });
    for (const e of expired) {
      await this.reservations.releaseHolds(e.organizationId, e.outletId, e.notifiedTableIds, '');
      const u = await this.prisma.waitlistEntry.update({
        where: { id: e.id },
        data: { notifiedTableIds: [] },
      });
      this.announce(u);
    }
    return expired.length;
  }

  private announce(e: { id: string; outletId: string; status: string }) {
    this.realtime.emit(rooms.outlet(e.outletId), 'waitlist.updated', {
      outletId: e.outletId,
      entryId: e.id,
      status: e.status,
    });
  }
}
