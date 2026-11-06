-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "serviceChargeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxBreakup" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "taxablePaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BillLine" ADD COLUMN     "discountPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceChargeCgstPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceChargePaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceChargeSgstPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "BillLine_orderItemId_idx" ON "BillLine"("orderItemId");

-- A bill can never go negative, and an invoice number is unique per outlet (already enforced by @@unique).
ALTER TABLE "Bill" ADD CONSTRAINT "bill_amounts_nonneg" CHECK ("totalPaise" >= 0 AND "discountPaise" >= 0 AND "serviceChargePaise" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_pos" CHECK ("amountPaise" > 0);
