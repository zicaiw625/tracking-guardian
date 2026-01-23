DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'PixelConfig' AND column_name = 'previousConfig'
    ) THEN
        ALTER TABLE "PixelConfig" ADD COLUMN "previousConfig" JSONB;
        RAISE NOTICE '已添加 previousConfig 字段';
    ELSE
        RAISE NOTICE 'previousConfig 字段已存在';
    END IF;
END $$;
