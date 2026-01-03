-- 移除 PixelConfig 的 shopId_platform 唯一约束，以支持同一平台多个配置
-- 保留 shopId_platform_environment 和 shopId_platform_environment_platformId 唯一约束

-- 检查并删除旧的唯一约束
DO $$
BEGIN
    -- 删除 shopId_platform 唯一约束（如果存在）
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'PixelConfig_shopId_platform_key'
    ) THEN
        ALTER TABLE "PixelConfig" DROP CONSTRAINT "PixelConfig_shopId_platform_key";
    END IF;
    
    -- 如果约束是作为索引存在的，也删除索引
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'PixelConfig_shopId_platform_key'
    ) THEN
        DROP INDEX IF EXISTS "PixelConfig_shopId_platform_key";
    END IF;
END $$;

-- 确保 shopId_platform 索引存在（用于查询优化，但不是唯一约束）
CREATE INDEX IF NOT EXISTS "PixelConfig_shopId_platform_idx" ON "PixelConfig"("shopId", "platform");

-- 注释说明
COMMENT ON INDEX "PixelConfig_shopId_platform_idx" IS '支持同一平台多个配置的查询优化索引（非唯一约束）';

