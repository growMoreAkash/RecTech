import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { alertQuerySchema, rooms } from '@dinesense/shared';
import type { AlertStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Ctx, Roles } from '../auth/decorators';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { ApiZodQuery, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Alerts centre (full UI in M4). */
@ApiTags('alerts')
@ApiBearerAuth()
@Roles('OWNER', 'MANAGER', 'HOST')
@Controller('outlets/:outletId/alerts')
export class AlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get()
  @ApiZodQuery(alertQuerySchema)
  list(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(alertQuerySchema)) q: { status?: AlertStatus },
  ) {
    return this.prisma.forOrg(ctx.user.org).alert.findMany({
      where: { outletId, ...(q.status ? { status: q.status } : { status: { not: 'RESOLVED' } }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post(':alertId/ack')
  @HttpCode(200)
  ack(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('alertId') alertId: string) {
    return this.setStatus(ctx, outletId, alertId, 'ACKNOWLEDGED');
  }

  @Post(':alertId/resolve')
  @HttpCode(200)
  resolve(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('alertId') alertId: string,
  ) {
    return this.setStatus(ctx, outletId, alertId, 'RESOLVED');
  }

  private async setStatus(
    ctx: RequestContext,
    outletId: string,
    alertId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED',
  ) {
    const alert = await this.prisma.$transaction(async (tx) => {
      const before = await tx.alert.findFirst({
        where: { id: alertId, outletId, organizationId: ctx.user.org },
      });
      if (!before) throw AppError.notFound('Alert');
      const now = new Date();
      const after = await tx.alert.update({
        where: { id: alertId },
        data:
          status === 'ACKNOWLEDGED'
            ? { status, acknowledgedAt: now, acknowledgedById: ctx.user.sub }
            : {
                status,
                resolvedAt: now,
                acknowledgedAt: before.acknowledgedAt ?? now,
                acknowledgedById: before.acknowledgedById ?? ctx.user.sub,
              },
      });
      await this.audit.record(
        ctx,
        { action: `alert.${status.toLowerCase()}`, entityType: 'Alert', entityId: alertId, outletId },
        tx,
      );
      return after;
    });
    this.realtime.emit(
      [rooms.role('MANAGER', outletId), rooms.role('OWNER', outletId), rooms.role('HOST', outletId)],
      'alert.updated',
      {
        id: alert.id,
        outletId,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        tableId: alert.tableId,
        message: alert.message,
        createdAt: alert.createdAt.toISOString(),
      },
    );
    return alert;
  }
}
