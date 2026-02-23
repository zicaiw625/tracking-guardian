-- AlterTable
ALTER TABLE "PixelEventReceipt" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'live';

-- CreateIndex
CREATE INDEX "PixelEventReceipt_environment_idx" ON "PixelEventReceipt"("environment");
