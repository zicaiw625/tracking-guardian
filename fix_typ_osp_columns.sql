-- 快速修复：添加缺失的 typOsp 相关字段到 Shop 表
-- 此脚本可以立即执行以修复数据库结构问题

-- 添加 typOspPagesEnabled 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'typOspPagesEnabled'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "typOspPagesEnabled" BOOLEAN;
        RAISE NOTICE '已添加 typOspPagesEnabled 字段';
    ELSE
        RAISE NOTICE 'typOspPagesEnabled 字段已存在';
    END IF;
END $$;

-- 添加 typOspUpdatedAt 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'typOspUpdatedAt'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "typOspUpdatedAt" TIMESTAMP(3);
        RAISE NOTICE '已添加 typOspUpdatedAt 字段';
    ELSE
        RAISE NOTICE 'typOspUpdatedAt 字段已存在';
    END IF;
END $$;

-- 添加 typOspLastCheckedAt 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'typOspLastCheckedAt'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "typOspLastCheckedAt" TIMESTAMP(3);
        RAISE NOTICE '已添加 typOspLastCheckedAt 字段';
    ELSE
        RAISE NOTICE 'typOspLastCheckedAt 字段已存在';
    END IF;
END $$;

-- 添加 typOspDetectedAt 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'typOspDetectedAt'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "typOspDetectedAt" TIMESTAMP(3);
        RAISE NOTICE '已添加 typOspDetectedAt 字段';
    ELSE
        RAISE NOTICE 'typOspDetectedAt 字段已存在';
    END IF;
END $$;

-- 添加 typOspStatusReason 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'typOspStatusReason'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "typOspStatusReason" TEXT;
        RAISE NOTICE '已添加 typOspStatusReason 字段';
    ELSE
        RAISE NOTICE 'typOspStatusReason 字段已存在';
    END IF;
END $$;

-- 验证字段是否已正确添加
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'Shop' 
    AND column_name IN ('typOspPagesEnabled', 'typOspUpdatedAt', 'typOspLastCheckedAt', 'typOspDetectedAt', 'typOspStatusReason')
ORDER BY column_name;
