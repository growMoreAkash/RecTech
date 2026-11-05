import { Prisma } from '@prisma/client';
import { PRISMA_ENUMS } from '@dinesense/shared';
import { describe, expect, it } from 'vitest';
import { TENANT_MODELS } from './tenant';

describe('schema ↔ shared contract', () => {
  const dbEnums = Object.fromEntries(
    Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)]),
  );

  it('every Prisma enum is mirrored in @dinesense/shared with identical values', () => {
    expect(Object.keys(dbEnums).sort()).toEqual(Object.keys(PRISMA_ENUMS).sort());
    for (const [name, values] of Object.entries(PRISMA_ENUMS)) {
      expect(dbEnums[name], name).toEqual([...values]);
    }
  });

  it('every model with outletId also carries organizationId (tenant scoping)', () => {
    const missing = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'outletId'))
      .filter((m) => !TENANT_MODELS.has(m.name))
      .map((m) => m.name);
    // Internal bookkeeping rows, only ever touched by services that already scoped the outlet.
    expect(missing.sort()).toEqual(['InvoiceSequence', 'RoundRobinCursor', 'UserOutletRole']);
  });
});
