


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'shopTier'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "shopTier" TEXT;
    END IF;
END $$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Shop' AND column_name = 'monthlyOrderLimit'
    ) THEN
        ALTER TABLE "Shop" ADD COLUMN "monthlyOrderLimit" INTEGER NOT NULL DEFAULT 100;
    END IF;
END $$;


DO $$
BEGIN
    
    UPDATE "Shop" 
    SET "monthlyOrderLimit" = 100 
    WHERE "monthlyOrderLimit" IS NULL;
END $$;
