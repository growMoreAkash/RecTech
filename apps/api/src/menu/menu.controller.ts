import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  availabilitySchema,
  type CategoryInput,
  categoryInputSchema,
  type MenuItemInput,
  menuItemInputSchema,
  type MenuItemPatch,
  menuItemPatchSchema,
  type ModifierGroupInput,
  modifierGroupInputSchema,
  type StationInput,
  stationInputSchema,
} from '@dinesense/shared';
import { Authenticated, Ctx, Managers, Roles } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { MenuService } from './menu.service';

const categoryPatchSchema = categoryInputSchema.partial();

@ApiTags('menu')
@ApiBearerAuth()
@Controller('outlets/:outletId')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('menu')
  @Authenticated()
  get(@Ctx() ctx: RequestContext, @Param('outletId') outletId: string) {
    return this.menu.adminMenu(ctx, outletId);
  }

  @Post('stations')
  @Managers()
  @ApiZodBody(stationInputSchema)
  createStation(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Body(new ZodPipe(stationInputSchema)) b: StationInput,
  ) {
    return this.menu.createStation(ctx, o, b);
  }

  @Post('menu/categories')
  @Managers()
  @ApiZodBody(categoryInputSchema)
  createCategory(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Body(new ZodPipe(categoryInputSchema)) b: CategoryInput,
  ) {
    return this.menu.createCategory(ctx, o, b);
  }

  @Patch('menu/categories/:categoryId')
  @Managers()
  @ApiZodBody(categoryPatchSchema)
  updateCategory(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Param('categoryId') id: string,
    @Body(new ZodPipe(categoryPatchSchema)) b: Partial<CategoryInput>,
  ) {
    return this.menu.updateCategory(ctx, o, id, b);
  }

  @Delete('menu/categories/:categoryId')
  @HttpCode(204)
  @Managers()
  async archiveCategory(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Param('categoryId') id: string,
  ) {
    await this.menu.archiveCategory(ctx, o, id);
  }

  @Post('menu/items')
  @Managers()
  @ApiZodBody(menuItemInputSchema)
  createItem(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Body(new ZodPipe(menuItemInputSchema)) b: MenuItemInput,
  ) {
    return this.menu.createItem(ctx, o, b);
  }

  @Patch('menu/items/:itemId')
  @Managers()
  @ApiZodBody(menuItemPatchSchema)
  updateItem(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Param('itemId') id: string,
    @Body(new ZodPipe(menuItemPatchSchema)) b: MenuItemPatch,
  ) {
    return this.menu.updateItem(ctx, o, id, b);
  }

  @Delete('menu/items/:itemId')
  @HttpCode(204)
  @Managers()
  async archiveItem(@Ctx() ctx: RequestContext, @Param('outletId') o: string, @Param('itemId') id: string) {
    await this.menu.archiveItem(ctx, o, id);
  }

  /** Out-of-stock toggle — the kitchen can flip this mid-service. */
  @Patch('menu/items/:itemId/availability')
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @ApiZodBody(availabilitySchema)
  setAvailability(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Param('itemId') id: string,
    @Body(new ZodPipe(availabilitySchema)) b: { isAvailable: boolean },
  ) {
    return this.menu.setAvailability(ctx, o, id, b.isAvailable);
  }

  @Post('menu/modifier-groups')
  @Managers()
  @ApiZodBody(modifierGroupInputSchema)
  createGroup(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Body(new ZodPipe(modifierGroupInputSchema)) b: ModifierGroupInput,
  ) {
    return this.menu.upsertModifierGroup(ctx, o, b);
  }

  @Put('menu/modifier-groups/:groupId')
  @Managers()
  @ApiZodBody(modifierGroupInputSchema)
  updateGroup(
    @Ctx() ctx: RequestContext,
    @Param('outletId') o: string,
    @Param('groupId') id: string,
    @Body(new ZodPipe(modifierGroupInputSchema)) b: ModifierGroupInput,
  ) {
    return this.menu.upsertModifierGroup(ctx, o, b, id);
  }
}
