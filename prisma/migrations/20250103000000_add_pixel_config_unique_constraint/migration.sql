-- 添加 displayName 和 priority 字段（如果不存在）
ALTER TABLE "PixelConfig" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "PixelConfig" ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 0;

-- 添加向后兼容的唯一约束 shopId_platform_environment（如果不存在）
-- 注意：此约束与 shopId_platform_environment_platformId 约束有重叠，但允许这种情况
-- 用于支持不支持 platformId 的旧代码路径
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_key" 
        ON "PixelConfig"("shopId", "platform", "environment");
    END IF;
END $$;

-- 确保 shopId_platform_environment_platformId 唯一约束存在（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_platformId_key" 
        ON "PixelConfig"("shopId", "platform", "environment", "platformId");
    END IF;
END $$;

-- 添加 priority 索引（如果不存在）
CREATE INDEX IF NOT EXISTS "PixelConfig_priority_idx" ON "PixelConfig"("priority");

