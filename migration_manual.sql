-- 手动执行数据库迁移脚本
-- 对应设计方案 v1.0 - 迁移清单增强
-- 执行方式：在 PostgreSQL 客户端中直接执行此 SQL 文件

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

-- 验证迁移结果
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'AuditAsset' 
    AND column_name IN ('priority', 'estimatedTimeMinutes', 'dependencies')
ORDER BY column_name;

