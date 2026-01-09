-- Add reportUrl column to VerificationRun table
DO $$
BEGIN
    -- Check if VerificationRun table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'VerificationRun') THEN
        -- Check if reportUrl column doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'VerificationRun' 
            AND column_name = 'reportUrl'
        ) THEN
            ALTER TABLE "VerificationRun" ADD COLUMN "reportUrl" TEXT;
            RAISE NOTICE 'Added reportUrl column to VerificationRun table';
        ELSE
            RAISE NOTICE 'reportUrl column already exists in VerificationRun table';
        END IF;
    ELSE
        RAISE NOTICE 'VerificationRun table does not exist, skipping column addition';
    END IF;
END $$;
