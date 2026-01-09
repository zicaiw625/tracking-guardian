-- 添加缺失的 Shop 表字段

-- 添加 shopTier 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'shopTier'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "shopTier" TEXT;
    END IF;
END $$;

-- 添加 monthlyOrderLimit 字段（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'monthlyOrderLimit'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "monthlyOrderLimit" INTEGER NOT NULL DEFAULT 100;
    END IF;
END $$;

-- 为现有记录设置默认值（如果字段刚刚添加且允许NULL）
DO $$
BEGIN
    -- 确保所有记录的 monthlyOrderLimit 都有值
    UPDATE "Shop" 
    SET "monthlyOrderLimit" = 100 
    WHERE "monthlyOrderLimit" IS NULL;
END $$;
