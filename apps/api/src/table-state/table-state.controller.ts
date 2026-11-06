import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type ConsentFlags,
  type Actor,
  seatSchema,
  type SeatInput,
  type TableMachineEvent,
  transitionSchema,
  type TransitionInput,
} from '@dinesense/shared';
import { actorFromContext } from '../audit/audit.service';
import { Authenticated, Ctx, Roles } from '../auth/decorators';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { rolesIn } from '../common/roles';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { upsertGuestByPhone } from '../guests/guest-identity';
import { TableStateService } from './table-state.service';

const staffActor = (ctx: RequestContext, outletId: string): Actor => ({
  kind: 'STAFF',
  userId: ctx.user.sub,
  roles: rolesIn(ctx, outletId),
});

/** Staff-driven table state changes. Fine-grained permissions live in the state machine itself. */
@ApiTags('tables')
@ApiBearerAuth()
@Controller('outlets/:outletId/tables/:tableId')
export class TableStateController {
  constructor(
    private readonly state: TableStateService,
    private readonly prisma: PrismaService,
  ) {}

  /** Returning-guest recognition at the door: the party's phone links the seating to their profile. */
  private async guestFor(
    ctx: RequestContext,
    g: { phone: string; name?: string; consents?: ConsentFlags },
  ): Promise<string> {
    const guest = await this.prisma.$transaction((tx) =>
      upsertGuestByPhone(tx, ctx.user.org, g.phone, {
        name: g.name,
        consents: g.consents,
        source: 'HOST',
        actorId: ctx.user.sub,
      }),
    );
    return guest.id;
  }

  @Post('seat')
  @HttpCode(200)
  @Roles('OWNER', 'MANAGER', 'HOST', 'WAITER')
  @ApiZodBody(seatSchema)
  async seat(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodPipe(seatSchema)) body: SeatInput,
  ) {
    const out = await this.state.apply({
      organizationId: ctx.user.org,
      outletId,
      tableId,
      event: {
        type: 'HOST_SEAT',
        partySize: body.partySize,
        ...(body.source ? { source: body.source } : {}),
      },
      actor: staffActor(ctx, outletId),
      audit: actorFromContext(ctx),
      source: 'STAFF',
      seat: {
        notes: body.notes,
        joinTableIds: body.joinTableIds,
        ...(body.guest ? { guestId: await this.guestFor(ctx, body.guest) } : {}),
      },
    });
    return { tables: out.tables };
  }

  @Post('transitions')
  @HttpCode(200)
  @Authenticated()
  @ApiZodBody(transitionSchema)
  async transition(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodPipe(transitionSchema)) body: TransitionInput,
  ) {
    const event = (
      body.event === 'FORCE_STATE' ? { type: 'FORCE_STATE', to: body.to } : { type: body.event }
    ) as TableMachineEvent;
    if (event.type === 'HOST_SEAT') throw AppError.forbidden('Use the seat endpoint to seat a party');
    const out = await this.state.apply({
      organizationId: ctx.user.org,
      outletId,
      tableId,
      event,
      actor: staffActor(ctx, outletId),
      audit: actorFromContext(ctx),
      source: 'STAFF',
      expectedVersion: body.expectedVersion,
    });
    return { noop: out.result?.noop ?? false, tables: out.tables };
  }

  @Get('timeline')
  @Authenticated()
  async timeline(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('tableId') tableId: string,
  ) {
    const db = this.prisma.forOrg(ctx.user.org);
    const table = await db.table.findFirst({ where: { id: tableId, outletId, archivedAt: null } });
    if (!table) throw AppError.notFound('Table');
    const link = await db.seatingTable.findFirst({
      where: { tableId },
      orderBy: { seating: { seatedAt: 'desc' } },
      select: { seatingId: true },
    });
    const seating = link
      ? await db.seating.findUnique({
          where: { id: link.seatingId },
          include: {
            servingWaiter: { select: { id: true, name: true } },
            tables: { select: { table: { select: { id: true, label: true } } } },
            tasks: { orderBy: { createdAt: 'desc' }, take: 50 },
            assignments: {
              orderBy: { assignedAt: 'desc' },
              include: { waiter: { select: { id: true, name: true } } },
            },
          },
        })
      : null;
    const events = await db.tableEvent.findMany({
      where: { tableId },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
    const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
    const actors = await db.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.name]));
    return {
      table: { id: table.id, label: table.label, status: table.status, version: table.version },
      seating,
      events: events.map((e) => ({ ...e, actorName: e.actorId ? (names.get(e.actorId) ?? null) : null })),
    };
  }
}
