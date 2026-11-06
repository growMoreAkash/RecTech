import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  type OrderItemStatus,
  type OrderSource,
  Prisma,
  type Role,
  type Task,
  type TaskType,
} from '@prisma/client';
import {
  type AvailabilityWindow,
  CART_LIMITS,
  isWithinWindows,
  localDate,
  localDayRange,
  type OrderLineInput,
  priceLine,
  rooms,
  shouldHoldMains,
} from '@dinesense/shared';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { itemInclude, flattenItem } from '../menu/menu.service';
import { touchSeating } from '../table-state/staff-touch';
import { TableStateService } from '../table-state/table-state.service';
import { PrepTimeService } from './prep-time.service';

type Tx = Prisma.TransactionClient;

export interface CreateOrderInput {
  organizationId: string;
  outletId: string;
  seatingId: string;
  source: OrderSource;
  lines: OrderLineInput[];
  audit: AuditActor;
  placedById?: string;
  guestSessionId?: string;
  /** Runs inside the order transaction (e.g. clear the guest cart). */
  afterCreate?: (tx: Tx, orderId: string) => Promise<void>;
}

export const orderInclude = {
  items: { orderBy: { queuedAt: 'asc' } },
  seating: {
    select: {
      id: true,
      servingWaiterId: true,
      tables: { select: { table: { select: { id: true, label: true } } } },
    },
  },
} satisfies Prisma.OrderInclude;

/** Item status moves allowed, and who may make them. */
const ITEM_FLOW: Record<OrderItemStatus, Partial<Record<OrderItemStatus, readonly Role[]>>> = {
  // Held courses reach the kitchen through fireCourse, not item by item.
  HELD: { VOID: ['MANAGER', 'OWNER'] },
  QUEUED: {
    COOKING: ['CHEF', 'MANAGER', 'OWNER'],
    READY: ['CHEF', 'MANAGER', 'OWNER'],
    VOID: ['MANAGER', 'OWNER'],
  },
  COOKING: {
    READY: ['CHEF', 'MANAGER', 'OWNER'],
    QUEUED: ['CHEF', 'MANAGER', 'OWNER'],
    VOID: ['MANAGER', 'OWNER'],
  },
  READY: {
    SERVED: ['WAITER', 'MANAGER', 'OWNER', 'HOST'],
    COOKING: ['CHEF', 'MANAGER', 'OWNER'],
    VOID: ['MANAGER', 'OWNER'],
  },
  SERVED: {},
  VOID: {},
};
const ITEM_TS: Partial<Record<OrderItemStatus, 'startedAt' | 'readyAt' | 'servedAt' | 'voidedAt'>> = {
  COOKING: 'startedAt',
  READY: 'readyAt',
  SERVED: 'servedAt',
  VOID: 'voidedAt',
};

/**
 * Orders from QR guests and waiters, the approval queue, and the kitchen flow.
 * Pricing is always recomputed server-side from the live menu; clients never send prices.
 */
@Injectable()
export class OrderingService {
  private readonly logger = new Logger(OrderingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly tables: TableStateService,
    private readonly notifier: NotifierService,
    private readonly prep: PrepTimeService,
  ) {}

  /** Prices lines against the live menu. Throws ITEM_UNAVAILABLE / INVALID_MODIFIERS with per-line details. */
  async priceLines(
    db: Tx | PrismaService,
    organizationId: string,
    outletId: string,
    lines: OrderLineInput[],
    now = new Date(),
  ) {
    const outlet = await db.outlet.findUniqueOrThrow({ where: { id: outletId }, select: { timezone: true } });
    const ids = [...new Set(lines.map((l) => l.menuItemId))];
    const items = await db.menuItem.findMany({
      where: { id: { in: ids }, organizationId, outletId, archivedAt: null },
      include: {
        ...itemInclude,
        category: { select: { availabilityWindows: true, archivedAt: true, course: true } },
      },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    const open = (w: unknown) => isWithinWindows(w as AvailabilityWindow[] | null, now, outlet.timezone);

    const unavailable: { index: number; menuItemId: string }[] = [];
    const invalid: { index: number; menuItemId: string; errors: unknown }[] = [];
    const priced = lines.map((line, index) => {
      const item = byId.get(line.menuItemId);
      if (
        !item ||
        !item.isAvailable ||
        item.category.archivedAt ||
        !open(item.availabilityWindows) ||
        !open(item.category.availabilityWindows)
      ) {
        unavailable.push({ index, menuItemId: line.menuItemId });
        return null;
      }
      const flat = flattenItem({ ...item, modifierGroups: item.modifierGroups });
      const price = priceLine(flat, line.modifierIds);
      if (!price.ok) {
        invalid.push({ index, menuItemId: line.menuItemId, errors: price.errors });
        return null;
      }
      return { line, item: flat, price, course: item.category.course };
    });
    if (unavailable.length) {
      throw new AppError('ITEM_UNAVAILABLE', HttpStatus.CONFLICT, 'Some items are not available right now', {
        lines: unavailable,
      });
    }
    if (invalid.length) {
      throw new AppError('INVALID_MODIFIERS', HttpStatus.BAD_REQUEST, 'Some options are not valid', {
        lines: invalid,
      });
    }
    return priced.filter((p): p is NonNullable<typeof p> => p !== null);
  }

  async createOrder(input: CreateOrderInput) {
    if (!input.lines.length) throw new AppError('CART_EMPTY', HttpStatus.BAD_REQUEST, 'Nothing to order');
    if (input.lines.reduce((s, l) => s + l.quantity, 0) > CART_LIMITS.maxItemsPerOrder) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Too many items in one order');
    }

    let approvalTask: Task | null = null;
    const order = await this.prisma.$transaction(async (tx) => {
      const seating = await tx.seating.findFirst({
        where: { id: input.seatingId, organizationId: input.organizationId, outletId: input.outletId },
        include: { tables: { include: { table: { select: { status: true } } } } },
      });
      if (!seating || seating.status !== 'OPEN' || seating.tables.some((t) => t.table.status === 'PAID')) {
        throw new AppError('NO_OPEN_SEATING', HttpStatus.CONFLICT, 'This table is not taking orders');
      }
      const settings = await tx.outletSettings.findUniqueOrThrow({ where: { outletId: input.outletId } });
      const priced = await this.priceLines(tx, input.organizationId, input.outletId, input.lines);
      const number = await this.nextNumber(tx, input.outletId);
      const accepted = input.source === 'WAITER' || !settings.qrOrderNeedsApproval;
      const now = new Date();

      const created = await tx.order.create({
        data: {
          organizationId: input.organizationId,
          outletId: input.outletId,
          seatingId: seating.id,
          number,
          source: input.source,
          status: accepted ? 'ACCEPTED' : 'PENDING_APPROVAL',
          placedById: input.placedById ?? null,
          guestSessionId: input.guestSessionId ?? null,
          ...(accepted && input.placedById ? { approvedById: input.placedById, approvedAt: now } : {}),
          ...(accepted && !input.placedById ? { approvedAt: now } : {}),
          items: {
            create: priced.map(({ line, item, price, course }) => ({
              organizationId: input.organizationId,
              outletId: input.outletId,
              menuItemId: item.id,
              nameSnapshot: item.name as Prisma.InputJsonValue,
              stationId: item.stationId,
              quantity: line.quantity,
              unitPricePaise: price.unitPricePaise,
              taxRateBps: item.taxRateBps,
              modifiers: price.modifiers as unknown as Prisma.InputJsonValue,
              note: line.note ?? null,
              course,
            })),
          },
        },
        include: orderInclude,
      });

      if (!accepted) {
        approvalTask = await tx.task.create({
          data: {
            organizationId: input.organizationId,
            outletId: input.outletId,
            type: 'APPROVE_ORDER',
            tableId: seating.tables[0]!.tableId,
            seatingId: seating.id,
            orderId: created.id,
            assigneeId: seating.servingWaiterId,
          },
        });
      }
      if (accepted) await this.release(tx, created, settings.pacingEnabled, now);
      // A waiter taking the order is serving the table (and is at it).
      if (input.source === 'WAITER' && input.placedById) {
        await tx.seating.updateMany({
          where: { id: seating.id, servingWaiterId: null },
          data: { servingWaiterId: input.placedById },
        });
        await touchSeating(tx, seating.id, now);
      }
      await input.afterCreate?.(tx, created.id);
      await this.audit.recordAs(
        input.audit,
        {
          action: 'order.create',
          entityType: 'Order',
          entityId: created.id,
          outletId: input.outletId,
          after: { number, source: input.source, status: created.status, lines: priced.length },
        },
        tx,
      );
      return created;
    });

    if (order.status === 'ACCEPTED') await this.afterAccept(order.id, input.audit);
    else this.announce(order);
    if (approvalTask) await this.notifier.taskCreated(approvalTask).catch(() => undefined);
    return this.getOrder(input.organizationId, order.id);
  }

  async approve(
    organizationId: string,
    outletId: string,
    orderId: string,
    audit: AuditActor & { id: string },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, organizationId, outletId, status: 'PENDING_APPROVAL' },
        data: { status: 'ACCEPTED', approvedById: audit.id, approvedAt: new Date() },
      });
      if (res.count !== 1) throw await this.notPending(tx, organizationId, outletId, orderId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const settings = await tx.outletSettings.findUniqueOrThrow({ where: { outletId } });
      await this.release(tx, order, settings.pacingEnabled, new Date());
      await this.closeTasks(tx, orderId, ['APPROVE_ORDER'], 'DONE', audit.id);
      await this.audit.recordAs(
        audit,
        { action: 'order.approve', entityType: 'Order', entityId: orderId, outletId },
        tx,
      );
    });
    await this.afterAccept(orderId, audit);
    return this.getOrder(organizationId, orderId);
  }

  async reject(organizationId: string, outletId: string, orderId: string, reason: string, audit: AuditActor) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, organizationId, outletId, status: 'PENDING_APPROVAL' },
        data: { status: 'REJECTED', rejectedReason: reason },
      });
      if (res.count !== 1) throw await this.notPending(tx, organizationId, outletId, orderId);
      await tx.orderItem.updateMany({
        where: { orderId },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
      });
      await this.closeTasks(tx, orderId, ['APPROVE_ORDER'], 'CANCELLED');
      await this.audit.recordAs(
        audit,
        { action: 'order.reject', entityType: 'Order', entityId: orderId, outletId, after: { reason } },
        tx,
      );
    });
    const order = await this.getOrder(organizationId, orderId);
    this.announce(order);
    return order;
  }

  /** Kitchen and floor item moves. Ready items create a SERVE task; serving the whole first order moves the table. */
  async setItemStatus(
    organizationId: string,
    outletId: string,
    itemId: string,
    next: Exclude<OrderItemStatus, 'QUEUED'> | 'QUEUED',
    roles: readonly Role[],
    audit: AuditActor,
    voidReason?: string,
  ) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, organizationId, outletId, order: { status: 'ACCEPTED' } },
      include: { order: { include: orderInclude }, station: true },
    });
    if (!item) throw AppError.notFound('Order item');
    if (item.status === next) return this.getOrder(organizationId, item.orderId);
    const allowed = ITEM_FLOW[item.status][next];
    if (!allowed) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `Cannot move an item from ${item.status} to ${next}`,
        { from: item.status, to: next },
      );
    }
    if (!allowed.some((r) => roles.includes(r))) throw AppError.forbidden();

    let serveTask: Task | null = null;
    await this.prisma.$transaction(async (tx) => {
      // Guard against a concurrent move (compare-and-set on the current status).
      const ts = ITEM_TS[next];
      const res = await tx.orderItem.updateMany({
        where: { id: itemId, status: item.status },
        data: {
          status: next,
          ...(ts ? { [ts]: new Date() } : {}),
          ...(next === 'VOID' ? { voidReason: voidReason ?? null } : {}),
        },
      });
      if (res.count !== 1)
        throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'The item was just changed by someone else');
      if (next === 'READY') serveTask = await this.ensureServeTask(tx, item.order);
      if (next === 'SERVED') await touchSeating(tx, item.order.seatingId);
      await this.audit.recordAs(
        audit,
        {
          action: 'order.item.status',
          entityType: 'OrderItem',
          entityId: itemId,
          outletId,
          before: { status: item.status },
          after: { status: next, voidReason },
        },
        tx,
      );
    });

    await this.afterItemChange(organizationId, item.orderId, [item.station.code], audit);
    if (serveTask) await this.notifier.taskCreated(serveTask).catch(() => undefined);
    return this.getOrder(organizationId, item.orderId);
  }

  /** "Bump": everything of this order at this station is ready. */
  async bump(
    organizationId: string,
    outletId: string,
    orderId: string,
    stationCode: string,
    audit: AuditActor,
  ) {
    const station = await this.prisma.kitchenStation.findFirst({
      where: { organizationId, outletId, code: stationCode },
    });
    if (!station) throw AppError.notFound('Station');
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId, outletId, status: 'ACCEPTED' },
      include: orderInclude,
    });
    if (!order) throw AppError.notFound('Order');
    let serveTask: Task | null = null;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.orderItem.updateMany({
        where: { orderId, stationId: station.id, status: { in: ['QUEUED', 'COOKING'] } },
        data: { status: 'READY', readyAt: new Date() },
      });
      if (res.count) serveTask = await this.ensureServeTask(tx, order);
      await this.audit.recordAs(
        audit,
        {
          action: 'kds.bump',
          entityType: 'Order',
          entityId: orderId,
          outletId,
          after: { station: stationCode, items: res.count },
        },
        tx,
      );
    });
    await this.afterItemChange(organizationId, orderId, [stationCode], audit);
    if (serveTask) await this.notifier.taskCreated(serveTask).catch(() => undefined);
    return this.getOrder(organizationId, orderId);
  }

  /** Open tickets for one KDS station: accepted orders with items still to cook or pick up. */
  async kdsTickets(organizationId: string, outletId: string, stationCode: string) {
    const station = await this.prisma.kitchenStation.findFirst({
      where: { organizationId, outletId, code: stationCode },
    });
    if (!station) throw AppError.notFound('Station');
    const orders = await this.prisma.order.findMany({
      where: {
        organizationId,
        outletId,
        status: 'ACCEPTED',
        items: { some: { stationId: station.id, status: { in: ['HELD', 'QUEUED', 'COOKING', 'READY'] } } },
      },
      include: {
        items: {
          where: { stationId: station.id, status: { in: ['HELD', 'QUEUED', 'COOKING', 'READY'] } },
          orderBy: { queuedAt: 'asc' },
        },
        seating: { select: { partySize: true, tables: { select: { table: { select: { label: true } } } } } },
      },
      orderBy: [{ approvedAt: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      station: { id: station.id, code: station.code, name: station.name },
      tickets: orders.map((o) => ({
        orderId: o.id,
        number: o.number,
        source: o.source,
        tables: o.seating.tables
          .map((t) => t.table.label)
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
        partySize: o.seating.partySize,
        firedAt: (o.approvedAt ?? o.createdAt).toISOString(),
        items: o.items.map((i) => ({
          id: i.id,
          name: i.nameSnapshot,
          quantity: i.quantity,
          modifiers: i.modifiers,
          note: i.note,
          status: i.status,
          course: i.course,
          queuedAt: i.queuedAt.toISOString(),
          etaReadyAt: i.etaReadyAt?.toISOString() ?? null,
        })),
      })),
    };
  }

  /**
   * Course pacing: send the seating's held courses to the kitchen (waiter taps "Fire mains", or the service sweep
   * fires them when nobody did). Completes the FIRE_COURSE prompt.
   */
  async fireCourse(
    organizationId: string,
    outletId: string,
    seatingId: string,
    audit: AuditActor,
    reason: 'manual' | 'auto',
  ): Promise<{ fired: number }> {
    const now = new Date();
    const held = await this.prisma.$transaction(async (tx) => {
      const items = await tx.orderItem.findMany({
        where: { organizationId, outletId, status: 'HELD', order: { seatingId, status: 'ACCEPTED' } },
        select: { id: true, orderId: true, station: { select: { code: true } } },
      });
      if (!items.length) return [];
      const ids = items.map((i) => i.id);
      await tx.orderItem.updateMany({
        where: { id: { in: ids }, status: 'HELD' },
        data: { status: 'QUEUED', firedAt: now },
      });
      await this.restartQueue(tx, ids, now);
      await this.prep.stamp(tx, outletId, ids, now);
      await tx.task.updateMany({
        where: { seatingId, type: 'FIRE_COURSE', status: { in: ['OPEN', 'ACCEPTED'] } },
        data: { status: 'DONE', doneAt: now, doneById: audit.id ?? null },
      });
      await this.audit.recordAs(
        audit,
        {
          action: 'order.course.fire',
          entityType: 'Seating',
          entityId: seatingId,
          outletId,
          after: { items: ids.length, reason },
        },
        tx,
      );
      return items;
    });
    if (!held.length) return { fired: 0 };
    for (const code of new Set(held.map((i) => i.station.code)))
      this.realtime.emit([rooms.outlet(outletId), rooms.kds(outletId, code)], 'kds.changed', {
        outletId,
        stationCode: code,
      });
    for (const orderId of new Set(held.map((i) => i.orderId)))
      this.announce(await this.getOrder(organizationId, orderId));
    const tasks = await this.prisma.task.findMany({
      where: { seatingId, type: 'FIRE_COURSE', status: 'DONE', doneAt: now },
    });
    tasks.forEach((t) => this.notifier.taskUpdated(t));
    return { fired: held.length };
  }

  getOrder(organizationId: string, orderId: string) {
    return this.prisma.order.findFirstOrThrow({
      where: { id: orderId, organizationId },
      include: orderInclude,
    });
  }

  listOrders(organizationId: string, outletId: string, where: Prisma.OrderWhereInput) {
    return this.prisma.order.findMany({
      where: { ...where, organizationId, outletId },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ───────── internals ─────────

  /**
   * An order was accepted: its items reach the kitchen now (queue time restarts after approval so prep times are
   * the kitchen's), mains wait while starters are still to come (pacing), and each queued item gets an ETA.
   */
  private async release(
    tx: Tx,
    order: { id: string; outletId: string; seatingId: string },
    pacing: boolean,
    now: Date,
  ): Promise<void> {
    const accepted = await tx.orderItem.findMany({
      where: { orderId: order.id, status: 'QUEUED' },
      select: { id: true },
    });
    await this.restartQueue(
      tx,
      accepted.map((i) => i.id),
      now,
    );
    if (pacing) {
      const items = await tx.orderItem.findMany({
        where: { order: { seatingId: order.seatingId, status: 'ACCEPTED' } },
        select: { course: true, status: true },
      });
      if (shouldHoldMains(items)) {
        await tx.orderItem.updateMany({
          where: { orderId: order.id, status: 'QUEUED', course: 'MAIN' },
          data: { status: 'HELD' },
        });
      }
    }
    const queued = await tx.orderItem.findMany({
      where: { orderId: order.id, status: 'QUEUED' },
      select: { id: true },
    });
    await this.prep.stamp(
      tx,
      order.outletId,
      queued.map((i) => i.id),
      now,
    );
  }

  /**
   * The kitchen clock for these items starts now. Items keep their relative order (lines, tickets and bills are
   * ordered by queue time), so the whole group is shifted rather than stamped with one time.
   */
  private async restartQueue(tx: Tx, itemIds: string[], now: Date): Promise<void> {
    if (!itemIds.length) return;
    const items = await tx.orderItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, queuedAt: true },
    });
    const first = Math.min(...items.map((i) => i.queuedAt.getTime()));
    const shift = now.getTime() - first;
    if (shift <= 0) return;
    for (const i of items)
      await tx.orderItem.update({
        where: { id: i.id },
        data: { queuedAt: new Date(i.queuedAt.getTime() + shift) },
      });
  }

  /** Per-outlet daily ticket number, serialized with an advisory lock. */
  private async nextNumber(tx: Tx, outletId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ordno:' + outletId}))`;
    const outlet = await tx.outlet.findUniqueOrThrow({ where: { id: outletId }, select: { timezone: true } });
    const { start } = localDayRange(localDate(new Date(), outlet.timezone), outlet.timezone);
    return (await tx.order.count({ where: { outletId, createdAt: { gte: start } } })) + 1;
  }

  private async notPending(tx: Tx, organizationId: string, outletId: string, orderId: string) {
    const exists = await tx.order.findFirst({
      where: { id: orderId, organizationId, outletId },
      select: { status: true },
    });
    return exists
      ? new AppError('ORDER_NOT_PENDING', HttpStatus.CONFLICT, 'This order was already handled', {
          status: exists.status,
        })
      : AppError.notFound('Order');
  }

  private async closeTasks(
    tx: Tx,
    orderId: string,
    types: TaskType[],
    status: 'DONE' | 'CANCELLED',
    doneById?: string,
  ) {
    await tx.task.updateMany({
      where: { orderId, type: { in: types }, status: { in: ['OPEN', 'ACCEPTED'] } },
      data: { status, doneAt: new Date(), doneById: doneById ?? null },
    });
  }

  private async ensureServeTask(
    tx: Tx,
    order: Prisma.OrderGetPayload<{ include: typeof orderInclude }>,
  ): Promise<Task | null> {
    const open = await tx.task.findFirst({
      where: { orderId: order.id, type: 'SERVE', status: { in: ['OPEN', 'ACCEPTED'] } },
    });
    if (open) return null;
    return tx.task.create({
      data: {
        organizationId: order.organizationId,
        outletId: order.outletId,
        type: 'SERVE',
        tableId: order.seating.tables[0]?.table.id ?? null,
        seatingId: order.seatingId,
        orderId: order.id,
        assigneeId: order.seating.servingWaiterId,
      },
    });
  }

  /** After acceptance: move the table (first order → ORDERED), wake the kitchen, update everyone. */
  private async afterAccept(orderId: string, audit: AuditActor): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { ...orderInclude, items: { include: { station: true } } },
    });
    const tableId = order.seating.tables[0]?.table.id;
    if (tableId) {
      try {
        await this.tables.apply({
          organizationId: order.organizationId,
          outletId: order.outletId,
          tableId,
          event: { type: 'ORDER_ACCEPTED', orderSource: order.source },
          actor: { kind: 'SYSTEM' },
          audit,
          source: 'SYSTEM',
          payload: { orderId: order.id, number: order.number },
        });
      } catch (e) {
        // The order stands even if the table moved meanwhile (e.g. forced); log for the manager's audit trail.
        this.logger.warn(`ORDER_ACCEPTED not applied for order ${order.id}: ${String(e)}`);
      }
    }
    for (const code of new Set(order.items.map((i) => i.station.code))) {
      this.realtime.emit([rooms.outlet(order.outletId), rooms.kds(order.outletId, code)], 'kds.changed', {
        outletId: order.outletId,
        stationCode: code,
      });
    }
    this.announce(order);
  }

  private async afterItemChange(
    organizationId: string,
    orderId: string,
    stationCodes: string[],
    audit: AuditActor,
  ) {
    const order = await this.getOrder(organizationId, orderId);
    // All items of this order handled → its SERVE task is done.
    if (order.items.every((i) => i.status === 'SERVED' || i.status === 'VOID')) {
      await this.prisma.$transaction((tx) => this.closeTasks(tx, orderId, ['SERVE'], 'DONE', audit.id));
    }
    const first = await this.prisma.order.findFirst({
      where: { seatingId: order.seatingId, status: 'ACCEPTED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const tableId = order.seating.tables[0]?.table.id;
    const table = tableId
      ? await this.prisma.table.findUnique({ where: { id: tableId }, select: { status: true } })
      : null;
    if (first?.id === orderId && table?.status === 'ORDERED' && tableId) {
      try {
        await this.tables.apply({
          organizationId,
          outletId: order.outletId,
          tableId,
          event: { type: 'FIRST_ORDER_SERVED' },
          actor: { kind: 'SYSTEM' },
          audit,
          source: 'SYSTEM',
          payload: { orderId },
        });
      } catch (e) {
        // GUARD_FAILED simply means not everything is served yet.
        if (!(e instanceof AppError && e.code === 'TABLE_GUARD_FAILED'))
          this.logger.warn(`FIRST_ORDER_SERVED failed: ${String(e)}`);
      }
    }
    for (const code of stationCodes)
      this.realtime.emit([rooms.outlet(order.outletId), rooms.kds(order.outletId, code)], 'kds.changed', {
        outletId: order.outletId,
        stationCode: code,
      });
    this.announce(order);
  }

  private announce(order: {
    id: string;
    outletId: string;
    seatingId: string;
    status: string;
    seating: { servingWaiterId: string | null; tables: { table: { id: string } }[] };
  }) {
    const targets = [rooms.outlet(order.outletId), rooms.seating(order.seatingId)];
    this.realtime.emit(targets, 'order.updated', {
      outletId: order.outletId,
      orderId: order.id,
      seatingId: order.seatingId,
      tableIds: order.seating.tables.map((t) => t.table.id),
      status: order.status,
    });
  }
}
