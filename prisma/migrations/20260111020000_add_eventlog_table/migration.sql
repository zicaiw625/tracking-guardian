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
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventLog_shopId_fkey') THEN
        ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
