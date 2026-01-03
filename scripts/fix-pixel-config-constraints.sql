-- P0-3: 手动修复 PixelConfig 约束（如果迁移未完全生效）
-- 使用方法：在数据库管理工具中执行此脚本，或通过 psql 连接执行

-- 1. 删除旧的唯一约束（如果存在）
DO $$
BEGIN
    -- 删除作为约束的旧唯一约束
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        ALTER TABLE "PixelConfig" DROP CONSTRAINT "PixelConfig_shopId_platform_environment_key";
        RAISE NOTICE '已删除旧约束: PixelConfig_shopId_platform_environment_key';
    ELSE
        RAISE NOTICE '旧约束不存在（可能已删除）';
    END IF;
    
    -- 删除作为索引的旧唯一约束
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        DROP INDEX IF EXISTS "PixelConfig_shopId_platform_environment_key";
        RAISE NOTICE '已删除旧索引: PixelConfig_shopId_platform_environment_key';
    ELSE
        RAISE NOTICE '旧索引不存在（可能已删除）';
    END IF;
END $$;

-- 2. 确保新的唯一约束存在
DO $$
BEGIN
    -- 检查是否作为约束存在
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        RAISE NOTICE '新约束已存在（作为约束）';
    -- 检查是否作为索引存在
    ELSIF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        RAISE NOTICE '新约束已存在（作为索引）';
    ELSE
        -- 创建新的唯一约束
        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_platformId_key" 
        ON "PixelConfig"("shopId", "platform", "environment", "platformId");
        RAISE NOTICE '已创建新约束: PixelConfig_shopId_platform_environment_platformId_key';
    END IF;
END $$;

-- 3. 验证最终状态
SELECT 
    '约束状态验证' AS check_type,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'PixelConfig_shopId_platform_environment_key'
        ) OR EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE indexname = 'PixelConfig_shopId_platform_environment_key'
        ) THEN '❌ 旧约束仍存在'
        ELSE '✅ 旧约束已移除'
    END AS old_constraint_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
        ) OR EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE indexname = 'PixelConfig_shopId_platform_environment_platformId_key'
        ) THEN '✅ 新约束存在'
        ELSE '❌ 新约束不存在'
    END AS new_constraint_status;

