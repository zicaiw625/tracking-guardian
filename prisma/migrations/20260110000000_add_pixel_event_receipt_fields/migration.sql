ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "payloadJson" JSONB;
ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "orderKey" TEXT;

CREATE INDEX IF NOT EXISTS "PixelEventReceipt_orderKey_idx" ON "PixelEventReceipt"("orderKey");
