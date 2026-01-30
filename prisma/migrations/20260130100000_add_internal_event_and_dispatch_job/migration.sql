CREATE TABLE "InternalEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "client_id" TEXT,
    "timestamp" BIGINT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "page_url" TEXT,
    "referrer" TEXT,
    "querystring" TEXT,
    "currency" TEXT,
    "value" DECIMAL(12,2) NOT NULL,
    "transaction_id" TEXT,
    "items" JSONB,
    "user_data_hashed" JSONB,
    "consent_purposes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalEvent_shopId_event_id_event_name_key" ON "InternalEvent"("shopId", "event_id", "event_name");

CREATE INDEX "InternalEvent_shopId_idx" ON "InternalEvent"("shopId");

CREATE INDEX "InternalEvent_shopId_occurred_at_idx" ON "InternalEvent"("shopId", "occurred_at");

CREATE INDEX "InternalEvent_shopId_source_idx" ON "InternalEvent"("shopId", "source");

ALTER TABLE "InternalEvent" ADD CONSTRAINT "InternalEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventDispatchJob" (
    "id" TEXT NOT NULL,
    "internal_event_id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "last_response_code" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDispatchJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventDispatchJob_internal_event_id_destination_key" ON "EventDispatchJob"("internal_event_id", "destination");

CREATE INDEX "EventDispatchJob_status_next_retry_at_idx" ON "EventDispatchJob"("status", "next_retry_at");

ALTER TABLE "EventDispatchJob" ADD CONSTRAINT "EventDispatchJob_internal_event_id_fkey" FOREIGN KEY ("internal_event_id") REFERENCES "InternalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
