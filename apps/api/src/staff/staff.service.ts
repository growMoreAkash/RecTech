import { HttpStatus, Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import {
  type CreateStaffInput,
  localDate,
  localDayRange,
  rooms,
  type ShiftInput,
  type UpdateShiftInput,
  type UpdateStaffInput,
} from '@dinesense/shared';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../auth/crypto';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { hasRoleIn, MANAGER_ROLES } from '../common/roles';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Roles only an OWNER may grant (managers cannot promote themselves or others above staff). */
const PRIVILEGED: readonly Role[] = ['OWNER', 'MANAGER'];
/** Check-in window opens this long before the scheduled start. */
const EARLY_CHECK_IN_MS = 60 * 60_000;

const staffSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  active: true,
  pinHash: true,
  roles: { select: { outletId: true, role: true } },
} as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(ctx: RequestContext, outletId: string) {
    const users = await this.prisma.forOrg(ctx.user.org).user.findMany({
      where: { roles: { some: { outletId } } },
      select: staffSelect,
      orderBy: { name: 'asc' },
    });
    return users.map(({ pinHash, roles, ...u }) => ({
      ...u,
      hasPin: pinHash !== null,
      roles: roles.filter((r) => r.outletId === outletId).map((r) => r.role),
    }));
  }

  async create(ctx: RequestContext, outletId: string, input: CreateStaffInput) {
    this.assertMayGrant(ctx, outletId, [input.role]);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: ctx.user.org,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          passwordHash: input.password ? await hashSecret(input.password) : null,
          pinHash: await hashSecret(input.pin),
          roles: { create: { outletId, role: input.role } },
        },
        select: { id: true, name: true, email: true },
      });
      await this.audit.record(
        ctx,
        {
          action: 'staff.create',
          entityType: 'User',
          entityId: created.id,
          outletId,
          after: { ...created, role: input.role },
        },
        tx,
      );
      return created;
    });
    return { ...user, roles: [input.role] };
  }

  async update(ctx: RequestContext, outletId: string, userId: string, input: UpdateStaffInput) {
    const target = await this.prisma.forOrg(ctx.user.org).user.findFirst({
      where: { id: userId, roles: { some: { outletId } } },
      select: staffSelect,
    });
    if (!target) throw AppError.notFound('Staff member');
    const current = target.roles.filter((r) => r.outletId === outletId).map((r) => r.role);
    // Touching an owner/manager (or granting those roles) needs an owner.
    this.assertMayGrant(ctx, outletId, [
      ...(input.roles ?? []),
      ...current.filter((r) => PRIVILEGED.includes(r)),
    ]);
    if (userId === ctx.user.sub && input.active === false)
      throw AppError.forbidden('You cannot deactivate yourself');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.pin ? { pinHash: await hashSecret(input.pin) } : {}),
        },
      });
      if (input.roles) {
        await tx.userOutletRole.deleteMany({ where: { userId, outletId } });
        await tx.userOutletRole.createMany({
          data: [...new Set(input.roles)].map((role) => ({ userId, outletId, role })),
        });
      }
      if (input.active === false || input.roles) {
        // Role changes and deactivation take effect immediately: kill open sessions.
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const { pin: _pin, ...auditable } = input;
      await this.audit.record(
        ctx,
        {
          action: 'staff.update',
          entityType: 'User',
          entityId: userId,
          outletId,
          before: { name: target.name, active: target.active, roles: current },
          after: { ...auditable, pinChanged: input.pin !== undefined },
        },
        tx,
      );
    });
    return (await this.list(ctx, outletId)).find((u) => u.id === userId);
  }

  private assertMayGrant(ctx: RequestContext, outletId: string, roles: readonly Role[]): void {
    if (roles.some((r) => PRIVILEGED.includes(r)) && !hasRoleIn(ctx, outletId, ['OWNER'])) {
      throw AppError.forbidden('Only an owner can manage owner or manager accounts');
    }
  }

  // ───────── Shifts ─────────

  async listShifts(ctx: RequestContext, outletId: string, date?: string) {
    const outlet = await this.prisma
      .forOrg(ctx.user.org)
      .outlet.findUniqueOrThrow({ where: { id: outletId } });
    const day = date ?? localDate(new Date(), outlet.timezone);
    const { start, end } = localDayRange(day, outlet.timezone);
    const shifts = await this.prisma.forOrg(ctx.user.org).shift.findMany({
      where: { outletId, startsAt: { lt: end }, endsAt: { gt: start } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ startsAt: 'asc' }, { checkInSeq: 'asc' }],
    });
    return { date: day, shifts };
  }

  async createShift(ctx: RequestContext, outletId: string, input: ShiftInput) {
    await this.assertShiftRefs(ctx, outletId, input.userId, input.role, input.sectionIds);
    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: {
          organizationId: ctx.user.org,
          outletId,
          userId: input.userId,
          role: input.role,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          sectionIds: input.sectionIds,
          maxTables: input.maxTables ?? null,
          assignmentMode: input.assignmentMode ?? null,
        },
      });
      await this.audit.record(
        ctx,
        { action: 'shift.create', entityType: 'Shift', entityId: shift.id, outletId, after: shift },
        tx,
      );
      this.shiftChanged(outletId, shift);
      return shift;
    });
  }

  async updateShift(ctx: RequestContext, outletId: string, shiftId: string, input: UpdateShiftInput) {
    const before = await this.findShift(ctx, outletId, shiftId);
    if (input.sectionIds)
      await this.assertShiftRefs(ctx, outletId, before.userId, before.role, input.sectionIds);
    const startsAt = input.startsAt ?? before.startsAt;
    const endsAt = input.endsAt ?? before.endsAt;
    if (endsAt <= startsAt) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Shift must end after it starts', [
        { path: 'endsAt', message: 'Shift must end after it starts' },
      ]);
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.shift.update({ where: { id: shiftId }, data: input });
      await this.audit.record(
        ctx,
        { action: 'shift.update', entityType: 'Shift', entityId: shiftId, outletId, before, after },
        tx,
      );
      this.shiftChanged(outletId, after);
      return after;
    });
  }

  async deleteShift(ctx: RequestContext, outletId: string, shiftId: string) {
    const shift = await this.findShift(ctx, outletId, shiftId);
    if (shift.checkedInAt)
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'A shift that has started cannot be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.shift.delete({ where: { id: shiftId } });
      await this.audit.record(
        ctx,
        { action: 'shift.delete', entityType: 'Shift', entityId: shiftId, outletId, before: shift },
        tx,
      );
    });
    this.shiftChanged(outletId, shift);
  }

  /**
   * Check-in assigns a per-outlet, monotonically increasing `checkInSeq` — the stable round-robin order (PLAN §5).
   * Serialized with a transaction-scoped advisory lock so two simultaneous check-ins never share a number.
   */
  async checkIn(ctx: RequestContext, outletId: string, shiftId: string) {
    const shift = await this.findShift(ctx, outletId, shiftId);
    this.assertSelfOrManager(ctx, outletId, shift.userId);
    const now = new Date();
    if (shift.checkedInAt) throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Already checked in');
    if (now.getTime() < shift.startsAt.getTime() - EARLY_CHECK_IN_MS || now >= shift.endsAt) {
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'This shift is not open for check-in now');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'checkin:' + outletId}))`;
      const { _max } = await tx.shift.aggregate({ where: { outletId }, _max: { checkInSeq: true } });
      const after = await tx.shift.update({
        where: { id: shiftId },
        data: { checkedInAt: now, checkInSeq: (_max.checkInSeq ?? 0) + 1 },
      });
      await this.audit.record(
        ctx,
        {
          action: 'shift.check_in',
          entityType: 'Shift',
          entityId: shiftId,
          outletId,
          after: { checkInSeq: after.checkInSeq },
        },
        tx,
      );
      this.shiftChanged(outletId, after);
      return after;
    });
  }

  async checkOut(ctx: RequestContext, outletId: string, shiftId: string) {
    const shift = await this.findShift(ctx, outletId, shiftId);
    this.assertSelfOrManager(ctx, outletId, shift.userId);
    if (!shift.checkedInAt || shift.checkedOutAt)
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Not checked in');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.shift.update({
        where: { id: shiftId },
        data: { checkedOutAt: new Date(), onBreak: false, breakStartedAt: null },
      });
      await this.audit.record(
        ctx,
        { action: 'shift.check_out', entityType: 'Shift', entityId: shiftId, outletId },
        tx,
      );
      this.shiftChanged(outletId, after);
      return after;
    });
  }

  async setBreak(ctx: RequestContext, outletId: string, shiftId: string, onBreak: boolean) {
    const shift = await this.findShift(ctx, outletId, shiftId);
    this.assertSelfOrManager(ctx, outletId, shift.userId);
    if (!shift.checkedInAt || shift.checkedOutAt)
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Not checked in');
    if (shift.onBreak === onBreak) return shift;
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.shift.update({
        where: { id: shiftId },
        data: { onBreak, breakStartedAt: onBreak ? new Date() : null },
      });
      await this.audit.record(
        ctx,
        {
          action: onBreak ? 'shift.break_start' : 'shift.break_end',
          entityType: 'Shift',
          entityId: shiftId,
          outletId,
        },
        tx,
      );
      this.shiftChanged(outletId, after);
      return after;
    });
  }

  private async findShift(ctx: RequestContext, outletId: string, shiftId: string) {
    const shift = await this.prisma
      .forOrg(ctx.user.org)
      .shift.findFirst({ where: { id: shiftId, outletId } });
    if (!shift) throw AppError.notFound('Shift');
    return shift;
  }

  private assertSelfOrManager(ctx: RequestContext, outletId: string, userId: string): void {
    if (userId !== ctx.user.sub && !hasRoleIn(ctx, outletId, MANAGER_ROLES)) {
      throw AppError.forbidden('You can only change your own shift');
    }
  }

  private async assertShiftRefs(
    ctx: RequestContext,
    outletId: string,
    userId: string,
    role: Role,
    sectionIds: string[],
  ) {
    const db = this.prisma.forOrg(ctx.user.org);
    const holds = await db.user.findFirst({
      where: { id: userId, active: true, roles: { some: { outletId, role } } },
    });
    if (!holds) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'This person does not have that role here',
        [{ path: 'role', message: 'Role not held at this outlet' }],
      );
    }
    const found = await db.section.count({ where: { id: { in: sectionIds }, outletId, archivedAt: null } });
    if (found !== new Set(sectionIds).size) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Unknown section', [
        { path: 'sectionIds', message: 'Unknown section' },
      ]);
    }
  }

  private shiftChanged(outletId: string, shift: { id: string; userId: string }): void {
    this.realtime.emit(rooms.outlet(outletId), 'shift.updated', {
      outletId,
      shiftId: shift.id,
      userId: shift.userId,
    });
  }
}
