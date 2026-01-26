ALTER TABLE "PixelConfig" ADD COLUMN IF NOT EXISTS "configVersion" INTEGER;
UPDATE "PixelConfig" SET "configVersion" = 1 WHERE "configVersion" IS NULL;
ALTER TABLE "PixelConfig" ALTER COLUMN "configVersion" SET DEFAULT 1;
ALTER TABLE "PixelConfig" ALTER COLUMN "configVersion" SET NOT NULL;

