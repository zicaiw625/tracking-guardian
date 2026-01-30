ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "platform" TEXT;

UPDATE "PixelEventReceipt"
SET "platform" = COALESCE(
  "payloadJson"->>'platform',
  "payloadJson"->>'destination',
  'unknown'
)
WHERE "payloadJson" IS NOT NULL;

UPDATE "PixelEventReceipt" SET "platform" = 'unknown' WHERE "platform" IS NULL;

ALTER TABLE "PixelEventReceipt" ALTER COLUMN "platform" SET DEFAULT 'unknown';
ALTER TABLE "PixelEventReceipt" ALTER COLUMN "platform" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PixelEventReceipt_shopId_eventId_eventType_key'
  ) THEN
    ALTER TABLE "PixelEventReceipt" DROP CONSTRAINT "PixelEventReceipt_shopId_eventId_eventType_key";
  END IF;
END $$;

DROP INDEX IF EXISTS "PixelEventReceipt_shopId_eventId_eventType_key";

ALTER TABLE "PixelEventReceipt" ADD CONSTRAINT "PixelEventReceipt_shopId_eventId_eventType_platform_key"
  UNIQUE ("shopId", "eventId", "eventType", "platform");

CREATE INDEX IF NOT EXISTS "PixelEventReceipt_platform_idx" ON "PixelEventReceipt"("platform");
