import { Injectable, Logger } from '@nestjs/common';
import {
  type Alert,
  type AlertSeverity,
  type AlertType,
  type AssignmentReason,
  Prisma,
  type Task,
} from '@prisma/client';
import { rooms, selectWaiter, type WaiterCandidate } from '@dinesense/shared';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableViews } from '../table-state/table-views';

type Tx = Prisma.TransactionClient;

export interface EvaluateResult {
  /** Seating greeted, closed or gone: nothing more to do. */
  done: boolean;
  /** When the engine needs to look at this seating again. */
  nextWakeAt: Date | null;
  actions: ('BREACH' | 'ASSIGN' | 'REASSIGN' | 'ESCALATE' | 'NO_WAITER')[];
}

const ALERT_TEXT: Partial<Record<AlertType, string>> = {
  SLA_BREACH: 'Nobody has greeted this table yet',
  REASSIGNED: 'Greet reassigned to another waiter',
  ESCALATION: 'Guests still not greeted — manager needed',
  NO_ELIGIBLE_WAITER: 'No waiter is available to greet this table',
};

const REASON: Record<string, AssignmentReason> = {
  ROUND_ROBIN: 'ROUND_ROBIN',
  LEAST_LOADED: 'LEAST_LOADED',
  FIXED_SECTION: 'FIXED_SECTION',
};

/**
 * The 5-minute greet rule (docs/PLAN.md §5) as one idempotent decision: given a seating and "now", do whatever is
 * due — breach, assign, re-assign, escalate — and say when to look again. Timers only decide *when* to call this;
 * the database decides *what* happens, so duplicate, late or lost timers are harmless.
 */
@Injectable()
export class SlaEngine {
  private readonly logger = new Logger(SlaEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
    private readonly realtime: RealtimeService,
    private readonly views: TableViews,
  ) {}

  async evaluate(seatingId: string, now = new Date()): Promise<EvaluateResult> {
    const created: { tasks: Task[]; alerts: Alert[]; updated: Task[] } = {
      tasks: [],
      alerts: [],
      updated: [],
    };
    const result = await this.prisma.$transaction(async (tx) => {
      // One evaluation per seating at a time.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sla:' + seatingId}))`;
      const seating = await tx.seating.findUnique({
        where: { id: seatingId },
        include: {
          tables: { include: { table: { select: { id: true, sectionId: true } } } },
          assignments: { orderBy: { attempt: 'asc' } },
        },
      });
      if (!seating || seating.status !== 'OPEN' || seating.greetedAt)
        return { done: true, nextWakeAt: null, actions: [] };

      const settings = await tx.outletSettings.findUniqueOrThrow({ where: { outletId: seating.outletId } });
      const at = (sec: number, from = seating.seatedAt) => new Date(from.getTime() + sec * 1000);
      const greetDue = at(settings.greetSlaSeconds);
      const escalateDue = at(settings.escalateAfterSeconds);
      const table = seating.tables[0]?.table;
      const actions: EvaluateResult['actions'] = [];
      const ctx = { tx, seating, created };

      if (now >= escalateDue && !seating.escalatedAt) {
        await tx.seating.update({ where: { id: seatingId }, data: { escalatedAt: now } });
        await this.alert(ctx, 'ESCALATION', 'CRITICAL', `ESCALATION:${seatingId}`, table?.id);
        actions.push('ESCALATE');
      }

      let pendingUntil: Date | null = null;
      let retryAt: Date | null = null;
      if (now >= greetDue) {
        if (!seating.slaBreachedAt) {
          await tx.seating.update({ where: { id: seatingId }, data: { slaBreachedAt: now } });
          await this.alert(ctx, 'SLA_BREACH', 'WARNING', `SLA_BREACH:${seatingId}`, table?.id);
          actions.push('BREACH');
        }
        const last = seating.assignments.at(-1);
        const live = last && !last.expiredAt ? last : undefined;
        let needNew = !live;

        if (live && !live.acknowledgedAt) {
          const ackDue = at(settings.reassignAfterSeconds, live.assignedAt);
          if (now >= ackDue) {
            // Not acknowledged in time: hand the table to the next waiter.
            await tx.assignment.update({ where: { id: live.id }, data: { expiredAt: now } });
            const expired = await tx.task.updateMany({
              where: {
                seatingId,
                type: 'GREET',
                assigneeId: live.waiterId,
                status: { in: ['OPEN', 'ACCEPTED'] },
              },
              data: { status: 'EXPIRED', doneAt: now },
            });
            if (expired.count) {
              created.updated.push(
                ...(await tx.task.findMany({
                  where: {
                    seatingId,
                    type: 'GREET',
                    assigneeId: live.waiterId,
                    status: 'EXPIRED',
                    doneAt: now,
                  },
                })),
              );
            }
            needNew = true;
          } else {
            pendingUntil = ackDue;
          }
        }
        // An acknowledged waiter is on the way: no more re-assignment (escalation still applies).

        if (needNew && table) {
          const tried = new Set(seating.assignments.map((a) => a.waiterId));
          const picked = await this.pickWaiter(
            tx,
            seating.outletId,
            table.sectionId,
            settings,
            tried,
            now,
            seatingId,
          );
          if (picked.ok) {
            const attempt = (last?.attempt ?? 0) + 1;
            await tx.assignment.create({
              data: {
                organizationId: seating.organizationId,
                outletId: seating.outletId,
                seatingId,
                waiterId: picked.userId,
                // The attempt number says whether this is a re-assignment; the reason records how the waiter was picked.
                reason: REASON[settings.assignmentMode] ?? 'ROUND_ROBIN',
                attempt,
                assignedAt: now,
              },
            });
            // Any unassigned GREET task is superseded by the assigned one.
            await tx.task.updateMany({
              where: { seatingId, type: 'GREET', assigneeId: null, status: 'OPEN' },
              data: { status: 'CANCELLED', doneAt: now },
            });
            created.tasks.push(
              await tx.task.create({
                data: {
                  organizationId: seating.organizationId,
                  outletId: seating.outletId,
                  type: 'GREET',
                  tableId: table.id,
                  seatingId,
                  assigneeId: picked.userId,
                  payload: { attempt },
                },
              }),
            );
            if (attempt > 1)
              await this.alert(ctx, 'REASSIGNED', 'WARNING', `REASSIGNED:${seatingId}:${attempt}`, table.id, {
                attempt,
              });
            pendingUntil = at(settings.reassignAfterSeconds, now);
            actions.push(attempt > 1 ? 'REASSIGN' : 'ASSIGN');
          } else {
            await this.alert(
              ctx,
              'NO_ELIGIBLE_WAITER',
              'WARNING',
              `NO_ELIGIBLE_WAITER:${seatingId}`,
              table.id,
            );
            retryAt = at(Math.min(settings.reassignAfterSeconds, 60), now);
            actions.push('NO_WAITER');
          }
        }
      }

      const wakes = [
        now < greetDue ? greetDue : null,
        !seating.escalatedAt && now < escalateDue && !actions.includes('ESCALATE') ? escalateDue : null,
        pendingUntil,
        retryAt,
      ].filter((d): d is Date => d !== null);
      const nextWakeAt = wakes.length ? new Date(Math.min(...wakes.map((d) => d.getTime()))) : null;
      return { done: false, nextWakeAt, actions };
    });

    if (result.actions.length) await this.announce(seatingId, created);
    return result;
  }

  /** Builds candidates from live shifts and picks under the outlet's round-robin lock, then advances the cursor. */
  private async pickWaiter(
    tx: Tx,
    outletId: string,
    sectionId: string,
    settings: { assignmentMode: 'ROUND_ROBIN' | 'LEAST_LOADED' | 'FIXED_SECTION'; defaultMaxTables: number },
    tried: Set<string>,
    now: Date,
    seatingId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rr:' + outletId}))`;
    const shifts = await tx.shift.findMany({
      where: {
        outletId,
        role: 'WAITER',
        checkedInAt: { not: null },
        checkedOutAt: null,
        endsAt: { gt: now },
        user: { active: true },
      },
      orderBy: { checkInSeq: 'desc' },
    });
    const byUser = new Map<string, (typeof shifts)[number]>();
    for (const s of shifts) if (!byUser.has(s.userId)) byUser.set(s.userId, s);
    const ids = [...byUser.keys()];

    const [serving, pending, cursors] = await Promise.all([
      tx.seating.groupBy({
        by: ['servingWaiterId'],
        where: { outletId, status: 'OPEN', servingWaiterId: { in: ids } },
        _count: true,
      }),
      tx.assignment.groupBy({
        by: ['waiterId'],
        where: {
          outletId,
          waiterId: { in: ids },
          expiredAt: null,
          acknowledgedAt: null,
          seatingId: { not: seatingId },
          seating: { status: 'OPEN', greetedAt: null },
        },
        _count: true,
      }),
      tx.roundRobinCursor.findMany({ where: { outletId } }),
    ]);
    const load = new Map<string, number>();
    for (const s of serving) if (s.servingWaiterId) load.set(s.servingWaiterId, s._count);
    for (const p of pending) load.set(p.waiterId, (load.get(p.waiterId) ?? 0) + p._count);

    const candidates: WaiterCandidate[] = [...byUser.values()].map((s) => ({
      userId: s.userId,
      checkInSeq: s.checkInSeq ?? 0,
      sectionIds: s.sectionIds,
      activeTables: load.get(s.userId) ?? 0,
      maxTables: s.maxTables ?? settings.defaultMaxTables,
      onBreak: s.onBreak,
    }));
    const picked = selectWaiter({
      candidates,
      mode: settings.assignmentMode,
      sectionId,
      cursors: Object.fromEntries(cursors.map((c) => [c.sectionKey, c.lastCheckInSeq])),
      exclude: tried,
    });
    if (picked.ok) {
      await tx.roundRobinCursor.upsert({
        where: { outletId_sectionKey: { outletId, sectionKey: picked.cursorKey } },
        create: {
          outletId,
          sectionKey: picked.cursorKey,
          lastCheckInSeq: picked.checkInSeq,
          lastUserId: picked.userId,
        },
        update: { lastCheckInSeq: picked.checkInSeq, lastUserId: picked.userId },
      });
    }
    return picked;
  }

  private async alert(
    c: {
      tx: Tx;
      seating: { id: string; organizationId: string; outletId: string };
      created: { alerts: Alert[] };
    },
    type: AlertType,
    severity: AlertSeverity,
    dedupeKey: string,
    tableId: string | undefined,
    payload: Record<string, unknown> = {},
  ) {
    const exists = await c.tx.alert.findUnique({
      where: { outletId_dedupeKey: { outletId: c.seating.outletId, dedupeKey } },
    });
    if (exists) return;
    c.created.alerts.push(
      await c.tx.alert.create({
        data: {
          organizationId: c.seating.organizationId,
          outletId: c.seating.outletId,
          type,
          severity,
          tableId: tableId ?? null,
          seatingId: c.seating.id,
          message: ALERT_TEXT[type] ?? type,
          payload: payload as Prisma.InputJsonValue,
          dedupeKey,
        },
      }),
    );
  }

  /** After commit: push the assigned waiter, warn managers, refresh every floor map. */
  private async announce(seatingId: string, created: { tasks: Task[]; alerts: Alert[]; updated: Task[] }) {
    const seating = await this.prisma.seating.findUnique({
      where: { id: seatingId },
      select: { organizationId: true, outletId: true, tables: { select: { tableId: true } } },
    });
    if (!seating) return;
    const tables = await this.views.load(
      seating.organizationId,
      seating.outletId,
      seating.tables.map((t) => t.tableId),
    );
    for (const t of tables)
      this.realtime.emit([rooms.outlet(seating.outletId), rooms.table(t.tableId)], 'table.updated', t);
    for (const a of created.alerts) {
      this.realtime.emit(
        [rooms.role('MANAGER', a.outletId), rooms.role('OWNER', a.outletId), rooms.role('HOST', a.outletId)],
        'alert.created',
        {
          id: a.id,
          outletId: a.outletId,
          type: a.type,
          severity: a.severity,
          status: a.status,
          tableId: a.tableId,
          message: a.message,
          createdAt: a.createdAt.toISOString(),
        },
      );
    }
    for (const t of created.updated) this.notifier.taskUpdated(t);
    await Promise.allSettled([
      ...created.tasks.map((t) => this.notifier.taskCreated(t)),
      ...created.alerts.map((a) => this.notifier.alertRaised(a)),
    ]);
  }

  /** Open, un-greeted seatings (for the safety-net sweep). */
  async openUngreeted(limit = 1000): Promise<string[]> {
    const rows = await this.prisma.seating.findMany({
      where: { status: 'OPEN', greetedAt: null },
      select: { id: true },
      orderBy: { seatedAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  logError(seatingId: string, e: unknown) {
    this.logger.error(`SLA evaluation failed for ${seatingId}: ${String(e)}`);
  }
}
