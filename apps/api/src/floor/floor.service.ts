import { HttpStatus, Injectable } from '@nestjs/common';
import type { FloorPlanInput, SectionInput, TableStatus } from '@dinesense/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { rooms } from '@dinesense/shared';
import { TableViews } from '../table-state/table-views';

const qrToken = () => randomBytes(12).toString('base64url');
/** Tables in these states can be removed from the floor plan. */
const REMOVABLE: readonly TableStatus[] = ['VACANT', 'OUT_OF_SERVICE'];

const layoutSelect = {
  id: true,
  label: true,
  sectionId: true,
  capacity: true,
  minCapacity: true,
  shape: true,
  x: true,
  y: true,
  w: true,
  h: true,
  rotation: true,
  joinableWith: true,
} as const;

@Injectable()
export class FloorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly views: TableViews,
    private readonly realtime: RealtimeService,
  ) {}

  /** Everything the floor map needs in one call: sections, layout and live state. */
  async snapshot(ctx: RequestContext, outletId: string) {
    const db = this.prisma.forOrg(ctx.user.org);
    const [sections, tables, live, settings] = await Promise.all([
      db.section.findMany({
        where: { outletId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      db.table.findMany({
        where: { outletId, archivedAt: null },
        select: layoutSelect,
        orderBy: { label: 'asc' },
      }),
      this.views.load(ctx.user.org, outletId),
      db.outletSettings.findUnique({ where: { outletId }, select: { greetSlaSeconds: true } }),
    ]);
    const byId = new Map(live.map((l) => [l.tableId, l]));
    return {
      sections,
      greetSlaSeconds: settings?.greetSlaSeconds ?? 300,
      // Natural order: T2 before T10.
      tables: tables
        .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
        .map((t) => ({ ...t, live: byId.get(t.id)! })),
    };
  }

  createSection(ctx: RequestContext, outletId: string, input: SectionInput) {
    return this.prisma.$transaction(async (tx) => {
      const section = await tx.section.create({
        data: {
          organizationId: ctx.user.org,
          outletId,
          name: input.name,
          color: input.color ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.audit.record(
        ctx,
        { action: 'section.create', entityType: 'Section', entityId: section.id, outletId, after: section },
        tx,
      );
      this.changed(outletId);
      return section;
    });
  }

  updateSection(ctx: RequestContext, outletId: string, sectionId: string, input: Partial<SectionInput>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.section.findFirst({
        where: { id: sectionId, outletId, organizationId: ctx.user.org, archivedAt: null },
      });
      if (!before) throw AppError.notFound('Section');
      const after = await tx.section.update({ where: { id: sectionId }, data: input });
      await this.audit.record(
        ctx,
        { action: 'section.update', entityType: 'Section', entityId: sectionId, outletId, before, after },
        tx,
      );
      this.changed(outletId);
      return after;
    });
  }

  archiveSection(ctx: RequestContext, outletId: string, sectionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const section = await tx.section.findFirst({
        where: { id: sectionId, outletId, organizationId: ctx.user.org, archivedAt: null },
      });
      if (!section) throw AppError.notFound('Section');
      const inUse = await tx.table.count({ where: { sectionId, archivedAt: null } });
      if (inUse)
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'Move or remove the tables in this section first',
          { tables: inUse },
        );
      await tx.section.update({ where: { id: sectionId }, data: { archivedAt: new Date() } });
      await this.audit.record(
        ctx,
        { action: 'section.archive', entityType: 'Section', entityId: sectionId, outletId, before: section },
        tx,
      );
      this.changed(outletId);
    });
  }

  /**
   * Saves the whole floor plan from the editor: updates existing tables, creates new ones, archives removed ones.
   * Labels are swapped through temporary values so renames like T1↔T2 don't trip the unique index.
   */
  async savePlan(ctx: RequestContext, outletId: string, plan: FloorPlanInput) {
    await this.prisma.$transaction(async (tx) => {
      const where = { outletId, organizationId: ctx.user.org, archivedAt: null };
      const [existing, sections] = await Promise.all([
        tx.table.findMany({ where, select: { ...layoutSelect, status: true } }),
        tx.section.findMany({ where, select: { id: true } }),
      ]);
      const existingById = new Map(existing.map((t) => [t.id, t]));
      const sectionIds = new Set(sections.map((s) => s.id));

      for (const [i, t] of plan.tables.entries()) {
        if (t.id && !existingById.has(t.id)) throw AppError.notFound(`Table ${t.label}`);
        if (!sectionIds.has(t.sectionId)) {
          throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Unknown section', [
            { path: `tables.${i}.sectionId`, message: 'Unknown section' },
          ]);
        }
      }

      const keep = new Set(plan.tables.flatMap((t) => (t.id ? [t.id] : [])));
      const removed = existing.filter((t) => !keep.has(t.id));
      const busy = removed.filter((t) => !REMOVABLE.includes(t.status));
      if (busy.length) {
        throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Tables in service cannot be removed', {
          tables: busy.map((t) => ({ id: t.id, label: t.label, status: t.status })),
        });
      }

      const now = new Date();
      // Free up labels: archived and all kept tables get unique temporary labels first.
      for (const t of [...removed, ...existing.filter((e) => keep.has(e.id))]) {
        await tx.table.update({
          where: { id: t.id },
          data: { label: `~${t.id}`, ...(keep.has(t.id) ? {} : { archivedAt: now }) },
        });
      }
      for (const t of removed) {
        await tx.table.update({
          where: { id: t.id },
          data: { label: `${t.label}~${t.id.slice(-6)}`, joinableWith: [] },
        });
      }

      // Create new tables, then resolve join keys → ids.
      const idByKey = new Map<string, string>();
      for (const t of plan.tables) {
        if (t.id) {
          idByKey.set(t.key, t.id);
          idByKey.set(t.id, t.id);
          continue;
        }
        const created = await tx.table.create({
          data: {
            organizationId: ctx.user.org,
            outletId,
            sectionId: t.sectionId,
            label: `~new-${t.key}`,
            capacity: t.capacity,
            minCapacity: t.minCapacity,
            shape: t.shape,
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            rotation: t.rotation,
            joinableWith: [],
            qrToken: qrToken(),
            staffQrToken: qrToken(),
          },
        });
        idByKey.set(t.key, created.id);
      }

      // Joins are symmetric: if A lists B, B lists A.
      const joins = new Map<string, Set<string>>();
      for (const t of plan.tables) {
        const self = idByKey.get(t.key)!;
        for (const k of t.joinableWith) {
          const other = idByKey.get(k);
          if (!other || other === self) continue;
          (joins.get(self) ?? joins.set(self, new Set()).get(self)!).add(other);
          (joins.get(other) ?? joins.set(other, new Set()).get(other)!).add(self);
        }
      }

      for (const t of plan.tables) {
        const id = idByKey.get(t.key)!;
        await tx.table.update({
          where: { id },
          data: {
            label: t.label,
            sectionId: t.sectionId,
            capacity: t.capacity,
            minCapacity: t.minCapacity,
            shape: t.shape,
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            rotation: t.rotation,
            joinableWith: [...(joins.get(id) ?? [])].sort(),
          },
        });
      }

      await this.audit.record(
        ctx,
        {
          action: 'floor.plan.save',
          entityType: 'Outlet',
          entityId: outletId,
          outletId,
          before: { tables: existing.map(({ status: _s, ...t }) => t) },
          after: {
            tables: plan.tables.length,
            created: plan.tables.filter((t) => !t.id).length,
            archived: removed.map((t) => t.id),
          },
        },
        tx,
      );
    });
    this.changed(outletId);
    return this.snapshot(ctx, outletId);
  }

  private changed(outletId: string): void {
    this.realtime.emit(rooms.outlet(outletId), 'floor.changed', { outletId });
  }
}
