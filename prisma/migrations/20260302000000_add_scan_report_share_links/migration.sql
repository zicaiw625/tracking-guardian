ALTER TABLE "ReportShareLink"
  ALTER COLUMN "runId" DROP NOT NULL;

ALTER TABLE "ReportShareLink"
  ADD COLUMN IF NOT EXISTS "scanReportId" TEXT;

CREATE INDEX IF NOT EXISTS "ReportShareLink_shopId_scanReportId_idx"
  ON "ReportShareLink"("shopId", "scanReportId");

CREATE INDEX IF NOT EXISTS "ReportShareLink_scanReportId_revokedAt_expiresAt_idx"
  ON "ReportShareLink"("scanReportId", "revokedAt", "expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ReportShareLink_scanReportId_fkey'
  ) THEN
    ALTER TABLE "ReportShareLink"
      ADD CONSTRAINT "ReportShareLink_scanReportId_fkey"
      FOREIGN KEY ("scanReportId")
      REFERENCES "ScanReport"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
