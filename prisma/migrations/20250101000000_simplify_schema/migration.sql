-- 简化 Prisma schema：删除不必要的模型，简化 PixelEventReceipt

-- 1. 删除 Workspace 相关表
DROP TABLE IF EXISTS "WorkspaceShop" CASCADE;
DROP TABLE IF EXISTS "WorkspaceMember" CASCADE;
DROP TABLE IF EXISTS "WorkspaceComment" CASCADE;
DROP TABLE IF EXISTS "Workspace" CASCADE;

-- 2. 删除 ShopGroup 相关表
DROP TABLE IF EXISTS "ShopGroupMember" CASCADE;
DROP TABLE IF EXISTS "ShopGroup" CASCADE;

-- 3. 删除 Task 相关表
DROP TABLE IF EXISTS "TaskComment" CASCADE;
DROP TABLE IF EXISTS "MigrationTask" CASCADE;

-- 4. 删除 Monitoring/Alert 相关表
DROP TABLE IF EXISTS "AlertConfig" CASCADE;
DROP TABLE IF EXISTS "PerformanceMetric" CASCADE;

-- 5. 删除 Conversion/Reconciliation 相关表
DROP TABLE IF EXISTS "ConversionJob" CASCADE;
DROP TABLE IF EXISTS "ConversionLog" CASCADE;
DROP TABLE IF EXISTS "ReconciliationReport" CASCADE;

-- 6. 删除 Report 相关表
DROP TABLE IF EXISTS "ReportJob" CASCADE;

-- 7. 删除其他不需要的表
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

-- 8. 简化 PixelEventReceipt 表
-- 先删除旧表
DROP TABLE IF EXISTS "PixelEventReceipt" CASCADE;

-- 创建新的简化版 PixelEventReceipt
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

-- 创建索引
CREATE INDEX "PixelEventReceipt_shopId_idx" ON "PixelEventReceipt"("shopId");
CREATE INDEX "PixelEventReceipt_shopId_pixelTimestamp_idx" ON "PixelEventReceipt"("shopId", "pixelTimestamp");
CREATE INDEX "PixelEventReceipt_verificationRunId_idx" ON "PixelEventReceipt"("verificationRunId");
CREATE INDEX "PixelEventReceipt_eventType_idx" ON "PixelEventReceipt"("eventType");
CREATE INDEX "PixelEventReceipt_shopId_eventType_pixelTimestamp_idx" ON "PixelEventReceipt"("shopId", "eventType", "pixelTimestamp");

-- 添加外键约束
ALTER TABLE "PixelEventReceipt" ADD CONSTRAINT "PixelEventReceipt_Shop_fkey" FOREIGN KEY ("Shop") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PixelEventReceipt" ADD CONSTRAINT "PixelEventReceipt_VerificationRun_fkey" FOREIGN KEY ("verificationRunId") REFERENCES "VerificationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. 更新 Shop 表，移除不需要的关系
-- 注意：PostgreSQL 不支持直接删除列上的关系，这些关系会在删除表时自动删除

-- 10. 更新 VerificationRun 表，添加与 PixelEventReceipt 的关系
-- 关系已通过外键约束建立
