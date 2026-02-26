CREATE TABLE IF NOT EXISTS "ReportShareLink" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'verification_report',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "lastAccessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReportShareLink_tokenHash_key" ON "ReportShareLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "ReportShareLink_shopId_runId_idx" ON "ReportShareLink"("shopId", "runId");
CREATE INDEX IF NOT EXISTS "ReportShareLink_runId_revokedAt_expiresAt_idx" ON "ReportShareLink"("runId", "revokedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "ReportShareLink_expiresAt_idx" ON "ReportShareLink"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ReportShareLink_shopId_fkey'
  ) THEN
    ALTER TABLE "ReportShareLink"
      ADD CONSTRAINT "ReportShareLink_shopId_fkey"
      FOREIGN KEY ("shopId")
      REFERENCES "Shop"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ReportShareLink_runId_fkey'
  ) THEN
    ALTER TABLE "ReportShareLink"
      ADD CONSTRAINT "ReportShareLink_runId_fkey"
      FOREIGN KEY ("runId")
      REFERENCES "VerificationRun"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
