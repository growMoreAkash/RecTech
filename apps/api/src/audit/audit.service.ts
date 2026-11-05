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

/** Who did it. Staff requests use `fromContext`; jobs and edge devices build one directly. */
export interface AuditActor {
  organizationId: string;
  type: 'USER' | 'DEVICE' | 'SYSTEM' | 'GUEST';
  id?: string;
  requestId?: string;
  ip?: string;
}

export const actorFromContext = (ctx: RequestContext): AuditActor => ({
  organizationId: ctx.user.org,
  type: ctx.user.deviceId ? 'DEVICE' : 'USER',
  id: ctx.user.sub,
  requestId: ctx.requestId,
  ip: ctx.ip,
});

const json = (v: unknown) =>
  v === undefined
    ? undefined
    : v === null
      ? Prisma.JsonNull
      : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Append-only audit trail. Call it inside the same transaction as the change it records,
 * so a change can never commit without its audit row.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(ctx: RequestContext, entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    return this.recordAs(actorFromContext(ctx), entry, tx);
  }

  async recordAs(actor: AuditActor, entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        outletId: entry.outletId ?? null,
        actorType: actor.type,
        actorId: actor.id ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: json(entry.before),
        after: json(entry.after),
        requestId: actor.requestId ?? null,
        ip: actor.ip ?? null,
      },
    });
  }
}
