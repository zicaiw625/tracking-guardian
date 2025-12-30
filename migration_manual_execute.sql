-- ============================================================
-- 手动执行迁移脚本
-- 对应设计方案 v1.0 - 迁移清单增强
-- 
-- 执行方式：
-- 1. 在 Render PostgreSQL 控制台执行
-- 2. 或使用 psql 命令行工具
-- 3. 或使用数据库管理工具（如 pgAdmin、DBeaver）
-- ============================================================

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

-- 验证迁移
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'AuditAsset' 
    AND column_name IN ('priority', 'estimatedTimeMinutes', 'dependencies')
ORDER BY column_name;




