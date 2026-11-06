import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  guestPayAbandonSchema,
  type GuestPayInput,
  guestPaySchema,
  type GuestPayVerifyInput,
  guestPayVerifySchema,
} from '@dinesense/shared';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { RateLimitService } from '../common/rate-limit.service';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { Guest, GuestGuard } from '../guest/guest.guard';
import type { GuestClaims } from '../guest/guest-token';
import { OnlinePaymentsService } from './online-payments.service';

/** Guest pay-at-table (QR session token). */
@ApiTags('guest')
@Public()
@UseGuards(GuestGuard)
@ApiHeader({ name: 'x-guest-token', required: true })
@Controller('g')
export class GuestPaymentsController {
  constructor(
    private readonly payments: OnlinePaymentsService,
    private readonly limit: RateLimitService,
  ) {}

  @Get('bills')
  bills(@Guest() g: GuestClaims) {
    return this.payments.bills(g);
  }

  @Post('payments')
  @HttpCode(200)
  @ApiZodBody(guestPaySchema)
  async start(@Guest() g: GuestClaims, @Body(new ZodPipe(guestPaySchema)) body: GuestPayInput) {
    await this.limit.hit(`g-pay:${g.seat}`, 10, 300);
    return this.payments.start(g, body.billId, body.shareKey, body.tipPaise ?? 0);
  }

  @Post('payments/verify')
  @HttpCode(200)
  @ApiZodBody(guestPayVerifySchema)
  async verify(@Guest() g: GuestClaims, @Body(new ZodPipe(guestPayVerifySchema)) body: GuestPayVerifyInput) {
    await this.limit.hit(`g-pay-verify:${g.seat}`, 20, 300);
    return this.payments.verify(g, body.orderId, body.paymentId, body.signature);
  }

  /** The guest's phone could not open the checkout at all: release the pending payment. */
  @Post('payments/abandon')
  @HttpCode(200)
  @ApiZodBody(guestPayAbandonSchema)
  async abandon(
    @Guest() g: GuestClaims,
    @Body(new ZodPipe(guestPayAbandonSchema)) body: { orderId: string },
  ) {
    await this.limit.hit(`g-pay-abandon:${g.seat}`, 20, 300);
    await this.payments.abandon(g, body.orderId);
    return { ok: true };
  }
}

/** Server-to-server provider webhooks.

 Authenticated by the HMAC over the raw body, nothing else. */
@ApiTags('payments')
@Public()
@Controller('payments')
export class PaymentWebhookController {
  constructor(
    private readonly payments: OnlinePaymentsService,
    private readonly limit: RateLimitService,
  ) {}

  @Post('razorpay/webhook')
  @HttpCode(200)
  async razorpay(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Ip() ip: string,
  ) {
    await this.limit.hit(`pay-webhook:${ip}`, 300, 60);
    return this.payments.webhook(req.rawBody, signature);
  }
}
