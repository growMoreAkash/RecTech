import { Injectable, Logger } from '@nestjs/common';
import type { Alert, Prisma, TaskType } from '@prisma/client';
import { decideService, lastTouch, rooms, type ServiceFacts } from '@dinesense/shared';
import type { AuditActor } from '../audit/audit.service';
import { NotifierService } from '../notifications/notifier.service';
import { OrderingService } from '../ordering/ordering.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

type Tx = Prisma.TransactionClient;
type Marker = 'idleNudgedAt' | 'idleAlertedAt' | 'fireMainsPromptAt' | 'dessertOfferAt';

const seatingInclude = {
  tables: { include: { table: { select: { id: true, label: true, status: true } } } },
  orders: {
    where: { status: 'ACCEPTED' },
    select: { items: { select: { course: true, status: true, servedAt: true } } },
  },
} satisfies Prisma.SeatingInclude;
type LoadedSeating = Prisma.SeatingGetPayload<{ include: typeof seatingInclude }>;

/**
 * Service quality on the floor: idle tables, held courses and dessert offers. One idempotent sweep runs the pure
 * `decideService` for every open seating; each prompt is claimed by compare-and-set on its seating marker, so
 * parallel sweeps (several API instances) never double a task or alert.
 */
@Injectable()
export class ServiceEngine {
  private readonly logger = new Logger(ServiceEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordering: OrderingService,
    private readonly notifier: NotifierService,
    private readonly realtime: RealtimeService,
  ) {}

  async sweep(now = new Date(), outletId?: string) {
    const seatings = await this.prisma.seating.findMany({
      where: { status: 'OPEN', ...(outletId ? { outletId } : {}) },
      include: seatingInclude,
    });
    const settings = new Map(
      (
        await this.prisma.outletSettings.findMany({
          where: { outletId: { in: [...new Set(seatings.map((s) => s.outletId))] } },
        })
      ).map((s) => [s.outletId, s]),
    );
    const done = { nudges: 0, alerts: 0, firePrompts: 0, fired: 0, dessertOffers: 0 };
    for (const s of seatings) {
      const cfg = settings.get(s.outletId);
      const primary = s.tables[0]?.table;
      if (!cfg || !primary) continue;
      try {
        const facts: ServiceFacts = {
          status: primary.status,
          seatedAt: s.seatedAt,
          greetedAt: s.greetedAt,
          lastStaffTouchAt: s.lastStaffTouchAt,
          idleNudgedAt: s.idleNudgedAt,
          idleAlertedAt: s.idleAlertedAt,
          fireMainsPromptAt: s.fireMainsPromptAt,
          dessertOfferAt: s.dessertOfferAt,
          items: s.orders.flatMap((o) => o.items),
        };
        const d = decideService(facts, cfg, now);
        const label = primary.label;
        if (
          d.nudge &&
          (await this.prompt(s, 'idleNudgedAt', 'CHECK_TABLE', now, { idleMinutes: d.idleMinutes }))
        )
          done.nudges++;
        if (d.idleAlert && (await this.idleAlert(s, label, d.idleMinutes, lastTouch(facts), now)))
          done.alerts++;
        if (d.autoFire) {
          const system: AuditActor = { organizationId: s.organizationId, type: 'SYSTEM' };
          done.fired += (
            await this.ordering.fireCourse(s.organizationId, s.outletId, s.id, system, 'auto')
          ).fired;
        } else if (d.firePrompt && (await this.prompt(s, 'fireMainsPromptAt', 'FIRE_COURSE', now, {})))
          done.firePrompts++;
        if (d.offerDessert && (await this.prompt(s, 'dessertOfferAt', 'OFFER_DESSERT', now, {})))
          done.dessertOffers++;
      } catch (e) {
        this.logger.warn(`service sweep failed for seating ${s.id}: ${String(e)}`);
      }
    }
    return done;
  }

  /** Claims the marker and creates the task for the serving waiter (or anyone on the floor). */
  private async prompt(
    s: LoadedSeating,
    marker: Marker,
    type: TaskType,
    now: Date,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const task = await this.prisma.$transaction(async (tx) => {
      if (!(await this.claim(tx, s, marker, now))) return null;
      return tx.task.create({
        data: {
          organizationId: s.organizationId,
          outletId: s.outletId,
          type,
          tableId: s.tables[0]!.tableId,
          seatingId: s.id,
          assigneeId: s.servingWaiterId,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    });
    if (task) await this.notifier.taskCreated(task).catch(() => undefined);
    return task !== null;
  }

  private async idleAlert(s: LoadedSeating, label: string, minutes: number, since: Date, now: Date) {
    const alert = await this.prisma.$transaction(async (tx): Promise<Alert | null> => {
      if (!(await this.claim(tx, s, 'idleAlertedAt', now))) return null;
      return tx.alert.create({
        data: {
          organizationId: s.organizationId,
          outletId: s.outletId,
          type: 'IDLE_TABLE',
          severity: 'WARNING',
          tableId: s.tables[0]!.tableId,
          seatingId: s.id,
          message: `Nobody has been to table ${label} for ${minutes} min`,
          payload: { idleMinutes: minutes, since: since.toISOString(), waiterId: s.servingWaiterId },
          dedupeKey: `IDLE_TABLE:${s.id}:${since.getTime()}`,
        },
      });
    });
    if (!alert) return false;
    this.realtime.emit(
      [rooms.role('MANAGER', s.outletId), rooms.role('OWNER', s.outletId), rooms.role('HOST', s.outletId)],
      'alert.created',
      {
        id: alert.id,
        outletId: s.outletId,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        tableId: alert.tableId,
        message: alert.message,
        createdAt: alert.createdAt.toISOString(),
      },
    );
    await this.notifier.alertRaised(alert).catch(() => undefined);
    return true;
  }

  /** Compare-and-set: only the sweep that moves the marker from the value it read creates the prompt. */
  private async claim(tx: Tx, s: LoadedSeating, marker: Marker, now: Date): Promise<boolean> {
    const res = await tx.seating.updateMany({
      where: { id: s.id, status: 'OPEN', [marker]: s[marker] },
      data: { [marker]: now },
    });
    return res.count === 1;
  }
}
