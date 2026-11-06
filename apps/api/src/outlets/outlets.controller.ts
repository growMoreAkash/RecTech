import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type OutletSettingsInput, updateOutletSettingsSchema } from '@dinesense/shared';
import { Authenticated, Ctx, Managers } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { OutletsService } from './outlets.service';

@ApiTags('outlets')
@ApiBearerAuth()
@Controller('outlets')
export class OutletsController {
  constructor(private readonly outlets: OutletsService) {}

  @Get()
  @Authenticated()
  list(@Ctx() ctx: RequestContext) {
    return this.outlets.list(ctx);
  }

  @Get(':outletId')
  @Authenticated()
  get(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.outlets.get(ctx, outletId);
  }

  @Get(':outletId/settings')
  @Authenticated()
  getSettings(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.outlets.getSettings(ctx, outletId);
  }

  @Patch(':outletId/settings')
  @Managers()
  @ApiZodBody(updateOutletSettingsSchema)
  updateSettings(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(updateOutletSettingsSchema)) body: Partial<OutletSettingsInput>,
  ) {
    return this.outlets.updateSettings(ctx, outletId, body);
  }
}
