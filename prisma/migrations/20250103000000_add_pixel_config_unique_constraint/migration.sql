
ALTER TABLE "PixelConfig" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "PixelConfig" ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_key"
        ON "PixelConfig"("shopId", "platform", "environment");
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_platformId_key"
        ON "PixelConfig"("shopId", "platform", "environment", "platformId");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PixelConfig_priority_idx" ON "PixelConfig"("priority");

