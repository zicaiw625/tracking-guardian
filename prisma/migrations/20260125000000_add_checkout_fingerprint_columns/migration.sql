ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "checkoutFingerprint" TEXT;
ALTER TABLE "ConversionJob" ADD COLUMN IF NOT EXISTS "webhookCheckoutFingerprint" TEXT;
