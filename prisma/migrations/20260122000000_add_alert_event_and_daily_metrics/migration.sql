CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyAggregatedMetrics" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(12,2) NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL,
    "platformBreakdown" JSONB NOT NULL,
    "eventVolume" INTEGER NOT NULL DEFAULT 0,
    "missingParamsRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAggregatedMetrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertEvent_shopId_fingerprint_sentAt_key" ON "AlertEvent"("shopId", "fingerprint", "sentAt");

CREATE INDEX "AlertEvent_shopId_sentAt_idx" ON "AlertEvent"("shopId", "sentAt");

CREATE INDEX "AlertEvent_shopId_alertType_sentAt_idx" ON "AlertEvent"("shopId", "alertType", "sentAt");

CREATE INDEX "AlertEvent_fingerprint_idx" ON "AlertEvent"("fingerprint");

CREATE UNIQUE INDEX "DailyAggregatedMetrics_shopId_date_key" ON "DailyAggregatedMetrics"("shopId", "date");

CREATE INDEX "DailyAggregatedMetrics_shopId_date_idx" ON "DailyAggregatedMetrics"("shopId", "date");

CREATE INDEX "DailyAggregatedMetrics_date_idx" ON "DailyAggregatedMetrics"("date");

ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyAggregatedMetrics" ADD CONSTRAINT "DailyAggregatedMetrics_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
