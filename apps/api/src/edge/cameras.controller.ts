import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type CameraInput,
  cameraInputSchema,
  cameraPatchSchema,
  edgeDeviceInputSchema,
  type ZonesInput,
  zonesInputSchema,
} from '@dinesense/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../auth/crypto';
import { Ctx, Managers } from '../auth/decorators';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { EdgeCrypto, maskStreamUrl } from './edge-crypto';

const cameraView = (
  c: Prisma.CameraGetPayload<{
    include: { zones: true; edgeDevice: { select: { id: true; name: true; lastSeenAt: true } } };
  }>,
  url: string,
) => ({
  id: c.id,
  name: c.name,
  edgeDevice: c.edgeDevice,
  streamHost: maskStreamUrl(url),
  fps: c.fps,
  enabled: c.enabled,
  healthy: c.healthy,
  lastHealthAt: c.lastHealthAt,
  lastHealth: c.lastHealth,
  snapshotAt: c.snapshotAt,
  hasSnapshot: c.snapshotAt !== null,
  door: (c.doorPolygon as [number, number][] | null) ?? null,
  zones: c.zones.map((z) => ({
    id: z.id,
    tableId: z.tableId,
    polygon: z.polygon,
    calibratedAt: z.calibratedAt,
  })),
});

/** Managers: edge devices, cameras (stream URLs write-only), table zones, snapshots. */
@ApiTags('cameras')
@ApiBearerAuth()
@Managers()
@Controller('outlets/:outletId')
export class CamerasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EdgeCrypto,
    private readonly audit: AuditService,
  ) {}

  @Get('edge-devices')
  devices(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.prisma.forOrg(ctx.user.org).edgeDevice.findMany({
      where: { outletId },
      select: {
        id: true,
        name: true,
        version: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
        _count: { select: { cameras: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The device id + secret are shown once; put them in the edge box's .env. */
  @Post('edge-devices')
  @ApiZodBody(edgeDeviceInputSchema)
  async registerDevice(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(edgeDeviceInputSchema)) body: { name: string },
  ) {
    const device = await this.prisma.$transaction(async (tx) => {
      const d = await tx.edgeDevice.create({
        data: {
          organizationId: ctx.user.org,
          outletId,
          name: body.name,
          tokenHash: `pending-${Date.now()}-${Math.random()}`,
        },
      });
      const updated = await tx.edgeDevice.update({
        where: { id: d.id },
        data: { tokenHash: sha256(this.crypto.deviceSecret(d.id)) },
      });
      await this.audit.record(
        ctx,
        {
          action: 'edge.device.register',
          entityType: 'EdgeDevice',
          entityId: d.id,
          outletId,
          after: { name: d.name },
        },
        tx,
      );
      return updated;
    });
    return {
      device: { id: device.id, name: device.name },
      deviceId: device.id,
      secret: this.crypto.deviceSecret(device.id),
    };
  }

  @Delete('edge-devices/:deviceId')
  @HttpCode(204)
  async revokeDevice(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.edgeDevice.updateMany({
        where: { id: deviceId, outletId, organizationId: ctx.user.org, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!res.count) throw AppError.notFound('Edge device');
      await tx.camera.updateMany({ where: { edgeDeviceId: deviceId }, data: { enabled: false } });
      await this.audit.record(
        ctx,
        { action: 'edge.device.revoke', entityType: 'EdgeDevice', entityId: deviceId, outletId },
        tx,
      );
    });
  }

  @Get('cameras')
  async cameras(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    const rows = await this.prisma.forOrg(ctx.user.org).camera.findMany({
      where: { outletId },
      include: { zones: true, edgeDevice: { select: { id: true, name: true, lastSeenAt: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => cameraView(c, this.crypto.decrypt(c.rtspUrlEncrypted)));
  }

  @Post('cameras')
  @ApiZodBody(cameraInputSchema)
  async create(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(cameraInputSchema)) body: CameraInput,
  ) {
    await this.assertDevice(ctx, outletId, body.edgeDeviceId);
    const cam = await this.prisma.$transaction(async (tx) => {
      const c = await tx.camera.create({
        data: {
          organizationId: ctx.user.org,
          outletId,
          edgeDeviceId: body.edgeDeviceId,
          name: body.name,
          rtspUrlEncrypted: this.crypto.encrypt(body.rtspUrl),
          fps: body.fps,
          enabled: body.enabled,
        },
        include: { zones: true, edgeDevice: { select: { id: true, name: true, lastSeenAt: true } } },
      });
      await this.audit.record(
        ctx,
        {
          action: 'camera.create',
          entityType: 'Camera',
          entityId: c.id,
          outletId,
          after: { name: c.name, host: maskStreamUrl(body.rtspUrl) },
        },
        tx,
      );
      return c;
    });
    return cameraView(cam, body.rtspUrl);
  }

  @Patch('cameras/:cameraId')
  @ApiZodBody(cameraPatchSchema)
  async update(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('cameraId') cameraId: string,
    @Body(new ZodPipe(cameraPatchSchema)) body: Partial<CameraInput>,
  ) {
    await this.findCamera(ctx, outletId, cameraId);
    if (body.edgeDeviceId) await this.assertDevice(ctx, outletId, body.edgeDeviceId);
    const { rtspUrl, ...rest } = body;
    const cam = await this.prisma.$transaction(async (tx) => {
      const c = await tx.camera.update({
        where: { id: cameraId },
        data: { ...rest, ...(rtspUrl ? { rtspUrlEncrypted: this.crypto.encrypt(rtspUrl) } : {}) },
        include: { zones: true, edgeDevice: { select: { id: true, name: true, lastSeenAt: true } } },
      });
      await this.audit.record(
        ctx,
        {
          action: 'camera.update',
          entityType: 'Camera',
          entityId: cameraId,
          outletId,
          after: { ...rest, urlChanged: !!rtspUrl },
        },
        tx,
      );
      return c;
    });
    return cameraView(cam, this.crypto.decrypt(cam.rtspUrlEncrypted));
  }

  @Delete('cameras/:cameraId')
  @HttpCode(204)
  async remove(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('cameraId') cameraId: string,
  ): Promise<void> {
    await this.findCamera(ctx, outletId, cameraId);
    await this.prisma.$transaction(async (tx) => {
      await tx.camera.delete({ where: { id: cameraId } });
      await this.audit.record(
        ctx,
        { action: 'camera.delete', entityType: 'Camera', entityId: cameraId, outletId },
        tx,
      );
    });
  }

  /** Replaces the camera's table zones (normalised polygons drawn on the snapshot). */
  @Put('cameras/:cameraId/zones')
  @ApiZodBody(zonesInputSchema)
  async zones(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('cameraId') cameraId: string,
    @Body(new ZodPipe(zonesInputSchema)) body: ZonesInput,
  ) {
    await this.findCamera(ctx, outletId, cameraId);
    const tableIds = body.zones.map((z) => z.tableId);
    const found = await this.prisma
      .forOrg(ctx.user.org)
      .table.count({ where: { id: { in: tableIds }, outletId, archivedAt: null } });
    if (found !== tableIds.length) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Unknown table in zones', [
        { path: 'zones', message: 'Unknown table' },
      ]);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.tableZone.deleteMany({ where: { cameraId } });
      if (body.door !== undefined)
        await tx.camera.update({
          where: { id: cameraId },
          data: { doorPolygon: body.door === null ? Prisma.DbNull : body.door },
        });
      await tx.tableZone.createMany({
        data: body.zones.map((z) => ({
          organizationId: ctx.user.org,
          outletId,
          cameraId,
          tableId: z.tableId,
          polygon: z.polygon,
          calibratedById: ctx.user.sub,
        })),
      });
      await this.audit.record(
        ctx,
        {
          action: 'camera.zones',
          entityType: 'Camera',
          entityId: cameraId,
          outletId,
          after: { zones: body.zones.length, ...(body.door !== undefined ? { door: !!body.door } : {}) },
        },
        tx,
      );
    });
    return this.prisma.tableZone.findMany({ where: { cameraId } });
  }

  @Post('cameras/:cameraId/request-snapshot')
  @HttpCode(202)
  async requestSnapshot(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('cameraId') cameraId: string,
  ) {
    await this.findCamera(ctx, outletId, cameraId);
    await this.prisma.camera.update({ where: { id: cameraId }, data: { snapshotRequestedAt: new Date() } });
    return { requested: true };
  }

  @Get('cameras/:cameraId/snapshot')
  @Header('content-type', 'image/jpeg')
  @Header('cache-control', 'private, no-store')
  async snapshot(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('cameraId') cameraId: string,
  ) {
    const cam = await this.findCamera(ctx, outletId, cameraId);
    if (!cam.snapshotJpeg) throw AppError.notFound('Snapshot');
    return new StreamableFile(Buffer.from(cam.snapshotJpeg));
  }

  private async findCamera(ctx: RequestContext, outletId: string, cameraId: string) {
    const cam = await this.prisma
      .forOrg(ctx.user.org)
      .camera.findFirst({ where: { id: cameraId, outletId } });
    if (!cam) throw AppError.notFound('Camera');
    return cam;
  }

  private async assertDevice(ctx: RequestContext, outletId: string, deviceId: string) {
    const d = await this.prisma
      .forOrg(ctx.user.org)
      .edgeDevice.findFirst({ where: { id: deviceId, outletId, revokedAt: null } });
    if (!d)
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Unknown edge device', [
        { path: 'edgeDeviceId', message: 'Unknown edge device' },
      ]);
  }
}
