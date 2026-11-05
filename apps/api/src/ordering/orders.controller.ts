import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type ItemStatusInput,
  itemStatusSchema,
  kdsQuerySchema,
  ordersQuerySchema,
  rejectOrderSchema,
  type WaiterOrderInput,
  waiterOrderSchema,
} from '@dinesense/shared';
import type { OrderStatus } from '@prisma/client';
import { actorFromContext } from '../audit/audit.service';
import { Authenticated, Ctx, Roles } from '../auth/decorators';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { rolesIn } from '../common/roles';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { OrderingService } from './ordering.service';

const ORDER_TAKERS = ['OWNER', 'MANAGER', 'WAITER'] as const;

@ApiTags('orders')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class OrdersController {
  constructor(
    private readonly ordering: OrderingService,
    private readonly prisma: PrismaService,
  ) {}

  /** Waiter-assisted order for the table's open seating. Goes straight to the kitchen and counts as greet. */
  @Post('tables/:tableId/orders')
  @Roles(...ORDER_TAKERS)
  @ApiZodBody(waiterOrderSchema)
  async waiterOrder(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodPipe(waiterOrderSchema)) body: WaiterOrderInput,
  ) {
    const link = await this.prisma.forOrg(ctx.user.org).seatingTable.findFirst({
      where: { tableId, isOpen: true, table: { outletId } },
      select: { seatingId: true },
    });
    if (!link) throw new AppError('NO_OPEN_SEATING', 409, 'Seat the party before taking an order');
    return this.ordering.createOrder({
      organizationId: ctx.user.org,
      outletId,
      seatingId: link.seatingId,
      source: 'WAITER',
      lines: body.items,
      placedById: ctx.user.sub,
      audit: actorFromContext(ctx),
    });
  }

  /** Orders of the table's current seating (drawer). */
  @Get('tables/:tableId/orders')
  @Authenticated()
  async tableOrders(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('tableId') tableId: string,
  ) {
    const link = await this.prisma
      .forOrg(ctx.user.org)
      .seatingTable.findFirst({ where: { tableId, isOpen: true, table: { outletId } } });
    if (!link) return [];
    return this.ordering.listOrders(ctx.user.org, outletId, { seatingId: link.seatingId });
  }

  @Get('orders')
  @Authenticated()
  @ApiZodQuery(ordersQuerySchema)
  list(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(ordersQuerySchema)) q: { status?: OrderStatus },
  ) {
    return this.ordering.listOrders(
      ctx.user.org,
      outletId,
      q.status ? { status: q.status } : { seating: { status: 'OPEN' } },
    );
  }

  @Post('orders/:orderId/approve')
  @HttpCode(200)
  @Roles(...ORDER_TAKERS)
  approve(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.ordering.approve(ctx.user.org, outletId, orderId, {
      ...actorFromContext(ctx),
      id: ctx.user.sub,
    });
  }

  @Post('orders/:orderId/reject')
  @HttpCode(200)
  @Roles(...ORDER_TAKERS)
  @ApiZodBody(rejectOrderSchema)
  reject(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodPipe(rejectOrderSchema)) body: { reason: string },
  ) {
    return this.ordering.reject(ctx.user.org, outletId, orderId, body.reason, actorFromContext(ctx));
  }

  /** Kitchen (cooking/ready), floor (served) and managers (void). Fine-grained roles per move in the service. */
  @Patch('order-items/:itemId')
  @Roles('OWNER', 'MANAGER', 'CHEF', 'WAITER', 'HOST')
  @ApiZodBody(itemStatusSchema)
  setItemStatus(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodPipe(itemStatusSchema)) body: ItemStatusInput,
  ) {
    return this.ordering.setItemStatus(
      ctx.user.org,
      outletId,
      itemId,
      body.status,
      rolesIn(ctx, outletId),
      actorFromContext(ctx),
      body.voidReason,
    );
  }

  @Get('kds')
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @ApiZodQuery(kdsQuerySchema)
  kds(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(kdsQuerySchema)) q: { station: string },
  ) {
    return this.ordering.kdsTickets(ctx.user.org, outletId, q.station);
  }

  @Post('kds/orders/:orderId/bump')
  @HttpCode(200)
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @ApiZodQuery(kdsQuerySchema)
  bump(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('orderId') orderId: string,
    @Query(new ZodPipe(kdsQuerySchema)) q: { station: string },
  ) {
    return this.ordering.bump(ctx.user.org, outletId, orderId, q.station, actorFromContext(ctx));
  }
}
