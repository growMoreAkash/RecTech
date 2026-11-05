import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type FloorPlanInput,
  floorPlanSchema,
  type SectionInput,
  sectionInputSchema,
} from '@dinesense/shared';
import { Authenticated, Ctx, Managers } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { FloorService } from './floor.service';

const sectionPatchSchema = sectionInputSchema.partial();

@ApiTags('floor')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class FloorController {
  constructor(private readonly floor: FloorService) {}

  @Get('floor')
  @Authenticated()
  snapshot(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.floor.snapshot(ctx, outletId);
  }

  @Put('floor-plan')
  @Managers()
  @ApiZodBody(floorPlanSchema)
  savePlan(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(floorPlanSchema)) body: FloorPlanInput,
  ) {
    return this.floor.savePlan(ctx, outletId, body);
  }

  @Post('sections')
  @Managers()
  @ApiZodBody(sectionInputSchema)
  createSection(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Body(new ZodPipe(sectionInputSchema)) body: SectionInput,
  ) {
    return this.floor.createSection(ctx, outletId, body);
  }

  @Patch('sections/:sectionId')
  @Managers()
  @ApiZodBody(sectionPatchSchema)
  updateSection(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodPipe(sectionPatchSchema)) body: Partial<SectionInput>,
  ) {
    return this.floor.updateSection(ctx, outletId, sectionId, body);
  }

  @Delete('sections/:sectionId')
  @HttpCode(204)
  @Managers()
  async archiveSection(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('sectionId') sectionId: string,
  ) {
    await this.floor.archiveSection(ctx, outletId, sectionId);
  }
}
