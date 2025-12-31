
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "accessToken" TEXT,
    "email" TEXT,
    "name" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "monthlyOrderLimit" INTEGER NOT NULL DEFAULT 100,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "piiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pcdAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "pcdAcknowledgedAt" TIMESTAMP(3),
    "weakConsentMode" BOOLEAN NOT NULL DEFAULT false,
    "consentStrategy" TEXT NOT NULL DEFAULT 'strict',
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "ingestionSecret" TEXT,
    "previousIngestionSecret" TEXT,
    "previousSecretExpiry" TIMESTAMP(3),
    "primaryDomain" TEXT,
    "storefrontDomains" TEXT[],
    "webPixelId" TEXT,
    "shopTier" TEXT,
    "typOspPagesEnabled" BOOLEAN,
    "typOspUpdatedAt" TIMESTAMP(3),
    "typOspLastCheckedAt" TIMESTAMP(3),
    "typOspDetectedAt" TIMESTAMP(3),
    "typOspStatusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScanReport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scriptTags" JSONB,
    "checkoutConfig" JSONB,
    "riskItems" JSONB,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "identifiedPlatforms" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScanReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PixelConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformId" TEXT,
    "credentialsEncrypted" TEXT,
    "clientConfig" JSONB,
    "credentials_legacy" JSONB,
    "clientSideEnabled" BOOLEAN NOT NULL DEFAULT true,
    "serverSideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eventMappings" JSONB,
    "environment" TEXT NOT NULL DEFAULT 'live',
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "previousConfig" JSONB,
    "rollbackAllowed" BOOLEAN NOT NULL DEFAULT true,
    "migrationStatus" TEXT NOT NULL DEFAULT 'not_started',
    "migratedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixelConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "settings" JSONB,
    "settingsEncrypted" TEXT,
    "discrepancyThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "minOrdersForAlert" INTEGER NOT NULL DEFAULT 10,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversionLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "orderValue" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "eventId" TEXT,
    "platform" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "platformResponse" JSONB,
    "clientSideSent" BOOLEAN NOT NULL DEFAULT false,
    "serverSideSent" BOOLEAN NOT NULL DEFAULT false,
    "deadLetteredAt" TIMESTAMP(3),
    "manuallyRetried" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ConversionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationReport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "shopifyOrders" INTEGER NOT NULL DEFAULT 0,
    "shopifyRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "platformConversions" INTEGER NOT NULL DEFAULT 0,
    "platformRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderDiscrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueDiscrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SurveyResponse" (
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

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonthlyUsage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PixelEventReceipt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT,
    "checkoutToken" TEXT,
    "pixelTimestamp" TIMESTAMP(3) NOT NULL,
    "consentState" JSONB,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "signatureStatus" TEXT NOT NULL DEFAULT 'unsigned',
    "trustLevel" TEXT NOT NULL DEFAULT 'unknown',
    "untrustedReason" TEXT,
    "originHost" TEXT,
    "usedCheckoutTokenFallback" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PixelEventReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "orderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversionJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "orderValue" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "capiInput" JSONB,
    "consentEvidence" JSONB,
    "trustMetadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "platformResults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ConversionJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventNonce" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GDPRJob" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GDPRJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditAsset" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'api_scan',
    "category" TEXT NOT NULL DEFAULT 'other',
    "platform" TEXT,
    "fingerprint" TEXT,
    "displayName" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "suggestedMigration" TEXT NOT NULL DEFAULT 'web_pixel',
    "migrationStatus" TEXT NOT NULL DEFAULT 'pending',
    "migratedAt" TIMESTAMP(3),
    "details" JSONB,
    "scanReportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "runName" TEXT NOT NULL DEFAULT '验收测试',
    "runType" TEXT NOT NULL DEFAULT 'quick',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "platforms" TEXT[],
    "summaryJson" JSONB,
    "eventsJson" JSONB,
    "reportUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UiExtensionSetting" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "settingsJson" JSONB,
    "displayRules" JSONB,
    "localization" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UiExtensionSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerPartnerId" TEXT,
    "ownerEmail" TEXT,
    "settingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "inviteStatus" TEXT NOT NULL DEFAULT 'pending',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceShop" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "alias" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceShop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "canEditSettings" BOOLEAN NOT NULL DEFAULT false,
    "canViewReports" BOOLEAN NOT NULL DEFAULT true,
    "canManageBilling" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_shop_idx" ON "Session"("shop");

CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

CREATE INDEX "ScanReport_shopId_idx" ON "ScanReport"("shopId");

CREATE INDEX "ScanReport_status_idx" ON "ScanReport"("status");

CREATE INDEX "PixelConfig_shopId_idx" ON "PixelConfig"("shopId");

CREATE INDEX "PixelConfig_platform_idx" ON "PixelConfig"("platform");

CREATE INDEX "PixelConfig_environment_idx" ON "PixelConfig"("environment");

CREATE UNIQUE INDEX "PixelConfig_shopId_platform_key" ON "PixelConfig"("shopId", "platform");

CREATE INDEX "AlertConfig_shopId_idx" ON "AlertConfig"("shopId");

CREATE INDEX "AlertConfig_channel_idx" ON "AlertConfig"("channel");

CREATE INDEX "ConversionLog_shopId_idx" ON "ConversionLog"("shopId");

CREATE INDEX "ConversionLog_orderId_idx" ON "ConversionLog"("orderId");

CREATE INDEX "ConversionLog_platform_idx" ON "ConversionLog"("platform");

CREATE INDEX "ConversionLog_status_idx" ON "ConversionLog"("status");

CREATE INDEX "ConversionLog_createdAt_idx" ON "ConversionLog"("createdAt");

CREATE INDEX "ConversionLog_shopId_createdAt_idx" ON "ConversionLog"("shopId", "createdAt");

CREATE INDEX "ConversionLog_shopId_status_idx" ON "ConversionLog"("shopId", "status");

CREATE INDEX "ConversionLog_shopId_platform_createdAt_idx" ON "ConversionLog"("shopId", "platform", "createdAt");

CREATE INDEX "ConversionLog_shopId_createdAt_status_idx" ON "ConversionLog"("shopId", "createdAt", "status");

CREATE INDEX "ConversionLog_status_nextRetryAt_idx" ON "ConversionLog"("status", "nextRetryAt");

CREATE INDEX "ConversionLog_status_deadLetteredAt_idx" ON "ConversionLog"("status", "deadLetteredAt");

CREATE UNIQUE INDEX "ConversionLog_shopId_orderId_platform_eventType_key" ON "ConversionLog"("shopId", "orderId", "platform", "eventType");

CREATE INDEX "ReconciliationReport_shopId_idx" ON "ReconciliationReport"("shopId");

CREATE INDEX "ReconciliationReport_platform_idx" ON "ReconciliationReport"("platform");

CREATE INDEX "ReconciliationReport_reportDate_idx" ON "ReconciliationReport"("reportDate");

CREATE INDEX "ReconciliationReport_shopId_reportDate_idx" ON "ReconciliationReport"("shopId", "reportDate");

CREATE UNIQUE INDEX "ReconciliationReport_shopId_platform_reportDate_key" ON "ReconciliationReport"("shopId", "platform", "reportDate");

CREATE INDEX "SurveyResponse_shopId_idx" ON "SurveyResponse"("shopId");

CREATE INDEX "SurveyResponse_orderId_idx" ON "SurveyResponse"("orderId");

CREATE INDEX "SurveyResponse_shopId_orderId_idx" ON "SurveyResponse"("shopId", "orderId");

CREATE INDEX "SurveyResponse_shopId_createdAt_idx" ON "SurveyResponse"("shopId", "createdAt");

CREATE INDEX "AuditLog_shopId_idx" ON "AuditLog"("shopId");

CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

CREATE INDEX "AuditLog_resourceType_idx" ON "AuditLog"("resourceType");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");

CREATE INDEX "MonthlyUsage_shopId_idx" ON "MonthlyUsage"("shopId");

CREATE INDEX "MonthlyUsage_yearMonth_idx" ON "MonthlyUsage"("yearMonth");

CREATE UNIQUE INDEX "MonthlyUsage_shopId_yearMonth_key" ON "MonthlyUsage"("shopId", "yearMonth");

CREATE INDEX "PixelEventReceipt_shopId_idx" ON "PixelEventReceipt"("shopId");

CREATE INDEX "PixelEventReceipt_orderId_idx" ON "PixelEventReceipt"("orderId");

CREATE INDEX "PixelEventReceipt_shopId_orderId_idx" ON "PixelEventReceipt"("shopId", "orderId");

CREATE INDEX "PixelEventReceipt_shopId_checkoutToken_idx" ON "PixelEventReceipt"("shopId", "checkoutToken");

CREATE INDEX "PixelEventReceipt_checkoutToken_idx" ON "PixelEventReceipt"("checkoutToken");

CREATE UNIQUE INDEX "PixelEventReceipt_shopId_orderId_eventType_key" ON "PixelEventReceipt"("shopId", "orderId", "eventType");

CREATE INDEX "WebhookLog_shopDomain_idx" ON "WebhookLog"("shopDomain");

CREATE INDEX "WebhookLog_receivedAt_idx" ON "WebhookLog"("receivedAt");

CREATE INDEX "WebhookLog_receivedAt_status_idx" ON "WebhookLog"("receivedAt", "status");

CREATE UNIQUE INDEX "WebhookLog_shopDomain_webhookId_topic_key" ON "WebhookLog"("shopDomain", "webhookId", "topic");

CREATE INDEX "ConversionJob_shopId_idx" ON "ConversionJob"("shopId");

CREATE INDEX "ConversionJob_status_idx" ON "ConversionJob"("status");

CREATE INDEX "ConversionJob_status_nextRetryAt_idx" ON "ConversionJob"("status", "nextRetryAt");

CREATE INDEX "ConversionJob_createdAt_idx" ON "ConversionJob"("createdAt");

CREATE UNIQUE INDEX "ConversionJob_shopId_orderId_key" ON "ConversionJob"("shopId", "orderId");

CREATE INDEX "EventNonce_expiresAt_idx" ON "EventNonce"("expiresAt");

CREATE UNIQUE INDEX "EventNonce_shopId_nonce_eventType_key" ON "EventNonce"("shopId", "nonce", "eventType");

CREATE INDEX "GDPRJob_status_idx" ON "GDPRJob"("status");

CREATE INDEX "GDPRJob_shopDomain_idx" ON "GDPRJob"("shopDomain");

CREATE INDEX "GDPRJob_createdAt_idx" ON "GDPRJob"("createdAt");

CREATE INDEX "AuditAsset_shopId_idx" ON "AuditAsset"("shopId");

CREATE INDEX "AuditAsset_category_idx" ON "AuditAsset"("category");

CREATE INDEX "AuditAsset_riskLevel_idx" ON "AuditAsset"("riskLevel");

CREATE INDEX "AuditAsset_platform_idx" ON "AuditAsset"("platform");

CREATE INDEX "AuditAsset_migrationStatus_idx" ON "AuditAsset"("migrationStatus");

CREATE UNIQUE INDEX "AuditAsset_shopId_fingerprint_key" ON "AuditAsset"("shopId", "fingerprint");

CREATE INDEX "VerificationRun_shopId_idx" ON "VerificationRun"("shopId");

CREATE INDEX "VerificationRun_status_idx" ON "VerificationRun"("status");

CREATE INDEX "VerificationRun_createdAt_idx" ON "VerificationRun"("createdAt");

CREATE INDEX "UiExtensionSetting_shopId_idx" ON "UiExtensionSetting"("shopId");

CREATE INDEX "UiExtensionSetting_moduleKey_idx" ON "UiExtensionSetting"("moduleKey");

CREATE INDEX "UiExtensionSetting_isEnabled_idx" ON "UiExtensionSetting"("isEnabled");

CREATE UNIQUE INDEX "UiExtensionSetting_shopId_moduleKey_key" ON "UiExtensionSetting"("shopId", "moduleKey");

CREATE INDEX "Workspace_ownerPartnerId_idx" ON "Workspace"("ownerPartnerId");

CREATE INDEX "Workspace_ownerEmail_idx" ON "Workspace"("ownerEmail");

CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

CREATE INDEX "WorkspaceMember_email_idx" ON "WorkspaceMember"("email");

CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_email_key" ON "WorkspaceMember"("workspaceId", "email");

CREATE INDEX "WorkspaceShop_workspaceId_idx" ON "WorkspaceShop"("workspaceId");

CREATE INDEX "WorkspaceShop_shopId_idx" ON "WorkspaceShop"("shopId");

CREATE UNIQUE INDEX "WorkspaceShop_workspaceId_shopId_key" ON "WorkspaceShop"("workspaceId", "shopId");

CREATE INDEX "ShopGroup_ownerId_idx" ON "ShopGroup"("ownerId");

CREATE INDEX "ShopGroupMember_groupId_idx" ON "ShopGroupMember"("groupId");

CREATE INDEX "ShopGroupMember_shopId_idx" ON "ShopGroupMember"("shopId");

CREATE UNIQUE INDEX "ShopGroupMember_groupId_shopId_key" ON "ShopGroupMember"("groupId", "shopId");

ALTER TABLE "ScanReport" ADD CONSTRAINT "ScanReport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PixelConfig" ADD CONSTRAINT "PixelConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertConfig" ADD CONSTRAINT "AlertConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversionLog" ADD CONSTRAINT "ConversionLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReconciliationReport" ADD CONSTRAINT "ReconciliationReport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MonthlyUsage" ADD CONSTRAINT "MonthlyUsage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PixelEventReceipt" ADD CONSTRAINT "PixelEventReceipt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversionJob" ADD CONSTRAINT "ConversionJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditAsset" ADD CONSTRAINT "AuditAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UiExtensionSetting" ADD CONSTRAINT "UiExtensionSetting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceShop" ADD CONSTRAINT "WorkspaceShop_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShopGroupMember" ADD CONSTRAINT "ShopGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ShopGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
[schema-engine] error: Error: kill EPERM
    at ChildProcess.kill (node:internal/child_process:511:26)
    at Ia.stop (/Users/wangzicai/Documents/tracking-guardian/node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js:531:2458)
    at en.stop (/Users/wangzicai/Documents/tracking-guardian/node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js:547:363)
    at wb.parse (/Users/wangzicai/Documents/tracking-guardian/node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js:1040:1893)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async aAt (/Users/wangzicai/Documents/tracking-guardian/node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js:2002:1678) {
  errno: -1,
  code: 'EPERM',
  syscall: 'kill'
}

