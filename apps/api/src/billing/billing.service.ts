import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type BillAdjustInput,
  BillError,
  type BillSplitInput,
  computeBill,
  computeSplit,
  shareStatus,
  SplitError,
  type SplitPlan,
  financialYear,
  localized,
  type PaymentInput,
  rooms,
} from '@dinesense/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TableStateService } from '../table-state/table-state.service';

type Tx = Prisma.TransactionClient;

export const billInclude = {
  lines: { orderBy: { sortOrder: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BillInclude;
type BillRow = Prisma.BillGetPayload<{ include: typeof billInclude }>;

/** An online checkout younger than this blocks re-splitting (the guest may still complete it). */
export const PENDING_PAYMENT_WINDOW_MS = 15 * 60_000;

/**
 * Bills for a seating. Rules:
 * - A seating has at most one OPEN bill; it always holds every billable item (accepted, not void) that is not already
 *   on a FINALIZED/PAID bill. Items ordered after finalising go onto a new bill.
 * - Finalising freezes the lines and assigns a gap-free invoice number per outlet per financial year.
 * - Payments are recorded against a finalised bill; when every bill is paid the table moves to PAID.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly tables: TableStateService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────── queries ─────────

  async forTable(organizationId: string, outletId: string, tableId: string) {
    const seatingId = await this.openSeatingId(organizationId, outletId, tableId);
    if (!seatingId) return [];
    const bills = await this.prisma.bill.findMany({
      where: { organizationId, outletId, seatingId },
      include: billInclude,
      orderBy: { createdAt: 'asc' },
    });
    return bills.map((b) => this.view(b));
  }

  async get(organizationId: string, outletId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, organizationId, outletId },
      include: billInclude,
    });
    if (!bill) throw AppError.notFound('Bill');
    return this.view(bill);
  }

  /** Bills of a business day (for the cashier's list). */
  async list(organizationId: string, outletId: string, from: Date, to: Date) {
    const bills = await this.prisma.bill.findMany({
      where: { organizationId, outletId, createdAt: { gte: from, lt: to } },
      include: billInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return bills.map((b) => this.view(b));
  }

  // ───────── commands ─────────

  /** Creates or refreshes the OPEN bill of the table's seating from its unbilled items. */
  async prepare(organizationId: string, outletId: string, tableId: string, audit: AuditActor) {
    const seatingId = await this.openSeatingId(organizationId, outletId, tableId);
    if (!seatingId)
      throw new AppError('NO_OPEN_SEATING', HttpStatus.CONFLICT, 'This table has no open seating');
    const bill = await this.prisma.$transaction(async (tx) => {
      await this.lockSeating(tx, seatingId);
      const open = await tx.bill.findFirst({ where: { seatingId, status: 'OPEN' } });
      const items = await this.billableItems(tx, seatingId, open?.id);
      if (!items.length) {
        if (open) await tx.bill.delete({ where: { id: open.id } });
        throw new AppError('NOTHING_TO_BILL', HttpStatus.CONFLICT, 'There is nothing to bill');
      }
      const settings = await tx.outletSettings.findUniqueOrThrow({ where: { outletId } });
      const billId =
        open?.id ??
        (
          await tx.bill.create({
            data: { organizationId, outletId, seatingId, serviceChargeBps: settings.serviceChargeBps },
          })
        ).id;
      const updated = await this.recompute(tx, billId, items, settings.pricesIncludeTax);
      await this.audit.recordAs(
        audit,
        {
          action: open ? 'bill.refresh' : 'bill.create',
          entityType: 'Bill',
          entityId: billId,
          outletId,
          after: { totalPaise: updated.totalPaise, lines: items.length },
        },
        tx,
      );
      return updated;
    });
    this.announce(outletId, bill);
    return this.view(bill);
  }

  /** Discount and service charge on an OPEN bill. */
  async adjust(
    organizationId: string,
    outletId: string,
    billId: string,
    input: BillAdjustInput,
    audit: AuditActor,
  ) {
    const bill = await this.prisma.$transaction(async (tx) => {
      const before = await this.lockBill(tx, organizationId, outletId, billId);
      if (before.status !== 'OPEN')
        throw new AppError('BILL_NOT_EDITABLE', HttpStatus.CONFLICT, 'Only an open bill can be changed');
      await tx.bill.update({
        where: { id: billId },
        data: {
          ...(input.discountPaise !== undefined ? { discountPaise: input.discountPaise } : {}),
          ...(input.discountReason !== undefined ? { discountReason: input.discountReason } : {}),
          ...(input.serviceChargeBps !== undefined ? { serviceChargeBps: input.serviceChargeBps } : {}),
        },
      });
      const settings = await tx.outletSettings.findUniqueOrThrow({ where: { outletId } });
      const items = await this.billableItems(tx, before.seatingId, billId);
      const after = await this.recompute(tx, billId, items, settings.pricesIncludeTax);
      await this.audit.recordAs(
        audit,
        {
          action: 'bill.adjust',
          entityType: 'Bill',
          entityId: billId,
          outletId,
          before: {
            discountPaise: before.discountPaise,
            serviceChargeBps: before.serviceChargeBps,
            totalPaise: before.totalPaise,
          },
          after: {
            discountPaise: after.discountPaise,
            discountReason: after.discountReason,
            serviceChargeBps: after.serviceChargeBps,
            totalPaise: after.totalPaise,
          },
        },
        tx,
      );
      return after;
    });
    this.announce(outletId, bill);
    return this.view(bill);
  }

  async finalize(organizationId: string, outletId: string, billId: string, audit: AuditActor) {
    const bill = await this.prisma.$transaction(async (tx) => {
      const b = await this.lockBill(tx, organizationId, outletId, billId);
      if (b.status !== 'OPEN')
        throw new AppError('BILL_NOT_EDITABLE', HttpStatus.CONFLICT, 'This bill is already final');
      // Re-price against the latest items so nothing ordered meanwhile is lost or double-billed.
      const settings = await tx.outletSettings.findUniqueOrThrow({ where: { outletId } });
      const items = await this.billableItems(tx, b.seatingId, billId);
      if (!items.length)
        throw new AppError('NOTHING_TO_BILL', HttpStatus.CONFLICT, 'There is nothing to bill');
      await this.recompute(tx, billId, items, settings.pricesIncludeTax);
      const invoiceNumber = await this.nextInvoiceNumber(tx, outletId);
      const after = await tx.bill.update({
        where: { id: billId },
        data: {
          status: 'FINALIZED',
          invoiceNumber,
          finalizedAt: new Date(),
          finalizedById: audit.type === 'USER' ? (audit.id ?? null) : null,
        },
        include: billInclude,
      });
      await this.audit.recordAs(
        audit,
        {
          action: 'bill.finalize',
          entityType: 'Bill',
          entityId: billId,
          outletId,
          after: { invoiceNumber, totalPaise: after.totalPaise },
        },
        tx,
      );
      return after;
    });
    this.announce(outletId, bill);
    return this.view(bill);
  }

  /** Cash / UPI / card collected at the counter. An OPEN bill is finalised first. */
  async pay(
    organizationId: string,
    outletId: string,
    billId: string,
    input: PaymentInput,
    audit: AuditActor,
  ) {
    const current = await this.prisma.bill.findFirst({ where: { id: billId, organizationId, outletId } });
    if (!current) throw AppError.notFound('Bill');
    if (current.status === 'OPEN') await this.finalize(organizationId, outletId, billId, audit);

    const bill = await this.prisma.$transaction(async (tx) => {
      const b = await this.lockBill(tx, organizationId, outletId, billId);
      if (b.status !== 'FINALIZED')
        throw new AppError(
          'BILL_NOT_EDITABLE',
          HttpStatus.CONFLICT,
          `A ${b.status.toLowerCase()} bill cannot take payments`,
        );
      const paid = b.payments.filter((p) => p.status === 'CAPTURED').reduce((s, p) => s + p.amountPaise, 0);
      const due = b.totalPaise - paid;
      if (input.amountPaise > due) {
        throw new AppError('OVERPAYMENT', HttpStatus.CONFLICT, 'Amount is more than what is due', {
          duePaise: due,
        });
      }
      if (input.shareKey) {
        const share = this.shares(b).find((x) => x.key === input.shareKey);
        if (!share) throw new AppError('SPLIT_INVALID', HttpStatus.BAD_REQUEST, 'No such share on this bill');
        if (input.amountPaise > share.duePaise)
          throw new AppError('OVERPAYMENT', HttpStatus.CONFLICT, 'Amount is more than this share', {
            duePaise: share.duePaise,
          });
      }
      const now = new Date();
      const tipPaise = input.tipPaise ?? 0;
      await tx.payment.create({
        data: {
          organizationId,
          outletId,
          billId,
          method: input.method,
          status: 'CAPTURED',
          amountPaise: input.amountPaise,
          tipPaise,
          tipWaiterId: tipPaise ? await this.tipWaiter(tx, b.seatingId) : null,
          reference: input.reference ?? null,
          shareKey: input.shareKey ?? null,
          receivedById: audit.type === 'USER' ? (audit.id ?? null) : null,
          capturedAt: now,
        },
      });
      const settled = input.amountPaise === due;
      const after = await tx.bill.update({
        where: { id: billId },
        data: settled ? { status: 'PAID', paidAt: now } : {},
        include: billInclude,
      });
      await this.audit.recordAs(
        audit,
        {
          action: 'bill.payment',
          entityType: 'Bill',
          entityId: billId,
          outletId,
          after: {
            method: input.method,
            amountPaise: input.amountPaise,
            tipPaise: input.tipPaise ?? 0,
            shareKey: input.shareKey,
            settled,
          },
        },
        tx,
      );
      return after;
    });

    if (bill.status === 'PAID')
      await this.maybeMarkTablePaid(organizationId, outletId, bill.seatingId, audit);
    this.announce(outletId, bill);
    return this.view(bill);
  }

  // ───────── online payments (provider calls happen outside these transactions) ─────────

  /**
   * Reserves an online payment for a bill (or one split share): finalises an open bill, works out the amount
   * due and returns a PENDING payment — reusing a recent pending one for the same amount so double taps and two
   * phones paying the same share share one provider order.
   */
  async reserveOnline(
    g: { org: string; out: string; seat: string },
    billId: string,
    shareKey: string | undefined,
    provider: string,
    audit: AuditActor,
    tipPaise = 0,
  ) {
    const current = await this.prisma.bill.findFirst({
      where: { id: billId, organizationId: g.org, outletId: g.out, seatingId: g.seat },
    });
    if (!current) throw AppError.notFound('Bill');
    if (current.status === 'OPEN') await this.finalize(g.org, g.out, billId, audit);

    return this.prisma.$transaction(async (tx) => {
      const b = await this.lockBill(tx, g.org, g.out, billId);
      if (b.status !== 'FINALIZED')
        throw new AppError('BILL_NOT_EDITABLE', HttpStatus.CONFLICT, 'Nothing is due on this bill');
      const paid = b.payments.filter((p) => p.status === 'CAPTURED').reduce((s, p) => s + p.amountPaise, 0);
      let amount = b.totalPaise - paid;
      if (shareKey) {
        const share = this.shares(b).find((x) => x.key === shareKey);
        if (!share) throw new AppError('SPLIT_INVALID', HttpStatus.BAD_REQUEST, 'No such share on this bill');
        amount = Math.min(amount, share.duePaise);
      }
      if (amount <= 0) throw new AppError('BILL_NOT_EDITABLE', HttpStatus.CONFLICT, 'Nothing is due');
      const now = Date.now();
      const reusable = b.payments.find(
        (p) =>
          p.status === 'PENDING' &&
          p.provider === provider &&
          p.providerOrderId &&
          p.amountPaise === amount &&
          p.tipPaise === tipPaise &&
          (p.shareKey ?? undefined) === shareKey &&
          now - p.createdAt.getTime() < PENDING_PAYMENT_WINDOW_MS,
      );
      if (reusable) return { payment: reusable, bill: b, reused: true };
      const payment = await tx.payment.create({
        data: {
          organizationId: g.org,
          outletId: g.out,
          billId,
          method: 'RAZORPAY',
          status: 'PENDING',
          amountPaise: amount,
          tipPaise,
          tipWaiterId: tipPaise ? await this.tipWaiter(tx, b.seatingId) : null,
          shareKey: shareKey ?? null,
          provider,
        },
      });
      return { payment, bill: b, reused: false };
    });
  }

  async attachProviderOrder(paymentId: string, providerOrderId: string) {
    await this.prisma.payment.update({ where: { id: paymentId }, data: { providerOrderId } });
  }

  async failOnline(by: { paymentId?: string; providerOrderId?: string }, reason: string) {
    const p = await this.prisma.payment.findFirst({
      where: by.paymentId ? { id: by.paymentId } : { providerOrderId: by.providerOrderId ?? '-' },
    });
    if (!p || p.status !== 'PENDING') return;
    await this.prisma.payment.update({
      where: { id: p.id },
      data: { status: 'FAILED', failureReason: reason.slice(0, 200) },
    });
  }

  /**
   * Marks an online payment captured (idempotent: browser callback and webhook may both arrive). Money that
   * arrives for an already-settled bill is still recorded — it was taken — and flagged in the audit log for a
   * refund from the provider dashboard. `grossPaise` is what the provider charged: bill amount + tip.
   */
  async captureOnline(providerOrderId: string, providerPaymentId: string, grossPaise?: number) {
    const found = await this.prisma.payment.findUnique({ where: { providerOrderId } });
    if (!found) return null;
    const audit: AuditActor = { organizationId: found.organizationId, type: 'SYSTEM' };
    const result = await this.prisma.$transaction(async (tx) => {
      const b = await this.lockBill(tx, found.organizationId, found.outletId, found.billId);
      const p = b.payments.find((x) => x.id === found.id)!;
      if (p.status === 'CAPTURED') return null;
      const gross = grossPaise ?? p.amountPaise + p.tipPaise;
      if (gross !== p.amountPaise + p.tipPaise)
        this.logger.warn(
          `online payment ${providerPaymentId}: charged ${gross} ≠ expected ${p.amountPaise + p.tipPaise}`,
        );
      // The tip comes out of what was charged last, so a short charge never hides part of the bill.
      const amount = Math.max(0, gross - p.tipPaise);
      const tip = gross - amount;
      const now = new Date();
      await tx.payment.update({
        where: { id: p.id },
        data: {
          status: 'CAPTURED',
          amountPaise: amount,
          tipPaise: tip,
          providerPaymentId,
          reference: providerPaymentId,
          capturedAt: now,
          failureReason: null,
        },
      });
      const paid =
        b.payments.filter((x) => x.status === 'CAPTURED').reduce((s, x) => s + x.amountPaise, 0) + amount;
      const extra = b.status !== 'FINALIZED' || paid > b.totalPaise;
      const settle = b.status === 'FINALIZED' && paid >= b.totalPaise;
      const after = await tx.bill.update({
        where: { id: b.id },
        data: settle ? { status: 'PAID', paidAt: now } : {},
        include: billInclude,
      });
      await this.audit.recordAs(
        audit,
        {
          action: extra ? 'bill.payment.excess' : 'bill.payment',
          entityType: 'Bill',
          entityId: b.id,
          outletId: b.outletId,
          after: {
            method: 'RAZORPAY',
            amountPaise: amount,
            tipPaise: tip,
            shareKey: p.shareKey,
            providerPaymentId,
            settled: settle,
          },
        },
        tx,
      );
      if (extra)
        this.logger.warn(
          `bill ${b.id}: online payment ${providerPaymentId} exceeds what was due — refund it`,
        );
      return after;
    });
    if (!result) return null;
    if (result.status === 'PAID')
      await this.maybeMarkTablePaid(result.organizationId, result.outletId, result.seatingId, audit);
    this.announce(result.outletId, result);
    return this.view(result);
  }

  /** Tips go to whoever is serving the table when it pays. */
  private async tipWaiter(tx: Tx, seatingId: string): Promise<string | null> {
    const s = await tx.seating.findUnique({ where: { id: seatingId }, select: { servingWaiterId: true } });
    return s?.servingWaiterId ?? null;
  }

  /** Bills of the guest's seating as the guest sees them (no staff ids). */
  async guestBills(g: { org: string; out: string; seat: string }) {
    const bills = await this.prisma.bill.findMany({
      where: { organizationId: g.org, outletId: g.out, seatingId: g.seat, status: { not: 'VOID' } },
      include: billInclude,
      orderBy: { createdAt: 'asc' },
    });
    return bills.map((b) => {
      const v = this.view(b);
      return {
        id: v.id,
        status: v.status,
        invoiceNumber: v.invoiceNumber,
        totalPaise: v.totalPaise,
        paidPaise: v.paidPaise,
        duePaise: v.duePaise,
        invoiceUrl: v.status === 'OPEN' ? null : v.invoiceUrl,
        split: v.split,
        lines: v.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity })),
        checkoutInProgress: v.payments.some((p) => p.status === 'PENDING' && p.provider),
      };
    });
  }

  /** Splits the (finalised) bill into shares paid separately. Only before any money has been taken. */
  async split(
    organizationId: string,
    outletId: string,
    billId: string,
    input: BillSplitInput | null,
    audit: AuditActor,
  ) {
    const current = await this.prisma.bill.findFirst({
      where: { id: billId, organizationId, outletId },
      include: { lines: { select: { id: true, orderItemId: true } } },
    });
    if (!current) throw AppError.notFound('Bill');
    if (current.status === 'OPEN' && input) {
      await this.finalize(organizationId, outletId, billId, audit);
      // Finalising re-prices and re-creates the lines: carry by-item picks over via their order item.
      if (input.mode === 'BY_ITEM') {
        const fresh = await this.prisma.billLine.findMany({
          where: { billId },
          select: { id: true, orderItemId: true },
        });
        const byItem = new Map(fresh.map((l) => [l.orderItemId, l.id]));
        const remap = new Map(current.lines.map((l) => [l.id, byItem.get(l.orderItemId) ?? l.id]));
        input = {
          ...input,
          shares: input.shares.map((sh) => ({ ...sh, lineIds: sh.lineIds.map((id) => remap.get(id) ?? id) })),
        };
      }
    }

    const bill = await this.prisma.$transaction(async (tx) => {
      const b = await this.lockBill(tx, organizationId, outletId, billId);
      if (b.status !== 'FINALIZED')
        throw new AppError(
          'BILL_NOT_EDITABLE',
          HttpStatus.CONFLICT,
          `A ${b.status.toLowerCase()} bill cannot be split`,
        );
      if (b.payments.some((p) => p.status === 'CAPTURED'))
        throw new AppError(
          'BILL_NOT_EDITABLE',
          HttpStatus.CONFLICT,
          'Payments were already taken on this bill',
        );
      this.assertNoCheckoutInProgress(b);
      let plan: SplitPlan | null = null;
      if (input) {
        try {
          plan = computeSplit(input, { totalPaise: b.totalPaise, lines: b.lines });
        } catch (e) {
          if (e instanceof SplitError) throw new AppError('SPLIT_INVALID', HttpStatus.BAD_REQUEST, e.message);
          throw e;
        }
      }
      const after = await tx.bill.update({
        where: { id: billId },
        data: { splitPlan: plan ? (plan as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
        include: billInclude,
      });
      await this.audit.recordAs(
        audit,
        {
          action: plan ? 'bill.split' : 'bill.split.clear',
          entityType: 'Bill',
          entityId: billId,
          outletId,
          before: b.splitPlan ? { split: b.splitPlan } : undefined,
          after: plan ? { split: plan } : undefined,
        },
        tx,
      );
      return after;
    });
    this.announce(outletId, bill);
    return this.view(bill);
  }

  async void(organizationId: string, outletId: string, billId: string, reason: string, audit: AuditActor) {
    const bill = await this.prisma.$transaction(async (tx) => {
      const b = await this.lockBill(tx, organizationId, outletId, billId);
      if (b.status === 'VOID' || b.status === 'PAID')
        throw new AppError(
          'BILL_NOT_EDITABLE',
          HttpStatus.CONFLICT,
          `A ${b.status.toLowerCase()} bill cannot be voided`,
        );
      if (b.payments.some((p) => p.status === 'CAPTURED')) {
        throw new AppError(
          'BILL_NOT_EDITABLE',
          HttpStatus.CONFLICT,
          'Refund the payments before voiding this bill',
        );
      }
      // A voided invoice keeps its number (GST requires cancelled invoices to stay on record).
      const after = await tx.bill.update({
        where: { id: billId },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
        include: billInclude,
      });
      await this.audit.recordAs(
        audit,
        {
          action: 'bill.void',
          entityType: 'Bill',
          entityId: billId,
          outletId,
          after: { reason, invoiceNumber: b.invoiceNumber },
        },
        tx,
      );
      return after;
    });
    this.announce(outletId, bill);
    return this.view(bill);
  }

  // ───────── invoice links ─────────

  /** Unguessable, non-expiring share link for one bill (printed or sent to the guest). */
  invoicePath(billId: string): string {
    return `/api/v1/invoices/${billId}?t=${this.sign(billId)}`;
  }

  verifyInvoiceToken(billId: string, token: string | undefined): boolean {
    if (!token) return false;
    const expected = Buffer.from(this.sign(billId));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async invoiceData(billId: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        ...billInclude,
        outlet: true,
        seating: { select: { partySize: true, tables: { select: { table: { select: { label: true } } } } } },
      },
    });
    if (!bill) throw AppError.notFound('Bill');
    return bill;
  }

  private sign(billId: string): string {
    return createHmac('sha256', `invoice:${this.env.JWT_ACCESS_SECRET}`)
      .update(billId)
      .digest('base64url')
      .slice(0, 32);
  }

  // ───────── internals ─────────

  /** Throws while a guest checkout started recently could still complete. */
  assertNoCheckoutInProgress(b: {
    payments: { status: string; provider: string | null; createdAt: Date }[];
  }) {
    const now = Date.now();
    if (
      b.payments.some(
        (p) =>
          p.status === 'PENDING' && p.provider && now - p.createdAt.getTime() < PENDING_PAYMENT_WINDOW_MS,
      )
    )
      throw new AppError('PAYMENT_IN_PROGRESS', HttpStatus.CONFLICT, 'An online payment is in progress');
  }

  /** Split shares with paid/due (empty when the bill is not split). */
  shares(b: {
    splitPlan: Prisma.JsonValue;
    payments: { shareKey: string | null; amountPaise: number; status: string }[];
  }) {
    return b.splitPlan ? shareStatus(b.splitPlan as unknown as SplitPlan, b.payments) : [];
  }

  view(b: BillRow) {
    const paidPaise = b.payments
      .filter((p) => p.status === 'CAPTURED')
      .reduce((s, p) => s + p.amountPaise, 0);
    const { splitPlan, ...rest } = b;
    return {
      ...rest,
      split: splitPlan ? { mode: (splitPlan as unknown as SplitPlan).mode, shares: this.shares(b) } : null,
      paidPaise,
      duePaise: b.status === 'VOID' ? 0 : Math.max(0, b.totalPaise - paidPaise),
      invoiceUrl: this.invoicePath(b.id),
    };
  }

  private async openSeatingId(organizationId: string, outletId: string, tableId: string) {
    const link = await this.prisma.seatingTable.findFirst({
      where: { tableId, isOpen: true, table: { outletId, organizationId } },
      select: { seatingId: true },
    });
    return link?.seatingId ?? null;
  }

  private async lockSeating(tx: Tx, seatingId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bill:' + seatingId}))`;
  }

  private async lockBill(tx: Tx, organizationId: string, outletId: string, billId: string) {
    const bill = await tx.bill.findFirst({ where: { id: billId, organizationId, outletId } });
    if (!bill) throw AppError.notFound('Bill');
    await this.lockSeating(tx, bill.seatingId);
    return tx.bill.findUniqueOrThrow({ where: { id: billId }, include: billInclude });
  }

  /** Accepted, non-void items of the seating not on another live (non-void, non-open) bill. */
  private async billableItems(tx: Tx, seatingId: string, openBillId?: string) {
    const items = await tx.orderItem.findMany({
      where: { order: { seatingId, status: 'ACCEPTED' }, status: { not: 'VOID' } },
      include: { menuItem: { select: { hsnSac: true } }, order: { select: { number: true } } },
      orderBy: [{ order: { createdAt: 'asc' } }, { queuedAt: 'asc' }],
    });
    const billed = await tx.billLine.findMany({
      where: {
        orderItemId: { in: items.map((i) => i.id) },
        bill: { status: { in: ['FINALIZED', 'PAID'] }, ...(openBillId ? { id: { not: openBillId } } : {}) },
      },
      select: { orderItemId: true },
    });
    const done = new Set(billed.map((b) => b.orderItemId));
    return items.filter((i) => !done.has(i.id));
  }

  private async recompute(
    tx: Tx,
    billId: string,
    items: Awaited<ReturnType<BillingService['billableItems']>>,
    pricesIncludeTax: boolean,
  ) {
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
    let result;
    try {
      result = computeBill(
        items.map((i) => ({
          key: i.id,
          quantity: i.quantity,
          unitPricePaise: i.unitPricePaise,
          taxRateBps: i.taxRateBps,
        })),
        { discountPaise: bill.discountPaise, serviceChargeBps: bill.serviceChargeBps, pricesIncludeTax },
      );
    } catch (e) {
      if (e instanceof BillError && e.code === 'DISCOUNT_TOO_LARGE') {
        throw new AppError(
          'DISCOUNT_TOO_LARGE',
          HttpStatus.BAD_REQUEST,
          'The discount is larger than the bill',
        );
      }
      throw e;
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    await tx.billLine.deleteMany({ where: { billId } });
    await tx.billLine.createMany({
      data: result.lines.map((l, sortOrder) => {
        const item = byId.get(l.key)!;
        const mods = (item.modifiers as { name: unknown }[])
          .map((m) => localized(m.name, 'en'))
          .filter(Boolean);
        return {
          billId,
          orderItemId: item.id,
          description: `${localized(item.nameSnapshot, 'en')}${mods.length ? ` (${mods.join(', ')})` : ''}`,
          hsnSac: item.menuItem.hsnSac,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          discountPaise: l.discountPaise,
          taxableValuePaise: l.taxableValuePaise,
          taxRateBps: l.taxRateBps,
          cgstPaise: l.cgstPaise,
          sgstPaise: l.sgstPaise,
          serviceChargePaise: l.serviceChargePaise,
          serviceChargeCgstPaise: l.serviceChargeCgstPaise,
          serviceChargeSgstPaise: l.serviceChargeSgstPaise,
          sortOrder,
        };
      }),
    });
    return tx.bill.update({
      where: { id: billId },
      data: {
        subtotalPaise: result.subtotalPaise,
        discountPaise: result.discountPaise,
        serviceChargePaise: result.serviceChargePaise,
        taxablePaise: result.taxablePaise,
        cgstPaise: result.cgstPaise,
        sgstPaise: result.sgstPaise,
        roundOffPaise: result.roundOffPaise,
        totalPaise: result.totalPaise,
        taxBreakup: result.taxByRate,
      },
      include: billInclude,
    });
  }

  /** Gap-free per outlet and financial year: allocated inside the finalising transaction (rolls back with it). */
  private async nextInvoiceNumber(tx: Tx, outletId: string): Promise<string> {
    const outlet = await tx.outlet.findUniqueOrThrow({
      where: { id: outletId },
      select: { invoicePrefix: true, timezone: true },
    });
    const fy = financialYear(new Date(), outlet.timezone);
    const [row] = await tx.$queryRaw<{ next: number }[]>`
      INSERT INTO "InvoiceSequence" ("outletId", "financialYear", "next") VALUES (${outletId}, ${fy}, 1)
      ON CONFLICT ("outletId", "financialYear") DO UPDATE SET "next" = "InvoiceSequence"."next" + 1
      RETURNING "next"`;
    return `${outlet.invoicePrefix}/${fy}/${String(row!.next).padStart(5, '0')}`;
  }

  /** When every live bill of the seating is paid, the table moves to PAID (reducer re-checks the totals). */
  private async maybeMarkTablePaid(
    organizationId: string,
    outletId: string,
    seatingId: string,
    audit: AuditActor,
  ) {
    const link = await this.prisma.seatingTable.findFirst({
      where: { seatingId },
      select: { tableId: true },
    });
    if (!link) return;
    const unpaid = await this.prisma.bill.count({
      where: { seatingId, status: { in: ['OPEN', 'FINALIZED'] } },
    });
    if (unpaid) return;
    try {
      await this.tables.apply({
        organizationId,
        outletId,
        tableId: link.tableId,
        event: { type: 'PAYMENT_CAPTURED' },
        actor: { kind: 'SYSTEM' },
        audit,
        source: 'SYSTEM',
      });
    } catch (e) {
      this.logger.warn(`PAYMENT_CAPTURED not applied for seating ${seatingId}: ${String(e)}`);
    }
  }

  private announce(outletId: string, bill: { id: string; seatingId: string; status: string }) {
    this.realtime.emit([rooms.outlet(outletId), rooms.seating(bill.seatingId)], 'bill.updated', {
      outletId,
      billId: bill.id,
      seatingId: bill.seatingId,
      status: bill.status,
    });
  }
}
