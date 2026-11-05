import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '../common/request';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  outletId?: string;
  before?: unknown;
  after?: unknown;
}

const json = (v: unknown) =>
  v === undefined ? undefined : v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);

/**
 * Append-only audit trail. Call it inside the same transaction as the change it records,
 * so a change can never commit without its audit row.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(ctx: RequestContext, entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId: ctx.user.org,
        outletId: entry.outletId ?? null,
        actorType: ctx.user.deviceId ? 'DEVICE' : 'USER',
        actorId: ctx.user.sub,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: json(entry.before),
        after: json(entry.after),
        requestId: ctx.requestId ?? null,
        ip: ctx.ip ?? null,
      },
    });
  }
}
