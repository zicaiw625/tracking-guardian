DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shop' AND column_name = 'pendingIngestionSecret'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "pendingIngestionSecret" TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shop' AND column_name = 'pendingSecretIssuedAt'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "pendingSecretIssuedAt" TIMESTAMP(3);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shop' AND column_name = 'pendingSecretExpiry'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "pendingSecretExpiry" TIMESTAMP(3);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shop' AND column_name = 'pendingSecretMatchCount'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "pendingSecretMatchCount" INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;
