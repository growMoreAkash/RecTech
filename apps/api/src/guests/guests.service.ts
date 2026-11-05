import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { type ConsentFlags, type GuestPatchInput, localized, maskPhone } from '@dinesense/shared';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SeatingEvents } from '../table-state/seating-events';
import { applyConsents, type ConsentSource } from './guest-identity';

type GuestRow = Prisma.GuestGetPayload<object>;

/**
 * Guest profiles (CRM core) and DPDP rights. Personal data lives only on `Guest`; erasure nulls it and keeps the
 * row for anonymous aggregates (visits, spend) and legally required invoices.
 */
@Injectable()
export class GuestsService implements OnModuleInit {
  private readonly logger = new Logger(GuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly seatings: SeatingEvents,
  ) {}

  onModuleInit() {
    this.seatings.onClosed(async (e) => {
      const s = await this.prisma.seating.findUnique({
        where: { id: e.seatingId },
        select: { guestId: true },
      });
      if (s?.guestId) await this.recomputeStats(s.guestId);
    });
  }

  view(g: GuestRow, upcoming: unknown[] = []) {
    return {
      id: g.id,
      phone: g.phone,
      phoneMasked: g.phone ? maskPhone(g.phone) : null,
      name: g.name,
      birthday: g.birthday,
      notes: g.notes,
      allergies: g.allergies,
      consents: (g.consentFlags ?? {}) as ConsentFlags,
      visits: g.visits,
      lastVisitAt: g.lastVisitAt,
      totalSpendPaise: g.totalSpendPaise,
      favourites: g.favourites as { name: string; count: number }[],
      erased: !!g.deletedAt,
      createdAt: g.createdAt,
      upcoming,
    };
  }

  private async load(organizationId: string, guestId: string) {
    const g = await this.prisma.guest.findFirst({ where: { id: guestId, organizationId } });
    if (!g) throw AppError.notFound('Guest');
    return g;
  }

  private upcoming(guestId: string) {
    return this.prisma.reservation.findMany({
      where: { guestId, status: 'CONFIRMED', startsAt: { gte: new Date(Date.now() - 3 * 3600_000) } },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: { id: true, outletId: true, startsAt: true, partySize: true, tableIds: true },
    });
  }

  /** Recognition at the door / on the phone. Every look at personal data is audited. */
  async lookup(organizationId: string, phone: string, audit: AuditActor, outletId: string) {
    const g = await this.prisma.guest.findUnique({
      where: { organizationId_phone: { organizationId, phone } },
    });
    if (!g || g.deletedAt) return { guest: null };
    await this.audit.recordAs(audit, {
      action: 'guest.lookup',
      entityType: 'Guest',
      entityId: g.id,
      outletId,
    });
    return { guest: this.view(g, await this.upcoming(g.id)) };
  }

  async get(organizationId: string, guestId: string, audit: AuditActor, outletId: string) {
    const g = await this.load(organizationId, guestId);
    await this.audit.recordAs(audit, { action: 'guest.view', entityType: 'Guest', entityId: g.id, outletId });
    return this.view(g, await this.upcoming(g.id));
  }

  async search(organizationId: string, q: string | undefined, take = 50) {
    const where: Prisma.GuestWhereInput = { organizationId, deletedAt: null };
    if (q?.trim()) {
      const digits = q.replace(/\D/g, '');
      where.OR = [
        { name: { contains: q.trim(), mode: 'insensitive' } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
      ];
    }
    const rows = await this.prisma.guest.findMany({
      where,
      orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take,
    });
    return rows.map((g) => this.view(g));
  }

  async update(
    organizationId: string,
    guestId: string,
    input: GuestPatchInput,
    audit: AuditActor,
    outletId: string,
    source: ConsentSource = 'STAFF',
  ) {
    const g = await this.load(organizationId, guestId);
    if (g.deletedAt) throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'This guest’s data was erased');
    const { consents, ...fields } = input;
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = Object.keys(fields).length
        ? await tx.guest.update({ where: { id: g.id }, data: fields })
        : g;
      const flags = await applyConsents(tx, updated, consents, source, audit.id ?? null);
      await this.audit.recordAs(
        audit,
        {
          action: 'guest.update',
          entityType: 'Guest',
          entityId: g.id,
          outletId,
          // Field names only: the audit log must not become a second copy of personal data.
          after: { fields: Object.keys(fields), consents: consents ?? undefined },
        },
        tx,
      );
      return { ...updated, consentFlags: flags as Prisma.JsonValue };
    });
    return this.view(after, await this.upcoming(g.id));
  }

  /** DPDP access right: everything we hold about the guest, as JSON. */
  async export(organizationId: string, guestId: string, audit: AuditActor, outletId: string) {
    const g = await this.load(organizationId, guestId);
    const [consents, reservations, seatings] = await Promise.all([
      this.prisma.guestConsent.findMany({ where: { guestId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.reservation.findMany({ where: { guestId }, orderBy: { startsAt: 'asc' } }),
      this.prisma.seating.findMany({
        where: { guestId },
        orderBy: { seatedAt: 'asc' },
        select: {
          outlet: { select: { name: true } },
          seatedAt: true,
          closedAt: true,
          partySize: true,
          orders: {
            where: { status: 'ACCEPTED' },
            select: {
              items: { where: { status: { not: 'VOID' } }, select: { nameSnapshot: true, quantity: true } },
            },
          },
        },
      }),
    ]);
    await this.audit.recordAs(audit, {
      action: 'guest.export',
      entityType: 'Guest',
      entityId: g.id,
      outletId,
    });
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        phone: g.phone,
        name: g.name,
        birthday: g.birthday,
        notes: g.notes,
        allergies: g.allergies,
        consents: g.consentFlags,
        createdAt: g.createdAt,
        erasedAt: g.deletedAt,
      },
      consentHistory: consents.map((c) => ({
        purpose: c.purpose,
        granted: c.granted,
        source: c.source,
        at: c.createdAt,
      })),
      reservations: reservations.map((r) => ({
        startsAt: r.startsAt,
        partySize: r.partySize,
        status: r.status,
        notes: r.notes,
        createdAt: r.createdAt,
      })),
      visits: seatings.map((s) => ({
        outlet: s.outlet.name,
        seatedAt: s.seatedAt,
        leftAt: s.closedAt,
        partySize: s.partySize,
        items: s.orders.flatMap((o) =>
          o.items.map((i) => ({ name: localized(i.nameSnapshot, 'en'), quantity: i.quantity })),
        ),
      })),
    };
  }

  /** DPDP erasure (request or retention). Future bookings are cancelled; aggregates stay anonymous. */
  async erase(
    organizationId: string,
    guestId: string,
    reason: 'REQUEST' | 'RETENTION',
    audit: AuditActor,
    outletId?: string,
  ) {
    const g = await this.load(organizationId, guestId);
    if (g.deletedAt) return this.view(g);
    const now = new Date();
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.reservation.updateMany({
        where: { guestId, status: 'CONFIRMED', startsAt: { gt: now } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: 'STAFF', notes: null },
      });
      await tx.reservation.updateMany({ where: { guestId }, data: { notes: null } });
      await tx.seating.updateMany({ where: { guestId }, data: { notes: null } });
      const erased = await tx.guest.update({
        where: { id: guestId },
        data: {
          phone: null,
          name: null,
          birthday: null,
          notes: null,
          allergies: null,
          favourites: [],
          consentFlags: {},
          deletedAt: now,
        },
      });
      await this.audit.recordAs(
        audit,
        { action: 'guest.erase', entityType: 'Guest', entityId: guestId, outletId, after: { reason } },
        tx,
      );
      return erased;
    });
    return this.view(after);
  }

  auditPrivacy(
    audit: AuditActor,
    outletId: string,
    before: number,
    after: number,
    tx: Prisma.TransactionClient,
  ) {
    return this.audit.recordAs(
      audit,
      {
        action: 'org.privacy.update',
        entityType: 'Organization',
        entityId: audit.organizationId,
        outletId,
        before: { guestRetentionDays: before },
        after: { guestRetentionDays: after },
      },
      tx,
    );
  }

  /** Visit projection: visits, last visit, spend on paid bills, top items. Idempotent full recompute. */
  async recomputeStats(guestId: string) {
    const seatings = await this.prisma.seating.findMany({
      where: { guestId, status: 'CLOSED' },
      select: {
        seatedAt: true,
        bills: { where: { status: 'PAID' }, select: { totalPaise: true } },
        orders: {
          where: { status: 'ACCEPTED' },
          select: {
            items: { where: { status: { not: 'VOID' } }, select: { nameSnapshot: true, quantity: true } },
          },
        },
      },
    });
    const counts = new Map<string, number>();
    for (const s of seatings)
      for (const o of s.orders)
        for (const i of o.items) {
          const n = localized(i.nameSnapshot, 'en');
          counts.set(n, (counts.get(n) ?? 0) + i.quantity);
        }
    const favourites = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    await this.prisma.guest.update({
      where: { id: guestId },
      data: {
        visits: seatings.length,
        lastVisitAt: seatings.reduce<Date | null>((m, s) => (!m || s.seatedAt > m ? s.seatedAt : m), null),
        totalSpendPaise: seatings.reduce((t, s) => t + s.bills.reduce((x, b) => x + b.totalPaise, 0), 0),
        favourites,
      },
    });
  }

  /** Erases personal data of guests inactive longer than their organisation's retention period. */
  async retentionSweep(now = new Date()) {
    const orgs = await this.prisma.organization.findMany({
      where: { guestRetentionDays: { gt: 0 } },
      select: { id: true, guestRetentionDays: true },
    });
    let erased = 0;
    for (const org of orgs) {
      const cutoff = new Date(now.getTime() - org.guestRetentionDays * 86_400_000);
      const stale = await this.prisma.guest.findMany({
        where: {
          organizationId: org.id,
          deletedAt: null,
          OR: [{ lastVisitAt: { lt: cutoff } }, { lastVisitAt: null, createdAt: { lt: cutoff } }],
          reservations: { none: { startsAt: { gte: cutoff } } },
        },
        select: { id: true },
        take: 500,
      });
      for (const g of stale) {
        await this.erase(org.id, g.id, 'RETENTION', { organizationId: org.id, type: 'SYSTEM' });
        erased++;
      }
    }
    if (erased) this.logger.log(`retention: erased ${erased} guest profile(s)`);
    return erased;
  }
}
