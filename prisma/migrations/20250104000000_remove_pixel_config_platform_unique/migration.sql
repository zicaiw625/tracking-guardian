

DO $$
BEGIN

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'PixelConfig_shopId_platform_key'
    ) THEN
        ALTER TABLE "PixelConfig" DROP CONSTRAINT "PixelConfig_shopId_platform_key";
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'PixelConfig_shopId_platform_key'
    ) THEN
        DROP INDEX IF EXISTS "PixelConfig_shopId_platform_key";
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PixelConfig_shopId_platform_idx" ON "PixelConfig"("shopId", "platform");

COMMENT ON INDEX "PixelConfig_shopId_platform_idx" IS '支持同一平台多个配置的查询优化索引（非唯一约束）';

