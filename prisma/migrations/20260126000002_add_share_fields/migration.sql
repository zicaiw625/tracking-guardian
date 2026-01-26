ALTER TABLE "ScanReport"
ADD COLUMN IF NOT EXISTS "shareTokenHash" TEXT,
ADD COLUMN IF NOT EXISTS "shareTokenExpiresAt" TIMESTAMP(3);

ALTER TABLE "VerificationRun"
ADD COLUMN IF NOT EXISTS "publicId" TEXT,
ADD COLUMN IF NOT EXISTS "publicTokenHash" TEXT,
ADD COLUMN IF NOT EXISTS "shareTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "VerificationRun_publicId_key" ON "VerificationRun"("publicId");

CREATE INDEX IF NOT EXISTS "VerificationRun_publicId_idx" ON "VerificationRun"("publicId");

