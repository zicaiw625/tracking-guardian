



DO $$
BEGIN
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'VerificationRun') THEN
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'VerificationRun' 
            AND column_name = 'eventsJson'
        ) THEN
            ALTER TABLE "VerificationRun" ADD COLUMN "eventsJson" JSONB;
            RAISE NOTICE 'Added eventsJson column to VerificationRun table';
        ELSE
            RAISE NOTICE 'eventsJson column already exists in VerificationRun table';
        END IF;
    ELSE
        RAISE NOTICE 'VerificationRun table does not exist, skipping column addition';
    END IF;
END $$;
