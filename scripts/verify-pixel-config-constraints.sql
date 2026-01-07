

SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'PixelConfig_shopId_platform_environment_key'
        ) THEN '❌ 旧约束仍存在，需要删除'
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE indexname = 'PixelConfig_shopId_platform_environment_key'
        ) THEN '❌ 旧索引仍存在，需要删除'
        ELSE '✅ 旧约束已移除'
    END AS old_constraint_status;

SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
        ) THEN '✅ 新约束存在（作为约束）'
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE indexname = 'PixelConfig_shopId_platform_environment_platformId_key'
        ) THEN '✅ 新约束存在（作为索引）'
        ELSE '❌ 新约束不存在，需要创建'
    END AS new_constraint_status;

SELECT
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'PixelConfig'::regclass
    AND contype = 'u'
ORDER BY conname;

SELECT
    indexname AS index_name,
    indexdef AS definition
FROM pg_indexes
WHERE tablename = 'PixelConfig'
    AND indexname LIKE '%unique%' OR indexname LIKE '%key'
ORDER BY indexname;

