import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { paginationSchema } from '@dinesense/shared';
import type { z } from 'zod';
import { Ctx, Managers } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodQuery, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('outlets/:outletId/audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Managers()
  @ApiZodQuery(paginationSchema)
  async list(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(paginationSchema)) q: z.infer<typeof paginationSchema>,
  ) {
    const rows = await this.prisma.forOrg(ctx.user.org).auditLog.findMany({
      where: { outletId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)?.id : null };
  }
}
