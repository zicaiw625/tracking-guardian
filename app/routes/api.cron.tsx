import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { runAllShopsDeliveryHealthCheck } from "../services/delivery-health.server";
import { processPendingConversions, processRetries } from "../services/retry.server";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";

/**
 * P3-2: Clean up old data based on each shop's retention settings
 * This runs as part of the daily cron job
 */
async function cleanupExpiredData(): Promise<{
  shopsProcessed: number;
  conversionLogsDeleted: number;
  surveyResponsesDeleted: number;
  auditLogsDeleted: number;
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

    if (conversionResult.count > 0 || surveyResult.count > 0 || auditResult.count > 0) {
      console.log(
        `Data cleanup for ${shop.shopDomain}: ` +
        `${conversionResult.count} conversions, ` +
        `${surveyResult.count} surveys, ` +
        `${auditResult.count} audit logs deleted`
      );
    }
  }

  return {
    shopsProcessed: shops.length,
    conversionLogsDeleted: totalConversionLogs,
    surveyResponsesDeleted: totalSurveyResponses,
    auditLogsDeleted: totalAuditLogs,
  };
}

// This endpoint is called by a cron job service (e.g., Vercel Cron, Railway Cron)
// to run daily reconciliation for all shops

/**
 * Validates the cron request authorization
 * Returns an error response if unauthorized, null if authorized
 * 
 * SECURITY NOTE: We require CRON_SECRET for all requests.
 * The x-vercel-cron header alone is NOT sufficient as it can be spoofed.
 * Vercel Cron jobs should be configured to include the Authorization header.
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

  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Rate limiting check
  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    console.warn("Cron endpoint rate limited");
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    return authError;
  }

  try {
    // P1-2: Process pending conversions first (newly queued from webhooks)
    console.log("Processing pending conversions...");
    const pendingResults = await processPendingConversions();
    console.log(`Pending: ${pendingResults.processed} processed, ${pendingResults.succeeded} succeeded, ${pendingResults.failed} failed`);

    // Process conversion retries (failed items scheduled for retry)
    console.log("Processing pending conversion retries...");
    const retryResults = await processRetries();
    console.log(`Retries: ${retryResults.processed} processed, ${retryResults.succeeded} succeeded, ${retryResults.failed} failed`);

    // Run daily delivery health check
    console.log("Running daily delivery health check...");
    const healthCheckResults = await runAllShopsDeliveryHealthCheck();

    const successful = healthCheckResults.filter((r) => r.success).length;
    const failed = healthCheckResults.filter((r) => !r.success).length;

    // P3-2: Clean up expired data based on retention settings
    console.log("Cleaning up expired data...");
    const cleanupResults = await cleanupExpiredData();
    console.log(`Cleanup: ${cleanupResults.shopsProcessed} shops, ` +
      `${cleanupResults.conversionLogsDeleted} conversions, ` +
      `${cleanupResults.surveyResponsesDeleted} surveys, ` +
      `${cleanupResults.auditLogsDeleted} audit logs deleted`);

    return json({
      success: true,
      message: `Cron completed`,
      pending: pendingResults,
      retries: retryResults,
      deliveryHealth: {
        successful,
        failed,
        results: healthCheckResults,
      },
      cleanup: cleanupResults,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

// Also support GET for simple cron services (like Vercel Cron)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Rate limiting check
  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    console.warn("Cron endpoint rate limited (GET)");
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    return authError;
  }

  try {
    // P1-2: Process pending conversions first (newly queued from webhooks)
    console.log("Processing pending conversions...");
    const pendingResults = await processPendingConversions();
    console.log(`Pending: ${pendingResults.processed} processed, ${pendingResults.succeeded} succeeded, ${pendingResults.failed} failed`);

    // Process conversion retries (failed items scheduled for retry)
    console.log("Processing pending conversion retries...");
    const retryResults = await processRetries();
    console.log(`Retries: ${retryResults.processed} processed, ${retryResults.succeeded} succeeded, ${retryResults.failed} failed`);

    // Run daily delivery health check
    console.log("Running daily delivery health check...");
    const healthCheckResults = await runAllShopsDeliveryHealthCheck();

    const successful = healthCheckResults.filter((r) => r.success).length;
    const failed = healthCheckResults.filter((r) => !r.success).length;

    // P3-2: Clean up expired data based on retention settings
    console.log("Cleaning up expired data...");
    const cleanupResults = await cleanupExpiredData();
    console.log(`Cleanup: ${cleanupResults.shopsProcessed} shops, ` +
      `${cleanupResults.conversionLogsDeleted} conversions, ` +
      `${cleanupResults.surveyResponsesDeleted} surveys, ` +
      `${cleanupResults.auditLogsDeleted} audit logs deleted`);

    return json({
      success: true,
      message: `Cron completed`,
      pending: pendingResults,
      retries: retryResults,
      deliveryHealth: {
        successful,
        failed,
        results: healthCheckResults,
      },
      cleanup: cleanupResults,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

