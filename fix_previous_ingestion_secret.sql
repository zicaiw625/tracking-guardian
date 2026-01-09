-- 修复缺失的 previousIngestionSecret 和 previousSecretExpiry 列
-- 这个文件可以直接在生产数据库中执行

-- 添加 previousIngestionSecret 列（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'previousIngestionSecret'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "previousIngestionSecret" TEXT;
        RAISE NOTICE 'Added previousIngestionSecret column';
    ELSE
        RAISE NOTICE 'previousIngestionSecret column already exists';
    END IF;
END $$;

-- 添加 previousSecretExpiry 列（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'previousSecretExpiry'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "previousSecretExpiry" TIMESTAMP(3);
        RAISE NOTICE 'Added previousSecretExpiry column';
    ELSE
        RAISE NOTICE 'previousSecretExpiry column already exists';
    END IF;
END $$;