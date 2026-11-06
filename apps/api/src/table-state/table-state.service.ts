import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Alert, type EventSource, Prisma, type Task, type TaskType } from '@prisma/client';
import {
  type Actor,
  type Effect,
  type MachineContext,
  rooms,
  type SeatingFacts,
  type SeatingSource,
  type TableMachineEvent,
  type TableStatus,
  transition,
  type TransitionResult,
} from '@dinesense/shared';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SeatingEvents } from './seating-events';
import { touchSeating } from './staff-touch';
import { SLA_SCHEDULER, type SlaScheduler } from './sla-scheduler';
import { type TableLive, TableViews } from './table-views';

type Tx = Prisma.TransactionClient;

export interface ApplyInput {
  organizationId: string;
  outletId: string;
  tableId: string;
  event: TableMachineEvent;
  actor: Actor;
  audit: AuditActor;
  source: EventSource;
  /** Client's last seen version; mismatch → 409 VERSION_CONFLICT. */
  expectedVersion?: number;
  /** Edge idempotency key. A repeat is acknowledged without re-applying. */
  eventId?: string;
  occurredAt?: Date;
  confidence?: number;
  payload?: Record<string, unknown>;
  /** Extra data for HOST_SEAT. */
  seat?: { notes?: string; joinTableIds?: string[]; guestId?: string; reservationId?: string };
}

export interface ApplyOutput {
  result: Extract<TransitionResult, { ok: true }> | null;
  duplicate: boolean;
  tables: TableLive[];
}

const ALERT_MESSAGES: Record<string, string> = {
  LEFT_WITHOUT_PAYING: 'Guests may have left without paying',
  SEATED_AT_DIRTY_TABLE: 'Guests were seated at a table that was not cleaned',
  RESERVED_TABLE_TAKEN: 'Guests sat at a reserved table',
};

const REJECT_ERRORS = {
  INVALID_FROM_STATE: ['TABLE_INVALID_TRANSITION', HttpStatus.CONFLICT],
  GUARD_FAILED: ['TABLE_GUARD_FAILED', HttpStatus.CONFLICT],
  FORBIDDEN: ['FORBIDDEN', HttpStatus.FORBIDDEN],
} as const;

/** Events that complete (rather than cancel) open tasks of these types. */
const FULFILS: Partial<Record<TableMachineEvent['type'], readonly TaskType[]>> = {
  GREET: ['GREET'],
  CAMERA_STAFF_PRESENT: ['GREET'],
  ORDER_ACCEPTED: ['GREET'],
  CLEAN_CONFIRMED: ['CLEAN'],
  PAYMENT_CAPTURED: ['BILL'],
};

/** Tables a party can be seated at (or joined into). */
const SEATABLE: readonly TableStatus[] = ['VACANT', 'RESERVED', 'NEEDS_CLEANING'];

/**
 * The only writer of table state. Loads context, runs the pure reducer, and executes its effects in one
 * transaction (row-locked tables, TableEvent + AuditLog per change). Timers and sockets run after commit.
 */
@Injectable()
export class TableStateService {
  private readonly logger = new Logger(TableStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly views: TableViews,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
    @Inject(SLA_SCHEDULER) private readonly sla: SlaScheduler,
    private readonly seatingEvents: SeatingEvents,
  ) {}

  async apply(input: ApplyInput): Promise<ApplyOutput> {
    const after: {
      sla: ('start' | 'cancel')[];
      seatingId?: string;
      seatedAt?: Date;
      alerts: Alert[];
      tasks: Task[];
      touched: Task[];
      closedSeatingId?: string;
    } = {
      sla: [],
      alerts: [],
      tasks: [],
      touched: [],
    };

    const out = await this.prisma.$transaction(async (tx) => {
      if (input.eventId && (await tx.tableEvent.findUnique({ where: { eventId: input.eventId } }))) {
        return { result: null, duplicate: true, targetIds: [input.tableId] };
      }

      const table = await this.lockTable(tx, input);
      if (input.expectedVersion !== undefined && input.expectedVersion !== table.version) {
        throw new AppError(
          'VERSION_CONFLICT',
          HttpStatus.CONFLICT,
          'The table changed; refresh and try again',
          {
            currentVersion: table.version,
            status: table.status,
          },
        );
      }

      const open = await tx.seatingTable.findFirst({
        where: { tableId: table.id, isOpen: true },
        include: { seating: { include: { tables: true } } },
      });
      const seating = open?.seating ?? null;
      const settings = await tx.outletSettings.findUniqueOrThrow({ where: { outletId: input.outletId } });

      const ctx: MachineContext = {
        settings,
        seating: seating ? await this.seatingFacts(tx, seating.id) : null,
        actor: input.actor,
      };
      const result = transition(table.status, input.event, ctx);
      if (!result.ok) {
        const [code, status] = REJECT_ERRORS[result.reason];
        throw new AppError(code, status, result.message, { from: result.from, event: input.event.type });
      }
      // Any staff action on the table, or staff seen standing at it, ends an idle episode.
      if (seating && (input.actor.kind === 'STAFF' || input.event.type === 'CAMERA_STAFF_PRESENT')) {
        after.touched = await touchSeating(tx, seating.id, input.occurredAt ?? new Date());
      }
      if (result.noop) return { result, duplicate: false, targetIds: [table.id] };

      const occurredAt = input.occurredAt ?? new Date();
      let seatingId = seating?.id;
      let targetIds = seating ? seating.tables.map((t) => t.tableId) : [table.id];
      const fromStatuses = new Map<string, TableStatus>([[table.id, table.status]]);
      if (seating) {
        const others = await tx.table.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, status: true },
        });
        others.forEach((t) => fromStatuses.set(t.id, t.status));
      }

      for (const effect of result.effects) {
        switch (effect.type) {
          case 'CREATE_SEATING': {
            const joined = await this.lockJoinTables(tx, input, table.id);
            joined.forEach((t) => fromStatuses.set(t.id, t.status));
            targetIds = [table.id, ...joined.map((t) => t.id)];
            const created = await tx.seating.create({
              data: {
                organizationId: input.organizationId,
                outletId: input.outletId,
                partySize: effect.partySize ?? null,
                source: effect.source satisfies SeatingSource,
                seatedBy: effect.seatedBy,
                notes: input.seat?.notes ?? null,
                guestId: input.seat?.guestId ?? null,
                reservationId: input.seat?.reservationId ?? null,
                seatedAt: occurredAt,
                tables: { create: targetIds.map((tableId) => ({ tableId })) },
              },
            });
            seatingId = created.id;
            after.seatingId = created.id;
            after.seatedAt = created.seatedAt;
            break;
          }
          case 'CLOSE_SEATING':
            if (!seatingId) break;
            await tx.seating.update({
              where: { id: seatingId },
              data: { status: 'CLOSED', closedAt: occurredAt },
            });
            await tx.seatingTable.updateMany({ where: { seatingId }, data: { isOpen: false } });
            after.closedSeatingId = seatingId;
            break;
          case 'SET_SEATING_TS':
            if (seatingId) await this.setTimestamp(tx, seatingId, effect.field, occurredAt, input.actor);
            break;
          case 'MARK_CLEANED': {
            const last = await tx.seatingTable.findFirst({
              where: { tableId: table.id, isOpen: false, seating: { cleanedAt: null } },
              orderBy: { seating: { closedAt: 'desc' } },
            });
            if (last)
              await tx.seating.update({ where: { id: last.seatingId }, data: { cleanedAt: occurredAt } });
            break;
          }
          case 'START_GREET_SLA':
            after.sla.push('start');
            break;
          case 'CANCEL_GREET_SLA':
            after.sla.push('cancel');
            after.seatingId ??= seatingId;
            break;
          case 'CREATE_TASK': {
            const task = await this.createTask(tx, input, effect.task, table.id, seatingId);
            if (task) after.tasks.push(task);
            break;
          }
          case 'CANCEL_TASKS': {
            const fulfilled = FULFILS[input.event.type] ?? [];
            const scope = {
              outletId: input.outletId,
              status: { in: ['OPEN', 'ACCEPTED'] as ('OPEN' | 'ACCEPTED')[] },
              OR: [{ tableId: { in: targetIds } }, ...(seatingId ? [{ seatingId }] : [])],
            };
            const done = effect.tasks.filter((t) => fulfilled.includes(t));
            const cancelled = effect.tasks.filter((t) => !fulfilled.includes(t));
            if (done.length) {
              await tx.task.updateMany({
                where: { ...scope, type: { in: [...done] } },
                data: {
                  status: 'DONE',
                  doneAt: occurredAt,
                  doneById: input.actor.kind === 'STAFF' ? input.actor.userId : null,
                },
              });
            }
            if (cancelled.length) {
              await tx.task.updateMany({
                where: { ...scope, type: { in: [...cancelled] } },
                data: { status: 'CANCELLED', doneAt: occurredAt },
              });
            }
            break;
          }
          case 'RAISE_ALERT': {
            const alert = await this.raiseAlert(tx, input, effect, table.id, seatingId);
            if (alert) after.alerts.push(alert);
            break;
          }
          case 'RESOLVE_ALERTS':
            if (!seatingId) break;
            await tx.alert.updateMany({
              where: {
                outletId: input.outletId,
                seatingId,
                type: { in: [...effect.alerts] },
                status: { not: 'RESOLVED' },
              },
              data: { status: 'RESOLVED', resolvedAt: occurredAt },
            });
            break;
          case 'UPDATE_PARTY_SIZE':
            if (!seatingId) break;
            // Staff-entered party sizes win over camera counts.
            await tx.seating.updateMany({
              where: { id: seatingId, OR: [{ partySize: null }, { seatedBy: 'CAMERA' }] },
              data: { partySize: effect.partySize },
            });
            break;
          default:
            assertNever(effect);
        }
      }

      if (result.next !== result.from || result.effects.some((e) => e.type === 'CREATE_SEATING')) {
        await tx.table.updateMany({
          where: { id: { in: targetIds } },
          data: { status: result.next, statusChangedAt: occurredAt, version: { increment: 1 } },
        });
      }

      await tx.tableEvent.createMany({
        data: targetIds.map((tableId) => ({
          organizationId: input.organizationId,
          outletId: input.outletId,
          tableId,
          seatingId: seatingId ?? null,
          type: input.event.type,
          source: input.source,
          actorId: input.audit.id ?? null,
          confidence: input.confidence ?? null,
          fromStatus: fromStatuses.get(tableId) ?? result.from,
          toStatus: result.next,
          payload: {
            ...(input.payload ?? {}),
            event: input.event,
            ...(tableId !== table.id ? { joinedWith: table.id } : {}),
          },
          // Idempotency key lives on the primary table's row only.
          eventId: tableId === table.id ? (input.eventId ?? null) : null,
          occurredAt,
        })),
      });

      await this.audit.recordAs(
        input.audit,
        {
          action: 'table.transition',
          entityType: 'Table',
          entityId: table.id,
          outletId: input.outletId,
          before: { status: result.from, version: table.version },
          after: { status: result.next, event: input.event, seatingId, tableIds: targetIds },
        },
        tx,
      );
      return { result, duplicate: false, targetIds };
    });

    const tables = await this.views.load(input.organizationId, input.outletId, out.targetIds);
    if (out.result && !out.result.noop) this.broadcast(input.outletId, tables, after.alerts);
    await this.runTimers(input, after);
    // Push/socket notifications must never fail a committed transition.
    after.touched.forEach((t) => this.notifier.taskUpdated(t));
    await Promise.allSettled([
      ...after.tasks.map((t) => this.notifier.taskCreated(t)),
      ...after.alerts.map((a) => this.notifier.alertRaised(a)),
      ...(after.closedSeatingId
        ? [
            this.seatingEvents.emitClosed({
              organizationId: input.organizationId,
              outletId: input.outletId,
              seatingId: after.closedSeatingId,
            }),
          ]
        : []),
    ]);
    return { result: out.result, duplicate: out.duplicate, tables };
  }

  private broadcast(outletId: string, tables: TableLive[], alerts: Alert[]): void {
    for (const t of tables)
      this.realtime.emit([rooms.outlet(outletId), rooms.table(t.tableId)], 'table.updated', t);
    for (const a of alerts) {
      this.realtime.emit(
        [rooms.role('MANAGER', outletId), rooms.role('OWNER', outletId), rooms.role('HOST', outletId)],
        'alert.created',
        {
          id: a.id,
          outletId,
          type: a.type,
          severity: a.severity,
          status: a.status,
          tableId: a.tableId,
          message: a.message,
          createdAt: a.createdAt.toISOString(),
        },
      );
    }
  }

  /** Timers run after commit; a failure here must not undo the transition (the M5 reconciler repairs it). */
  private async runTimers(
    input: ApplyInput,
    after: { sla: ('start' | 'cancel')[]; seatingId?: string; seatedAt?: Date },
  ): Promise<void> {
    if (!after.seatingId) return;
    try {
      for (const op of after.sla) {
        if (op === 'start' && after.seatedAt) {
          await this.sla.startGreetSla({
            organizationId: input.organizationId,
            outletId: input.outletId,
            seatingId: after.seatingId,
            seatedAt: after.seatedAt,
          });
        } else if (op === 'cancel') {
          await this.sla.cancelGreetSla({ seatingId: after.seatingId });
        }
      }
    } catch (e) {
      this.logger.error(`SLA scheduling failed for seating ${after.seatingId}: ${String(e)}`);
    }
  }

  private async lockTable(tx: Tx, input: ApplyInput) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Table"
      WHERE id = ${input.tableId} AND "organizationId" = ${input.organizationId}
        AND "outletId" = ${input.outletId} AND "archivedAt" IS NULL
      FOR UPDATE`;
    if (!locked.length) throw AppError.notFound('Table');
    return tx.table.findUniqueOrThrow({ where: { id: input.tableId } });
  }

  /** Validates and locks the extra tables of a HOST_SEAT join. */
  private async lockJoinTables(tx: Tx, input: ApplyInput, primaryId: string) {
    const ids = [...new Set(input.seat?.joinTableIds ?? [])].filter((id) => id !== primaryId).sort();
    if (!ids.length) return [];
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Table"
      WHERE id IN (${Prisma.join(ids)}) AND "outletId" = ${input.outletId} AND "archivedAt" IS NULL
      ORDER BY id FOR UPDATE`;
    if (locked.length !== ids.length) throw AppError.notFound('Join table');
    const tables = await tx.table.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        label: true,
        status: true,
        seatings: { where: { isOpen: true }, select: { seatingId: true } },
      },
    });
    const busy = tables.filter((t) => !SEATABLE.includes(t.status) || t.seatings.length);
    if (busy.length) {
      throw new AppError(
        'TABLE_INVALID_TRANSITION',
        HttpStatus.CONFLICT,
        'Some tables to join are not free',
        {
          tables: busy.map((t) => ({ id: t.id, label: t.label, status: t.status })),
        },
      );
    }
    return tables;
  }

  private async seatingFacts(tx: Tx, seatingId: string): Promise<SeatingFacts> {
    const firstOrder = await tx.order.findFirst({
      where: { seatingId, status: 'ACCEPTED' },
      orderBy: { createdAt: 'asc' },
      select: { items: { select: { status: true } } },
    });
    const bills = await tx.bill.findMany({
      where: { seatingId, status: { not: 'VOID' } },
      select: {
        totalPaise: true,
        payments: { where: { status: 'CAPTURED' }, select: { amountPaise: true } },
      },
    });
    const total = bills.reduce((s, b) => s + b.totalPaise, 0);
    const paid = bills.reduce((s, b) => s + b.payments.reduce((p, x) => p + x.amountPaise, 0), 0);
    return {
      hasAcceptedOrder: firstOrder !== null,
      allFirstOrderServed:
        firstOrder !== null &&
        firstOrder.items.length > 0 &&
        firstOrder.items.every((i) => i.status === 'SERVED' || i.status === 'VOID'),
      isPaid: bills.length > 0 && total > 0 && paid >= total,
    };
  }

  private async setTimestamp(
    tx: Tx,
    seatingId: string,
    field: Extract<Effect, { type: 'SET_SEATING_TS' }>['field'],
    at: Date,
    actor: Actor,
  ) {
    // Only the first occurrence counts (e.g. first greet, first order).
    await tx.seating.updateMany({ where: { id: seatingId, [field]: null }, data: { [field]: at } });
    if (field !== 'greetedAt' || actor.kind !== 'STAFF') return;
    await tx.seating.updateMany({
      where: { id: seatingId, greetedById: null },
      data: { greetedById: actor.userId },
    });
    // The waiter who greets becomes the serving waiter unless one is already set (e.g. by assignment).
    if (actor.roles.includes('WAITER')) {
      await tx.seating.updateMany({
        where: { id: seatingId, servingWaiterId: null },
        data: { servingWaiterId: actor.userId },
      });
    }
  }

  private async createTask(
    tx: Tx,
    input: ApplyInput,
    type: TaskType,
    tableId: string,
    seatingId?: string,
  ): Promise<Task | null> {
    const existing = await tx.task.findFirst({
      where: { outletId: input.outletId, tableId, type, status: { in: ['OPEN', 'ACCEPTED'] } },
    });
    if (existing) return null;
    const seating = seatingId ? await tx.seating.findUnique({ where: { id: seatingId } }) : null;
    return tx.task.create({
      data: {
        organizationId: input.organizationId,
        outletId: input.outletId,
        type,
        tableId,
        seatingId: seatingId ?? null,
        // Bills go to the serving waiter; cleaning goes to the shared busser queue.
        assigneeId: type === 'CLEAN' ? null : (seating?.servingWaiterId ?? null),
      },
    });
  }

  private async raiseAlert(
    tx: Tx,
    input: ApplyInput,
    effect: Extract<Effect, { type: 'RAISE_ALERT' }>,
    tableId: string,
    seatingId?: string,
  ): Promise<Alert | null> {
    const dedupeKey = `${effect.alert}:${seatingId ?? tableId}`;
    const exists = await tx.alert.findUnique({
      where: { outletId_dedupeKey: { outletId: input.outletId, dedupeKey } },
    });
    if (exists) return null;
    return tx.alert.create({
      data: {
        organizationId: input.organizationId,
        outletId: input.outletId,
        type: effect.alert,
        severity: effect.severity,
        tableId,
        seatingId: seatingId ?? null,
        message: ALERT_MESSAGES[effect.alert] ?? effect.alert,
        dedupeKey,
      },
    });
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled effect ${JSON.stringify(x)}`);
}
