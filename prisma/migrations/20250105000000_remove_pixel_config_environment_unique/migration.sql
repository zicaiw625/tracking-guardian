

DO $$
BEGIN

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        ALTER TABLE "PixelConfig" DROP CONSTRAINT "PixelConfig_shopId_platform_environment_key";
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'PixelConfig_shopId_platform_environment_key'
    ) THEN
        DROP INDEX IF EXISTS "PixelConfig_shopId_platform_environment_key";
    END IF;
END $$;

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) AND NOT EXISTS (

        SELECT 1 FROM pg_indexes
        WHERE indexname = 'PixelConfig_shopId_platform_environment_platformId_key'
    ) THEN
        CREATE UNIQUE INDEX "PixelConfig_shopId_platform_environment_platformId_key"
        ON "PixelConfig"("shopId", "platform", "environment", "platformId");
    END IF;
END $$;

COMMENT ON INDEX "PixelConfig_shopId_platform_environment_platformId_key" IS
'P0-3: 支持同一平台多个目的地配置的唯一约束。如果 platformId 为 null，同一店铺、同一平台、同一环境只能有 1 个配置；如果 platformId 不为 null，可以有多个配置（通过不同的 platformId 区分）';

