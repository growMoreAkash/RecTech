import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type RegisterDeviceInput, registerDeviceSchema } from '@dinesense/shared';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../auth/crypto';
import { Ctx, Managers } from '../auth/decorators';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const publicFields = {
  id: true,
  name: true,
  kind: true,
  station: true,
  createdAt: true,
  lastSeenAt: true,
  revokedAt: true,
} as const;

/** Staff terminals and KDS screens. The device token is shown once at registration and stored hashed. */
@ApiTags('devices')
@ApiBearerAuth()
@Controller('outlets/:outletId/devices')
export class DevicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Managers()
  list(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.prisma.forOrg(ctx.user.org).staffDevice.findMany({
      where: { outletId },
      select: publicFields,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  @Managers()
  @ApiZodBody(registerDeviceSchema)
  async register(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(registerDeviceSchema)) body: RegisterDeviceInput,
  ) {
    const deviceToken = randomToken('sd', 32);
    const device = await this.prisma.$transaction(async (tx) => {
      const created = await tx.staffDevice.create({
        data: {
          organizationId: ctx.user.org,
          outletId,
          name: body.name,
          kind: body.kind,
          station: body.station ?? null,
          tokenHash: sha256(deviceToken),
          createdById: ctx.user.sub,
        },
        select: publicFields,
      });
      await this.audit.record(
        ctx,
        {
          action: 'device.register',
          entityType: 'StaffDevice',
          entityId: created.id,
          outletId,
          after: created,
        },
        tx,
      );
      return created;
    });
    return { device, deviceToken };
  }

  @Delete(':deviceId')
  @HttpCode(204)
  @Managers()
  async revoke(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.staffDevice.updateMany({
        where: { id: deviceId, outletId, organizationId: ctx.user.org, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (res.count !== 1) throw AppError.notFound('Device');
      // Sessions opened from this device die with it.
      await tx.refreshToken.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        ctx,
        { action: 'device.revoke', entityType: 'StaffDevice', entityId: deviceId, outletId },
        tx,
      );
    });
  }
}
