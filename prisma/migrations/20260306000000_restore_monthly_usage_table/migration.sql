-- Restore MonthlyUsage table removed by historical migration.
-- Keep this migration idempotent for environments with schema drift.
CREATE TABLE IF NOT EXISTS "MonthlyUsage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonthlyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyUsage_shopId_yearMonth_key" ON "MonthlyUsage"("shopId", "yearMonth");
CREATE INDEX IF NOT EXISTS "MonthlyUsage_shopId_idx" ON "MonthlyUsage"("shopId");
CREATE INDEX IF NOT EXISTS "MonthlyUsage_yearMonth_idx" ON "MonthlyUsage"("yearMonth");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MonthlyUsage_shopId_fkey'
  ) THEN
    ALTER TABLE "MonthlyUsage"
      ADD CONSTRAINT "MonthlyUsage_shopId_fkey"
      FOREIGN KEY ("shopId")
      REFERENCES "Shop"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
