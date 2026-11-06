-- CreateEnum
CREATE TYPE "Course" AS ENUM ('DRINK', 'STARTER', 'MAIN', 'DESSERT', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('MID_MEAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'IDLE_TABLE';
ALTER TYPE "AlertType" ADD VALUE 'GUEST_UNHAPPY';

-- AlterEnum
ALTER TYPE "OrderItemStatus" ADD VALUE 'HELD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskType" ADD VALUE 'CHECK_TABLE';
ALTER TYPE "TaskType" ADD VALUE 'FIRE_COURSE';
ALTER TYPE "TaskType" ADD VALUE 'OFFER_DESSERT';
ALTER TYPE "TaskType" ADD VALUE 'SERVICE_RECOVERY';

-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN     "course" "Course" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "course" "Course" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "etaReadyAt" TIMESTAMP(3),
ADD COLUMN     "firedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OutletSettings" ADD COLUMN     "autoFireMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "dessertOfferMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "dirtyConfirmSeconds" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "fireMainsAfterMinutes" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "idleAlertMinutes" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "idleNudgeMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "midMealCheckMinutes" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "pacingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tipPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tipWaiterId" TEXT;

-- AlterTable
ALTER TABLE "Seating" ADD COLUMN     "dessertOfferAt" TIMESTAMP(3),
ADD COLUMN     "fireMainsPromptAt" TIMESTAMP(3),
ADD COLUMN     "idleAlertedAt" TIMESTAMP(3),
ADD COLUMN     "idleNudgedAt" TIMESTAMP(3),
ADD COLUMN     "lastStaffTouchAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "seatingId" TEXT NOT NULL,
    "guestSessionId" TEXT,
    "kind" "FeedbackKind" NOT NULL DEFAULT 'MID_MEAL',
    "positive" BOOLEAN NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_outletId_createdAt_idx" ON "Feedback"("outletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_seatingId_guestSessionId_kind_key" ON "Feedback"("seatingId", "guestSessionId", "kind");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_seatingId_fkey" FOREIGN KEY ("seatingId") REFERENCES "Seating"("id") ON DELETE CASCADE ON UPDATE CASCADE;

