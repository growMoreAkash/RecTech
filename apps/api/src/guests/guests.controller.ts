import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type GuestPatchInput,
  guestLookupSchema,
  guestPatchSchema,
  privacySettingsSchema,
} from '@dinesense/shared';
import { z } from 'zod';
import { actorFromContext } from '../audit/audit.service';
import { Ctx, Managers, Roles } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { GuestsService } from './guests.service';

const FRONT = ['OWNER', 'MANAGER', 'HOST'] as const;
const searchSchema = z.object({ q: z.string().max(60).optional() });

/** Guest profiles (org-wide; routes are outlet-scoped for RBAC). Every read of personal data is audited. */
@ApiTags('guests')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class GuestsController {
  constructor(
    private readonly guests: GuestsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('guests/lookup')
  @Roles(...FRONT, 'WAITER')
  @ApiZodQuery(guestLookupSchema)
  lookup(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(guestLookupSchema)) q: { phone: string },
  ) {
    return this.guests.lookup(ctx.user.org, q.phone, actorFromContext(ctx), outletId);
  }

  @Get('guests')
  @Managers()
  @ApiZodQuery(searchSchema)
  search(@Ctx() ctx: RequestContext, @Query(new ZodPipe(searchSchema)) q: { q?: string }) {
    return this.guests.search(ctx.user.org, q.q);
  }

  @Get('guests/:guestId')
  @Roles(...FRONT)
  get(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('guestId') guestId: string) {
    return this.guests.get(ctx.user.org, guestId, actorFromContext(ctx), outletId);
  }

  @Patch('guests/:guestId')
  @Roles(...FRONT)
  @ApiZodBody(guestPatchSchema)
  update(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('guestId') guestId: string,
    @Body(new ZodPipe(guestPatchSchema)) body: GuestPatchInput,
  ) {
    return this.guests.update(ctx.user.org, guestId, body, actorFromContext(ctx), outletId);
  }

  /** DPDP access request: a JSON file of everything held about the guest. */
  @Get('guests/:guestId/export')
  @Managers()
  export(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('guestId') guestId: string) {
    return this.guests.export(ctx.user.org, guestId, actorFromContext(ctx), outletId);
  }

  /** DPDP erasure request. */
  @Delete('guests/:guestId')
  @Managers()
  erase(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string, @Param('guestId') guestId: string) {
    return this.guests.erase(ctx.user.org, guestId, 'REQUEST', actorFromContext(ctx), outletId);
  }

  @Get('privacy')
  @Roles('OWNER')
  async privacy(@Ctx() ctx: RequestContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.user.org },
      select: { guestRetentionDays: true },
    });
    return org;
  }

  @Patch('privacy')
  @Roles('OWNER')
  @ApiZodBody(privacySettingsSchema)
  async setPrivacy(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(privacySettingsSchema)) body: { guestRetentionDays: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: ctx.user.org } });
      const after = await tx.organization.update({
        where: { id: ctx.user.org },
        data: { guestRetentionDays: body.guestRetentionDays },
        select: { guestRetentionDays: true },
      });
      await this.guestsAudit(ctx, outletId, before.guestRetentionDays, after.guestRetentionDays, tx);
      return after;
    });
  }

  private guestsAudit(
    ctx: RequestContext,
    outletId: string,
    before: number,
    after: number,
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ) {
    return this.guests.auditPrivacy(actorFromContext(ctx), outletId, before, after, tx);
  }
}
