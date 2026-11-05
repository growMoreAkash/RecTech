import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Alert, Camera, EdgeDevice, Prisma } from '@prisma/client';
import {
  EDGE_MAX_EVENT_AGE_SECONDS,
  type EdgeBatchResult,
  type EdgeEvent,
  edgeEventSchema,
  rooms,
  type TableMachineEvent,
} from '@dinesense/shared';
import { createHash } from 'node:crypto';
import type { AuditActor } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableStateService } from '../table-state/table-state.service';
import { EdgeCrypto } from './edge-crypto';

/** How long a camera may go without a health report before it is considered offline. */
export const CAMERA_STALE_SECONDS = 90;
export const DEVICE_STALE_SECONDS = 120;

@Injectable()
export class EdgeService {
  private readonly logger = new Logger(EdgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EdgeCrypto,
    private readonly tables: TableStateService,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
  ) {}

  /** Everything the device needs to run: cameras (with decrypted stream URLs), zones, thresholds. */
  async config(device: EdgeDevice) {
    const [settings, cameras] = await Promise.all([
      this.prisma.outletSettings.findUniqueOrThrow({ where: { outletId: device.outletId } }),
      this.prisma.camera.findMany({
        where: { edgeDeviceId: device.id },
        include: { zones: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const body = {
      outletId: device.outletId,
      settings: {
        occupancyConfirmSeconds: settings.occupancyConfirmSeconds,
        vacancyConfirmSeconds: settings.vacancyConfirmSeconds,
        staffPresentSeconds: settings.staffPresentSeconds,
      },
      cameras: cameras.map((c) => ({
        id: c.id,
        name: c.name,
        rtspUrl: this.crypto.decrypt(c.rtspUrlEncrypted),
        fps: c.fps,
        enabled: c.enabled,
        snapshotWanted: !c.snapshotAt || (!!c.snapshotRequestedAt && c.snapshotRequestedAt > c.snapshotAt),
        zones: c.zones.map((z) => ({ tableId: z.tableId, polygon: z.polygon as [number, number][] })),
      })),
    };
    // Lets the device skip restarting workers when nothing changed.
    const configVersion = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
    await this.touch(device);
    return { ...body, configVersion };
  }

  async saveSnapshot(device: EdgeDevice, cameraId: string, jpeg: Buffer) {
    if (!jpeg.length || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Snapshot must be a JPEG');
    }
    const res = await this.prisma.camera.updateMany({
      where: { id: cameraId, edgeDeviceId: device.id },
      data: { snapshotJpeg: new Uint8Array(jpeg), snapshotAt: new Date() },
    });
    if (!res.count) throw AppError.notFound('Camera');
    this.realtime.emit(rooms.role('MANAGER', device.outletId), 'camera.updated', {
      outletId: device.outletId,
      cameraId,
    });
  }

  /** Applies a batch of edge events. Each event is processed at most once (EdgeEventReceipt). */
  async ingest(device: EdgeDevice, events: unknown[]): Promise<EdgeBatchResult> {
    const result: EdgeBatchResult = { accepted: [], duplicates: [], rejected: [], retry: [] };
    const cameras = new Map(
      (
        await this.prisma.camera.findMany({ where: { edgeDeviceId: device.id }, include: { zones: true } })
      ).map((c) => [c.id, c]),
    );
    for (const raw of events) {
      const parsed = edgeEventSchema.safeParse(raw);
      const eventId = (raw as { eventId?: unknown } | null)?.eventId;
      if (!parsed.success) {
        result.rejected.push({ eventId: typeof eventId === 'string' ? eventId : '?', reason: 'INVALID' });
        continue;
      }
      const e = parsed.data;
      try {
        await this.prisma.edgeEventReceipt.create({ data: { eventId: e.eventId, deviceId: device.id } });
      } catch {
        result.duplicates.push(e.eventId);
        continue;
      }
      try {
        const reason = await this.apply(device, cameras, e);
        if (reason) result.rejected.push({ eventId: e.eventId, reason });
        else result.accepted.push(e.eventId);
      } catch (err) {
        if (err instanceof AppError && Number(err.status) < 500) {
          // A business rejection (e.g. table out of service): do not retry.
          result.rejected.push({ eventId: e.eventId, reason: err.code });
        } else {
          // Transient: forget the receipt so the device sends it again.
          await this.prisma.edgeEventReceipt.deleteMany({ where: { eventId: e.eventId } });
          result.retry.push(e.eventId);
          this.logger.warn(`edge event ${e.eventId} failed: ${String(err)}`);
        }
      }
    }
    await this.touch(device);
    return result;
  }

  private async apply(
    device: EdgeDevice,
    cameras: Map<string, Camera & { zones: { tableId: string }[] }>,
    e: EdgeEvent,
  ): Promise<string | null> {
    const occurredAt = new Date(e.occurredAt);
    if (e.type === 'device.heartbeat') {
      await this.prisma.edgeDevice.update({
        where: { id: device.id },
        data: { version: e.payload.version, lastSeenAt: new Date() },
      });
      return null;
    }
    const camera = cameras.get(e.cameraId);
    if (!camera) return 'UNKNOWN_CAMERA';
    if (e.type === 'camera.health') {
      await this.cameraHealth(camera, e.payload.status !== 'down', e.payload, occurredAt);
      return null;
    }
    if (Date.now() - occurredAt.getTime() > EDGE_MAX_EVENT_AGE_SECONDS * 1000) return 'STALE';
    if (!camera.zones.some((z) => z.tableId === e.tableId)) return 'NO_ZONE';

    const event: TableMachineEvent =
      e.type === 'table.occupied'
        ? { type: 'CAMERA_OCCUPIED', guestCount: e.payload.guestCount }
        : e.type === 'table.vacated'
          ? { type: 'CAMERA_VACATED' }
          : e.type === 'table.guest_count_changed'
            ? { type: 'GUEST_COUNT_CHANGED', guestCount: e.payload.guestCount }
            : { type: 'CAMERA_STAFF_PRESENT', seconds: e.payload.seconds, confidence: e.confidence };
    const audit: AuditActor = { organizationId: device.organizationId, type: 'DEVICE', id: device.id };
    await this.tables.apply({
      organizationId: device.organizationId,
      outletId: device.outletId,
      tableId: e.tableId,
      event,
      actor: { kind: 'CAMERA', deviceId: device.id },
      audit,
      source: 'CAMERA',
      eventId: e.eventId,
      occurredAt,
      confidence: e.confidence,
      payload: { cameraId: e.cameraId, ...e.payload },
    });
    return null;
  }

  /** Records a camera health report; raises CAMERA_OFFLINE when it goes down and resolves it when it recovers. */
  async cameraHealth(
    camera: Camera,
    healthy: boolean,
    report: Prisma.InputJsonValue | null,
    at = new Date(),
  ) {
    await this.prisma.camera.update({
      where: { id: camera.id },
      data: { healthy, lastHealthAt: at, ...(report ? { lastHealth: report } : {}) },
    });
    if (healthy === camera.healthy && camera.lastHealthAt) return;
    if (!healthy) {
      await this.raiseOnce(
        camera.organizationId,
        camera.outletId,
        'CAMERA_OFFLINE',
        { cameraId: camera.id },
        `Camera "${camera.name}" is offline`,
      );
    } else {
      await this.prisma.alert.updateMany({
        where: {
          outletId: camera.outletId,
          type: 'CAMERA_OFFLINE',
          cameraId: camera.id,
          status: { not: 'RESOLVED' },
        },
        data: { status: 'RESOLVED', resolvedAt: at },
      });
    }
    this.realtime.emit(rooms.role('MANAGER', camera.outletId), 'camera.updated', {
      outletId: camera.outletId,
      cameraId: camera.id,
    });
  }

  /** Sweep: cameras silent for too long go offline; edge devices silent for too long raise EDGE_OFFLINE. */
  async sweep(now = new Date()) {
    const stale = await this.prisma.camera.findMany({
      where: {
        enabled: true,
        healthy: true,
        lastHealthAt: { lt: new Date(now.getTime() - CAMERA_STALE_SECONDS * 1000) },
      },
    });
    for (const c of stale) await this.cameraHealth(c, false, null, now);
    const silent = await this.prisma.edgeDevice.findMany({
      where: {
        revokedAt: null,
        lastSeenAt: { lt: new Date(now.getTime() - DEVICE_STALE_SECONDS * 1000) },
        cameras: { some: { enabled: true } },
      },
    });
    for (const d of silent) {
      await this.raiseOnce(
        d.organizationId,
        d.outletId,
        'EDGE_OFFLINE',
        { payload: { deviceId: d.id } },
        `Edge device "${d.name}" is not reporting`,
      );
    }
    return { cameras: stale.length, devices: silent.length };
  }

  /** One open alert per condition; a new episode starts once the previous one is resolved. */
  private async raiseOnce(
    organizationId: string,
    outletId: string,
    type: 'CAMERA_OFFLINE' | 'EDGE_OFFLINE',
    where: { cameraId?: string; payload?: { deviceId: string } },
    message: string,
  ) {
    const open = await this.prisma.alert.findFirst({
      where: {
        outletId,
        type,
        status: { not: 'RESOLVED' },
        ...(where.cameraId
          ? { cameraId: where.cameraId }
          : { payload: { path: ['deviceId'], equals: where.payload!.deviceId } }),
      },
    });
    if (open) return;
    const alert: Alert = await this.prisma.alert.create({
      data: {
        organizationId,
        outletId,
        type,
        severity: 'WARNING',
        cameraId: where.cameraId ?? null,
        payload: where.payload ?? {},
        message,
        dedupeKey: `${type}:${where.cameraId ?? where.payload!.deviceId}:${Date.now()}`,
      },
    });
    this.realtime.emit([rooms.role('MANAGER', outletId), rooms.role('OWNER', outletId)], 'alert.created', {
      id: alert.id,
      outletId,
      type: alert.type,
      severity: alert.severity,
      status: alert.status,
      tableId: null,
      message,
      createdAt: alert.createdAt.toISOString(),
    });
    await this.notifier.alertRaised(alert).catch(() => undefined);
  }

  private async touch(device: EdgeDevice) {
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 10_000) {
      await this.prisma.edgeDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      await this.prisma.alert.updateMany({
        where: {
          outletId: device.outletId,
          type: 'EDGE_OFFLINE',
          status: { not: 'RESOLVED' },
          payload: { path: ['deviceId'], equals: device.id },
        },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
    }
  }
}
