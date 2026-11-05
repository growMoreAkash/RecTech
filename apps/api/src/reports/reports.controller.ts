import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { localDate, localDayRange, shiftQuerySchema, summarizeDay } from '@dinesense/shared';
import { Ctx, Managers } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodQuery, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

/** Basic day reports for managers (local day of the outlet). */
@ApiTags('reports')
@ApiBearerAuth()
@Managers()
@Controller('outlets/:outletId/reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('day')
  @ApiZodQuery(shiftQuerySchema)
  async day(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(shiftQuerySchema)) q: { date?: string },
  ) {
    const db = this.prisma.forOrg(ctx.user.org);
    const outlet = await db.outlet.findUniqueOrThrow({
      where: { id: outletId },
      include: { settings: true },
    });
    const date = q.date ?? localDate(new Date(), outlet.timezone);
    const { start, end } = localDayRange(date, outlet.timezone);
    const inDay = { gte: start, lt: end };

    const [seatings, bills, payments, leftWithoutPaying] = await Promise.all([
      db.seating.findMany({
        where: { outletId, seatedAt: inDay },
        select: {
          seatedAt: true,
          greetedAt: true,
          greetedById: true,
          partySize: true,
          slaBreachedAt: true,
          escalatedAt: true,
          assignments: {
            select: { waiterId: true, assignedAt: true, acknowledgedAt: true, expiredAt: true },
          },
        },
      }),
      db.bill.findMany({
        where: { outletId, status: { in: ['FINALIZED', 'PAID'] }, finalizedAt: inDay },
        select: { finalizedAt: true, totalPaise: true },
      }),
      db.payment.findMany({
        where: { outletId, status: 'CAPTURED', capturedAt: inDay },
        select: { method: true, amountPaise: true },
      }),
      db.alert.count({ where: { outletId, type: 'LEFT_WITHOUT_PAYING', createdAt: inDay } }),
    ]);
    const assignments = seatings.flatMap((s) => s.assignments);
    const ids = [
      ...new Set([
        ...assignments.map((a) => a.waiterId),
        ...seatings.flatMap((s) => (s.greetedById ? [s.greetedById] : [])),
      ]),
    ];
    const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });

    return {
      date,
      timeZone: outlet.timezone,
      greetSlaSeconds: outlet.settings?.greetSlaSeconds ?? 300,
      ...summarizeDay({
        seatings,
        assignments,
        bills: bills.map((b) => ({ finalizedAt: b.finalizedAt!, totalPaise: b.totalPaise })),
        payments,
        leftWithoutPaying,
        greetSlaSeconds: outlet.settings?.greetSlaSeconds ?? 300,
        timeZone: outlet.timezone,
        names: new Map(users.map((u) => [u.id, u.name])),
      }),
    };
  }
}
