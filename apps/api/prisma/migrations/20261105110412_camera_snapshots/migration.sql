-- AlterTable
ALTER TABLE "Camera" ADD COLUMN     "snapshotJpeg" BYTEA,
ADD COLUMN     "snapshotRequestedAt" TIMESTAMP(3);
