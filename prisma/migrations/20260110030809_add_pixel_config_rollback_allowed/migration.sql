-- Add missing columns to PixelConfig table
DO $$
BEGIN
    -- Add rollbackAllowed column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'PixelConfig' AND column_name = 'rollbackAllowed'
    ) THEN
        ALTER TABLE "PixelConfig" ADD COLUMN "rollbackAllowed" BOOLEAN NOT NULL DEFAULT true;
        RAISE NOTICE '已添加 rollbackAllowed 字段';
    ELSE
        RAISE NOTICE 'rollbackAllowed 字段已存在';
    END IF;

    -- Add displayName column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'PixelConfig' AND column_name = 'displayName'
    ) THEN
        ALTER TABLE "PixelConfig" ADD COLUMN "displayName" TEXT;
        RAISE NOTICE '已添加 displayName 字段';
    ELSE
        RAISE NOTICE 'displayName 字段已存在';
    END IF;

    -- Add priority column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'PixelConfig' AND column_name = 'priority'
    ) THEN
        ALTER TABLE "PixelConfig" ADD COLUMN "priority" INTEGER DEFAULT 0;
        RAISE NOTICE '已添加 priority 字段';
    ELSE
        RAISE NOTICE 'priority 字段已存在';
    END IF;

    -- Add priority index if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'PixelConfig' AND indexname = 'PixelConfig_priority_idx'
    ) THEN
        CREATE INDEX "PixelConfig_priority_idx" ON "PixelConfig"("priority");
        RAISE NOTICE '已添加 priority 索引';
    ELSE
        RAISE NOTICE 'priority 索引已存在';
    END IF;
END $$;
