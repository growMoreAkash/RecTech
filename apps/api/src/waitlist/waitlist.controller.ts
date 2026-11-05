import { Body, Controller, Get, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type Actor,
  type WaitlistAddInput,
  waitlistAddSchema,
  type WaitlistJoinInput,
  waitlistJoinSchema,
  waitlistNotifySchema,
  waitlistSeatSchema,
} from '@dinesense/shared';
import { actorFromContext } from '../audit/audit.service';
import { Ctx, Public, Roles } from '../auth/decorators';
import { AppError } from '../common/app-error';
import { RateLimitService } from '../common/rate-limit.service';
import type { RequestContext } from '../common/request';
import { rolesIn } from '../common/roles';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { ReservationsService } from '../reservations/reservations.service';
import { WaitlistService } from './waitlist.service';

const FRONT = ['OWNER', 'MANAGER', 'HOST'] as const;
const staffActor = (ctx: RequestContext, outletId: string): Actor => ({
  kind: 'STAFF',
  userId: ctx.user.sub,
  roles: rolesIn(ctx, outletId),
});

/** Host stand: the queue with ETAs and table suggestions, door-camera arrivals. */
@ApiTags('waitlist')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class WaitlistController {
  constructor(
    private readonly waitlist: WaitlistService,
    private readonly reservations: ReservationsService,
  ) {}

  @Get('waitlist')
  @Roles(...FRONT, 'WAITER')
  list(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.waitlist.list(ctx.user.org, outletId);
  }

  @Post('waitlist')
  @Roles(...FRONT)
  @ApiZodBody(waitlistAddSchema)
  add(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(waitlistAddSchema)) body: WaitlistAddInput,
  ) {
    return this.waitlist.add(ctx.user.org, outletId, body, actorFromContext(ctx));
  }

  @Post('waitlist/:entryId/notify')
  @HttpCode(200)
  @Roles(...FRONT)
  @ApiZodBody(waitlistNotifySchema)
  notify(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('entryId') id: string,
    @Body(new ZodPipe(waitlistNotifySchema)) body: { tableIds: string[] },
  ) {
    return this.waitlist.notify(ctx.user.org, outletId, id, body.tableIds, actorFromContext(ctx));
  }

  @Post('waitlist/:entryId/seat')
  @HttpCode(200)
  @Roles(...FRONT, 'WAITER')
  @ApiZodBody(waitlistSeatSchema)
  seat(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('entryId') id: string,
    @Body(new ZodPipe(waitlistSeatSchema)) body: { tableIds?: string[] },
  ) {
    return this.waitlist.seat(
      ctx.user.org,
      outletId,
      id,
      body.tableIds,
      staffActor(ctx, outletId),
      actorFromContext(ctx),
    );
  }

  @Post('waitlist/:entryId/remove')
  @HttpCode(200)
  @Roles(...FRONT)
  remove(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('entryId') id: string) {
    return this.waitlist.remove(ctx.user.org, outletId, id, actorFromContext(ctx));
  }

  @Get('door-arrivals')
  @Roles(...FRONT, 'WAITER')
  arrivals(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string): Promise<unknown> {
    return this.reservations.recentArrivals(ctx.user.org, outletId);
  }

  @Post('door-arrivals/:arrivalId/dismiss')
  @HttpCode(200)
  @Roles(...FRONT, 'WAITER')
  dismiss(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('arrivalId') id: string) {
    return this.reservations.dismissArrival(ctx.user.org, outletId, id);
  }
}

/** Door QR: join the queue (/w/{slug}) and follow your place (/w/status/{token}). Rate-limited. */
@ApiTags('waitlist')
@Public()
@Controller('w')
export class PublicWaitlistController {
  constructor(
    private readonly waitlist: WaitlistService,
    private readonly limit: RateLimitService,
  ) {}

  private entry(token: string) {
    const id = this.waitlist.verify(token);
    if (!id) throw AppError.notFound('Waitlist entry');
    return id;
  }

  @Get('status/:token')
  async status(@Param('token') token: string, @Ip() ip: string) {
    await this.limit.hit(`w-status:${ip}`, 120, 60);
    return this.waitlist.view(this.entry(token));
  }

  @Post('status/:token/leave')
  @HttpCode(200)
  async leave(@Param('token') token: string, @Ip() ip: string) {
    await this.limit.hit(`w-leave:${ip}`, 20, 300);
    return this.waitlist.leave(this.entry(token), ip);
  }

  @Get(':slug')
  async info(@Param('slug') slug: string, @Ip() ip: string) {
    await this.limit.hit(`w-page:${ip}`, 60, 60);
    return this.waitlist.publicInfo(slug);
  }

  @Post(':slug/entries')
  @ApiZodBody(waitlistJoinSchema)
  async join(
    @Param('slug') slug: string,
    @Ip() ip: string,
    @Body(new ZodPipe(waitlistJoinSchema)) body: WaitlistJoinInput,
  ) {
    await this.limit.hit(`w-join:${ip}`, 10, 3600);
    await this.limit.hit(`w-join-phone:${body.phone}`, 5, 86_400);
    return this.waitlist.join(slug, body, ip);
  }
}
