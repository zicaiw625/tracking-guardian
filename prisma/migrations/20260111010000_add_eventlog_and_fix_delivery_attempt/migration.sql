CREATE TABLE IF NOT EXISTS "EventLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web_pixel',
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "shopifyContextJson" JSONB,
    "normalizedEventJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventLog_shopId_eventId_key" ON "EventLog"("shopId", "eventId");
CREATE INDEX IF NOT EXISTS "EventLog_shopId_idx" ON "EventLog"("shopId");
CREATE INDEX IF NOT EXISTS "EventLog_shopId_createdAt_idx" ON "EventLog"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "EventLog_shopId_eventName_createdAt_idx" ON "EventLog"("shopId", "eventName", "createdAt");
CREATE INDEX IF NOT EXISTS "EventLog_eventId_idx" ON "EventLog"("eventId");
CREATE INDEX IF NOT EXISTS "EventLog_occurredAt_idx" ON "EventLog"("occurredAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EventLog_shopId_fkey'
    ) THEN
        ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "DeliveryAttempt" 
    ADD COLUMN IF NOT EXISTS "destinationType" TEXT,
    ADD COLUMN IF NOT EXISTS "environment" TEXT DEFAULT 'live',
    ADD COLUMN IF NOT EXISTS "eventLogId" TEXT,
    ADD COLUMN IF NOT EXISTS "requestPayloadJson" JSONB,
    ADD COLUMN IF NOT EXISTS "responseBodySnippet" TEXT,
    ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'pending';

UPDATE "DeliveryAttempt" 
SET "destinationType" = COALESCE("platform", 'unknown'),
    "environment" = COALESCE("environment", 'live'),
    "status" = CASE WHEN "ok" = true THEN 'ok' ELSE 'fail' END,
    "requestPayloadJson" = '{}'::jsonb
WHERE "destinationType" IS NULL;

ALTER TABLE "DeliveryAttempt"
    ALTER COLUMN "destinationType" SET NOT NULL,
    ALTER COLUMN "environment" SET NOT NULL,
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "requestPayloadJson" SET NOT NULL;

ALTER TABLE "DeliveryAttempt"
    ALTER COLUMN "platform" DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryAttempt_eventLogId_fkey'
    ) THEN
        ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_eventLogId_fkey"
            FOREIGN KEY ("eventLogId") REFERENCES "EventLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DROP INDEX IF EXISTS "DeliveryAttempt_shopId_eventLogId_destinationType_environment_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryAttempt_shopId_eventLogId_destinationType_environment_key" 
    ON "DeliveryAttempt"("shopId", "eventLogId", "destinationType", "environment")
    WHERE "eventLogId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "DeliveryAttempt_eventLogId_idx" ON "DeliveryAttempt"("eventLogId");
CREATE INDEX IF NOT EXISTS "DeliveryAttempt_shopId_destinationType_createdAt_idx" ON "DeliveryAttempt"("shopId", "destinationType", "createdAt");
CREATE INDEX IF NOT EXISTS "DeliveryAttempt_shopId_status_createdAt_idx" ON "DeliveryAttempt"("shopId", "status", "createdAt");
