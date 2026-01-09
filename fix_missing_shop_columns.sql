



DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'shopTier'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "shopTier" TEXT;
        RAISE NOTICE '已添加 shopTier 字段';
    ELSE
        RAISE NOTICE 'shopTier 字段已存在';
    END IF;
END $$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'monthlyOrderLimit'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "monthlyOrderLimit" INTEGER NOT NULL DEFAULT 100;
        RAISE NOTICE '已添加 monthlyOrderLimit 字段';
    ELSE
        RAISE NOTICE 'monthlyOrderLimit 字段已存在';
    END IF;
END $$;


DO $$
BEGIN
    
    UPDATE "Shop" 
    SET "monthlyOrderLimit" = 100 
    WHERE "monthlyOrderLimit" IS NULL;
    
    IF FOUND THEN
        RAISE NOTICE '已更新现有记录的 monthlyOrderLimit 默认值';
    END IF;
END $$;


SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'Shop' 
    AND column_name IN ('shopTier', 'monthlyOrderLimit')
ORDER BY column_name;
