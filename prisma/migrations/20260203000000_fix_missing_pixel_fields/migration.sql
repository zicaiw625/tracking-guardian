-- Add missing columns to PixelEventReceipt
ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "hmacMatched" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "totalValue" DECIMAL(12,2);
ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "currency" TEXT;

-- Add index for hmacMatched
CREATE INDEX IF NOT EXISTS "PixelEventReceipt_shopId_createdAt_hmacMatched_idx" ON "PixelEventReceipt"("shopId", "createdAt", "hmacMatched");
