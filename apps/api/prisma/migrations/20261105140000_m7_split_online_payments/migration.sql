-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "splitPlan" JSONB;

-- AlterTable
ALTER TABLE "OutletSettings" ADD COLUMN     "onlinePaymentsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerOrderId" TEXT,
ADD COLUMN     "providerPaymentId" TEXT,
ADD COLUMN     "shareKey" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

