import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Alert, OutletSettings, Prisma, Reservation } from '@prisma/client';
import {
  type BookingRules,
  type BookTable,
  type Busy,
  type ConsentFlags,
  listSlots,
  localDate,
  localDayRange,
  localTime,
  maskPhone,
  type OpeningHoursInput,
  pickTables,
  type ReservationPatchInput,
  rooms,
  turnMinutes,
} from '@dinesense/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { ENV, type Env } from '../config/env';
import { upsertGuestByPhone } from '../guests/guest-identity';
import { guestDateTime, MessagingService, type QueueInput } from '../messaging/messaging.service';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableStateService } from '../table-state/table-state.service';

type Tx = Prisma.TransactionClient;
const SEATED = ['OCCUPIED', 'GREETED', 'ORDERED', 'SERVED', 'BILL_REQUESTED', 'PAID'] as const;

export interface BookInput {
  startsAt: Date;
  partySize: number;
  phone: string;
  name?: string;
  notes?: string;
  sectionId?: string;
  tableIds?: string[];
  durationMinutes?: number;
  consents?: ConsentFlags;
  locale?: 'en' | 'hi';
}

export function rulesOf(s: OutletSettings): BookingRules {
  return {
    slotMinutes: s.bookingSlotMinutes,
    leadMinutes: s.bookingLeadMinutes,
    horizonDays: s.bookingHorizonDays,
    maxPartySize: s.bookingMaxPartySize,
    lastSeatingMinutes: s.bookingLastSeatingMinutes,
    maxCoversPerSlot: s.bookingMaxCoversPerSlot,
    turnMinutes: { small: s.turnSmallMinutes, medium: s.turnMediumMinutes, large: s.turnLargeMinutes },
  };
}

/**
 * Bookings: availability, create / move / cancel (guest link or staff), check-in (seats the party through the
 * table state machine), and the sweep that holds tables before a booking and marks no-shows.
 * Every booking write runs under a per-outlet advisory lock and re-checks availability, so two guests can never get
 * the same table for overlapping times.
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tables: TableStateService,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
    private readonly messaging: MessagingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────── manage links ─────────

  manageToken(reservationId: string): string {
    return `${reservationId}.${this.sign(reservationId)}`;
  }

  /** The reservation id of a valid manage-link token, else null. */
  verifyToken(token: string): string | null {
    const [id, sig] = token.split('.');
    if (!id || !sig) return null;
    const expected = Buffer.from(this.sign(id));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  }

  private sign(id: string): string {
    return createHmac('sha256', `reservation:${this.env.JWT_ACCESS_SECRET}`)
      .update(id)
      .digest('base64url')
      .slice(0, 27);
  }

  // ───────── reads ─────────

  async outletBySlug(slug: string) {
    const outlet = await this.prisma.outlet.findUnique({
      where: { slug },
      include: { settings: true, sections: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!outlet || outlet.archivedAt || !outlet.settings) throw AppError.notFound('Restaurant');
    return outlet as typeof outlet & { settings: OutletSettings };
  }

  find(id: string) {
    return this.prisma.reservation.findUnique({ where: { id } });
  }

  async outletBySlugOrId(outletId: string) {
    const o = await this.prisma.outlet.findUniqueOrThrow({
      where: { id: outletId },
      include: { settings: true },
    });
    return o as typeof o & { settings: OutletSettings };
  }

  async hours(outletId: string) {
    return this.prisma.outletHours.findMany({
      where: { outletId },
      orderBy: [{ dayOfWeek: 'asc' }, { opens: 'asc' }],
    });
  }

  async setHours(organizationId: string, outletId: string, input: OpeningHoursInput, audit: AuditActor) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.outletHours.findMany({ where: { outletId } });
      await tx.outletHours.deleteMany({ where: { outletId } });
      await tx.outletHours.createMany({
        data: input.windows.map((w) => ({ organizationId, outletId, ...w })),
      });
      await this.audit.recordAs(
        audit,
        {
          action: 'outlet.hours.update',
          entityType: 'Outlet',
          entityId: outletId,
          outletId,
          before: before.map(({ dayOfWeek, opens, closes }) => ({ dayOfWeek, opens, closes })),
          after: input.windows,
        },
        tx,
      );
      return tx.outletHours.findMany({
        where: { outletId },
        orderBy: [{ dayOfWeek: 'asc' }, { opens: 'asc' }],
      });
    });
  }

  /** Tables and busy intervals around [from, to): bookings, plus parties seated right now (estimated end). */
  private async context(
    db: Tx | PrismaService,
    outletId: string,
    settings: OutletSettings,
    from: Date,
    to: Date,
  ) {
    const [tables, bookings] = await Promise.all([
      db.table.findMany({
        where: { outletId, archivedAt: null },
        include: { seatings: { where: { isOpen: true }, include: { seating: true } } },
      }),
      db.reservation.findMany({
        where: { outletId, status: 'CONFIRMED', startsAt: { lt: to }, endsAt: { gt: from } },
      }),
    ]);
    const now = Date.now();
    const bookTables: BookTable[] = tables.map((t) => ({
      id: t.id,
      capacity: t.capacity,
      minCapacity: t.minCapacity,
      sectionId: t.sectionId,
      onlineBookable: t.onlineBookable,
      joinableWith: t.joinableWith,
      outOfService: t.status === 'OUT_OF_SERVICE',
    }));
    const busy: Busy[] = bookings.map((r) => ({
      tableIds: r.tableIds,
      from: r.startsAt,
      to: r.endsAt,
      reservationId: r.id,
      partySize: r.partySize,
    }));
    for (const t of tables) {
      const open = t.seatings[0]?.seating;
      if (!open || !(SEATED as readonly string[]).includes(t.status)) continue;
      const expected =
        open.seatedAt.getTime() + turnMinutes(open.partySize ?? 2, rulesOf(settings).turnMinutes) * 60_000;
      // A party still seated is assumed to need at least 15 more minutes.
      busy.push({
        tableIds: [t.id],
        from: new Date(now - 60_000),
        to: new Date(Math.max(expected, now + 15 * 60_000)),
      });
    }
    return { tables: bookTables, busy, tableRows: tables };
  }

  async slots(
    outletId: string,
    settings: OutletSettings,
    timeZone: string,
    date: string,
    partySize: number,
    online: boolean,
  ) {
    const { start, end } = localDayRange(date, timeZone);
    const ctx = await this.context(
      this.prisma,
      outletId,
      settings,
      start,
      new Date(end.getTime() + 8 * 3600_000),
    );
    const hours = await this.hours(outletId);
    const rules = rulesOf(settings);
    return listSlots({
      date,
      timeZone,
      now: new Date(),
      partySize,
      hours,
      // Staff booking ignores lead time and the online party limit.
      rules: online ? rules : { ...rules, leadMinutes: 0, maxPartySize: 60 },
      tables: ctx.tables,
      busy: ctx.busy,
      online,
    }).map((s) => ({ time: s.time, startsAt: s.startsAt.toISOString(), available: s.available }));
  }

  async listDay(organizationId: string, outletId: string, date: string) {
    const outlet = await this.prisma.outlet.findFirstOrThrow({ where: { id: outletId, organizationId } });
    const { start, end } = localDayRange(date, outlet.timezone);
    const rows = await this.prisma.reservation.findMany({
      where: { outletId, organizationId, startsAt: { gte: start, lt: end } },
      include: { guest: true },
      orderBy: { startsAt: 'asc' },
    });
    const msgs = await this.messaging.forEntity(
      organizationId,
      'Reservation',
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...this.staffView(r), messages: msgs.filter((m) => m.entityId === r.id) }));
  }

  staffView(
    r: Reservation & {
      guest: {
        id: string;
        name: string | null;
        phone: string | null;
        visits: number;
        allergies: string | null;
        notes: string | null;
        deletedAt: Date | null;
      };
    },
  ) {
    return {
      id: r.id,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      partySize: r.partySize,
      status: r.status,
      channel: r.channel,
      tableIds: r.tableIds,
      sectionId: r.sectionId,
      notes: r.notes,
      heldAt: r.heldAt,
      seatingId: r.seatingId,
      guest: {
        id: r.guest.id,
        name: r.guest.name,
        phone: r.guest.phone,
        phoneMasked: r.guest.phone ? maskPhone(r.guest.phone) : null,
        visits: r.guest.visits,
        allergies: r.guest.allergies,
        notes: r.guest.notes,
        erased: !!r.guest.deletedAt,
      },
    };
  }

  /** What the guest sees on the manage page (no internal ids beyond the booking). */
  async guestView(reservationId: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guest: true, outlet: { include: { settings: true } } },
    });
    if (!r) throw AppError.notFound('Booking');
    const tz = r.outlet.timezone;
    return {
      status: r.status,
      startsAt: r.startsAt,
      date: localDate(r.startsAt, tz),
      time: localTime(r.startsAt, tz),
      partySize: r.partySize,
      name: r.guest.name,
      notes: r.notes,
      consents: (r.guest.consentFlags ?? {}) as ConsentFlags,
      outlet: { name: r.outlet.name, address: r.outlet.address, slug: r.outlet.slug, timezone: tz },
      canChange: r.status === 'CONFIRMED' && r.startsAt.getTime() > Date.now(),
      maxPartySize: r.outlet.settings?.bookingMaxPartySize ?? 8,
    };
  }

  // ───────── writes ─────────

  private async lock(tx: Tx, outletId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'book:' + outletId}))`;
  }

  /** Creates a booking. Online: only an available slot of the booking page; staff: any time, any table. */
  async book(
    organizationId: string,
    outletId: string,
    input: BookInput,
    opts: { channel: 'ONLINE' | 'STAFF'; audit: AuditActor },
  ) {
    const outlet = await this.prisma.outlet.findFirstOrThrow({
      where: { id: outletId, organizationId },
      include: { settings: true },
    });
    const settings = outlet.settings!;
    const online = opts.channel === 'ONLINE';
    if (online) {
      if (!settings.bookingEnabled)
        throw new AppError('BOOKING_CLOSED', HttpStatus.CONFLICT, 'Online booking is off');
      const date = localDate(input.startsAt, outlet.timezone);
      const ok = (await this.slots(outletId, settings, outlet.timezone, date, input.partySize, true)).some(
        (s) => s.available && new Date(s.startsAt).getTime() === input.startsAt.getTime(),
      );
      if (!ok) throw new AppError('NO_AVAILABILITY', HttpStatus.CONFLICT, 'That time is no longer available');
    }
    const minutes = input.durationMinutes ?? turnMinutes(input.partySize, rulesOf(settings).turnMinutes);
    const endsAt = new Date(input.startsAt.getTime() + minutes * 60_000);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, outletId);
      const ctx = await this.context(tx, outletId, settings, input.startsAt, endsAt);
      const tableIds = this.chooseTables(ctx, input, endsAt, online);
      const guest = await upsertGuestByPhone(tx, organizationId, input.phone, {
        name: input.name,
        consents: input.consents,
        source: online ? 'BOOKING_PAGE' : 'STAFF',
        actorId: opts.audit.type === 'USER' ? (opts.audit.id ?? null) : null,
        locale: input.locale,
      });
      const r = await tx.reservation.create({
        data: {
          organizationId,
          outletId,
          guestId: guest.id,
          partySize: input.partySize,
          startsAt: input.startsAt,
          endsAt,
          channel: opts.channel,
          tableIds,
          sectionId: input.sectionId ?? null,
          notes: input.notes ?? null,
          createdById: opts.audit.type === 'USER' ? (opts.audit.id ?? null) : null,
        },
        include: { guest: true },
      });
      await this.audit.recordAs(
        { ...opts.audit, ...(online ? { type: 'GUEST' as const, id: guest.id } : {}) },
        {
          action: 'reservation.create',
          entityType: 'Reservation',
          entityId: r.id,
          outletId,
          after: { startsAt: r.startsAt, partySize: r.partySize, tableIds, channel: opts.channel },
        },
        tx,
      );
      await this.messaging.queue(tx, this.bookingMessage('BOOKING_CONFIRMED', r, guest, outlet));
      return r;
    });
    this.announce(created);
    return { reservation: this.staffView(created), manageToken: this.manageToken(created.id) };
  }

  private chooseTables(
    ctx: { tables: BookTable[]; busy: Busy[] },
    input: { partySize: number; startsAt: Date; sectionId?: string; tableIds?: string[] },
    endsAt: Date,
    online: boolean,
    ignoreReservationId?: string,
  ): string[] {
    if (input.tableIds?.length) {
      const known = new Set(ctx.tables.map((t) => t.id));
      if (!input.tableIds.every((id) => known.has(id))) throw AppError.notFound('Table');
      const clash = ctx.busy.some(
        (b) =>
          b.reservationId !== ignoreReservationId &&
          b.from < endsAt &&
          input.startsAt < b.to &&
          b.tableIds.some((id) => input.tableIds!.includes(id)),
      );
      if (clash)
        throw new AppError('NO_AVAILABILITY', HttpStatus.CONFLICT, 'That table is booked or occupied then');
      return input.tableIds;
    }
    const ids = pickTables(ctx.tables, ctx.busy, {
      partySize: input.partySize,
      from: input.startsAt,
      to: endsAt,
      sectionId: input.sectionId ?? null,
      online,
      ignoreReservationId,
    });
    if (!ids) throw new AppError('NO_AVAILABILITY', HttpStatus.CONFLICT, 'No table is free for that time');
    return ids;
  }

  /** Move / resize / re-table a booking (staff patch or guest reschedule). */
  async change(
    organizationId: string,
    outletId: string,
    reservationId: string,
    input: ReservationPatchInput,
    opts: { online: boolean; audit: AuditActor },
  ) {
    const outlet = await this.prisma.outlet.findFirstOrThrow({
      where: { id: outletId, organizationId },
      include: { settings: true },
    });
    const settings = outlet.settings!;
    const current = await this.prisma.reservation.findFirst({
      where: { id: reservationId, organizationId, outletId },
    });
    if (!current) throw AppError.notFound('Booking');
    if (current.status !== 'CONFIRMED')
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `A ${current.status.toLowerCase()} booking cannot be changed`,
      );
    const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
    const partySize = input.partySize ?? current.partySize;
    if (opts.online && input.startsAt) {
      const date = localDate(startsAt, outlet.timezone);
      const free = await this.slots(outletId, settings, outlet.timezone, date, partySize, true);
      // The booking's own slot counts as free for itself.
      const ok =
        startsAt.getTime() === current.startsAt.getTime() ||
        free.some((s) => s.available && new Date(s.startsAt).getTime() === startsAt.getTime());
      if (!ok) throw new AppError('NO_AVAILABILITY', HttpStatus.CONFLICT, 'That time is not available');
    }
    const minutes =
      input.durationMinutes ??
      (input.partySize || input.startsAt
        ? turnMinutes(partySize, rulesOf(settings).turnMinutes)
        : (current.endsAt.getTime() - current.startsAt.getTime()) / 60_000);
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

    const moved = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, outletId);
      const ctx = await this.context(tx, outletId, settings, startsAt, endsAt);
      const keepTables =
        !input.tableIds && !input.partySize && !input.startsAt && !input.durationMinutes
          ? current.tableIds
          : undefined;
      const tableIds =
        keepTables ??
        this.chooseTables(
          ctx,
          { partySize, startsAt, sectionId: current.sectionId ?? undefined, tableIds: input.tableIds },
          endsAt,
          opts.online,
          current.id,
        );
      const r = await tx.reservation.update({
        where: { id: current.id },
        data: {
          startsAt,
          endsAt,
          partySize,
          tableIds,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          // Moved away from a held table: the hold is re-evaluated by the sweep.
          ...(current.heldAt &&
          (tableIds.join() !== current.tableIds.join() || startsAt.getTime() !== current.startsAt.getTime())
            ? { heldAt: null, holdAlertAt: null }
            : {}),
        },
        include: { guest: true },
      });
      await this.audit.recordAs(
        opts.audit,
        {
          action: 'reservation.update',
          entityType: 'Reservation',
          entityId: r.id,
          outletId,
          before: { startsAt: current.startsAt, partySize: current.partySize, tableIds: current.tableIds },
          after: { startsAt: r.startsAt, partySize: r.partySize, tableIds: r.tableIds },
        },
        tx,
      );
      if (r.startsAt.getTime() !== current.startsAt.getTime() || r.partySize !== current.partySize)
        await this.messaging.queue(tx, {
          ...this.bookingMessage('BOOKING_CHANGED', r, r.guest, outlet),
          dedupeSuffix: `${r.startsAt.getTime()}-${r.partySize}`,
        });
      return r;
    });
    if (current.heldAt && !moved.heldAt)
      await this.releaseHolds(organizationId, outletId, current.tableIds, current.id);
    this.announce(moved);
    return this.staffView(moved);
  }

  async cancel(
    organizationId: string,
    outletId: string,
    reservationId: string,
    by: 'GUEST' | 'STAFF',
    audit: AuditActor,
  ) {
    return this.close(organizationId, outletId, reservationId, 'CANCELLED', by, audit);
  }

  async noShow(organizationId: string, outletId: string, reservationId: string, audit: AuditActor) {
    return this.close(organizationId, outletId, reservationId, 'NO_SHOW', 'STAFF', audit);
  }

  private async close(
    organizationId: string,
    outletId: string,
    reservationId: string,
    status: 'CANCELLED' | 'NO_SHOW',
    by: 'GUEST' | 'STAFF',
    audit: AuditActor,
  ) {
    const now = new Date();
    const r = await this.prisma.$transaction(async (tx) => {
      const current = await tx.reservation.findFirst({
        where: { id: reservationId, organizationId, outletId },
      });
      if (!current) throw AppError.notFound('Booking');
      if (current.status !== 'CONFIRMED')
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          `This booking is already ${current.status.toLowerCase()}`,
        );
      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data:
          status === 'CANCELLED' ? { status, cancelledAt: now, cancelledBy: by } : { status, noShowAt: now },
        include: { guest: true },
      });
      await this.audit.recordAs(
        audit,
        {
          action: `reservation.${status === 'CANCELLED' ? 'cancel' : 'no_show'}`,
          entityType: 'Reservation',
          entityId: reservationId,
          outletId,
          after: { by },
        },
        tx,
      );
      return updated;
    });
    if (r.heldAt) await this.releaseHolds(organizationId, outletId, r.tableIds, r.id);
    this.announce(r);
    return this.staffView(r);
  }

  /** The party arrived: seat them on the booked (or chosen) tables through the state machine. */
  async checkIn(
    organizationId: string,
    outletId: string,
    reservationId: string,
    tableIdsOverride: string[] | undefined,
    actor: Parameters<TableStateService['apply']>[0]['actor'],
    audit: AuditActor,
  ) {
    const r = await this.prisma.reservation.findFirst({
      where: { id: reservationId, organizationId, outletId },
    });
    if (!r) throw AppError.notFound('Booking');
    if (r.status !== 'CONFIRMED')
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, `This booking is ${r.status.toLowerCase()}`);
    const [primary, ...join] = tableIdsOverride?.length ? tableIdsOverride : r.tableIds;
    if (!primary) throw new AppError('NO_AVAILABILITY', HttpStatus.CONFLICT, 'Pick a table for this party');
    const out = await this.tables.apply({
      organizationId,
      outletId,
      tableId: primary,
      event: { type: 'HOST_SEAT', partySize: r.partySize, source: 'RESERVATION' },
      actor,
      audit,
      source: 'STAFF',
      seat: { joinTableIds: join, guestId: r.guestId, reservationId: r.id, notes: r.notes ?? undefined },
    });
    const seating = await this.prisma.seatingTable.findFirst({
      where: { tableId: primary, isOpen: true },
      select: { seatingId: true },
    });
    const updated = await this.prisma.reservation.update({
      where: { id: r.id },
      data: {
        status: 'SEATED',
        seatedAt: new Date(),
        seatingId: seating?.seatingId ?? null,
        ...(tableIdsOverride?.length ? { tableIds: tableIdsOverride } : {}),
      },
      include: { guest: true },
    });
    // Tables that were held for this booking but not used are freed.
    const unused = r.heldAt ? r.tableIds.filter((id) => ![primary, ...join].includes(id)) : [];
    if (unused.length) await this.releaseHolds(organizationId, outletId, unused, r.id);
    this.announce(updated);
    return { reservation: this.staffView(updated), tables: out.tables };
  }

  private bookingMessage(
    purpose: 'BOOKING_CONFIRMED' | 'BOOKING_CHANGED' | 'BOOKING_REMINDER',
    r: Reservation,
    guest: QueueInput['guest'] & { name: string | null },
    outlet: { name: string; timezone: string },
  ): QueueInput {
    const when = guestDateTime(r.startsAt, outlet.timezone, guest.locale);
    return {
      organizationId: r.organizationId,
      outletId: r.outletId,
      guest,
      purpose,
      entityType: 'Reservation',
      entityId: r.id,
      vars: {
        name: guest.name ?? '',
        outlet: outlet.name,
        party: String(r.partySize),
        date: when.date,
        time: when.time,
        link: this.messaging.link(`/b/manage/${this.manageToken(r.id)}`),
      },
    };
  }

  // ───────── walk-ins at the door ─────────

  /** Best free table(s) right now for a party (no booking due on them within the party's turn time). */
  async suggestNow(outletId: string, partySize: number, now = new Date()): Promise<string[]> {
    const settings = await this.prisma.outletSettings.findUniqueOrThrow({ where: { outletId } });
    const to = new Date(now.getTime() + turnMinutes(partySize, rulesOf(settings).turnMinutes) * 60_000);
    const ctx = await this.context(this.prisma, outletId, settings, now, to);
    const free = new Set(ctx.tableRows.filter((t) => t.status === 'VACANT').map((t) => t.id));
    return (
      pickTables(
        ctx.tables.filter((t) => free.has(t.id)),
        ctx.busy,
        { partySize, from: now, to, online: false },
      ) ?? []
    );
  }

  /** The entrance camera saw a group arrive: remember it and tell the host where they could sit. */
  async recordArrival(
    camera: { id: string; organizationId: string; outletId: string },
    count: number,
    at: Date,
  ) {
    const suggestedTableIds = await this.suggestNow(camera.outletId, count);
    const a = await this.prisma.doorArrival.create({
      data: {
        organizationId: camera.organizationId,
        outletId: camera.outletId,
        cameraId: camera.id,
        count,
        at,
        suggestedTableIds,
      },
    });
    this.realtime.emit(
      [
        rooms.role('HOST', camera.outletId),
        rooms.role('MANAGER', camera.outletId),
        rooms.role('OWNER', camera.outletId),
      ],
      'door.arrival',
      { outletId: camera.outletId, arrivalId: a.id, count, suggestedTableIds },
    );
    return a;
  }

  recentArrivals(organizationId: string, outletId: string, now = new Date()) {
    return this.prisma.doorArrival.findMany({
      where: {
        organizationId,
        outletId,
        dismissedAt: null,
        at: { gte: new Date(now.getTime() - 15 * 60_000) },
      },
      orderBy: { at: 'desc' },
      take: 10,
    });
  }

  async dismissArrival(organizationId: string, outletId: string, id: string) {
    const r = await this.prisma.doorArrival.updateMany({
      where: { id, organizationId, outletId },
      data: { dismissedAt: new Date() },
    });
    if (!r.count) throw AppError.notFound('Arrival');
    return { ok: true };
  }

  // ───────── holds & no-shows ─────────

  async releaseHolds(organizationId: string, outletId: string, tableIds: string[], reservationId: string) {
    for (const tableId of tableIds) {
      // Another booking may hold the same table right after this one; leave it held then.
      const other = await this.prisma.reservation.findFirst({
        where: {
          id: { not: reservationId },
          status: 'CONFIRMED',
          heldAt: { not: null },
          tableIds: { has: tableId },
        },
      });
      if (other) continue;
      const t = await this.prisma.table.findUnique({ where: { id: tableId }, select: { status: true } });
      if (t?.status !== 'RESERVED') continue;
      await this.tables
        .apply({
          organizationId,
          outletId,
          tableId,
          event: { type: 'RELEASE_HOLD' },
          actor: { kind: 'SYSTEM' },
          audit: { organizationId, type: 'SYSTEM' },
          source: 'SYSTEM',
        })
        .catch((e: unknown) => this.logger.warn(`release hold ${tableId}: ${String(e)}`));
    }
  }

  /**
   * Holds tables `reservationHoldMinutes` before a booking (RESERVED; a walk-in seated there raises an alert),
   * warns the host once if a booked table is still occupied, and marks bookings not checked in within
   * `noShowGraceMinutes` as no-shows, releasing their tables. Idempotent; driven by a timer and by tests.
   */
  async sweep(now = new Date()) {
    const due = await this.prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        // Wide enough for reminders (up to a day ahead) and late no-shows.
        startsAt: {
          lte: new Date(now.getTime() + 25 * 3600_000),
          gte: new Date(now.getTime() - 180 * 60_000),
        },
      },
      include: { outlet: { include: { settings: true } }, guest: true },
    });
    let held = 0;
    let noShows = 0;
    for (const r of due) {
      const s = r.outlet.settings;
      if (!s) continue;
      const remindAt = r.startsAt.getTime() - s.bookingReminderMinutes * 60_000;
      // Reminder once (dedupe), only for bookings made well before — a booking for tonight made at 7 pm needs none.
      if (
        s.bookingReminderMinutes &&
        now.getTime() >= remindAt &&
        now < r.startsAt &&
        r.createdAt.getTime() < remindAt
      )
        await this.prisma.$transaction((tx) =>
          this.messaging.queue(tx, this.bookingMessage('BOOKING_REMINDER', r, r.guest, r.outlet)),
        );
      const holdFrom = r.startsAt.getTime() - s.reservationHoldMinutes * 60_000;
      const graceEnd = r.startsAt.getTime() + s.noShowGraceMinutes * 60_000;
      if (now.getTime() >= graceEnd) {
        await this.close(r.organizationId, r.outletId, r.id, 'NO_SHOW', 'STAFF', {
          organizationId: r.organizationId,
          type: 'SYSTEM',
        });
        noShows++;
        continue;
      }
      if (now.getTime() < holdFrom || r.heldAt || !s.reservationHoldMinutes) continue;
      const tables = await this.prisma.table.findMany({
        where: { id: { in: r.tableIds } },
        select: { id: true, status: true, label: true },
      });
      const busy = tables.filter((t) => t.status !== 'VACANT' && t.status !== 'RESERVED');
      if (busy.length) {
        if (!r.holdAlertAt) {
          await this.raiseTableNotFree(
            r,
            busy.map((t) => t.label),
          );
          await this.prisma.reservation.update({ where: { id: r.id }, data: { holdAlertAt: now } });
        }
        continue;
      }
      for (const t of tables.filter((x) => x.status === 'VACANT')) {
        await this.tables.apply({
          organizationId: r.organizationId,
          outletId: r.outletId,
          tableId: t.id,
          event: { type: 'HOLD_FOR_RESERVATION' },
          actor: { kind: 'SYSTEM' },
          audit: { organizationId: r.organizationId, type: 'SYSTEM' },
          source: 'SYSTEM',
          payload: { reservationId: r.id },
        });
      }
      const updated = await this.prisma.reservation.update({
        where: { id: r.id },
        data: { heldAt: now },
        include: { guest: true },
      });
      this.announce(updated);
      held++;
    }
    return { held, noShows };
  }

  private async raiseTableNotFree(r: Reservation & { guest: { name: string | null } }, labels: string[]) {
    const message =
      `Booking ${r.guest.name ?? ''} (${r.partySize}) is due but ${labels.join(', ')} is still occupied`.replace(
        /\s+/g,
        ' ',
      );
    const alert: Alert = await this.prisma.alert.create({
      data: {
        organizationId: r.organizationId,
        outletId: r.outletId,
        type: 'RESERVED_TABLE_TAKEN',
        severity: 'WARNING',
        tableId: r.tableIds[0] ?? null,
        payload: { reservationId: r.id },
        message,
        dedupeKey: `RESERVED_TABLE_TAKEN:${r.id}`,
      },
    });
    this.realtime.emit(
      [rooms.role('MANAGER', r.outletId), rooms.role('OWNER', r.outletId), rooms.role('HOST', r.outletId)],
      'alert.created',
      {
        id: alert.id,
        outletId: r.outletId,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        tableId: alert.tableId,
        message,
        createdAt: alert.createdAt.toISOString(),
      },
    );
    await this.notifier.alertRaised(alert).catch(() => undefined);
  }

  private announce(r: { id: string; outletId: string; status: string }) {
    this.realtime.emit(rooms.outlet(r.outletId), 'reservation.updated', {
      outletId: r.outletId,
      reservationId: r.id,
      status: r.status,
    });
  }
}
