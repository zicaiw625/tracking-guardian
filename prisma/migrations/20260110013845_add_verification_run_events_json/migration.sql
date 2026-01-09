-- Add missing eventsJson column to VerificationRun table
-- This migration adds the eventsJson column that exists in the Prisma schema
-- but may be missing from the database

DO $$
BEGIN
    -- Check if the table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'VerificationRun') THEN
        -- Check if the column doesn't exist before adding it
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
