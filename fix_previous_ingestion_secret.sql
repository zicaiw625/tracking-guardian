



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