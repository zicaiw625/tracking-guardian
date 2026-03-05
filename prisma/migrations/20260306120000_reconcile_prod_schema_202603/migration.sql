-- Reconcile production schema drift safely.
-- This migration is intentionally additive/idempotent and avoids destructive drops.

CREATE TABLE IF NOT EXISTS "ExtensionError" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "stack" TEXT,
    "target" TEXT,
    "orderIdHash" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtensionError_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookLog" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "orderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GDPRJob" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "GDPRJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BatchAuditJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BatchAuditJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PixelEventReceipt"
    ADD COLUMN IF NOT EXISTS "checkoutFingerprint" TEXT,
    ADD COLUMN IF NOT EXISTS "trustLevel" TEXT NOT NULL DEFAULT 'untrusted';

CREATE INDEX IF NOT EXISTS "ExtensionError_shopId_idx" ON "ExtensionError"("shopId");
CREATE INDEX IF NOT EXISTS "ExtensionError_shopId_timestamp_idx" ON "ExtensionError"("shopId", "timestamp");
CREATE INDEX IF NOT EXISTS "ExtensionError_createdAt_idx" ON "ExtensionError"("createdAt");

CREATE INDEX IF NOT EXISTS "WebhookLog_shopDomain_idx" ON "WebhookLog"("shopDomain");
CREATE INDEX IF NOT EXISTS "WebhookLog_receivedAt_idx" ON "WebhookLog"("receivedAt");
CREATE INDEX IF NOT EXISTS "WebhookLog_receivedAt_status_idx" ON "WebhookLog"("receivedAt", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookLog_shopDomain_webhookId_topic_key" ON "WebhookLog"("shopDomain", "webhookId", "topic");

CREATE INDEX IF NOT EXISTS "GDPRJob_status_idx" ON "GDPRJob"("status");
CREATE INDEX IF NOT EXISTS "GDPRJob_shopDomain_idx" ON "GDPRJob"("shopDomain");
CREATE INDEX IF NOT EXISTS "GDPRJob_createdAt_idx" ON "GDPRJob"("createdAt");

CREATE INDEX IF NOT EXISTS "BatchAuditJob_shopId_idx" ON "BatchAuditJob"("shopId");
CREATE INDEX IF NOT EXISTS "BatchAuditJob_status_idx" ON "BatchAuditJob"("status");
CREATE INDEX IF NOT EXISTS "BatchAuditJob_createdAt_idx" ON "BatchAuditJob"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExtensionError_shopId_fkey'
  ) THEN
    ALTER TABLE "ExtensionError"
      ADD CONSTRAINT "ExtensionError_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BatchAuditJob_shopId_fkey'
  ) THEN
    ALTER TABLE "BatchAuditJob"
      ADD CONSTRAINT "BatchAuditJob_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'PixelEventReceipt'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%("shopId") REFERENCES "Shop"("id")%'
  ) THEN
    ALTER TABLE "PixelEventReceipt"
      ADD CONSTRAINT "PixelEventReceipt_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('"AppliedRecipe"') IS NOT NULL
     AND to_regclass('"AppliedRecipe__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "AppliedRecipe" RENAME TO "AppliedRecipe__legacy_20260306"';
  END IF;

  IF to_regclass('"PerformanceMetric"') IS NOT NULL
     AND to_regclass('"PerformanceMetric__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "PerformanceMetric" RENAME TO "PerformanceMetric__legacy_20260306"';
  END IF;

  IF to_regclass('"PlatformEnvironment"') IS NOT NULL
     AND to_regclass('"PlatformEnvironment__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "PlatformEnvironment" RENAME TO "PlatformEnvironment__legacy_20260306"';
  END IF;

  IF to_regclass('"RefundSnapshot"') IS NOT NULL
     AND to_regclass('"RefundSnapshot__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "RefundSnapshot" RENAME TO "RefundSnapshot__legacy_20260306"';
  END IF;

  IF to_regclass('"ShopGroup"') IS NOT NULL
     AND to_regclass('"ShopGroup__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "ShopGroup" RENAME TO "ShopGroup__legacy_20260306"';
  END IF;

  IF to_regclass('"ShopGroupMember"') IS NOT NULL
     AND to_regclass('"ShopGroupMember__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "ShopGroupMember" RENAME TO "ShopGroupMember__legacy_20260306"';
  END IF;

  IF to_regclass('"ShopifyOrderSnapshot"') IS NOT NULL
     AND to_regclass('"ShopifyOrderSnapshot__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "ShopifyOrderSnapshot" RENAME TO "ShopifyOrderSnapshot__legacy_20260306"';
  END IF;

  IF to_regclass('"SurveyResponse"') IS NOT NULL
     AND to_regclass('"SurveyResponse__legacy_20260306"') IS NULL THEN
    EXECUTE 'ALTER TABLE "SurveyResponse" RENAME TO "SurveyResponse__legacy_20260306"';
  END IF;
END
$$;
