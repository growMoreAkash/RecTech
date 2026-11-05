import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type PushSubscriptionInput, pushSubscriptionSchema, pushUnsubscribeSchema } from '@dinesense/shared';
import { Authenticated, Ctx, Public } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

@ApiTags('push')
@Controller()
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('push/public-key')
  @Public()
  publicKey() {
    return { enabled: this.push.enabled, publicKey: this.push.publicKey };
  }

  /** One browser endpoint belongs to one user: re-subscribing on a shared terminal moves it to whoever is signed in. */
  @Post('me/push-subscriptions')
  @HttpCode(204)
  @ApiBearerAuth()
  @Authenticated()
  @ApiZodBody(pushSubscriptionSchema)
  async subscribe(
    @Ctx() ctx: RequestContext,
    @Body(new ZodPipe(pushSubscriptionSchema)) body: PushSubscriptionInput,
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId: ctx.user.sub,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: { userId: ctx.user.sub, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
  }

  @Delete('me/push-subscriptions')
  @HttpCode(204)
  @ApiBearerAuth()
  @Authenticated()
  @ApiZodBody(pushUnsubscribeSchema)
  async unsubscribe(
    @Ctx() ctx: RequestContext,
    @Body(new ZodPipe(pushUnsubscribeSchema)) body: { endpoint: string },
  ): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: ctx.user.sub },
    });
  }
}
