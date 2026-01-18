
-- Add credentials_legacy column if it doesn't exist
DO $$
BEGIN
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'PixelConfig' 
        AND column_name = 'credentials_legacy'
    ) THEN
        ALTER TABLE "PixelConfig" ADD COLUMN "credentials_legacy" JSONB;
        RAISE NOTICE 'Added credentials_legacy column to PixelConfig table';
    ELSE
        RAISE NOTICE 'credentials_legacy column already exists in PixelConfig table';
    END IF;
END $$;
