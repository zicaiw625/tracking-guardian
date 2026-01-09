


DROP TABLE IF EXISTS "WorkspaceShop" CASCADE;
DROP TABLE IF EXISTS "WorkspaceMember" CASCADE;
DROP TABLE IF EXISTS "WorkspaceComment" CASCADE;
DROP TABLE IF EXISTS "Workspace" CASCADE;


DROP TABLE IF EXISTS "ShopGroupMember" CASCADE;
DROP TABLE IF EXISTS "ShopGroup" CASCADE;


DROP TABLE IF EXISTS "TaskComment" CASCADE;
DROP TABLE IF EXISTS "MigrationTask" CASCADE;


DROP TABLE IF EXISTS "AlertConfig" CASCADE;
DROP TABLE IF EXISTS "PerformanceMetric" CASCADE;


DROP TABLE IF EXISTS "ConversionJob" CASCADE;
DROP TABLE IF EXISTS "ConversionLog" CASCADE;
DROP TABLE IF EXISTS "ReconciliationReport" CASCADE;


DROP TABLE IF EXISTS "ReportJob" CASCADE;


DROP TABLE IF EXISTS "AuditLog" CASCADE;
DROP TABLE IF EXISTS "MonthlyUsage" CASCADE;
DROP TABLE IF EXISTS "PixelTemplate" CASCADE;
DROP TABLE IF EXISTS "MigrationDraft" CASCADE;
DROP TABLE IF EXISTS "AppliedRecipe" CASCADE;
DROP TABLE IF EXISTS "SurveyResponse" CASCADE;
DROP TABLE IF EXISTS "UiExtensionSetting" CASCADE;
DROP TABLE IF EXISTS "EventNonce" CASCADE;
DROP TABLE IF EXISTS "GDPRJob" CASCADE;
DROP TABLE IF EXISTS "EventLog" CASCADE;
DROP TABLE IF EXISTS "DeliveryAttempt" CASCADE;
DROP TABLE IF EXISTS "ShopifyOrderSnapshot" CASCADE;
DROP TABLE IF EXISTS "RefundSnapshot" CASCADE;
DROP TABLE IF EXISTS "WebhookLog" CASCADE;



DROP TABLE IF EXISTS "PixelEventReceipt" CASCADE;


CREATE TABLE "PixelEventReceipt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "pixelTimestamp" TIMESTAMP(3) NOT NULL,
    "verificationRunId" TEXT,
    "originHost" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Shop" TEXT NOT NULL,

    CONSTRAINT "PixelEventReceipt_pkey" PRIMARY KEY ("id")
);


CREATE INDEX "PixelEventReceipt_shopId_idx" ON "PixelEventReceipt"("shopId");
CREATE INDEX "PixelEventReceipt_shopId_pixelTimestamp_idx" ON "PixelEventReceipt"("shopId", "pixelTimestamp");
CREATE INDEX "PixelEventReceipt_verificationRunId_idx" ON "PixelEventReceipt"("verificationRunId");
CREATE INDEX "PixelEventReceipt_eventType_idx" ON "PixelEventReceipt"("eventType");
CREATE INDEX "PixelEventReceipt_shopId_eventType_pixelTimestamp_idx" ON "PixelEventReceipt"("shopId", "eventType", "pixelTimestamp");


ALTER TABLE "PixelEventReceipt" ADD CONSTRAINT "PixelEventReceipt_Shop_fkey" FOREIGN KEY ("Shop") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PixelEventReceipt" ADD CONSTRAINT "PixelEventReceipt_VerificationRun_fkey" FOREIGN KEY ("verificationRunId") REFERENCES "VerificationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;






