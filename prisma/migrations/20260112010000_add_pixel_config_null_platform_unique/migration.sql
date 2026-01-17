WITH ranked_configs AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY "shopId", platform, environment
            ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
        ) AS row_number
    FROM "PixelConfig"
    WHERE "platformId" IS NULL
)
DELETE FROM "PixelConfig"
WHERE id IN (
    SELECT id
    FROM ranked_configs
    WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "PixelConfig_shopId_platform_environment_null_platformId_key"
ON "PixelConfig" ("shopId", platform, environment)
WHERE "platformId" IS NULL;
