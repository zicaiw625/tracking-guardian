DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'shopTierLastCheckedAt'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "shopTierLastCheckedAt" TIMESTAMP(3);
        RAISE NOTICE '已添加 shopTierLastCheckedAt 字段';
    ELSE
        RAISE NOTICE 'shopTierLastCheckedAt 字段已存在';
    END IF;
END $$;
