-- Restore SurveyResponse table that was accidentally dropped in simplify_schema migration
-- This table is still used by the application code

CREATE TABLE IF NOT EXISTS "SurveyResponse" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "rating" INTEGER,
    "feedback" TEXT,
    "source" TEXT,
    "customAnswers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SurveyResponse_shopId_idx" ON "SurveyResponse"("shopId");
CREATE INDEX IF NOT EXISTS "SurveyResponse_orderId_idx" ON "SurveyResponse"("orderId");
CREATE INDEX IF NOT EXISTS "SurveyResponse_shopId_orderId_idx" ON "SurveyResponse"("shopId", "orderId");
CREATE INDEX IF NOT EXISTS "SurveyResponse_shopId_createdAt_idx" ON "SurveyResponse"("shopId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SurveyResponse_shopId_fkey'
    ) THEN
        ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
