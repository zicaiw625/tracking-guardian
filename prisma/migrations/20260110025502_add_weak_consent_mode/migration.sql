
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'weakConsentMode'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "weakConsentMode" BOOLEAN NOT NULL DEFAULT false;
        RAISE NOTICE '已添加 weakConsentMode 字段';
    ELSE
        RAISE NOTICE 'weakConsentMode 字段已存在';
    END IF;
END $$;
