-- 验证 PixelConfig 约束状态
-- 此脚本用于检查并确保约束状态正确

-- 1. 检查旧的唯一约束是否存在（应该不存在）
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

-- 2. 检查新的唯一约束是否存在（应该存在）
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

-- 3. 列出所有 PixelConfig 相关的唯一约束和索引
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

