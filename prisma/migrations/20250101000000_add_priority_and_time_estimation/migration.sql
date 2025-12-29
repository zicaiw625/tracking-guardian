-- Add priority, estimatedTimeMinutes, and dependencies fields to AuditAsset
-- 对应设计方案 v1.0 - 迁移清单增强

-- Add priority field (1-10 score)
ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "priority" INTEGER;

-- Add estimatedTimeMinutes field (in minutes)
ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "estimatedTimeMinutes" INTEGER;

-- Add dependencies field (JSON array of AuditAsset IDs)
ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "dependencies" JSONB;

-- Create index for priority (for sorting)
CREATE INDEX IF NOT EXISTS "AuditAsset_priority_idx" ON "AuditAsset"("priority");

-- Create index for estimatedTimeMinutes (for sorting)
CREATE INDEX IF NOT EXISTS "AuditAsset_estimatedTimeMinutes_idx" ON "AuditAsset"("estimatedTimeMinutes");

