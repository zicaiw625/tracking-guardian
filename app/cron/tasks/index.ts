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
  let gdprResults = { processed: 0, successful: 0, failed: 0 };
  try {
    cronLogger.info("Processing GDPR jobs...");
    gdprResults = await processGDPRJobs();
    cronLogger.info("GDPR processing completed", { ...gdprResults });
  } catch (error) {
    cronLogger.error("GDPR processing failed", error);
  }

  // 2. Check GDPR compliance
  let gdprCompliance = { isCompliant: true, overdueCount: 0, criticals: [], pendingCount: 0, warnings: [], oldestPendingAge: 0 };
  try {
    cronLogger.info("Checking GDPR compliance...");
    // @ts-ignore - Ignore type mismatch for now due to complex return type
    gdprCompliance = await checkGDPRCompliance();

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
  } catch (error) {
    cronLogger.error("GDPR compliance check failed", error);
  }

  // 3. Reconcile pending consent
  let consentResults = { processed: 0, resolved: 0, expired: 0, errors: 0 };
  try {
    cronLogger.info("Reconciling pending consent...");
    consentResults = await reconcilePendingConsent();
    cronLogger.info("Consent reconciliation completed", { ...consentResults });
  } catch (error) {
    cronLogger.error("Consent reconciliation failed", error);
  }

  // 4. Process conversion jobs
  let jobResults = { processed: 0, successful: 0, failed: 0 };
  try {
    cronLogger.info("Processing conversion jobs...");
    jobResults = await processConversionJobs();
    cronLogger.info("Conversion jobs completed", { ...jobResults });
  } catch (error) {
    cronLogger.error("Conversion jobs failed", error);
  }

  // 5. Process pending conversions
  let pendingResults = { processed: 0, successful: 0, failed: 0 };
  try {
    cronLogger.info("Processing pending conversions...");
    pendingResults = await processPendingConversions();
    cronLogger.info("Pending conversions completed", pendingResults);
  } catch (error) {
    cronLogger.error("Pending conversions failed", error);
  }

  // 6. Process retries
  let retryResults = { processed: 0, successful: 0, failed: 0 };
  try {
    cronLogger.info("Processing pending conversion retries...");
    retryResults = await processRetries();
    cronLogger.info("Retries completed", retryResults);
  } catch (error) {
    cronLogger.error("Retries processing failed", error);
  }

  // 7. Run delivery health check
  let healthCheckResults: any[] = [];
  let successful = 0;
  let failed = 0;
  try {
    cronLogger.info("Running daily delivery health check...");
    healthCheckResults = await runAllShopsDeliveryHealthCheck();
    successful = healthCheckResults.filter((r) => r.success).length;
    failed = healthCheckResults.filter((r) => !r.success).length;
  } catch (error) {
    cronLogger.error("Delivery health check failed", error);
  }

  // 8. Run reconciliation
  let reconciliationResults = { processed: 0, succeeded: 0, failed: 0, results: [] };
  try {
    cronLogger.info("Running daily reconciliation...");
    // @ts-ignore
    reconciliationResults = await runAllShopsReconciliation();
    cronLogger.info("Reconciliation completed", {
      processed: reconciliationResults.processed,
      succeeded: reconciliationResults.succeeded,
      failed: reconciliationResults.failed,
      reportsGenerated: reconciliationResults.results.length,
    });
  } catch (error) {
    cronLogger.error("Reconciliation failed", error);
  }

  // 9. Clean up expired data
  let cleanupResults = {
    shopsProcessed: 0,
    conversionLogsDeleted: 0,
    surveyResponsesDeleted: 0,
    auditLogsDeleted: 0,
    conversionJobsDeleted: 0,
    pixelEventReceiptsDeleted: 0,
    webhookLogsDeleted: 0,
    scanReportsDeleted: 0,
    reconciliationReportsDeleted: 0,
    gdprJobsDeleted: 0,
    eventNoncesDeleted: 0,
  };
  try {
    cronLogger.info("Cleaning up expired data...");
    cleanupResults = await cleanupExpiredData();
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
  } catch (error) {
    cronLogger.error("Cleanup failed", error);
  }

  // 10. Refresh shop status
  let shopStatusRefresh = {
    shopsProcessed: 0,
    tierUpdates: 0,
    typOspUpdates: 0,
    typOspUnknown: 0,
    typOspUnknownReasons: {},
    errors: 0,
  };
  try {
    cronLogger.info("Refreshing shop tier and TYP/OSP status...");
    shopStatusRefresh = await refreshAllShopsStatus(cronLogger);
    cronLogger.info("Shop status refresh completed", { ...shopStatusRefresh });
  } catch (error) {
    cronLogger.error("Shop status refresh failed", error);
  }

  return {
    gdpr: gdprResults,
    // @ts-ignore
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
}

// =============================================================================
// Re-exports
// =============================================================================

export { cleanupExpiredData } from "./cleanup";
export { refreshAllShopsStatus } from "./shop-status";

