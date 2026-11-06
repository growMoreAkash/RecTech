import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { predictPrepSeconds, type PrepStats, prepStats } from '@dinesense/shared';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

const WINDOW_DAYS = 28;
const CACHE_MS = 5 * 60_000;
const MAX_SAMPLES = 5000;

/** Prep-time predictions from this outlet's recent QUEUED→READY times (pure maths in @dinesense/shared). */
@Injectable()
export class PrepTimeService {
  private readonly cache = new Map<string, { at: number; stats: PrepStats }>();

  constructor(private readonly prisma: PrismaService) {}

  async stats(outletId: string, now = new Date()): Promise<PrepStats> {
    const hit = this.cache.get(outletId);
    if (hit && now.getTime() - hit.at < CACHE_MS) return hit.stats;
    const rows = await this.prisma.orderItem.findMany({
      where: {
        outletId,
        readyAt: { not: null },
        queuedAt: { gte: new Date(now.getTime() - WINDOW_DAYS * 86_400_000) },
      },
      select: { menuItemId: true, stationId: true, queuedAt: true, readyAt: true },
      orderBy: { queuedAt: 'desc' },
      take: MAX_SAMPLES,
    });
    const stats = prepStats(
      rows.map((r) => ({
        menuItemId: r.menuItemId,
        stationId: r.stationId,
        seconds: (r.readyAt!.getTime() - r.queuedAt.getTime()) / 1000,
      })),
    );
    this.cache.set(outletId, { at: now.getTime(), stats });
    return stats;
  }

  /** Stamps `etaReadyAt` on items that just reached the kitchen, counting what is already queued at each station. */
  async stamp(tx: Db, outletId: string, itemIds: string[], now = new Date()): Promise<void> {
    if (!itemIds.length) return;
    const stats = await this.stats(outletId, now);
    const items = await tx.orderItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, menuItemId: true, stationId: true, queuedAt: true },
    });
    const stations = [...new Set(items.map((i) => i.stationId))];
    const busy = await tx.orderItem.groupBy({
      by: ['stationId'],
      where: {
        outletId,
        stationId: { in: stations },
        status: { in: ['QUEUED', 'COOKING'] },
        id: { notIn: itemIds },
        order: { status: 'ACCEPTED' },
      },
      _count: { _all: true },
    });
    const ahead = new Map(busy.map((b) => [b.stationId, b._count._all]));
    for (const i of items) {
      const seconds = predictPrepSeconds(i, stats, ahead.get(i.stationId) ?? 0);
      await tx.orderItem.update({
        where: { id: i.id },
        data: { etaReadyAt: new Date(i.queuedAt.getTime() + seconds * 1000) },
      });
    }
  }
}
