import { Prisma, type PrismaClient } from '@prisma/client';

/** Models that carry an organizationId column (derived from the schema, so new models are covered automatically). */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'organizationId'))
    .map((m) => m.name),
);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

export class TenantViolationError extends Error {
  constructor(model: string, op: string) {
    super(`Tenant violation: ${model}.${op} tried to write a row for another organization`);
  }
}

type Args = { where?: Record<string, unknown>; data?: unknown; create?: unknown };

function assertData(data: unknown, organizationId: string, model: string, op: string): void {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    const org = (row as Record<string, unknown> | undefined)?.organizationId;
    if (org !== organizationId) throw new TenantViolationError(model, op);
  }
}

/**
 * Returns a Prisma client whose queries on tenant models are always scoped to one organization.
 * Reads/updates/deletes get `organizationId` added to `where`; creates must carry the same organizationId.
 * Relies on Prisma's extended unique where (findUnique/update/delete accept extra non-unique filters).
 */
export function scopedClient(client: PrismaClient, organizationId: string) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as Args;
          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), organizationId };
          } else if (
            operation === 'create' ||
            operation === 'createMany' ||
            operation === 'createManyAndReturn'
          ) {
            assertData(a.data, organizationId, model, operation);
          } else if (operation === 'upsert') {
            a.where = { ...(a.where ?? {}), organizationId };
            assertData(a.create, organizationId, model, operation);
          }
          return query(a);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof scopedClient>;
