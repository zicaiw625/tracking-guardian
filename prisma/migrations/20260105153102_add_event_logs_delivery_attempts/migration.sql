

DROP TABLE IF EXISTS "EventLog" CASCADE;

CREATE TABLE "EventLog" (
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

CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "eventLogId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'live',
    "requestPayloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "responseStatus" INTEGER,
    "responseBodySnippet" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventLog_shopId_createdAt_idx" ON "EventLog"("shopId", "createdAt");
CREATE INDEX "EventLog_shopId_eventName_createdAt_idx" ON "EventLog"("shopId", "eventName", "createdAt");
CREATE INDEX "EventLog_eventId_idx" ON "EventLog"("eventId");
CREATE INDEX "EventLog_occurredAt_idx" ON "EventLog"("occurredAt");

CREATE INDEX "DeliveryAttempt_shopId_createdAt_idx" ON "DeliveryAttempt"("shopId", "createdAt");
CREATE INDEX "DeliveryAttempt_shopId_destinationType_createdAt_idx" ON "DeliveryAttempt"("shopId", "destinationType", "createdAt");
CREATE INDEX "DeliveryAttempt_shopId_status_createdAt_idx" ON "DeliveryAttempt"("shopId", "status", "createdAt");
CREATE INDEX "DeliveryAttempt_eventLogId_idx" ON "DeliveryAttempt"("eventLogId");
CREATE INDEX "DeliveryAttempt_createdAt_idx" ON "DeliveryAttempt"("createdAt");

CREATE UNIQUE INDEX "EventLog_shopId_eventId_key" ON "EventLog"("shopId", "eventId");
CREATE UNIQUE INDEX "DeliveryAttempt_shopId_eventLogId_destinationType_environment_key" ON "DeliveryAttempt"("shopId", "eventLogId", "destinationType", "environment");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EventLog_shopId_fkey'
    ) THEN
        ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryAttempt_eventLogId_fkey'
    ) THEN
        ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_eventLogId_fkey"
            FOREIGN KEY ("eventLogId") REFERENCES "EventLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryAttempt_shopId_fkey'
    ) THEN
        ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

