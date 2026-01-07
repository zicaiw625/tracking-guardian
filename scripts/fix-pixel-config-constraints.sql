

DO $$
BEGIN

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        ALTER TABLE "PixelConfig" DROP CONSTRAINT "PixelConfig_shopId_platform_environment_key";
        RAISE NOTICE '已删除旧约束: PixelConfig_shopId_platform_environment_key';
    ELSE
        RAISE NOTICE '旧约束不存在（可能已删除）';
    END IF;

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

DO $$
BEGIN

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        RAISE NOTICE '新约束已存在（作为约束）';

    ELSIF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        RAISE NOTICE '新约束已存在（作为索引）';
    ELSE

        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_platformId_key"
        ON "PixelConfig"("shopId", "platform", "environment", "platformId");
        RAISE NOTICE '已创建新约束: PixelConfig_shopId_platform_environment_platformId_key';
    END IF;
END $$;

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

