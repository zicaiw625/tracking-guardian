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

// P0-4: Generate unique request ID for logging and tracing
function generateRequestId(): string {
  return `cron-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

// P1-4: Replay protection time window (5 minutes)
const REPLAY_PROTECTION_WINDOW_MS = 5 * 60 * 1000;

/**
 * P2-2 / P3-2 / P0-06 / P1-04: Clean up old data based on each shop's retention settings
 * This runs as part of the daily cron job
 * 
 * IMPORTANT: This is for NORMAL DATA RETENTION, not GDPR compliance!
 * 
 * P1-04 DISTINCTION:
 * - This function: Routine cleanup of old data based on shop's dataRetentionDays setting
 *   - Only applies to ACTIVE shops (isActive: true)
 *   - Only deletes data older than retention period
 *   - Respects business rules (e.g., keeps failed jobs for debugging)
 * 
 * - GDPR shop_redact (gdpr.server.ts): Mandatory complete data deletion
 *   - IGNORES isActive status (runs 48h after uninstall regardless)
 *   - Deletes ALL data immediately (no retention period)
 *   - Required by Shopify/GDPR compliance
 * 
 * These two systems are INDEPENDENT - do not conflate them.
 * 
 * P0-06: Covers ALL data tables including:
 * - ConversionLog, SurveyResponse, AuditLog (original)
 * - ConversionJob, PixelEventReceipt, WebhookLog (P0-06 additions)
 * - ScanReport, ReconciliationReport (P0-06 additions)
 * 
 * P2-2: Writes audit log for each shop's cleanup operation
 */
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
}> {
  // Get all active shops with their retention settings
  const shops = await prisma.shop.findMany({
    where: {
      isActive: true,
      dataRetentionDays: { gt: 0 }, // Only shops with retention enabled
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

    // Delete old ConversionLogs
    const conversionResult = await prisma.conversionLog.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
        // Only delete successfully sent or permanently failed items
        status: { in: ["sent", "dead_letter"] },
      },
    });
    totalConversionLogs += conversionResult.count;

    // Delete old SurveyResponses
    const surveyResult = await prisma.surveyResponse.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
      },
    });
    totalSurveyResponses += surveyResult.count;

    // Delete old AuditLogs (keep them longer - 180 days)
    const auditCutoff = new Date();
    auditCutoff.setDate(auditCutoff.getDate() - Math.max(retentionDays, 180));
    const auditResult = await prisma.auditLog.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: auditCutoff },
      },
    });
    totalAuditLogs += auditResult.count;

    // P0-06: Delete completed/dead_letter ConversionJobs
    const conversionJobResult = await prisma.conversionJob.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
        status: { in: ["completed", "dead_letter"] },
      },
    });
    totalConversionJobs += conversionJobResult.count;

    // P0-06: Delete old PixelEventReceipts
    const pixelReceiptResult = await prisma.pixelEventReceipt.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
      },
    });
    totalPixelEventReceipts += pixelReceiptResult.count;

    // P0-06: Delete old WebhookLogs (uses shopDomain, not shopId)
    const webhookLogResult = await prisma.webhookLog.deleteMany({
      where: {
        shopDomain: shop.shopDomain,
        receivedAt: { lt: cutoffDate },
      },
    });
    totalWebhookLogs += webhookLogResult.count;

    // P0-06: Keep only the most recent N ScanReports per shop
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

    // P0-06: Delete old ReconciliationReports
    const reconciliationResult = await prisma.reconciliationReport.deleteMany({
      where: {
        shopId: shop.id,
        createdAt: { lt: cutoffDate },
      },
    });
    totalReconciliationReports += reconciliationResult.count;

    // P2-2: Write audit log for this shop's cleanup
    const totalDeleted = 
      conversionResult.count + surveyResult.count + auditResult.count +
      conversionJobResult.count + pixelReceiptResult.count + webhookLogResult.count +
      (oldScanReports.length > 0 ? oldScanReports.length : 0) + reconciliationResult.count;

    if (totalDeleted > 0) {
      console.log(
        `[P0-06] Data cleanup for ${shop.shopDomain}: ` +
        `conversions=${conversionResult.count}, surveys=${surveyResult.count}, ` +
        `auditLogs=${auditResult.count}, jobs=${conversionJobResult.count}, ` +
        `receipts=${pixelReceiptResult.count}, webhookLogs=${webhookLogResult.count}, ` +
        `scanReports=${oldScanReports.length}, reconciliations=${reconciliationResult.count}`
      );
      
      // Record cleanup in audit log
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
  };
}

// This endpoint is called by a cron job service (e.g., Vercel Cron, Railway Cron)
// to run daily reconciliation for all shops

/**
 * P1-4: Verify timestamp and optional HMAC signature for replay protection
 * 
 * Supports two authentication modes:
 * 1. Simple Bearer token (backwards compatible)
 * 2. HMAC signature with timestamp (enhanced security)
 * 
 * For HMAC mode, the request should include:
 * - X-Cron-Timestamp: Unix timestamp in seconds
 * - X-Cron-Signature: HMAC-SHA256(secret, timestamp)
 */
function verifyReplayProtection(request: Request, cronSecret: string): { valid: boolean; error?: string } {
  const timestamp = request.headers.get("X-Cron-Timestamp");
  const signature = request.headers.get("X-Cron-Signature");
  
  // If no timestamp header, skip replay protection (allow simple Bearer token auth)
  if (!timestamp) {
    return { valid: true };
  }
  
  // Validate timestamp format
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { valid: false, error: "Invalid timestamp format" };
  }
  
  // Check if request is within acceptable time window
  const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
  const timeDiff = Math.abs(now - requestTime);
  
  if (timeDiff > REPLAY_PROTECTION_WINDOW_MS / 1000) {
    console.warn(`Cron request timestamp out of range: diff=${timeDiff}s`);
    return { valid: false, error: "Request timestamp out of range (possible replay attack)" };
  }
  
  // If signature is provided, verify HMAC
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

/**
 * Validates the cron request authorization
 * Returns an error response if unauthorized, null if authorized
 * 
 * SECURITY NOTE: We require CRON_SECRET for all requests.
 * The x-vercel-cron header alone is NOT sufficient as it can be spoofed.
 * Vercel Cron jobs should be configured to include the Authorization header.
 * 
 * P1-4: Enhanced with replay protection via timestamp validation
 */
function validateCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  // Always require CRON_SECRET to be set in production
  if (!cronSecret) {
    if (isProduction) {
      console.error("CRITICAL: CRON_SECRET environment variable is not set in production");
      return json(
        { error: "Cron endpoint not configured" },
        { status: 503 }
      ) as unknown as Response;
    }
    // In development, allow without auth but warn
    console.warn("⚠️ CRON_SECRET not set. Allowing unauthenticated access in development only.");
    return null;
  }

  // Validate secret length
  if (cronSecret.length < 32) {
    console.warn("⚠️ CRON_SECRET is shorter than recommended 32 characters");
  }

  // Always verify the Authorization header - x-vercel-cron header can be spoofed
  // For Vercel Cron, configure the cron job to include:
  // headers: { "Authorization": "Bearer YOUR_CRON_SECRET" }
  if (authHeader !== `Bearer ${cronSecret}`) {
    const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     request.headers.get("x-real-ip") || 
                     "unknown";
    const vercelCronHeader = request.headers.get("x-vercel-cron");
    
    // Log the attempt with relevant details for security monitoring
    console.warn(
      `Unauthorized cron access attempt: IP=${clientIP}, ` +
      `hasVercelHeader=${!!vercelCronHeader}, ` +
      `hasAuthHeader=${!!authHeader}`
    );
    
    return json({ error: "Unauthorized" }, { status: 401 }) as unknown as Response;
  }
  
  // P1-4: Verify replay protection
  const replayCheck = verifyReplayProtection(request, cronSecret);
  if (!replayCheck.valid) {
    console.warn(`Cron replay protection failed: ${replayCheck.error}`);
    return json({ error: replayCheck.error }, { status: 401 }) as unknown as Response;
  }

  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // P0-4: Generate unique request ID for this cron execution
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  console.log(`[${requestId}] Cron execution started at ${new Date().toISOString()}`);
  
  // Rate limiting check
  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    console.warn(`[${requestId}] Cron endpoint rate limited`);
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    console.warn(`[${requestId}] Cron auth failed`);
    return authError;
  }

  try {
    // P0-01: Process GDPR jobs (data_request, customer_redact, shop_redact)
    console.log(`[${requestId}] Processing GDPR jobs...`);
    const gdprResults = await processGDPRJobs();
    console.log(`GDPR: ${gdprResults.processed} processed, ${gdprResults.succeeded} succeeded, ${gdprResults.failed} failed`);

    // P0-6: Reconcile pending_consent logs (check if pixel events have arrived)
    console.log(`[${requestId}] Reconciling pending consent...`);
    const consentResults = await reconcilePendingConsent();
    console.log(`Consent: ${consentResults.processed} processed, ${consentResults.resolved} resolved, ${consentResults.expired} expired, ${consentResults.errors} errors`);

    // P0-2: Process ConversionJobs (new queue-based async processing)
    console.log("Processing conversion jobs...");
    const jobResults = await processConversionJobs();
    console.log(`Jobs: ${jobResults.processed} processed, ${jobResults.succeeded} succeeded, ${jobResults.failed} failed, ${jobResults.limitExceeded} limit exceeded`);

    // P1-2: Process pending conversions (legacy - for backwards compatibility)
    console.log("Processing pending conversions...");
    const pendingResults = await processPendingConversions();
    console.log(`Pending: ${pendingResults.processed} processed, ${pendingResults.succeeded} succeeded, ${pendingResults.failed} failed`);

    // Process conversion retries (failed items scheduled for retry)
    console.log("Processing pending conversion retries...");
    const retryResults = await processRetries();
    console.log(`Retries: ${retryResults.processed} processed, ${retryResults.succeeded} succeeded, ${retryResults.failed} failed, ${retryResults.limitExceeded || 0} limit exceeded`);

    // Run daily delivery health check
    console.log("Running daily delivery health check...");
    const healthCheckResults = await runAllShopsDeliveryHealthCheck();

    const successful = healthCheckResults.filter((r) => r.success).length;
    const failed = healthCheckResults.filter((r) => !r.success).length;

    // P2-3: Run daily reconciliation (compare Shopify orders vs platform conversions)
    console.log("Running daily reconciliation...");
    const reconciliationResults = await runAllShopsReconciliation();
    console.log(`Reconciliation: ${reconciliationResults.processed} shops processed, ` +
      `${reconciliationResults.succeeded} succeeded, ${reconciliationResults.failed} failed, ` +
      `${reconciliationResults.results.length} reports generated`);

    // P3-2 / P0-06: Clean up expired data based on retention settings
    console.log(`[${requestId}] Cleaning up expired data...`);
    const cleanupResults = await cleanupExpiredData();
    console.log(
      `[${requestId}] [P0-06] Cleanup: ${cleanupResults.shopsProcessed} shops, ` +
      `conversions=${cleanupResults.conversionLogsDeleted}, surveys=${cleanupResults.surveyResponsesDeleted}, ` +
      `auditLogs=${cleanupResults.auditLogsDeleted}, jobs=${cleanupResults.conversionJobsDeleted}, ` +
      `receipts=${cleanupResults.pixelEventReceiptsDeleted}, webhookLogs=${cleanupResults.webhookLogsDeleted}, ` +
      `scanReports=${cleanupResults.scanReportsDeleted}, reconciliations=${cleanupResults.reconciliationReportsDeleted}`
    );

    const durationMs = Date.now() - startTime;
    console.log(`[${requestId}] Cron execution completed in ${durationMs}ms`);

    return json({
      success: true,
      message: `Cron completed`,
      requestId, // P0-4: Include requestId for tracing
      durationMs,
      gdpr: gdprResults,
      consent: consentResults,
      jobs: jobResults,
      pending: pendingResults,
      retries: retryResults,
      deliveryHealth: {
        successful,
        failed,
        results: healthCheckResults,
      },
      reconciliation: {
        processed: reconciliationResults.processed,
        succeeded: reconciliationResults.succeeded,
        failed: reconciliationResults.failed,
        reportsGenerated: reconciliationResults.results.length,
      },
      cleanup: cleanupResults,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${requestId}] Cron job error after ${durationMs}ms:`, error);
    return json(
      {
        success: false,
        requestId, // P0-4: Include requestId even on failure
        durationMs,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

// Also support GET for simple cron services (like Vercel Cron)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // P0-4: Generate unique request ID for this cron execution
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  console.log(`[${requestId}] Cron execution started (GET) at ${new Date().toISOString()}`);
  
  // Rate limiting check
  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    console.warn(`[${requestId}] Cron endpoint rate limited (GET)`);
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    console.warn(`[${requestId}] Cron auth failed (GET)`);
    return authError;
  }

  try {
    // P0-01: Process GDPR jobs (data_request, customer_redact, shop_redact)
    console.log(`[${requestId}] Processing GDPR jobs...`);
    const gdprResults = await processGDPRJobs();
    console.log(`GDPR: ${gdprResults.processed} processed, ${gdprResults.succeeded} succeeded, ${gdprResults.failed} failed`);

    // P0-6: Reconcile pending_consent logs (check if pixel events have arrived)
    console.log(`[${requestId}] Reconciling pending consent...`);
    const consentResults = await reconcilePendingConsent();
    console.log(`Consent: ${consentResults.processed} processed, ${consentResults.resolved} resolved, ${consentResults.expired} expired, ${consentResults.errors} errors`);

    // P0-2: Process ConversionJobs (new queue-based async processing)
    console.log("Processing conversion jobs...");
    const jobResults = await processConversionJobs();
    console.log(`Jobs: ${jobResults.processed} processed, ${jobResults.succeeded} succeeded, ${jobResults.failed} failed, ${jobResults.limitExceeded} limit exceeded`);

    // P1-2: Process pending conversions (legacy - for backwards compatibility)
    console.log("Processing pending conversions...");
    const pendingResults = await processPendingConversions();
    console.log(`Pending: ${pendingResults.processed} processed, ${pendingResults.succeeded} succeeded, ${pendingResults.failed} failed`);

    // Process conversion retries (failed items scheduled for retry)
    console.log("Processing pending conversion retries...");
    const retryResults = await processRetries();
    console.log(`Retries: ${retryResults.processed} processed, ${retryResults.succeeded} succeeded, ${retryResults.failed} failed, ${retryResults.limitExceeded || 0} limit exceeded`);

    // Run daily delivery health check
    console.log("Running daily delivery health check...");
    const healthCheckResults = await runAllShopsDeliveryHealthCheck();

    const successful = healthCheckResults.filter((r) => r.success).length;
    const failed = healthCheckResults.filter((r) => !r.success).length;

    // P2-3: Run daily reconciliation (compare Shopify orders vs platform conversions)
    console.log("Running daily reconciliation...");
    const reconciliationResults = await runAllShopsReconciliation();
    console.log(`Reconciliation: ${reconciliationResults.processed} shops processed, ` +
      `${reconciliationResults.succeeded} succeeded, ${reconciliationResults.failed} failed, ` +
      `${reconciliationResults.results.length} reports generated`);

    // P3-2 / P0-06: Clean up expired data based on retention settings
    console.log(`[${requestId}] Cleaning up expired data...`);
    const cleanupResults = await cleanupExpiredData();
    console.log(
      `[${requestId}] [P0-06] Cleanup: ${cleanupResults.shopsProcessed} shops, ` +
      `conversions=${cleanupResults.conversionLogsDeleted}, surveys=${cleanupResults.surveyResponsesDeleted}, ` +
      `auditLogs=${cleanupResults.auditLogsDeleted}, jobs=${cleanupResults.conversionJobsDeleted}, ` +
      `receipts=${cleanupResults.pixelEventReceiptsDeleted}, webhookLogs=${cleanupResults.webhookLogsDeleted}, ` +
      `scanReports=${cleanupResults.scanReportsDeleted}, reconciliations=${cleanupResults.reconciliationReportsDeleted}`
    );

    const durationMs = Date.now() - startTime;
    console.log(`[${requestId}] Cron execution completed (GET) in ${durationMs}ms`);

    return json({
      success: true,
      message: `Cron completed`,
      requestId, // P0-4: Include requestId for tracing
      durationMs,
      gdpr: gdprResults,
      consent: consentResults,
      jobs: jobResults,
      pending: pendingResults,
      retries: retryResults,
      deliveryHealth: {
        successful,
        failed,
        results: healthCheckResults,
      },
      reconciliation: {
        processed: reconciliationResults.processed,
        succeeded: reconciliationResults.succeeded,
        failed: reconciliationResults.failed,
        reportsGenerated: reconciliationResults.results.length,
      },
      cleanup: cleanupResults,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${requestId}] Cron job error (GET) after ${durationMs}ms:`, error);
    return json(
      {
        success: false,
        requestId, // P0-4: Include requestId even on failure
        durationMs,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

