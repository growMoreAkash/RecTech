import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type BillAdjustInput,
  billAdjustSchema,
  localDayRange,
  type PaymentInput,
  paymentSchema,
  shiftQuerySchema,
  voidBillSchema,
} from '@dinesense/shared';
import { actorFromContext } from '../audit/audit.service';
import { Authenticated, Ctx, Managers, Public, Roles } from '../auth/decorators';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { renderInvoice } from './invoice';

const CASH_DESK = ['OWNER', 'MANAGER', 'CASHIER'] as const;

@ApiTags('billing')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('tables/:tableId/bills')
  @Authenticated()
  forTable(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('tableId') tableId: string,
  ) {
    return this.billing.forTable(ctx.user.org, outletId, tableId);
  }

  /** Create (or refresh) the table's open bill. Waiters can print a bill; the cash desk settles it. */
  @Post('tables/:tableId/bills')
  @HttpCode(200)
  @Roles(...CASH_DESK, 'WAITER', 'HOST')
  prepare(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('tableId') tableId: string,
  ) {
    return this.billing.prepare(ctx.user.org, outletId, tableId, actorFromContext(ctx));
  }

  @Get('bills')
  @Roles(...CASH_DESK)
  @ApiZodQuery(shiftQuerySchema)
  async list(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(shiftQuerySchema)) q: { date?: string },
  ) {
    const outlet = await this.prisma
      .forOrg(ctx.user.org)
      .outlet.findUniqueOrThrow({ where: { id: outletId } });
    const day = q.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: outlet.timezone }).format(new Date());
    const { start, end } = localDayRange(day, outlet.timezone);
    return this.billing.list(ctx.user.org, outletId, start, end);
  }

  @Get('bills/:billId')
  @Authenticated()
  get(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('billId') billId: string) {
    return this.billing.get(ctx.user.org, outletId, billId);
  }

  @Patch('bills/:billId')
  @Roles(...CASH_DESK)
  @ApiZodBody(billAdjustSchema)
  adjust(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('billId') billId: string,
    @Body(new ZodPipe(billAdjustSchema)) body: BillAdjustInput,
  ) {
    return this.billing.adjust(ctx.user.org, outletId, billId, body, actorFromContext(ctx));
  }

  @Post('bills/:billId/finalize')
  @HttpCode(200)
  @Roles(...CASH_DESK)
  finalize(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('billId') billId: string) {
    return this.billing.finalize(ctx.user.org, outletId, billId, actorFromContext(ctx));
  }

  @Post('bills/:billId/payments')
  @HttpCode(200)
  @Roles(...CASH_DESK)
  @ApiZodBody(paymentSchema)
  pay(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('billId') billId: string,
    @Body(new ZodPipe(paymentSchema)) body: PaymentInput,
  ) {
    return this.billing.pay(ctx.user.org, outletId, billId, body, actorFromContext(ctx));
  }

  @Post('bills/:billId/void')
  @HttpCode(200)
  @Managers()
  @ApiZodBody(voidBillSchema)
  void(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('billId') billId: string,
    @Body(new ZodPipe(voidBillSchema)) body: { reason: string },
  ) {
    return this.billing.void(ctx.user.org, outletId, billId, body.reason, actorFromContext(ctx));
  }
}

/** Shareable invoice page: anyone with the signed link (printed receipt, guest's phone) can view it. */
@ApiTags('billing')
@Public()
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly billing: BillingService) {}

  @Get(':billId')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'private, no-store')
  @Header('x-robots-tag', 'noindex')
  @Header(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  )
  async invoice(@Param('billId') billId: string, @Query('t') token: string | undefined) {
    if (!this.billing.verifyInvoiceToken(billId, token)) throw AppError.notFound('Invoice');
    return renderInvoice(await this.billing.invoiceData(billId));
  }
}
