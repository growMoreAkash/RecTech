-- Tenant scoping: every outlet-scoped row carries organizationId.
ALTER TABLE "OutletHours" ADD COLUMN "organizationId" TEXT;
UPDATE "OutletHours" h SET "organizationId" = o."organizationId" FROM "Outlet" o WHERE o."id" = h."outletId";
ALTER TABLE "OutletHours" ALTER COLUMN "organizationId" SET NOT NULL;
