-- Fix schema drift where columns were added to schema/init migration but not applied to production DB
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "shopTier" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "typOspPagesEnabled" BOOLEAN;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "typOspUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "typOspLastCheckedAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "typOspDetectedAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "typOspStatusReason" TEXT;
