-- Add per-link access limit for public report shares
ALTER TABLE "ReportShareLink"
ADD COLUMN IF NOT EXISTS "maxAccessCount" INTEGER;

CREATE INDEX IF NOT EXISTS "ReportShareLink_tokenHash_revokedAt_expiresAt_idx"
ON "ReportShareLink"("tokenHash", "revokedAt", "expiresAt");
