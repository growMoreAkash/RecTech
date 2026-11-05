-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'SEATED', 'LEFT', 'REMOVED');

-- AlterTable
ALTER TABLE "Camera" ADD COLUMN     "doorPolygon" JSONB;

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "OutletSettings" ADD COLUMN     "bookingReminderMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "waitlistEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waitlistHoldMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "waitlistMaxPartySize" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "toPhone" TEXT,
    "template" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "quotedMinutes" INTEGER,
    "notifiedAt" TIMESTAMP(3),
    "notifiedTableIds" TEXT[],
    "holdUntil" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "seatingId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoorArrival" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "suggestedTableIds" TEXT[],
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoorArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_dedupeKey_key" ON "MessageLog"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_providerMessageId_key" ON "MessageLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "MessageLog_status_nextAttemptAt_idx" ON "MessageLog"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MessageLog_entityType_entityId_idx" ON "MessageLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "MessageLog_guestId_idx" ON "MessageLog"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_seatingId_key" ON "WaitlistEntry"("seatingId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_outletId_status_createdAt_idx" ON "WaitlistEntry"("outletId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DoorArrival_outletId_at_idx" ON "DoorArrival"("outletId", "at");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorArrival" ADD CONSTRAINT "DoorArrival_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

