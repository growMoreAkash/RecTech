import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  breakSchema,
  type CreateStaffInput,
  createStaffSchema,
  type ShiftInput,
  shiftInputSchema,
  shiftQuerySchema,
  type UpdateShiftInput,
  updateShiftSchema,
  type UpdateStaffInput,
  updateStaffSchema,
} from '@dinesense/shared';
import { Authenticated, Ctx, Managers, Roles } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod';
import { StaffService } from './staff.service';

@ApiTags('staff')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('staff')
  @Roles('OWNER', 'MANAGER', 'HOST')
  list(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.staff.list(ctx, outletId);
  }

  @Post('staff')
  @Managers()
  @ApiZodBody(createStaffSchema)
  create(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(createStaffSchema)) body: CreateStaffInput,
  ) {
    return this.staff.create(ctx, outletId, body);
  }

  @Patch('staff/:userId')
  @Managers()
  @ApiZodBody(updateStaffSchema)
  update(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(updateStaffSchema)) body: UpdateStaffInput,
  ) {
    return this.staff.update(ctx, outletId, userId, body);
  }

  @Get('shifts')
  @Authenticated()
  @ApiZodQuery(shiftQuerySchema)
  listShifts(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Query(new ZodPipe(shiftQuerySchema)) q: { date?: string },
  ) {
    return this.staff.listShifts(ctx, outletId, q.date);
  }

  @Post('shifts')
  @Managers()
  @ApiZodBody(shiftInputSchema)
  createShift(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(shiftInputSchema)) body: ShiftInput,
  ) {
    return this.staff.createShift(ctx, outletId, body);
  }

  @Patch('shifts/:shiftId')
  @Managers()
  @ApiZodBody(updateShiftSchema)
  updateShift(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodPipe(updateShiftSchema)) body: UpdateShiftInput,
  ) {
    return this.staff.updateShift(ctx, outletId, shiftId, body);
  }

  @Delete('shifts/:shiftId')
  @HttpCode(204)
  @Managers()
  async deleteShift(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('shiftId') shiftId: string,
  ) {
    await this.staff.deleteShift(ctx, outletId, shiftId);
  }

  /** Self or manager (checked in the service). */
  @Post('shifts/:shiftId/check-in')
  @HttpCode(200)
  @Authenticated()
  checkIn(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('shiftId') shiftId: string,
  ) {
    return this.staff.checkIn(ctx, outletId, shiftId);
  }

  @Post('shifts/:shiftId/check-out')
  @HttpCode(200)
  @Authenticated()
  checkOut(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('shiftId') shiftId: string,
  ) {
    return this.staff.checkOut(ctx, outletId, shiftId);
  }

  @Post('shifts/:shiftId/break')
  @HttpCode(200)
  @Authenticated()
  @ApiZodBody(breakSchema)
  setBreak(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodPipe(breakSchema)) body: { onBreak: boolean },
  ) {
    return this.staff.setBreak(ctx, outletId, shiftId, body.onBreak);
  }
}
