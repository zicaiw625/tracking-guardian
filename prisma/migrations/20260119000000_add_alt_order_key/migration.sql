ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "altOrderKey" TEXT;
CREATE INDEX IF NOT EXISTS "PixelEventReceipt_altOrderKey_idx" ON "PixelEventReceipt"("altOrderKey");
