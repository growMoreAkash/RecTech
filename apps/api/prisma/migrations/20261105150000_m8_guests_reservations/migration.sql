-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ReservationChannel" AS ENUM ('ONLINE', 'STAFF');

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "birthday" TEXT,
ADD COLUMN     "favourites" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "lastVisitAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "totalSpendPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "visits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "guestRetentionDays" INTEGER NOT NULL DEFAULT 730;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "slug" TEXT;
-- Backfill: readable name + short id suffix (unique), e.g. "spice-route-indiranagar-x7k2q9".
UPDATE "Outlet" SET "slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || lower(right("id", 6));
ALTER TABLE "Outlet" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable
ALTER TABLE "OutletSettings" ADD COLUMN     "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bookingHorizonDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "bookingLastSeatingMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "bookingLeadMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "bookingMaxCoversPerSlot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bookingMaxPartySize" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "bookingSlotMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "noShowGraceMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "reservationHoldMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "turnLargeMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "turnMediumMinutes" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "turnSmallMinutes" INTEGER NOT NULL DEFAULT 75;

-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "onlineBookable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "GuestConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletHours" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opens" TEXT NOT NULL,
    "closes" TEXT NOT NULL,

    CONSTRAINT "OutletHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "channel" "ReservationChannel" NOT NULL,
    "tableIds" TEXT[],
    "sectionId" TEXT,
    "notes" TEXT,
    "heldAt" TIMESTAMP(3),
    "holdAlertAt" TIMESTAMP(3),
    "seatingId" TEXT,
    "seatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "noShowAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestConsent_guestId_purpose_createdAt_idx" ON "GuestConsent"("guestId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "OutletHours_outletId_idx" ON "OutletHours"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_seatingId_key" ON "Reservation"("seatingId");

-- CreateIndex
CREATE INDEX "Reservation_outletId_startsAt_idx" ON "Reservation"("outletId", "startsAt");

-- CreateIndex
CREATE INDEX "Reservation_guestId_idx" ON "Reservation"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_slug_key" ON "Outlet"("slug");

-- AddForeignKey
ALTER TABLE "GuestConsent" ADD CONSTRAINT "GuestConsent_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletHours" ADD CONSTRAINT "OutletHours_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

