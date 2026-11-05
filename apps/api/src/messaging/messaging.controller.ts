import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { AppError } from '../common/app-error';
import { RateLimitService } from '../common/rate-limit.service';
import { MessagingService } from './messaging.service';

/** Meta WhatsApp webhook: subscription check (GET) and signed deliveries (POST, X-Hub-Signature-256). */
@ApiTags('messaging')
@Public()
@Controller('messaging/whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly limit: RateLimitService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ) {
    if (mode !== 'subscribe' || !this.messaging.verifyToken(token))
      throw AppError.forbidden('Bad verify token');
    return challenge ?? '';
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Ip() ip: string,
    @Body() body: unknown,
  ) {
    await this.limit.hit(`wa-webhook:${ip}`, 600, 60);
    if (!this.messaging.verifyWebhookSignature(req.rawBody, signature))
      throw new AppError('UNAUTHENTICATED', 401, 'Bad webhook signature');
    return this.messaging.webhook(body);
  }
}
