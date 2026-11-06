import { Body, Controller, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  cartAddSchema,
  cartPatchSchema,
  type GuestAction,
  guestActionSchema,
  guestSessionSchema,
  type MidMealFeedbackInput,
  midMealFeedbackSchema,
  type OrderLineInput,
} from '@dinesense/shared';
import { Public } from '../auth/decorators';
import { RateLimitService } from '../common/rate-limit.service';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { Guest, GuestGuard } from './guest.guard';
import type { GuestClaims } from './guest-token';
import { GuestService } from './guest.service';

/**
 * Public QR endpoints. Abuse controls: rate limits per IP and per session, orders only with an open seating,
 * waiter approval on by default, cart size caps, prices always computed server-side.
 */
@ApiTags('guest')
@Public()
@Controller('g')
export class GuestController {
  constructor(
    private readonly guests: GuestService,
    private readonly limit: RateLimitService,
  ) {}

  @Get('t/:qrToken')
  async landing(@Param('qrToken') qrToken: string, @Ip() ip: string) {
    await this.limit.hit(`g-landing:${ip}`, 60, 60);
    return this.guests.landing(qrToken);
  }

  @Post('t/:qrToken/session')
  @ApiZodBody(guestSessionSchema)
  async session(
    @Param('qrToken') qrToken: string,
    @Ip() ip: string,
    @Body(new ZodPipe(guestSessionSchema)) body: { deviceId: string },
  ) {
    await this.limit.hit(`g-session:${ip}`, 20, 60);
    return this.guests.startSession(qrToken, body.deviceId);
  }

  @Get('cart')
  @UseGuards(GuestGuard)
  @ApiHeader({ name: 'x-guest-token', required: true })
  cart(@Guest() g: GuestClaims) {
    return this.guests.cart(g);
  }

  @Post('cart/lines')
  @UseGuards(GuestGuard)
  @ApiHeader({ name: 'x-guest-token', required: true })
  @ApiZodBody(cartAddSchema)
  async add(@Guest() g: GuestClaims, @Body(new ZodPipe(cartAddSchema)) body: OrderLineInput) {
    await this.limit.hit(`g-cart:${g.sid}`, 60, 60);
    return this.guests.addLine(g, body);
  }

  @Patch('cart/lines/:lineId')
  @UseGuards(GuestGuard)
  @ApiHeader({ name: 'x-guest-token', required: true })
  @ApiZodBody(cartPatchSchema)
  async setQuantity(
    @Guest() g: GuestClaims,
    @Param('lineId') lineId: string,
    @Body(new ZodPipe(cartPatchSchema)) body: { quantity: number },
  ) {
    await this.limit.hit(`g-cart:${g.sid}`, 60, 60);
    return this.guests.setQuantity(g, lineId, body.quantity);
  }

  @Post('orders')
  @UseGuards(GuestGuard)
  @ApiHeader({ name: 'x-guest-token', required: true })
  async order(@Guest() g: GuestClaims) {
    await this.limit.hit(`g-order:${g.seat}`, 6, 600);
    return this.guests.placeOrder(g);
  }

  @Get('orders')
  @UseGuards(GuestGuard)
  @ApiHeader({ name: 'x-guest-token', required: true })
  orders(@Guest() g: GuestClaims) {
    return this.guests.orders(g);
  }

  @Post('actions')
  @UseGuards(GuestGuard)
  @ApiHeader({ name: 'x-guest-token', required: true })
  @ApiZodBody(guestActionSchema)
  async action(@Guest() g: GuestClaims, @Body(new ZodPipe(guestActionSchema)) body: { type: GuestAction }) {
    await this.limit.hit(`g-action:${g.seat}:${body.type}`, 3, 120);
    return this.guests.action(g, body.type);
  }

  /** "How's everything?" during the meal. */
  @Post('feedback')
  @UseGuards(GuestGuard)
  @ApiHeader({ name: 'x-guest-token', required: true })
  @ApiZodBody(midMealFeedbackSchema)
  async feedback(
    @Guest() g: GuestClaims,
    @Body(new ZodPipe(midMealFeedbackSchema)) body: MidMealFeedbackInput,
  ) {
    await this.limit.hit(`g-feedback:${g.seat}`, 10, 600);
    return this.guests.feedback(g, body);
  }
}
