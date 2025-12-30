-- Add performance indexes for AuditAsset
CREATE INDEX IF NOT EXISTS "AuditAsset_shopId_migrationStatus_idx" ON "AuditAsset"("shopId", "migrationStatus");
CREATE INDEX IF NOT EXISTS "AuditAsset_shopId_riskLevel_idx" ON "AuditAsset"("shopId", "riskLevel");
CREATE INDEX IF NOT EXISTS "AuditAsset_shopId_category_riskLevel_idx" ON "AuditAsset"("shopId", "category", "riskLevel");
CREATE INDEX IF NOT EXISTS "AuditAsset_shopId_createdAt_idx" ON "AuditAsset"("shopId", "createdAt");

-- Add performance indexes for VerificationRun
CREATE INDEX IF NOT EXISTS "VerificationRun_shopId_status_idx" ON "VerificationRun"("shopId", "status");
CREATE INDEX IF NOT EXISTS "VerificationRun_shopId_createdAt_idx" ON "VerificationRun"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "VerificationRun_shopId_status_createdAt_idx" ON "VerificationRun"("shopId", "status", "createdAt");

