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
  
  // P1: Optimized batch cleanup - group shops by retention days to reduce DB queries
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

  // Group shops by retention days for batch processing
  const shopsByRetention = new Map<number, Array<{ id: string; shopDomain: string }>>();
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

  // P1: Process each retention group in batch instead of per-shop
  for (const [retentionDays, shopsInGroup] of shopsByRetention) {
    const shopIds = shopsInGroup.map(s => s.id);
    const shopDomains = shopsInGroup.map(s => s.shopDomain);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const auditCutoff = new Date();
    auditCutoff.setDate(auditCutoff.getDate() - Math.max(retentionDays, 180));

    // Batch delete for all shops in this retention group
    const [
      conversionResult,
      surveyResult,
      auditResult,
      conversionJobResult,
      pixelReceiptResult,
      webhookLogResult,
      reconciliationResult,
    ] = await Promise.all([
      prisma.conversionLog.deleteMany({
        where: {
          shopId: { in: shopIds },
          createdAt: { lt: cutoffDate },
          status: { in: ["sent", "dead_letter"] },
        },
      }),
      prisma.surveyResponse.deleteMany({
        where: {
          shopId: { in: shopIds },
          createdAt: { lt: cutoffDate },
        },
      }),
      prisma.auditLog.deleteMany({
        where: {
          shopId: { in: shopIds },
          createdAt: { lt: auditCutoff },
        },
      }),
      prisma.conversionJob.deleteMany({
        where: {
          shopId: { in: shopIds },
          createdAt: { lt: cutoffDate },
          status: { in: ["completed", "dead_letter"] },
        },
      }),
      prisma.pixelEventReceipt.deleteMany({
        where: {
          shopId: { in: shopIds },
          createdAt: { lt: cutoffDate },
        },
      }),
      prisma.webhookLog.deleteMany({
        where: {
          shopDomain: { in: shopDomains },
          receivedAt: { lt: cutoffDate },
        },
      }),
      prisma.reconciliationReport.deleteMany({
        where: {
          shopId: { in: shopIds },
          createdAt: { lt: cutoffDate },
        },
      }),
    ]);

    totalConversionLogs += conversionResult.count;
    totalSurveyResponses += surveyResult.count;
    totalAuditLogs += auditResult.count;
    totalConversionJobs += conversionJobResult.count;
    totalPixelEventReceipts += pixelReceiptResult.count;
    totalWebhookLogs += webhookLogResult.count;
    totalReconciliationReports += reconciliationResult.count;

    // ScanReports need per-shop handling (keep last 5 per shop)
    // But we can batch the delete operation
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

    // Log cleanup results for this retention group
    const totalDeleted = 
      conversionResult.count + surveyResult.count + auditResult.count +
      conversionJobResult.count + pixelReceiptResult.count + webhookLogResult.count +
      reconciliationResult.count;

    if (totalDeleted > 0) {
      logger.info(
        `[P0-06] Batch cleanup for ${shopsInGroup.length} shops (${retentionDays} day retention)`,
        {
          shopsCount: shopsInGroup.length,
          retentionDays,
          conversions: conversionResult.count,
          surveys: surveyResult.count,
          auditLogs: auditResult.count,
          jobs: conversionJobResult.count,
          receipts: pixelReceiptResult.count,
          webhookLogs: webhookLogResult.count,
          reconciliations: reconciliationResult.count,
        }
      );
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
  const isProduction = process.env.NODE_ENV === "production";
  // P1: Check if strict replay protection is enabled (default: true in production)
  const strictReplayProtection = process.env.CRON_STRICT_REPLAY !== "false";

  if (!timestamp) {
    // P1 Fix: In production with strict mode, require timestamp to prevent replay attacks
    if (isProduction && strictReplayProtection) {
      logger.warn("Cron request missing timestamp header in production");
      return { valid: false, error: "Missing timestamp header (required in production)" };
    }
    // In development or with strict mode disabled, allow without timestamp
    // but log a warning
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
    // P1-02: Use logger
    logger.warn(`Cron request timestamp out of range`, { timeDiff });
    return { valid: false, error: "Request timestamp out of range (possible replay attack)" };
  }

  // P1 Fix: In production with strict mode, require signature when timestamp is provided
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

// P1: Extracted shared cron handler to eliminate code duplication between loader and action
interface CronResult {
  gdpr: Awaited<ReturnType<typeof processGDPRJobs>>;
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
}

async function executeCronTasks(
  cronLogger: ReturnType<typeof createRequestLogger>
): Promise<CronResult> {
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
}

async function handleCronRequest(
  request: Request,
  method: "POST" | "GET"
): Promise<Response> {
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

  // P1-03: Use distributed lock to prevent concurrent cron execution
  const lockResult = await withCronLock("main", requestId, async () => {
    return executeCronTasks(cronLogger);
  });

  const durationMs = Date.now() - startTime;

  // P1-03: Handle lock skip case
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
    return json(
      {
        success: false,
        requestId,
        durationMs,
        error: "Execution failed unexpectedly",
      },
      { status: 500 }
    ) as unknown as Response;
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

