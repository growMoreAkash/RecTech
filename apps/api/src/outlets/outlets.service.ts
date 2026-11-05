import { Injectable } from '@nestjs/common';
import type { OutletSettingsInput } from '@dinesense/shared';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext) {
    return this.prisma.forOrg(ctx.user.org).outlet.findMany({
      where: { id: { in: Object.keys(ctx.user.outlets) }, archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async get(ctx: RequestContext, outletId: string) {
    const outlet = await this.prisma.forOrg(ctx.user.org).outlet.findUnique({ where: { id: outletId } });
    if (!outlet) throw AppError.notFound('Outlet');
    return outlet;
  }

  async getSettings(ctx: RequestContext, outletId: string) {
    const settings = await this.prisma
      .forOrg(ctx.user.org)
      .outletSettings.findUnique({ where: { outletId } });
    if (!settings) throw AppError.notFound('Outlet settings');
    return settings;
  }

  async updateSettings(ctx: RequestContext, outletId: string, patch: Partial<OutletSettingsInput>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.outletSettings.findFirst({ where: { outletId, organizationId: ctx.user.org } });
      if (!before) throw AppError.notFound('Outlet settings');
      const after = await tx.outletSettings.update({ where: { outletId }, data: patch });
      await this.audit.record(
        ctx,
        {
          action: 'outlet.settings.update',
          entityType: 'OutletSettings',
          entityId: outletId,
          outletId,
          before,
          after,
        },
        tx,
      );
      return after;
    });
  }
}
