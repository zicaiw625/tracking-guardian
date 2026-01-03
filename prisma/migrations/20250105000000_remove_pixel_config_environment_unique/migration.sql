-- P0-3: 移除 PixelConfig 的 shopId_platform_environment 唯一约束
-- 以支持同一平台多个目的地配置（通过 platformId 区分）
-- 
-- 保留 shopId_platform_environment_platformId 唯一约束，该约束允许：
-- - 如果 platformId 为 null：同一店铺、同一平台、同一环境只能有 1 个配置（向后兼容）
-- - 如果 platformId 不为 null：同一店铺、同一平台、同一环境可以有多个配置（通过不同的 platformId 区分）
--
-- 例如：同一店铺可以配置多个 GA4 property（platformId = "G-XXXXX"）、多个 Meta Pixel（platformId = "123456789"）

DO $$
BEGIN
    -- 删除 shopId_platform_environment 唯一约束（如果存在）
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        ALTER TABLE "PixelConfig" DROP CONSTRAINT "PixelConfig_shopId_platform_environment_key";
    END IF;
    
    -- 如果约束是作为索引存在的，也删除索引
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        DROP INDEX IF EXISTS "PixelConfig_shopId_platform_environment_key";
    END IF;
END $$;

-- 确保 shopId_platform_environment_platformId 唯一约束存在（如果不存在）
-- 注意：可能作为约束或索引存在，需要检查两种情况
DO $$
BEGIN
    -- 检查是否作为约束存在
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) AND NOT EXISTS (
        -- 检查是否作为索引存在
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_platformId_key" 
        ON "PixelConfig"("shopId", "platform", "environment", "platformId");
    END IF;
END $$;

-- 注释说明
COMMENT ON INDEX "PixelConfig_shopId_platform_environment_platformId_key" IS 
'P0-3: 支持同一平台多个目的地配置的唯一约束。如果 platformId 为 null，同一店铺、同一平台、同一环境只能有 1 个配置；如果 platformId 不为 null，可以有多个配置（通过不同的 platformId 区分）';

