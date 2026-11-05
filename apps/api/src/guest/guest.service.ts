import { HttpStatus, Injectable } from '@nestjs/common';
import type { TaskType } from '@prisma/client';
import {
  CART_LIMITS,
  type CartLineView,
  type GuestAction,
  type OrderLineInput,
  rooms,
  runningTotal,
} from '@dinesense/shared';
import type { AuditActor } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { MenuService } from '../menu/menu.service';
import { OrderingService } from '../ordering/ordering.service';
import { NotifierService } from '../notifications/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableStateService } from '../table-state/table-state.service';
import { type GuestClaims, GuestTokens } from './guest-token';

const guestAudit = (g: GuestClaims): AuditActor => ({ organizationId: g.org, type: 'GUEST', id: g.sid });

@Injectable()
export class GuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: GuestTokens,
    private readonly menu: MenuService,
    private readonly ordering: OrderingService,
    private readonly tables: TableStateService,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
  ) {}

  private async tableByToken(qrToken: string) {
    const table = await this.prisma.table.findFirst({
      where: { qrToken, archivedAt: null, outlet: { archivedAt: null } },
      select: {
        id: true,
        label: true,
        organizationId: true,
        outletId: true,
        outlet: { select: { name: true } },
        seatings: { where: { isOpen: true }, select: { seatingId: true } },
      },
    });
    if (!table) throw AppError.notFound('Table');
    return table;
  }

  /** What the QR page shows first. Without an open seating the menu is read-only ("please wait to be seated"). */
  async landing(qrToken: string) {
    const table = await this.tableByToken(qrToken);
    return {
      outlet: { name: table.outlet.name },
      table: { label: table.label },
      open: table.seatings.length > 0,
      menu: await this.menu.guestMenu(table.organizationId, table.outletId),
    };
  }

  /** Joins this phone to the table's current seating (one session per device per seating). */
  async startSession(qrToken: string, deviceId: string) {
    const table = await this.tableByToken(qrToken);
    const seatingId = table.seatings[0]?.seatingId;
    if (!seatingId) throw new AppError('NO_OPEN_SEATING', HttpStatus.CONFLICT, 'Please wait to be seated');
    const session = await this.prisma.guestSession.upsert({
      where: { seatingId_deviceId: { seatingId, deviceId } },
      create: { organizationId: table.organizationId, outletId: table.outletId, seatingId, deviceId },
      update: {},
    });
    const token = await this.tokens.sign({
      sid: session.id,
      seat: seatingId,
      out: table.outletId,
      org: table.organizationId,
      tbl: table.id,
    });
    return { token, table: { label: table.label }, seatingId };
  }

  async cart(g: GuestClaims) {
    const lines = await this.prisma.cartLine.findMany({
      where: { seatingId: g.seat },
      orderBy: { updatedAt: 'asc' },
      include: { menuItem: { select: { name: true, vegType: true, taxRateBps: true } } },
    });
    // Prices are re-derived from the live menu so the cart never shows a stale price.
    const priced = lines.length
      ? await this.ordering
          .priceLines(
            this.prisma,
            g.org,
            g.out,
            lines.map((l) => ({
              menuItemId: l.menuItemId,
              quantity: l.quantity,
              modifierIds: l.modifierIds,
            })),
          )
          .catch(() => null)
      : [];
    const views: (CartLineView & { available: boolean })[] = lines.map((l, i) => {
      const p = priced?.[i];
      return {
        id: l.id,
        menuItemId: l.menuItemId,
        name: l.menuItem.name,
        vegType: l.menuItem.vegType,
        quantity: l.quantity,
        unitPricePaise: p?.price.unitPricePaise ?? 0,
        taxRateBps: l.menuItem.taxRateBps,
        modifiers: p?.price.modifiers.map((m) => ({ id: m.id, name: m.name })) ?? [],
        note: l.note,
        mine: l.guestSessionId === g.sid,
        available: priced !== null,
      };
    });
    return { lines: views, totals: runningTotal(views), canOrder: priced !== null };
  }

  async addLine(g: GuestClaims, line: OrderLineInput) {
    // Validate against the live menu up front, so guests learn about sold-out items when adding, not at checkout.
    await this.ordering.priceLines(this.prisma, g.org, g.out, [line]);
    const modifierIds = [...new Set(line.modifierIds)].sort();
    const note = line.note?.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      const lines = await tx.cartLine.findMany({ where: { seatingId: g.seat } });
      const same = lines.find(
        (l) =>
          l.menuItemId === line.menuItemId &&
          l.note === note &&
          l.modifierIds.slice().sort().join() === modifierIds.join(),
      );
      if (same) {
        await tx.cartLine.update({
          where: { id: same.id },
          data: { quantity: Math.min(CART_LIMITS.maxQuantityPerLine, same.quantity + line.quantity) },
        });
      } else {
        if (lines.length >= CART_LIMITS.maxLines)
          throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'The cart is full');
        await tx.cartLine.create({
          data: {
            seatingId: g.seat,
            guestSessionId: g.sid,
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            modifierIds,
            note,
          },
        });
      }
    });
    this.cartChanged(g);
    return this.cart(g);
  }

  /** The cart is shared: anyone at the table can change any line. Quantity 0 removes it. */
  async setQuantity(g: GuestClaims, lineId: string, quantity: number) {
    const where = { id: lineId, seatingId: g.seat };
    const res =
      quantity === 0
        ? await this.prisma.cartLine.deleteMany({ where })
        : await this.prisma.cartLine.updateMany({ where, data: { quantity } });
    if (res.count !== 1) throw AppError.notFound('Cart line');
    this.cartChanged(g);
    return this.cart(g);
  }

  async placeOrder(g: GuestClaims) {
    const lines = await this.prisma.cartLine.findMany({
      where: { seatingId: g.seat },
      orderBy: { updatedAt: 'asc' },
    });
    const order = await this.ordering.createOrder({
      organizationId: g.org,
      outletId: g.out,
      seatingId: g.seat,
      source: 'QR',
      lines: lines.map((l) => ({
        menuItemId: l.menuItemId,
        quantity: l.quantity,
        modifierIds: l.modifierIds,
        ...(l.note ? { note: l.note } : {}),
      })),
      guestSessionId: g.sid,
      audit: guestAudit(g),
      // Only the lines that were ordered are removed (someone may add more meanwhile).
      afterCreate: async (tx) => {
        await tx.cartLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
      },
    });
    this.cartChanged(g);
    return order;
  }

  async orders(g: GuestClaims) {
    const orders = await this.prisma.order.findMany({
      where: { seatingId: g.seat, organizationId: g.org },
      include: { items: { orderBy: { queuedAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    const billable = orders
      .filter((o) => o.status === 'ACCEPTED')
      .flatMap((o) => o.items.filter((i) => i.status !== 'VOID'));
    return {
      orders: orders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        rejectedReason: o.rejectedReason,
        createdAt: o.createdAt,
        items: o.items.map((i) => ({
          id: i.id,
          name: i.nameSnapshot,
          quantity: i.quantity,
          modifiers: i.modifiers,
          status: i.status,
          unitPricePaise: i.unitPricePaise,
        })),
      })),
      bill: runningTotal(billable),
    };
  }

  /** Call waiter / water / cutlery create a task for the serving waiter; "bill" moves the table to BILL_REQUESTED. */
  async action(g: GuestClaims, type: GuestAction) {
    if (type === 'BILL') {
      await this.tables.apply({
        organizationId: g.org,
        outletId: g.out,
        tableId: g.tbl,
        event: { type: 'REQUEST_BILL' },
        actor: { kind: 'GUEST', sessionId: g.sid },
        audit: guestAudit(g),
        source: 'GUEST',
      });
      return { ok: true };
    }
    const seating = await this.prisma.seating.findUniqueOrThrow({
      where: { id: g.seat },
      select: { servingWaiterId: true },
    });
    const taskType = type as TaskType;
    const existing = await this.prisma.task.findFirst({
      where: { seatingId: g.seat, type: taskType, status: { in: ['OPEN', 'ACCEPTED'] } },
    });
    const task =
      existing ??
      (await this.prisma.task.create({
        data: {
          organizationId: g.org,
          outletId: g.out,
          type: taskType,
          tableId: g.tbl,
          seatingId: g.seat,
          assigneeId: seating.servingWaiterId,
        },
      }));
    // No serving waiter yet → on-shift waiters are told (round-robin pick arrives with M5).
    if (!existing) await this.notifier.taskCreated(task).catch(() => undefined);
    return { ok: true, duplicate: !!existing };
  }

  private cartChanged(g: GuestClaims): void {
    this.realtime.emit(rooms.seating(g.seat), 'cart.updated', { seatingId: g.seat });
  }
}
