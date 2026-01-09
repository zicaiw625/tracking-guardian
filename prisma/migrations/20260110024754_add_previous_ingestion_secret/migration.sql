-- Add missing previousIngestionSecret and previousSecretExpiry columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'previousIngestionSecret'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "previousIngestionSecret" TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'previousSecretExpiry'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "previousSecretExpiry" TIMESTAMP(3);
    END IF;
END $$;