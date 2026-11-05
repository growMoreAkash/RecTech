import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Prisma, TaskType } from '@prisma/client';
import { MANUAL_TASK_TYPES, ROLE_TASK_TYPES, taskQuerySchema } from '@dinesense/shared';
import { AuditService } from '../audit/audit.service';
import { Authenticated, Ctx } from '../auth/decorators';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { hasRoleIn, MANAGER_ROLES, rolesIn } from '../common/roles';
import { ApiZodQuery, ZodPipe } from '../common/zod';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentsService } from '../sla/assignments.service';

/** Staff task inbox. Most tasks complete through their real action; call-waiter/water/cutlery are ticked off here. */
@ApiTags('tasks')
@ApiBearerAuth()
@Controller('outlets/:outletId/tasks')
export class TasksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifier: NotifierService,
    private readonly assignments: AssignmentsService,
  ) {}

  @Get()
  @Authenticated()
  @ApiZodQuery(taskQuerySchema)
  async list(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(taskQuerySchema)) q: { scope: 'mine' | 'all' },
  ) {
    const types = [...new Set(rolesIn(ctx, outletId).flatMap((r) => ROLE_TASK_TYPES[r]))] as TaskType[];
    const all = q.scope === 'all' && hasRoleIn(ctx, outletId, [...MANAGER_ROLES, 'HOST']);
    const where: Prisma.TaskWhereInput = {
      outletId,
      status: { in: ['OPEN', 'ACCEPTED'] },
      ...(all ? {} : { OR: [{ assigneeId: ctx.user.sub }, { assigneeId: null, type: { in: types } }] }),
    };
    const tasks = await this.prisma
      .forOrg(ctx.user.org)
      .task.findMany({ where, orderBy: { createdAt: 'asc' }, take: 200 });
    const tables = await this.prisma.forOrg(ctx.user.org).table.findMany({
      where: { id: { in: tasks.flatMap((t) => (t.tableId ? [t.tableId] : [])) } },
      select: { id: true, label: true },
    });
    const label = new Map(tables.map((t) => [t.id, t.label]));
    return tasks.map((t) => ({
      ...t,
      tableLabel: t.tableId ? (label.get(t.tableId) ?? null) : null,
      mine: t.assigneeId === ctx.user.sub,
    }));
  }

  /** Take an unassigned task (or confirm your own). */
  @Post(':taskId/accept')
  @HttpCode(200)
  @Authenticated()
  async accept(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('taskId') taskId: string,
  ) {
    const task = await this.prisma.$transaction(async (tx) => {
      const t = await tx.task.findFirst({ where: { id: taskId, outletId, organizationId: ctx.user.org } });
      if (!t) throw AppError.notFound('Task');
      if (t.status !== 'OPEN' && t.status !== 'ACCEPTED')
        throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'This task is already closed');
      if (t.assigneeId && t.assigneeId !== ctx.user.sub && !hasRoleIn(ctx, outletId, MANAGER_ROLES)) {
        throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Someone else has this task');
      }
      // Compare-and-set so two waiters tapping at once cannot both take it.
      const res = await tx.task.updateMany({
        where: { id: taskId, status: t.status, assigneeId: t.assigneeId },
        data: {
          status: 'ACCEPTED',
          assigneeId: t.assigneeId ?? ctx.user.sub,
          acceptedAt: t.acceptedAt ?? new Date(),
        },
      });
      if (res.count !== 1)
        throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Someone else just took this task');
      await this.audit.record(
        ctx,
        { action: 'task.accept', entityType: 'Task', entityId: taskId, outletId },
        tx,
      );
      return tx.task.findUniqueOrThrow({ where: { id: taskId } });
    });
    // Accepting a greet task is acknowledging the greet assignment (stops re-assignment).
    if (task.type === 'GREET' && task.seatingId) {
      const live = await this.assignments.liveFor(task.seatingId, ctx.user.sub);
      if (live && !live.acknowledgedAt) await this.assignments.acknowledge(ctx, outletId, live.id);
      return this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    }
    this.notifier.taskUpdated(task);
    return task;
  }

  @Post(':taskId/done')
  @HttpCode(200)
  @Authenticated()
  async done(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('taskId') taskId: string,
  ) {
    const task = await this.prisma.$transaction(async (tx) => {
      const t = await tx.task.findFirst({ where: { id: taskId, outletId, organizationId: ctx.user.org } });
      if (!t) throw AppError.notFound('Task');
      if (!(MANUAL_TASK_TYPES as readonly string[]).includes(t.type)) {
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'Complete this task with its action (greet, serve, bill, clean or approve)',
          { type: t.type },
        );
      }
      if (t.status !== 'OPEN' && t.status !== 'ACCEPTED') return t;
      const after = await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'DONE',
          doneAt: new Date(),
          doneById: ctx.user.sub,
          assigneeId: t.assigneeId ?? ctx.user.sub,
        },
      });
      await this.audit.record(
        ctx,
        { action: 'task.done', entityType: 'Task', entityId: taskId, outletId },
        tx,
      );
      return after;
    });
    this.notifier.taskUpdated(task);
    return task;
  }
}
