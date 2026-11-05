import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SeatingSummary, TableStatus } from '@dinesense/shared';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** Live state of one table, as sent to the floor map (REST snapshot and `table.updated`). */
export interface TableLive {
  tableId: string;
  outletId: string;
  status: TableStatus;
  version: number;
  statusChangedAt: string;
  seating: SeatingSummary | null;
}

const seatingInclude = {
  servingWaiter: { select: { id: true, name: true } },
  tables: { select: { tableId: true } },
} as const;

type SeatingRow = Prisma.SeatingGetPayload<{ include: typeof seatingInclude }>;

export function toSeatingSummary(s: SeatingRow): SeatingSummary {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: s.id,
    partySize: s.partySize,
    seatedAt: s.seatedAt.toISOString(),
    greetedAt: iso(s.greetedAt),
    firstOrderAt: iso(s.firstOrderAt),
    billRequestedAt: iso(s.billRequestedAt),
    paidAt: iso(s.paidAt),
    notes: s.notes,
    servingWaiter: s.servingWaiter,
    tableIds: s.tables.map((t) => t.tableId).sort(),
  };
}

@Injectable()
export class TableViews {
  constructor(private readonly prisma: PrismaService) {}

  /** Live views for tables of an outlet (all non-archived tables when `tableIds` is omitted). */
  async load(
    organizationId: string,
    outletId: string,
    tableIds?: string[],
    db: Db = this.prisma,
  ): Promise<TableLive[]> {
    const tables = await db.table.findMany({
      where: { organizationId, outletId, archivedAt: null, ...(tableIds ? { id: { in: tableIds } } : {}) },
      select: {
        id: true,
        outletId: true,
        status: true,
        version: true,
        statusChangedAt: true,
        seatings: { where: { isOpen: true }, select: { seating: { include: seatingInclude } } },
      },
    });
    return tables.map((t) => {
      const open = t.seatings[0]?.seating;
      return {
        tableId: t.id,
        outletId: t.outletId,
        status: t.status,
        version: t.version,
        statusChangedAt: t.statusChangedAt.toISOString(),
        seating: open ? toSeatingSummary(open) : null,
      };
    });
  }
}
