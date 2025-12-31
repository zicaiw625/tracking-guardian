

ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "priority" INTEGER;

ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "estimatedTimeMinutes" INTEGER;

ALTER TABLE "AuditAsset" ADD COLUMN IF NOT EXISTS "dependencies" JSONB;

CREATE INDEX IF NOT EXISTS "AuditAsset_priority_idx" ON "AuditAsset"("priority");

CREATE INDEX IF NOT EXISTS "AuditAsset_estimatedTimeMinutes_idx" ON "AuditAsset"("estimatedTimeMinutes");

SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'AuditAsset'
    AND column_name IN ('priority', 'estimatedTimeMinutes', 'dependencies')
ORDER BY column_name;

