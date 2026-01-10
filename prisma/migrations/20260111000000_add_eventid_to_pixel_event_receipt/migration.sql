ALTER TABLE "PixelEventReceipt" ADD COLUMN IF NOT EXISTS "eventId" TEXT;

UPDATE "PixelEventReceipt"
SET "eventId" = COALESCE(
  "orderKey",
  "id",
  'event_' || "shopId" || '_' || "eventType" || '_' || EXTRACT(EPOCH FROM "pixelTimestamp")::BIGINT::TEXT
)
WHERE "eventId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PixelEventReceipt" WHERE "eventId" IS NULL) THEN
    RAISE EXCEPTION '无法为所有记录生成 eventId，请检查数据完整性';
  END IF;
END $$;

ALTER TABLE "PixelEventReceipt" ALTER COLUMN "eventId" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PixelEventReceipt_shopId_eventId_eventType_key'
  ) THEN
    ALTER TABLE "PixelEventReceipt" DROP CONSTRAINT IF EXISTS "PixelEventReceipt_shopId_eventId_eventType_key";
  END IF;
END $$;

DROP INDEX IF EXISTS "PixelEventReceipt_shopId_eventId_eventType_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PixelEventReceipt_shopId_eventId_eventType_key'
  ) THEN
    ALTER TABLE "PixelEventReceipt" ADD CONSTRAINT "PixelEventReceipt_shopId_eventId_eventType_key" 
      UNIQUE ("shopId", "eventId", "eventType");
  END IF;
END $$;

DROP INDEX IF EXISTS "PixelEventReceipt_eventId_idx";
CREATE INDEX IF NOT EXISTS "PixelEventReceipt_eventId_idx" ON "PixelEventReceipt"("eventId");
