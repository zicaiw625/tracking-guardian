-- CreateTable
CREATE TABLE IF NOT EXISTS "ExtensionError" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "stack" TEXT,
    "target" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionError_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExtensionError_shopId_idx" ON "ExtensionError"("shopId");
CREATE INDEX IF NOT EXISTS "ExtensionError_shopId_createdAt_idx" ON "ExtensionError"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "ExtensionError_extension_idx" ON "ExtensionError"("extension");
CREATE INDEX IF NOT EXISTS "ExtensionError_endpoint_idx" ON "ExtensionError"("endpoint");
CREATE INDEX IF NOT EXISTS "ExtensionError_shopId_extension_createdAt_idx" ON "ExtensionError"("shopId", "extension", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ExtensionError_shopId_fkey'
    ) THEN
        ALTER TABLE "ExtensionError" ADD CONSTRAINT "ExtensionError_shopId_fkey"
            FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
