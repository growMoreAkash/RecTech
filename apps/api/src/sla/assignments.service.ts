import { HttpStatus, Injectable } from '@nestjs/common';
import { rooms } from '@dinesense/shared';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableViews } from '../table-state/table-views';

/** "Accept" on a greet assignment: stops re-assignment (escalation still applies until someone greets). */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
    private readonly views: TableViews,
  ) {}

  async acknowledge(ctx: RequestContext, outletId: string, assignmentId: string) {
    const out = await this.prisma.$transaction(async (tx) => {
      const a = await tx.assignment.findFirst({
        where: { id: assignmentId, outletId, organizationId: ctx.user.org },
        include: {
          seating: { select: { status: true, greetedAt: true, tables: { select: { tableId: true } } } },
        },
      });
      if (!a) throw AppError.notFound('Assignment');
      if (a.waiterId !== ctx.user.sub) throw AppError.forbidden('This table was assigned to someone else');
      if (a.expiredAt)
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'Too late — this table was passed to another waiter',
        );
      if (a.seating.status !== 'OPEN' || a.seating.greetedAt)
        return { a, task: null, tableIds: a.seating.tables.map((t) => t.tableId) };
      const now = new Date();
      // Compare-and-set so a simultaneous expiry wins cleanly.
      const res = await tx.assignment.updateMany({
        where: { id: a.id, expiredAt: null, acknowledgedAt: null },
        data: { acknowledgedAt: now },
      });
      if (!res.count && !a.acknowledgedAt)
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'Too late — this table was passed to another waiter',
        );
      await tx.seating.updateMany({
        where: { id: a.seatingId, servingWaiterId: null },
        data: { servingWaiterId: ctx.user.sub },
      });
      await tx.task.updateMany({
        where: { seatingId: a.seatingId, type: 'GREET', assigneeId: ctx.user.sub, status: 'OPEN' },
        data: { status: 'ACCEPTED', acceptedAt: now },
      });
      const task = await tx.task.findFirst({
        where: { seatingId: a.seatingId, type: 'GREET', assigneeId: ctx.user.sub, status: 'ACCEPTED' },
      });
      await this.audit.record(
        ctx,
        { action: 'assignment.acknowledge', entityType: 'Assignment', entityId: a.id, outletId },
        tx,
      );
      return { a, task, tableIds: a.seating.tables.map((t) => t.tableId) };
    });
    if (out.task) this.notifier.taskUpdated(out.task);
    for (const t of await this.views.load(ctx.user.org, outletId, out.tableIds)) {
      this.realtime.emit([rooms.outlet(outletId), rooms.table(t.tableId)], 'table.updated', t);
    }
    return this.prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  }

  /** The live (not expired) assignment of a seating for this waiter, if any. */
  async liveFor(seatingId: string, waiterId: string) {
    return this.prisma.assignment.findFirst({
      where: { seatingId, waiterId, expiredAt: null },
      orderBy: { attempt: 'desc' },
    });
  }
}
