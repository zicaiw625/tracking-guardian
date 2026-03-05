-- Phase 2 cleanup:
-- 1) Drop legacy archived tables created during reconcile
-- 2) Align updatedAt defaults with Prisma @updatedAt semantics

DROP TABLE IF EXISTS "AppliedRecipe__legacy_20260306";
DROP TABLE IF EXISTS "PerformanceMetric__legacy_20260306";
DROP TABLE IF EXISTS "PlatformEnvironment__legacy_20260306";
DROP TABLE IF EXISTS "RefundSnapshot__legacy_20260306";
DROP TABLE IF EXISTS "ShopGroupMember__legacy_20260306";
DROP TABLE IF EXISTS "ShopGroup__legacy_20260306";
DROP TABLE IF EXISTS "ShopifyOrderSnapshot__legacy_20260306";
DROP TABLE IF EXISTS "SurveyResponse__legacy_20260306";

ALTER TABLE IF EXISTS "BatchAuditJob"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE IF EXISTS "WebhookLog"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
