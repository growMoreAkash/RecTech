import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type AvailabilityWindow,
  type CategoryInput,
  isWithinWindows,
  type MenuItemInput,
  type MenuItemPatch,
  type ModifierGroupInput,
  rooms,
  type StationInput,
} from '@dinesense/shared';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const json = (v: unknown) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

export const itemInclude = {
  modifierGroups: {
    orderBy: { sortOrder: 'asc' },
    select: {
      modifierGroup: {
        select: {
          id: true,
          name: true,
          minSelect: true,
          maxSelect: true,
          modifiers: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, name: true, priceDeltaPaise: true, isAvailable: true },
          },
        },
      },
    },
  },
} satisfies Prisma.MenuItemInclude;

type ItemRow = Prisma.MenuItemGetPayload<{ include: typeof itemInclude }>;

/** Flattens the join table so clients see `modifierGroups: [{ id, name, minSelect, maxSelect, modifiers }]`. */
export const flattenItem = ({ modifierGroups, ...item }: ItemRow) => ({
  ...item,
  modifierGroups: modifierGroups.map((g) => g.modifierGroup),
});

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Full menu for staff (includes unavailable items). */
  async adminMenu(ctx: RequestContext, outletId: string) {
    const db = this.prisma.forOrg(ctx.user.org);
    const [stations, categories, items, modifierGroups] = await Promise.all([
      db.kitchenStation.findMany({ where: { outletId }, orderBy: { code: 'asc' } }),
      db.menuCategory.findMany({
        where: { outletId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      db.menuItem.findMany({
        where: { outletId, archivedAt: null },
        include: itemInclude,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      db.modifierGroup.findMany({
        where: { outletId },
        include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { id: 'asc' },
      }),
    ]);
    return { stations, categories, items: items.map(flattenItem), modifierGroups };
  }

  /**
   * Menu shown to guests: only categories/items inside their availability windows right now;
   * out-of-stock items are kept but flagged so guests see "sold out" rather than a vanishing dish.
   */
  async guestMenu(organizationId: string, outletId: string, now = new Date()) {
    const outlet = await this.prisma.outlet.findUniqueOrThrow({
      where: { id: outletId },
      select: { timezone: true },
    });
    const [categories, items] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { organizationId, outletId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.menuItem.findMany({
        where: { organizationId, outletId, archivedAt: null },
        include: itemInclude,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const open = (w: unknown) => isWithinWindows(w as AvailabilityWindow[] | null, now, outlet.timezone);
    const visibleCats = categories.filter((c) => open(c.availabilityWindows));
    return {
      categories: visibleCats.map((c) => ({
        id: c.id,
        name: c.name,
        items: items
          .filter((i) => i.categoryId === c.id && open(i.availabilityWindows))
          .map((i) => {
            const f = flattenItem(i);
            return {
              id: f.id,
              name: f.name,
              description: f.description,
              vegType: f.vegType,
              allergens: f.allergens,
              spiceLevel: f.spiceLevel,
              pricePaise: f.pricePaise,
              taxRateBps: f.taxRateBps,
              imageUrl: f.imageUrl,
              isAvailable: f.isAvailable,
              modifierGroups: f.modifierGroups,
            };
          }),
      })),
    };
  }

  async createStation(ctx: RequestContext, outletId: string, input: StationInput) {
    return this.write(ctx, outletId, 'menu.station.create', 'KitchenStation', (tx) =>
      tx.kitchenStation.create({
        data: { organizationId: ctx.user.org, outletId, code: input.code, name: input.name },
      }),
    );
  }

  createCategory(ctx: RequestContext, outletId: string, input: CategoryInput) {
    return this.write(ctx, outletId, 'menu.category.create', 'MenuCategory', (tx) =>
      tx.menuCategory.create({
        data: {
          organizationId: ctx.user.org,
          outletId,
          name: input.name,
          sortOrder: input.sortOrder ?? 0,
          availabilityWindows: json(input.availabilityWindows),
        },
      }),
    );
  }

  updateCategory(ctx: RequestContext, outletId: string, categoryId: string, input: Partial<CategoryInput>) {
    return this.write(ctx, outletId, 'menu.category.update', 'MenuCategory', async (tx) => {
      await this.mustFind(
        tx.menuCategory.findFirst({
          where: { id: categoryId, outletId, organizationId: ctx.user.org, archivedAt: null },
        }),
        'Category',
      );
      return tx.menuCategory.update({
        where: { id: categoryId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.availabilityWindows !== undefined
            ? { availabilityWindows: json(input.availabilityWindows) }
            : {}),
        },
      });
    });
  }

  archiveCategory(ctx: RequestContext, outletId: string, categoryId: string) {
    return this.write(ctx, outletId, 'menu.category.archive', 'MenuCategory', async (tx) => {
      await this.mustFind(
        tx.menuCategory.findFirst({
          where: { id: categoryId, outletId, organizationId: ctx.user.org, archivedAt: null },
        }),
        'Category',
      );
      const items = await tx.menuItem.count({ where: { categoryId, archivedAt: null } });
      if (items)
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'Move or remove the items in this category first',
          { items },
        );
      return tx.menuCategory.update({ where: { id: categoryId }, data: { archivedAt: new Date() } });
    });
  }

  createItem(ctx: RequestContext, outletId: string, input: MenuItemInput) {
    return this.write(ctx, outletId, 'menu.item.create', 'MenuItem', async (tx) => {
      await this.assertRefs(tx, ctx, outletId, input);
      const { modifierGroupIds, availabilityWindows, description, ...rest } = input;
      const item = await tx.menuItem.create({
        data: {
          ...rest,
          organizationId: ctx.user.org,
          outletId,
          description: json(description),
          availabilityWindows: json(availabilityWindows),
          sortOrder: input.sortOrder ?? 0,
          modifierGroups: {
            create: modifierGroupIds.map((modifierGroupId, sortOrder) => ({ modifierGroupId, sortOrder })),
          },
        },
        include: itemInclude,
      });
      return flattenItem(item);
    });
  }

  updateItem(ctx: RequestContext, outletId: string, itemId: string, input: MenuItemPatch) {
    return this.write(ctx, outletId, 'menu.item.update', 'MenuItem', async (tx) => {
      await this.mustFind(
        tx.menuItem.findFirst({
          where: { id: itemId, outletId, organizationId: ctx.user.org, archivedAt: null },
        }),
        'Menu item',
      );
      await this.assertRefs(tx, ctx, outletId, input);
      const { modifierGroupIds, availabilityWindows, description, ...rest } = input;
      if (modifierGroupIds) {
        await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId: itemId } });
        await tx.menuItemModifierGroup.createMany({
          data: modifierGroupIds.map((modifierGroupId, sortOrder) => ({
            menuItemId: itemId,
            modifierGroupId,
            sortOrder,
          })),
        });
      }
      const item = await tx.menuItem.update({
        where: { id: itemId },
        data: {
          ...rest,
          ...(description !== undefined ? { description: json(description) } : {}),
          ...(availabilityWindows !== undefined ? { availabilityWindows: json(availabilityWindows) } : {}),
        },
        include: itemInclude,
      });
      return flattenItem(item);
    });
  }

  archiveItem(ctx: RequestContext, outletId: string, itemId: string) {
    return this.write(ctx, outletId, 'menu.item.archive', 'MenuItem', async (tx) => {
      await this.mustFind(
        tx.menuItem.findFirst({
          where: { id: itemId, outletId, organizationId: ctx.user.org, archivedAt: null },
        }),
        'Menu item',
      );
      // Orders keep name/price snapshots, so archiving never breaks history.
      return tx.menuItem.update({
        where: { id: itemId },
        data: { archivedAt: new Date(), isAvailable: false },
      });
    });
  }

  /** Out-of-stock toggle: reaches every open guest menu instantly. */
  async setAvailability(ctx: RequestContext, outletId: string, itemId: string, isAvailable: boolean) {
    const item = await this.write(
      ctx,
      outletId,
      'menu.item.availability',
      'MenuItem',
      async (tx) => {
        await this.mustFind(
          tx.menuItem.findFirst({
            where: { id: itemId, outletId, organizationId: ctx.user.org, archivedAt: null },
          }),
          'Menu item',
        );
        return tx.menuItem.update({
          where: { id: itemId },
          data: { isAvailable },
          select: { id: true, isAvailable: true },
        });
      },
      false,
    );
    this.realtime.emit([rooms.outlet(outletId), rooms.menu(outletId)], 'menu.availability', {
      outletId,
      menuItemId: item.id,
      isAvailable,
    });
    return item;
  }

  upsertModifierGroup(ctx: RequestContext, outletId: string, input: ModifierGroupInput, groupId?: string) {
    return this.write(
      ctx,
      outletId,
      groupId ? 'menu.modifiers.update' : 'menu.modifiers.create',
      'ModifierGroup',
      async (tx) => {
        const data = { name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect };
        let id = groupId;
        if (id) {
          await this.mustFind(
            tx.modifierGroup.findFirst({ where: { id, outletId, organizationId: ctx.user.org } }),
            'Modifier group',
          );
          await tx.modifierGroup.update({ where: { id }, data });
        } else {
          id = (await tx.modifierGroup.create({ data: { ...data, organizationId: ctx.user.org, outletId } }))
            .id;
        }
        const keep = input.modifiers.flatMap((m) => (m.id ? [m.id] : []));
        await tx.modifier.deleteMany({ where: { modifierGroupId: id, id: { notIn: keep } } });
        for (const [sortOrder, m] of input.modifiers.entries()) {
          const fields = {
            name: m.name,
            priceDeltaPaise: m.priceDeltaPaise,
            isAvailable: m.isAvailable,
            sortOrder,
          };
          if (m.id) {
            const res = await tx.modifier.updateMany({
              where: { id: m.id, modifierGroupId: id },
              data: fields,
            });
            if (res.count !== 1) throw AppError.notFound('Modifier');
          } else {
            await tx.modifier.create({ data: { ...fields, modifierGroupId: id } });
          }
        }
        return tx.modifierGroup.findUniqueOrThrow({
          where: { id },
          include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
        });
      },
    );
  }

  private async assertRefs(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    outletId: string,
    input: Partial<MenuItemInput>,
  ) {
    const scope = { outletId, organizationId: ctx.user.org };
    const bad = (path: string) =>
      new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Unknown reference', [
        { path, message: 'Not found in this outlet' },
      ]);
    if (
      input.categoryId &&
      !(await tx.menuCategory.findFirst({ where: { ...scope, id: input.categoryId, archivedAt: null } }))
    )
      throw bad('categoryId');
    if (input.stationId && !(await tx.kitchenStation.findFirst({ where: { ...scope, id: input.stationId } })))
      throw bad('stationId');
    if (input.modifierGroupIds?.length) {
      const n = await tx.modifierGroup.count({ where: { ...scope, id: { in: input.modifierGroupIds } } });
      if (n !== new Set(input.modifierGroupIds).size) throw bad('modifierGroupIds');
    }
  }

  private async mustFind<T>(p: Promise<T | null>, what: string): Promise<T> {
    const v = await p;
    if (!v) throw AppError.notFound(what);
    return v;
  }

  /** Runs a menu change with an audit row, then tells staff and guests the menu changed. */
  private async write<T extends { id: string }>(
    ctx: RequestContext,
    outletId: string,
    action: string,
    entityType: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    announce = true,
  ): Promise<T> {
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await fn(tx);
      await this.audit.record(ctx, { action, entityType, entityId: r.id, outletId, after: r }, tx);
      return r;
    });
    if (announce)
      this.realtime.emit([rooms.outlet(outletId), rooms.menu(outletId)], 'menu.changed', { outletId });
    return result;
  }
}
