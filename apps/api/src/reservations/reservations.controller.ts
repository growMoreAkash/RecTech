import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type Actor,
  type ConsentFlags,
  consentInputSchema,
  localDate,
  type OpeningHoursInput,
  openingHoursSchema,
  type PublicReservationInput,
  publicReservationSchema,
  type ReservationPatchInput,
  reservationPatchSchema,
  type RescheduleInput,
  rescheduleSchema,
  shiftQuerySchema,
  slotsQuerySchema,
  type StaffReservationInput,
  staffReservationSchema,
} from '@dinesense/shared';
import { z } from 'zod';
import { actorFromContext, type AuditActor } from '../audit/audit.service';
import { Ctx, Managers, Public, Roles } from '../auth/decorators';
import { AppError } from '../common/app-error';
import { RateLimitService } from '../common/rate-limit.service';
import type { RequestContext } from '../common/request';
import { rolesIn } from '../common/roles';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod';
import { GuestsService } from '../guests/guests.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from './reservations.service';

const FRONT = ['OWNER', 'MANAGER', 'HOST'] as const;
const checkInSchema = z
  .object({ tableIds: z.array(z.string().min(1).max(64)).min(1).max(6).optional() })
  .strict();
const staffActor = (ctx: RequestContext, outletId: string): Actor => ({
  kind: 'STAFF',
  userId: ctx.user.sub,
  roles: rolesIn(ctx, outletId),
});

/** Front desk: the day's bookings, phone bookings, changes, check-in, opening hours. */
@ApiTags('reservations')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('reservations')
  @Roles(...FRONT, 'WAITER')
  @ApiZodQuery(shiftQuerySchema)
  async list(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(shiftQuerySchema)) q: { date?: string },
  ) {
    const outlet = await this.prisma
      .forOrg(ctx.user.org)
      .outlet.findUniqueOrThrow({ where: { id: outletId } });
    return this.reservations.listDay(
      ctx.user.org,
      outletId,
      q.date ?? localDate(new Date(), outlet.timezone),
    );
  }

  @Get('reservations/slots')
  @Roles(...FRONT)
  @ApiZodQuery(slotsQuerySchema)
  async slots(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(slotsQuerySchema)) q: { date: string; partySize: number },
  ) {
    const outlet = await this.prisma
      .forOrg(ctx.user.org)
      .outlet.findUniqueOrThrow({ where: { id: outletId }, include: { settings: true } });
    return this.reservations.slots(outletId, outlet.settings!, outlet.timezone, q.date, q.partySize, false);
  }

  @Post('reservations')
  @Roles(...FRONT)
  @ApiZodBody(staffReservationSchema)
  create(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(staffReservationSchema)) body: StaffReservationInput,
  ) {
    return this.reservations.book(
      ctx.user.org,
      outletId,
      { ...body, startsAt: new Date(body.startsAt) },
      { channel: 'STAFF', audit: actorFromContext(ctx) },
    );
  }

  @Patch('reservations/:reservationId')
  @Roles(...FRONT)
  @ApiZodBody(reservationPatchSchema)
  change(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('reservationId') id: string,
    @Body(new ZodPipe(reservationPatchSchema)) body: ReservationPatchInput,
  ) {
    return this.reservations.change(ctx.user.org, outletId, id, body, {
      online: false,
      audit: actorFromContext(ctx),
    });
  }

  @Post('reservations/:reservationId/cancel')
  @HttpCode(200)
  @Roles(...FRONT)
  cancel(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('reservationId') id: string,
  ) {
    return this.reservations.cancel(ctx.user.org, outletId, id, 'STAFF', actorFromContext(ctx));
  }

  @Post('reservations/:reservationId/no-show')
  @HttpCode(200)
  @Roles(...FRONT)
  noShow(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('reservationId') id: string,
  ) {
    return this.reservations.noShow(ctx.user.org, outletId, id, actorFromContext(ctx));
  }

  @Post('reservations/:reservationId/check-in')
  @HttpCode(200)
  @Roles(...FRONT, 'WAITER')
  @ApiZodBody(checkInSchema)
  checkIn(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('reservationId') id: string,
    @Body(new ZodPipe(checkInSchema)) body: { tableIds?: string[] },
  ) {
    return this.reservations.checkIn(
      ctx.user.org,
      outletId,
      id,
      body.tableIds,
      staffActor(ctx, outletId),
      actorFromContext(ctx),
    );
  }

  @Get('hours')
  @Roles(...FRONT, 'WAITER', 'CASHIER')
  hours(@Param('outletId') outletId: string) {
    return this.reservations.hours(outletId);
  }

  @Put('hours')
  @Managers()
  @ApiZodBody(openingHoursSchema)
  setHours(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(openingHoursSchema)) body: OpeningHoursInput,
  ) {
    return this.reservations.setHours(ctx.user.org, outletId, body, actorFromContext(ctx));
  }
}

/**
 * Public booking page (/b/{slug}) and the guest's manage link (/b/manage/{token}). No accounts: the signed link is
 * the credential. Rate-limited per IP and per phone.
 */
@ApiTags('booking')
@Public()
@Controller('b')
export class BookingController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly guests: GuestsService,
    private readonly limit: RateLimitService,
  ) {}

  private async byToken(token: string) {
    const id = this.reservations.verifyToken(token);
    const r = id ? await this.reservations.find(id) : null;
    if (!r) throw AppError.notFound('Booking');
    return r;
  }

  private guestActor(r: { organizationId: string; guestId: string }, ip: string): AuditActor {
    return { organizationId: r.organizationId, type: 'GUEST', id: r.guestId, ip };
  }

  @Get('manage/:token')
  async manage(@Param('token') token: string, @Ip() ip: string) {
    await this.limit.hit(`b-manage:${ip}`, 60, 60);
    return this.reservations.guestView((await this.byToken(token)).id);
  }

  @Post('manage/:token/cancel')
  @HttpCode(200)
  async guestCancel(@Param('token') token: string, @Ip() ip: string) {
    await this.limit.hit(`b-manage-w:${ip}`, 20, 300);
    const r = await this.byToken(token);
    await this.reservations.cancel(r.organizationId, r.outletId, r.id, 'GUEST', this.guestActor(r, ip));
    return this.reservations.guestView(r.id);
  }

  @Post('manage/:token/reschedule')
  @HttpCode(200)
  @ApiZodBody(rescheduleSchema)
  async reschedule(
    @Param('token') token: string,
    @Ip() ip: string,
    @Body(new ZodPipe(rescheduleSchema)) body: RescheduleInput,
  ) {
    await this.limit.hit(`b-manage-w:${ip}`, 20, 300);
    const r = await this.byToken(token);
    const outlet = await this.reservations.outletBySlugOrId(r.outletId);
    if (body.partySize && body.partySize > outlet.settings.bookingMaxPartySize)
      throw new AppError('NO_AVAILABILITY', 409, 'Please call the restaurant for larger groups');
    await this.reservations.change(r.organizationId, r.outletId, r.id, body, {
      online: true,
      audit: this.guestActor(r, ip),
    });
    return this.reservations.guestView(r.id);
  }

  /** Consent changes from the link in every message (DPDP withdrawal must be as easy as giving consent). */
  @Patch('manage/:token/consents')
  @ApiZodBody(consentInputSchema)
  async consents(
    @Param('token') token: string,
    @Ip() ip: string,
    @Body(new ZodPipe(consentInputSchema)) body: ConsentFlags,
  ) {
    await this.limit.hit(`b-manage-w:${ip}`, 20, 300);
    const r = await this.byToken(token);
    await this.guests.update(
      r.organizationId,
      r.guestId,
      { consents: body },
      this.guestActor(r, ip),
      r.outletId,
      'MANAGE_LINK',
    );
    return this.reservations.guestView(r.id);
  }

  @Get(':slug')
  async outlet(@Param('slug') slug: string, @Ip() ip: string) {
    await this.limit.hit(`b-page:${ip}`, 60, 60);
    const o = await this.reservations.outletBySlug(slug);
    const s = o.settings;
    return {
      name: o.name,
      address: o.address,
      slug: o.slug,
      timezone: o.timezone,
      today: localDate(new Date(), o.timezone),
      booking: {
        enabled: s.bookingEnabled,
        maxPartySize: s.bookingMaxPartySize,
        horizonDays: s.bookingHorizonDays,
        slotMinutes: s.bookingSlotMinutes,
      },
      sections: o.sections.filter((x) => !x.archivedAt).map((x) => ({ id: x.id, name: x.name })),
    };
  }

  @Get(':slug/slots')
  @ApiZodQuery(slotsQuerySchema)
  async slots(
    @Param('slug') slug: string,
    @Ip() ip: string,
    @Query(new ZodPipe(slotsQuerySchema)) q: { date: string; partySize: number },
  ) {
    await this.limit.hit(`b-slots:${ip}`, 60, 60);
    const o = await this.reservations.outletBySlug(slug);
    if (!o.settings.bookingEnabled) return [];
    return this.reservations.slots(o.id, o.settings, o.timezone, q.date, q.partySize, true);
  }

  @Post(':slug/reservations')
  @ApiZodBody(publicReservationSchema)
  async book(
    @Param('slug') slug: string,
    @Ip() ip: string,
    @Body(new ZodPipe(publicReservationSchema)) body: PublicReservationInput,
  ) {
    await this.limit.hit(`b-book:${ip}`, 10, 3600);
    await this.limit.hit(`b-book-phone:${body.phone}`, 3, 86_400);
    const o = await this.reservations.outletBySlug(slug);
    if (body.partySize > o.settings.bookingMaxPartySize)
      throw new AppError('NO_AVAILABILITY', 409, 'Please call the restaurant for larger groups');
    const out = await this.reservations.book(
      o.organizationId,
      o.id,
      { ...body, startsAt: new Date(body.startsAt) },
      { channel: 'ONLINE', audit: { organizationId: o.organizationId, type: 'GUEST', ip } },
    );
    return { manageToken: out.manageToken, booking: await this.reservations.guestView(out.reservation.id) };
  }
}
