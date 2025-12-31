-- Add rawSnippetEncrypted column to AuditAsset table
ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "rawSnippetEncrypted" TEXT;

-- Create PerformanceMetric table
CREATE TABLE IF NOT EXISTS "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "metricId" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "rating" TEXT NOT NULL,
    "navigationType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- Create MigrationDraft table
CREATE TABLE IF NOT EXISTS "MigrationDraft" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "configData" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationDraft_pkey" PRIMARY KEY ("id")
);

-- Create indexes for PerformanceMetric
CREATE INDEX IF NOT EXISTS "PerformanceMetric_shopId_idx" ON "PerformanceMetric"("shopId");
CREATE INDEX IF NOT EXISTS "PerformanceMetric_metricName_idx" ON "PerformanceMetric"("metricName");
CREATE INDEX IF NOT EXISTS "PerformanceMetric_timestamp_idx" ON "PerformanceMetric"("timestamp");
CREATE INDEX IF NOT EXISTS "PerformanceMetric_shopId_metricName_timestamp_idx" ON "PerformanceMetric"("shopId", "metricName", "timestamp");

-- Create indexes for MigrationDraft
CREATE UNIQUE INDEX IF NOT EXISTS "MigrationDraft_shopId_key" ON "MigrationDraft"("shopId");
CREATE INDEX IF NOT EXISTS "MigrationDraft_expiresAt_idx" ON "MigrationDraft"("expiresAt");
CREATE INDEX IF NOT EXISTS "MigrationDraft_shopId_updatedAt_idx" ON "MigrationDraft"("shopId", "updatedAt");

-- Add foreign key constraints (only if they don't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PerformanceMetric_shopId_fkey'
    ) THEN
        ALTER TABLE "PerformanceMetric" ADD CONSTRAINT "PerformanceMetric_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MigrationDraft_shopId_fkey'
    ) THEN
        ALTER TABLE "MigrationDraft" ADD CONSTRAINT "MigrationDraft_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

