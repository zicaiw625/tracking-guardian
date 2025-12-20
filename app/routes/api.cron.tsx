import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import prisma from "../db.server";
import { runAllShopsDeliveryHealthCheck } from "../services/delivery-health.server";
import { runAllShopsReconciliation } from "../services/reconciliation.server";
import { processPendingConversions, processRetries, processConversionJobs } from "../services/retry.server";
import { reconcilePendingConsent } from "../services/consent-reconciler.server";
import { processGDPRJobs } from "../services/gdpr.server";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";
import { createAuditLog } from "../services/audit.server";
// P1-02: Use unified logger instead of console.log/console.error
import { logger, createRequestLogger } from "../utils/logger";
// P1-03: Cron mutex lock to prevent concurrent execution
import { withCronLock } from "../utils/cron-lock";

function generateRequestId(): string {
  return `cron-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

const REPLAY_PROTECTION_WINDOW_MS = 5 * 60 * 1000;

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
  gdprJobsDeleted: number;  // P0-2: Added GDPR job cleanup
}> {
  // P0-2: Clean up old GDPR jobs (completed/failed jobs older than 30 days)
  // This ensures we don't retain GDPR-related data longer than necessary
  const gdprCutoff = new Date();
  gdprCutoff.setDate(gdprCutoff.getDate() - 30);
  
  const gdprJobResult = await prisma.gDPRJob.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      createdAt: { lt: gdprCutoff },
    },
  });
  
  if (gdprJobResult.count > 0) {
    logger.info(`[P0-2] Cleaned up ${gdprJobResult.count} old GDPR jobs`);
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

  let totalConversionLogs = 0;
  let totalSurveyResponses = 0;
  let totalAuditLogs = 0;
  let totalConversionJobs = 0;
  let totalPixelEventReceipts = 0;
  let totalWebhookLogs = 0;
  let totalScanReports = 0;
  let totalReconciliationReports = 0;

  for (const shop of shops) {
    const retentionDays = shop.dataRetentionDays || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const conversionResult = await prisma.conversionLog.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
        
        status: { in: ["sent", "dead_letter"] },
      },
    });
    totalConversionLogs += conversionResult.count;

    const surveyResult = await prisma.surveyResponse.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
      },
    });
    totalSurveyResponses += surveyResult.count;

    const auditCutoff = new Date();
    auditCutoff.setDate(auditCutoff.getDate() - Math.max(retentionDays, 180));
    const auditResult = await prisma.auditLog.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: auditCutoff },
      },
    });
    totalAuditLogs += auditResult.count;

    const conversionJobResult = await prisma.conversionJob.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
        status: { in: ["completed", "dead_letter"] },
      },
    });
    totalConversionJobs += conversionJobResult.count;

    const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
      },
    });
    totalPixelEventReceipts += pixelReceiptResult.count;

    const webhookLogResult = await prisma.webhookLog.deleteMany({
      where: {
        shopDomain: shop.shopDomain,
        receivedAt: { lt: cutoffDate },
      },
    });
    totalWebhookLogs += webhookLogResult.count;

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

    const reconciliationResult = await prisma.reconciliationReport.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
      },
    });
    totalReconciliationReports += reconciliationResult.count;

    const totalDeleted = 
      conversionResult.count + surveyResult.count + auditResult.count +
      conversionJobResult.count + pixelReceiptResult.count + webhookLogResult.count +
      (oldScanReports.length > 0 ? oldScanReports.length : 0) + reconciliationResult.count;

    if (totalDeleted > 0) {
      // P1-02: Use logger instead of console.log
      logger.info(
        `[P0-06] Data cleanup for ${shop.shopDomain}`,
        {
          conversions: conversionResult.count,
          surveys: surveyResult.count,
          auditLogs: auditResult.count,
          jobs: conversionJobResult.count,
          receipts: pixelReceiptResult.count,
          webhookLogs: webhookLogResult.count,
          scanReports: oldScanReports.length,
          reconciliations: reconciliationResult.count,
        }
      );

      await createAuditLog({
        shopId: shop.id,
        actorType: "cron",
        actorId: "data-retention-cleanup",
        action: "data_cleanup_completed",
        resourceType: "shop",
        resourceId: shop.id,
        metadata: {
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          deletedCounts: {
            conversionLogs: conversionResult.count,
            surveyResponses: surveyResult.count,
            auditLogs: auditResult.count,
            conversionJobs: conversionJobResult.count,
            pixelEventReceipts: pixelReceiptResult.count,
            webhookLogs: webhookLogResult.count,
            scanReports: oldScanReports.length,
            reconciliationReports: reconciliationResult.count,
          },
        },
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
    gdprJobsDeleted: gdprJobResult.count,  // P0-2: Include GDPR cleanup count
  };
}

function verifyReplayProtection(request: Request, cronSecret: string): { valid: boolean; error?: string } {
  const timestamp = request.headers.get("X-Cron-Timestamp");
  const signature = request.headers.get("X-Cron-Signature");

  if (!timestamp) {
    return { valid: true };
  }

  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { valid: false, error: "Invalid timestamp format" };
  }

  const now = Math.floor(Date.now() / 1000); 
  const timeDiff = Math.abs(now - requestTime);
  
  if (timeDiff > REPLAY_PROTECTION_WINDOW_MS / 1000) {
    // P1-02: Use logger
    logger.warn(`Cron request timestamp out of range`, { timeDiff });
    return { valid: false, error: "Request timestamp out of range (possible replay attack)" };
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
    } catch {
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
      // P1-02: Use logger
      logger.error("CRITICAL: CRON_SECRET environment variable is not set in production");
      return json(
        { error: "Cron endpoint not configured" },
        { status: 503 }
      ) as unknown as Response;
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

    // P1-02: Use logger - don't log auth header content
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

export const action = async ({ request }: ActionFunctionArgs) => {
  // P1-02: Use request-scoped logger with requestId for tracing
  const requestId = generateRequestId();
  const cronLogger = createRequestLogger(requestId, { component: "cron" });
  const startTime = Date.now();
  
  cronLogger.info("Cron execution started");

  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    cronLogger.warn("Cron endpoint rate limited");
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    cronLogger.warn("Cron auth failed");
    return authError;
  }

  // P1-03: Use distributed lock to prevent concurrent cron execution
  const lockResult = await withCronLock("main", requestId, async () => {
    cronLogger.info("Processing GDPR jobs...");
    const gdprResults = await processGDPRJobs();
    cronLogger.info("GDPR processing completed", gdprResults);

    cronLogger.info("Reconciling pending consent...");
    const consentResults = await reconcilePendingConsent();
    cronLogger.info("Consent reconciliation completed", consentResults);

    cronLogger.info("Processing conversion jobs...");
    const jobResults = await processConversionJobs();
    cronLogger.info("Conversion jobs completed", jobResults);

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
    cronLogger.info("[P0-06] Cleanup completed", cleanupResults);

    return {
      gdpr: gdprResults,
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
    };
  });

  const durationMs = Date.now() - startTime;

  // P1-03: Handle lock skip case
  if (lockResult.lockSkipped) {
    cronLogger.info("Cron execution skipped - lock held by another instance", {
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
    });
  }

  if (!lockResult.executed || !lockResult.result) {
    cronLogger.error("Cron execution failed unexpectedly", undefined, { durationMs });
    return json(
      {
        success: false,
        requestId,
        durationMs,
        error: "Execution failed unexpectedly",
      },
      { status: 500 }
    );
  }

  cronLogger.info("Cron execution completed", { durationMs });

  return json({
    success: true,
    message: "Cron completed",
    requestId,
    durationMs,
    ...lockResult.result,
  });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // P1-02: Use request-scoped logger
  const requestId = generateRequestId();
  const cronLogger = createRequestLogger(requestId, { component: "cron", method: "GET" });
  const startTime = Date.now();
  
  cronLogger.info("Cron execution started (GET)");

  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    cronLogger.warn("Cron endpoint rate limited (GET)");
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    cronLogger.warn("Cron auth failed (GET)");
    return authError;
  }

  // P1-03: Use distributed lock to prevent concurrent cron execution
  const lockResult = await withCronLock("main", requestId, async () => {
    cronLogger.info("Processing GDPR jobs...");
    const gdprResults = await processGDPRJobs();
    cronLogger.info("GDPR processing completed", gdprResults);

    cronLogger.info("Reconciling pending consent...");
    const consentResults = await reconcilePendingConsent();
    cronLogger.info("Consent reconciliation completed", consentResults);

    cronLogger.info("Processing conversion jobs...");
    const jobResults = await processConversionJobs();
    cronLogger.info("Conversion jobs completed", jobResults);

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
    cronLogger.info("[P0-06] Cleanup completed", cleanupResults);

    return {
      gdpr: gdprResults,
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
    };
  });

  const durationMs = Date.now() - startTime;

  // P1-03: Handle lock skip case
  if (lockResult.lockSkipped) {
    cronLogger.info("Cron execution skipped (GET) - lock held by another instance", {
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
    });
  }

  if (!lockResult.executed || !lockResult.result) {
    cronLogger.error("Cron execution failed unexpectedly (GET)", undefined, { durationMs });
    return json(
      {
        success: false,
        requestId,
        durationMs,
        error: "Execution failed unexpectedly",
      },
      { status: 500 }
    );
  }

  cronLogger.info("Cron execution completed (GET)", { durationMs });

  return json({
    success: true,
    message: "Cron completed",
    requestId,
    durationMs,
    ...lockResult.result,
  });
};

