/**
 * Cron Task Executor
 *
 * Orchestrates execution of all cron tasks in the correct order.
 */

import { processGDPRJobs, checkGDPRCompliance } from "../../services/gdpr.server";
import { reconcilePendingConsent } from "../../services/consent-reconciler.server";
import { processConversionJobs, processPendingConversions, processRetries } from "../../services/retry.server";
import { runAllShopsDeliveryHealthCheck } from "../../services/delivery-health.server";
import { runAllShopsReconciliation } from "../../services/reconciliation.server";
import { logger } from "../../utils/logger.server";
import { cleanupExpiredData } from "./cleanup";
import { refreshAllShopsStatus } from "./shop-status";
import type { CronResult, CronLogger } from "../types";

// =============================================================================
// Task Executor
// =============================================================================

/**
 * Execute all cron tasks in sequence.
 *
 * @param cronLogger - Logger with request context
 * @returns Combined results from all tasks
 */
export async function executeCronTasks(cronLogger: CronLogger): Promise<CronResult> {
  // 1. Process GDPR jobs first (compliance priority)
  cronLogger.info("Processing GDPR jobs...");
  const gdprResults = await processGDPRJobs();
  cronLogger.info("GDPR processing completed", { ...gdprResults });

  // 2. Check GDPR compliance
  cronLogger.info("Checking GDPR compliance...");
  const gdprCompliance = await checkGDPRCompliance();

  if (!gdprCompliance.isCompliant) {
    cronLogger.error("GDPR COMPLIANCE VIOLATION!", undefined, {
      overdueCount: gdprCompliance.overdueCount,
      criticals: gdprCompliance.criticals,
    });
  } else if (gdprCompliance.warnings.length > 0) {
    cronLogger.warn("GDPR compliance warnings", {
      pendingCount: gdprCompliance.pendingCount,
      oldestAge: gdprCompliance.oldestPendingAge,
    });
  } else {
    cronLogger.info("GDPR compliance check passed", {
      pendingCount: gdprCompliance.pendingCount,
    });
  }

  // 3. Reconcile pending consent
  cronLogger.info("Reconciling pending consent...");
  const consentResults = await reconcilePendingConsent();
  cronLogger.info("Consent reconciliation completed", { ...consentResults });

  // 4. Process conversion jobs
  cronLogger.info("Processing conversion jobs...");
  const jobResults = await processConversionJobs();
  cronLogger.info("Conversion jobs completed", { ...jobResults });

  // 5. Process pending conversions
  cronLogger.info("Processing pending conversions...");
  const pendingResults = await processPendingConversions();
  cronLogger.info("Pending conversions completed", pendingResults);

  // 6. Process retries
  cronLogger.info("Processing pending conversion retries...");
  const retryResults = await processRetries();
  cronLogger.info("Retries completed", retryResults);

  // 7. Run delivery health check
  cronLogger.info("Running daily delivery health check...");
  const healthCheckResults = await runAllShopsDeliveryHealthCheck();
  const successful = healthCheckResults.filter((r) => r.success).length;
  const failed = healthCheckResults.filter((r) => !r.success).length;

  // 8. Run reconciliation
  cronLogger.info("Running daily reconciliation...");
  const reconciliationResults = await runAllShopsReconciliation();
  cronLogger.info("Reconciliation completed", {
    processed: reconciliationResults.processed,
    succeeded: reconciliationResults.succeeded,
    failed: reconciliationResults.failed,
    reportsGenerated: reconciliationResults.results.length,
  });

  // 9. Clean up expired data
  cronLogger.info("Cleaning up expired data...");
  const cleanupResults = await cleanupExpiredData();
  cronLogger.info("Cleanup completed", { ...cleanupResults });

  // Log cleanup metrics
  const totalDeleted =
    cleanupResults.conversionLogsDeleted +
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

  // 10. Refresh shop status
  cronLogger.info("Refreshing shop tier and TYP/OSP status...");
  const shopStatusRefresh = await refreshAllShopsStatus(cronLogger);
  cronLogger.info("Shop status refresh completed", { ...shopStatusRefresh });

  return {
    gdpr: gdprResults,
    gdprCompliance,
    // Map consent result to CronResult type (processed, matched, unmatched)
    consent: {
      processed: consentResults.processed,
      matched: consentResults.resolved,
      unmatched: consentResults.expired + consentResults.errors,
    },
    jobs: jobResults,
    pending: pendingResults,
    retries: retryResults,
    // Map health check results to DeliveryHealthResult
    deliveryHealth: {
      successful,
      failed,
      results: healthCheckResults.map(r => ({
        shopDomain: r.shopId ?? "unknown",
        success: r.success,
        error: r.error,
      })),
    },
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

// =============================================================================
// Re-exports
// =============================================================================

export { cleanupExpiredData } from "./cleanup";
export { refreshAllShopsStatus } from "./shop-status";

