-- Phase 3 cleanup:
-- Align remaining schema drift with current Prisma schema.

DROP INDEX IF EXISTS "AuditAsset_estimatedTimeMinutes_idx";
DROP INDEX IF EXISTS "AuditAsset_priority_idx";

ALTER TABLE IF EXISTS "PixelEventReceipt"
  DROP COLUMN IF EXISTS "Shop";

ALTER TABLE IF EXISTS "ScanReport"
  DROP COLUMN IF EXISTS "shareTokenHash",
  DROP COLUMN IF EXISTS "shareTokenExpiresAt";

ALTER TABLE IF EXISTS "VerificationRun"
  DROP COLUMN IF EXISTS "publicId",
  DROP COLUMN IF EXISTS "publicTokenHash",
  DROP COLUMN IF EXISTS "shareTokenExpiresAt";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PixelEventReceipt_VerificationRun_fkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PixelEventReceipt_verificationRunId_fkey'
  ) THEN
    ALTER TABLE "PixelEventReceipt"
      RENAME CONSTRAINT "PixelEventReceipt_VerificationRun_fkey"
      TO "PixelEventReceipt_verificationRunId_fkey";
  END IF;
END
$$;
