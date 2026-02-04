DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Session' AND column_name = 'firstName') THEN
        ALTER TABLE "Session" ADD COLUMN "firstName" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Session' AND column_name = 'lastName') THEN
        ALTER TABLE "Session" ADD COLUMN "lastName" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Session' AND column_name = 'email') THEN
        ALTER TABLE "Session" ADD COLUMN "email" TEXT;
    END IF;
END $$;
