import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import prisma from "../db.server";
import { runAllShopsDeliveryHealthCheck } from "../services/delivery-health.server";
import { runAllShopsReconciliation } from "../services/reconciliation.server";
import { processPendingConversions, processRetries, processConversionJobs } from "../services/retry.server";
import { reconcilePendingConsent } from "../services/consent-reconciler.server";
import { processGDPRJobs, checkGDPRCompliance } from "../services/gdpr.server";
import { createAuditLog } from "../services/audit.server";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";
import { logger, createRequestLogger } from "../utils/logger.server";
import { withCronLock } from "../utils/cron-lock";
import { refreshTypOspStatusWithOfflineToken } from "../services/checkout-profile.server";
import { refreshShopTier } from "../services/shop-tier.server";
function generateRequestId(): string {
    return `cron-${Date.now()}-${randomBytes(4).toString("hex")}`;
}
const REPLAY_PROTECTION_WINDOW_MS = 5 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 10;
async function batchDelete<T extends {
    id: string;
}>(tableName: string, findQuery: () => Promise<T[]>, deleteByIds: (ids: string[]) => Promise<{
    count: number;
}>): Promise<number> {
    let totalDeleted = 0;
    let batchCount = 0;
    while (batchCount < MAX_BATCHES_PER_RUN) {
        const records = await findQuery();
        if (records.length === 0) {
            break;
        }
        const ids = records.map(r => r.id);
        const result = await deleteByIds(ids);
        totalDeleted += result.count;
        batchCount++;
        logger.debug(`[Cleanup] Deleted ${result.count} ${tableName} (batch ${batchCount})`);
        if (records.length < CLEANUP_BATCH_SIZE) {
            break;
        }
    }
    if (batchCount >= MAX_BATCHES_PER_RUN) {
        logger.info(`[Cleanup] ${tableName}: Reached max batch limit, more records may remain`);
    }
    return totalDeleted;
}
async function cleanupExpiredData(): Promise<{
    shopsProcessed: number;
    conversionLogsDeleted: number;
    surveyResponsesDeleted: number;
    auditLogsDeleted: number;
    conversionJobsDeleted: number;
    pixelEventReceiptsDeleted: number;
    webhookLogsDeleted: number;
    scanReportsDeleted: number;
    reconciliationReportsDeleted: number;
    gdprJobsDeleted: number;
    eventNoncesDeleted: number;
}> {
    const eventNonceResult = await prisma.eventNonce.deleteMany({
        where: {
            expiresAt: { lt: new Date() },
        },
    });
    if (eventNonceResult.count > 0) {
        logger.info(`Cleaned up ${eventNonceResult.count} expired event nonces`);
    }
    const gdprCutoff = new Date();
    gdprCutoff.setDate(gdprCutoff.getDate() - 30);
    const gdprJobResult = await prisma.gDPRJob.deleteMany({
        where: {
            status: { in: ["completed", "failed"] },
            createdAt: { lt: gdprCutoff },
        },
    });
    if (gdprJobResult.count > 0) {
        logger.info(`Cleaned up ${gdprJobResult.count} old GDPR jobs`);
    }
    const shops = await prisma.shop.findMany({
        where: {
            isActive: true,
            dataRetentionDays: { gt: 0 },
        },
        select: {
            id: true,
            shopDomain: true,
            dataRetentionDays: true,
        },
    });
    const shopsByRetention = new Map<number, Array<{
        id: string;
        shopDomain: string;
    }>>();
    for (const shop of shops) {
        const retentionDays = shop.dataRetentionDays || 90;
        const existing = shopsByRetention.get(retentionDays) || [];
        existing.push({ id: shop.id, shopDomain: shop.shopDomain });
        shopsByRetention.set(retentionDays, existing);
    }
    let totalConversionLogs = 0;
    let totalSurveyResponses = 0;
    let totalAuditLogs = 0;
    let totalConversionJobs = 0;
    let totalPixelEventReceipts = 0;
    let totalWebhookLogs = 0;
    let totalScanReports = 0;
    let totalReconciliationReports = 0;
    for (const [retentionDays, shopsInGroup] of shopsByRetention) {
        const shopIds = shopsInGroup.map(s => s.id);
        const shopDomains = shopsInGroup.map(s => s.shopDomain);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const auditCutoff = new Date();
        auditCutoff.setDate(auditCutoff.getDate() - Math.max(retentionDays, 180));
        const [conversionLogsCount, surveyResponsesCount, auditLogsCount, conversionJobsCount, pixelReceiptsCount, webhookLogsCount, reconciliationCount,] = await Promise.all([
            batchDelete("ConversionLog", () => prisma.conversionLog.findMany({
                where: {
                    shopId: { in: shopIds },
                    createdAt: { lt: cutoffDate },
                    status: { in: ["sent", "dead_letter"] },
                },
                select: { id: true },
                take: CLEANUP_BATCH_SIZE,
            }), (ids) => prisma.conversionLog.deleteMany({ where: { id: { in: ids } } })),
            batchDelete("SurveyResponse", () => prisma.surveyResponse.findMany({
                where: {
                    shopId: { in: shopIds },
                    createdAt: { lt: cutoffDate },
                },
                select: { id: true },
                take: CLEANUP_BATCH_SIZE,
            }), (ids) => prisma.surveyResponse.deleteMany({ where: { id: { in: ids } } })),
            batchDelete("AuditLog", () => prisma.auditLog.findMany({
                where: {
                    shopId: { in: shopIds },
                    createdAt: { lt: auditCutoff },
                },
                select: { id: true },
                take: CLEANUP_BATCH_SIZE,
            }), (ids) => prisma.auditLog.deleteMany({ where: { id: { in: ids } } })),
            batchDelete("ConversionJob", () => prisma.conversionJob.findMany({
                where: {
                    shopId: { in: shopIds },
                    createdAt: { lt: cutoffDate },
                    status: { in: ["completed", "dead_letter"] },
                },
                select: { id: true },
                take: CLEANUP_BATCH_SIZE,
            }), (ids) => prisma.conversionJob.deleteMany({ where: { id: { in: ids } } })),
            batchDelete("PixelEventReceipt", () => prisma.pixelEventReceipt.findMany({
                where: {
                    shopId: { in: shopIds },
                    createdAt: { lt: cutoffDate },
                },
                select: { id: true },
                take: CLEANUP_BATCH_SIZE,
            }), (ids) => prisma.pixelEventReceipt.deleteMany({ where: { id: { in: ids } } })),
            batchDelete("WebhookLog", () => prisma.webhookLog.findMany({
                where: {
                    shopDomain: { in: shopDomains },
                    receivedAt: { lt: cutoffDate },
                },
                select: { id: true },
                take: CLEANUP_BATCH_SIZE,
            }), (ids) => prisma.webhookLog.deleteMany({ where: { id: { in: ids } } })),
            batchDelete("ReconciliationReport", () => prisma.reconciliationReport.findMany({
                where: {
                    shopId: { in: shopIds },
                    createdAt: { lt: cutoffDate },
                },
                select: { id: true },
                take: CLEANUP_BATCH_SIZE,
            }), (ids) => prisma.reconciliationReport.deleteMany({ where: { id: { in: ids } } })),
        ]);
        totalConversionLogs += conversionLogsCount;
        totalSurveyResponses += surveyResponsesCount;
        totalAuditLogs += auditLogsCount;
        totalConversionJobs += conversionJobsCount;
        totalPixelEventReceipts += pixelReceiptsCount;
        totalWebhookLogs += webhookLogsCount;
        totalReconciliationReports += reconciliationCount;
        for (const shop of shopsInGroup) {
            const scanReportsToKeep = 5;
            const oldScanReports = await prisma.scanReport.findMany({
                where: { shopId: shop.id },
                orderBy: { createdAt: "desc" },
                skip: scanReportsToKeep,
                select: { id: true },
            });
            if (oldScanReports.length > 0) {
                const scanReportResult = await prisma.scanReport.deleteMany({
                    where: { id: { in: oldScanReports.map(r => r.id) } },
                });
                totalScanReports += scanReportResult.count;
            }
        }
        const totalDeleted = conversionLogsCount + surveyResponsesCount + auditLogsCount +
            conversionJobsCount + pixelReceiptsCount + webhookLogsCount +
            reconciliationCount;
        if (totalDeleted > 0) {
            logger.info(`Batch cleanup for ${shopsInGroup.length} shops (${retentionDays} day retention)`, {
                shopsCount: shopsInGroup.length,
                retentionDays,
                conversions: conversionLogsCount,
                surveys: surveyResponsesCount,
                auditLogs: auditLogsCount,
                jobs: conversionJobsCount,
                receipts: pixelReceiptsCount,
                webhookLogs: webhookLogsCount,
                reconciliations: reconciliationCount,
            });
        }
    }
    return {
        shopsProcessed: shops.length,
        conversionLogsDeleted: totalConversionLogs,
        surveyResponsesDeleted: totalSurveyResponses,
        auditLogsDeleted: totalAuditLogs,
        conversionJobsDeleted: totalConversionJobs,
        pixelEventReceiptsDeleted: totalPixelEventReceipts,
        webhookLogsDeleted: totalWebhookLogs,
        scanReportsDeleted: totalScanReports,
        reconciliationReportsDeleted: totalReconciliationReports,
        gdprJobsDeleted: gdprJobResult.count,
        eventNoncesDeleted: eventNonceResult.count,
    };
}
function verifyReplayProtection(request: Request, cronSecret: string): {
    valid: boolean;
    error?: string;
} {
    const timestamp = request.headers.get("X-Cron-Timestamp");
    const signature = request.headers.get("X-Cron-Signature");
    const isProduction = process.env.NODE_ENV === "production";
    const strictReplayProtection = process.env.CRON_STRICT_REPLAY !== "false";
    if (!timestamp) {
        if (isProduction && strictReplayProtection) {
            logger.warn("Cron request missing timestamp header in production");
            return { valid: false, error: "Missing timestamp header (required in production)" };
        }
        if (isProduction) {
            logger.warn("Cron request accepted without timestamp (CRON_STRICT_REPLAY=false)");
        }
        return { valid: true };
    }
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime)) {
        return { valid: false, error: "Invalid timestamp format" };
    }
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(now - requestTime);
    if (timeDiff > REPLAY_PROTECTION_WINDOW_MS / 1000) {
        logger.warn(`Cron request timestamp out of range`, { timeDiff });
        return { valid: false, error: "Request timestamp out of range (possible replay attack)" };
    }
    if (isProduction && strictReplayProtection && !signature) {
        logger.warn("Cron request has timestamp but missing signature");
        return { valid: false, error: "Missing signature (required when timestamp is provided)" };
    }
    if (signature) {
        const expectedSignature = createHmac("sha256", cronSecret)
            .update(timestamp)
            .digest("hex");
        try {
            const signatureBuffer = Buffer.from(signature, "hex");
            const expectedBuffer = Buffer.from(expectedSignature, "hex");
            if (signatureBuffer.length !== expectedBuffer.length) {
                return { valid: false, error: "Invalid signature" };
            }
            if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
                return { valid: false, error: "Invalid signature" };
            }
        }
        catch {
            return { valid: false, error: "Invalid signature format" };
        }
    }
    return { valid: true };
}
function validateCronAuth(request: Request): Response | null {
    const authHeader = request.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === "production";
    if (!cronSecret) {
        if (isProduction) {
            logger.error("CRITICAL: CRON_SECRET environment variable is not set in production");
            return json({ error: "Cron endpoint not configured" }, { status: 503 }) as unknown as Response;
        }
        logger.warn("CRON_SECRET not set. Allowing unauthenticated access in development only.");
        return null;
    }
    if (cronSecret.length < 32) {
        logger.warn("CRON_SECRET is shorter than recommended 32 characters");
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
        const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            request.headers.get("x-real-ip") ||
            "unknown";
        const vercelCronHeader = request.headers.get("x-vercel-cron");
        logger.warn("Unauthorized cron access attempt", {
            clientIP,
            hasVercelHeader: !!vercelCronHeader,
            hasAuthHeader: !!authHeader,
        });
        return json({ error: "Unauthorized" }, { status: 401 }) as unknown as Response;
    }
    const replayCheck = verifyReplayProtection(request, cronSecret);
    if (!replayCheck.valid) {
        logger.warn(`Cron replay protection failed: ${replayCheck.error}`);
        return json({ error: replayCheck.error }, { status: 401 }) as unknown as Response;
    }
    return null;
}
interface CronResult {
    gdpr: Awaited<ReturnType<typeof processGDPRJobs>>;
    gdprCompliance: Awaited<ReturnType<typeof checkGDPRCompliance>>;
    consent: Awaited<ReturnType<typeof reconcilePendingConsent>>;
    jobs: Awaited<ReturnType<typeof processConversionJobs>>;
    pending: Awaited<ReturnType<typeof processPendingConversions>>;
    retries: Awaited<ReturnType<typeof processRetries>>;
    deliveryHealth: {
        successful: number;
        failed: number;
        results: Awaited<ReturnType<typeof runAllShopsDeliveryHealthCheck>>;
    };
    reconciliation: {
        processed: number;
        succeeded: number;
        failed: number;
        reportsGenerated: number;
    };
    cleanup: Awaited<ReturnType<typeof cleanupExpiredData>>;
    shopStatusRefresh?: {
        shopsProcessed: number;
        tierUpdates: number;
        typOspUpdates: number;
        typOspUnknown: number;
        typOspUnknownReasons: Record<string, number>;
        errors: number;
    };
}
async function executeCronTasks(cronLogger: ReturnType<typeof createRequestLogger>): Promise<CronResult> {
    cronLogger.info("Processing GDPR jobs...");
    const gdprResults = await processGDPRJobs();
    cronLogger.info("GDPR processing completed", gdprResults);
    cronLogger.info("Checking GDPR compliance...");
    const gdprCompliance = await checkGDPRCompliance();
    if (!gdprCompliance.isCompliant) {
        cronLogger.error("GDPR COMPLIANCE VIOLATION!", {
            overdueCount: gdprCompliance.overdueCount,
            criticals: gdprCompliance.criticals,
        });
    }
    else if (gdprCompliance.warnings.length > 0) {
        cronLogger.warn("GDPR compliance warnings", {
            pendingCount: gdprCompliance.pendingCount,
            oldestAge: gdprCompliance.oldestPendingAge,
        });
    }
    else {
        cronLogger.info("GDPR compliance check passed", {
            pendingCount: gdprCompliance.pendingCount,
        });
    }
    cronLogger.info("Reconciling pending consent...");
    const consentResults = await reconcilePendingConsent();
    cronLogger.info("Consent reconciliation completed", { ...consentResults });
    cronLogger.info("Processing conversion jobs...");
    const jobResults = await processConversionJobs();
    cronLogger.info("Conversion jobs completed", { ...jobResults });
    cronLogger.info("Processing pending conversions...");
    const pendingResults = await processPendingConversions();
    cronLogger.info("Pending conversions completed", pendingResults);
    cronLogger.info("Processing pending conversion retries...");
    const retryResults = await processRetries();
    cronLogger.info("Retries completed", retryResults);
    cronLogger.info("Running daily delivery health check...");
    const healthCheckResults = await runAllShopsDeliveryHealthCheck();
    const successful = healthCheckResults.filter((r) => r.success).length;
    const failed = healthCheckResults.filter((r) => !r.success).length;
    cronLogger.info("Running daily reconciliation...");
    const reconciliationResults = await runAllShopsReconciliation();
    cronLogger.info("Reconciliation completed", {
        processed: reconciliationResults.processed,
        succeeded: reconciliationResults.succeeded,
        failed: reconciliationResults.failed,
        reportsGenerated: reconciliationResults.results.length,
    });
    cronLogger.info("Cleaning up expired data...");
    const cleanupResults = await cleanupExpiredData();
    cronLogger.info("Cleanup completed", cleanupResults);
    const totalDeleted = cleanupResults.conversionLogsDeleted +
        cleanupResults.conversionJobsDeleted +
        cleanupResults.pixelEventReceiptsDeleted +
        cleanupResults.surveyResponsesDeleted +
        cleanupResults.auditLogsDeleted +
        cleanupResults.webhookLogsDeleted +
        cleanupResults.scanReportsDeleted +
        cleanupResults.reconciliationReportsDeleted +
        cleanupResults.gdprJobsDeleted +
        cleanupResults.eventNoncesDeleted;
    if (totalDeleted > 0) {
        cronLogger.info("[METRIC] retention_cleanup", {
            _metric: "retention_cleanup",
            totalDeleted,
            ...cleanupResults,
        });
    }
    cronLogger.info("Refreshing shop tier and TYP/OSP status...");
    const shopStatusRefresh = await refreshAllShopsStatus(cronLogger);
    cronLogger.info("Shop status refresh completed", shopStatusRefresh);
    return {
        gdpr: gdprResults,
        gdprCompliance,
        consent: consentResults,
        jobs: jobResults,
        pending: pendingResults,
        retries: retryResults,
        deliveryHealth: { successful, failed, results: healthCheckResults },
        reconciliation: {
            processed: reconciliationResults.processed,
            succeeded: reconciliationResults.succeeded,
            failed: reconciliationResults.failed,
            reportsGenerated: reconciliationResults.results.length,
        },
        cleanup: cleanupResults,
        shopStatusRefresh,
    };
}
async function refreshAllShopsStatus(cronLogger: ReturnType<typeof createRequestLogger>): Promise<{
    shopsProcessed: number;
    tierUpdates: number;
    typOspUpdates: number;
    typOspUnknown: number;
    typOspUnknownReasons: Record<string, number>;
    errors: number;
}> {
    let tierUpdates = 0;
    let typOspUpdates = 0;
    let typOspUnknown = 0;
    const typOspUnknownReasons: Record<string, number> = {};
    let errors = 0;
    const staleThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const shopsToRefresh = await prisma.shop.findMany({
        where: {
            isActive: true,
            OR: [
                { typOspLastCheckedAt: null },
                { typOspLastCheckedAt: { lt: staleThreshold } },
                { typOspUpdatedAt: null },
                { typOspUpdatedAt: { lt: staleThreshold } },
                { shopTier: "unknown" },
                { shopTier: null },
            ],
        },
        select: {
            id: true,
            shopDomain: true,
            shopTier: true,
            typOspPagesEnabled: true,
            typOspLastCheckedAt: true,
            typOspUpdatedAt: true,
        },
        take: 50,
    });
    cronLogger.info(`Found ${shopsToRefresh.length} shops needing status refresh`);
    for (const shop of shopsToRefresh) {
        try {
            const tierResult = await refreshShopTier(shop.id);
            if (tierResult.updated) {
                tierUpdates++;
                cronLogger.info(`Updated shopTier for ${shop.shopDomain}`, {
                    oldTier: shop.shopTier,
                    newTier: tierResult.tier,
                });
            }
            const typOspResult = await refreshTypOspStatusWithOfflineToken(shop.id, shop.shopDomain);
            if (typOspResult.status === "unknown") {
                typOspUnknown++;
                const reason = typOspResult.unknownReason || "UNKNOWN";
                typOspUnknownReasons[reason] = (typOspUnknownReasons[reason] || 0) + 1;
                cronLogger.debug(`TYP/OSP unknown for ${shop.shopDomain}`, {
                    reason: typOspResult.unknownReason,
                    error: typOspResult.error,
                });
            }
            else if (typOspResult.typOspPagesEnabled !== shop.typOspPagesEnabled) {
                typOspUpdates++;
                cronLogger.info(`Updated typOspPagesEnabled for ${shop.shopDomain}`, {
                    oldValue: shop.typOspPagesEnabled,
                    newValue: typOspResult.typOspPagesEnabled,
                    status: typOspResult.status,
                });
            }
        }
        catch (error) {
            errors++;
            cronLogger.warn(`Failed to refresh status for ${shop.shopDomain}:`, {
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }
    if (Object.keys(typOspUnknownReasons).length > 0) {
        cronLogger.info(`TYP/OSP unknown reasons distribution:`, typOspUnknownReasons);
    }
    return {
        shopsProcessed: shopsToRefresh.length,
        tierUpdates,
        typOspUpdates,
        typOspUnknown,
        typOspUnknownReasons,
        errors,
    };
}
async function handleCronRequest(request: Request, method: "POST" | "GET"): Promise<Response> {
    const methodSuffix = method === "GET" ? " (GET)" : "";
    const requestId = generateRequestId();
    const cronLogger = createRequestLogger(requestId, {
        component: "cron",
        ...(method === "GET" && { method: "GET" })
    });
    const startTime = Date.now();
    cronLogger.info(`Cron execution started${methodSuffix}`);
    const rateLimit = checkRateLimit(request, "cron");
    if (rateLimit.isLimited) {
        cronLogger.warn(`Cron endpoint rate limited${methodSuffix}`);
        return createRateLimitResponse(rateLimit.retryAfter);
    }
    const authError = validateCronAuth(request);
    if (authError) {
        cronLogger.warn(`Cron auth failed${methodSuffix}`);
        return authError;
    }
    const lockResult = await withCronLock("main", requestId, async () => {
        return executeCronTasks(cronLogger);
    });
    const durationMs = Date.now() - startTime;
    if (lockResult.lockSkipped) {
        cronLogger.info(`Cron execution skipped${methodSuffix} - lock held by another instance`, {
            reason: lockResult.reason,
            durationMs,
        });
        return json({
            success: true,
            skipped: true,
            message: "Cron skipped - another instance is already running",
            reason: lockResult.reason,
            requestId,
            durationMs,
        }) as unknown as Response;
    }
    if (!lockResult.executed || !lockResult.result) {
        cronLogger.error(`Cron execution failed unexpectedly${methodSuffix}`, undefined, { durationMs });
        return json({
            success: false,
            requestId,
            durationMs,
            error: "Execution failed unexpectedly",
        }, { status: 500 }) as unknown as Response;
    }
    cronLogger.info(`Cron execution completed${methodSuffix}`, { durationMs });
    return json({
        success: true,
        message: "Cron completed",
        requestId,
        durationMs,
        ...lockResult.result,
    }) as unknown as Response;
}
export const action = async ({ request }: ActionFunctionArgs) => {
    return handleCronRequest(request, "POST");
};
export const loader = async ({ request }: LoaderFunctionArgs) => {
    return handleCronRequest(request, "GET");
};
