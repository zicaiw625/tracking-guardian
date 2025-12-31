

import { processGDPRJobs, checkGDPRCompliance } from "../../services/gdpr.server";
import { reconcilePendingConsent } from "../../services/consent-reconciler.server";
import { processConversionJobs, processPendingConversions, processRetries } from "../../services/retry.server";
import { runAllShopsDeliveryHealthCheck, type DeliveryHealthJobResult } from "../../services/delivery-health.server";
import { runAllShopsReconciliation, type ReconciliationResult } from "../../services/reconciliation.server";
import { runAllShopAlertChecks } from "../../services/alert-dispatcher.server";
import { cleanupExpiredNonces } from "../../services/capi-dedup.server";
import { logger } from "../../utils/logger.server";
import { cleanupExpiredData } from "./cleanup";
import { refreshAllShopsStatus } from "./shop-status";
import type { CronResult, CronLogger } from "../types";
import type { GDPRComplianceResult } from "../../services/gdpr.server";

export async function executeCronTasks(cronLogger: CronLogger): Promise<CronResult> {

  let gdprResults = { processed: 0, succeeded: 0, failed: 0 };
  try {
    cronLogger.info("Processing GDPR jobs...");
    gdprResults = await processGDPRJobs();
    cronLogger.info("GDPR processing completed", { ...gdprResults });
  } catch (error) {
    cronLogger.error("GDPR processing failed", error);
  }

  let gdprCompliance: GDPRComplianceResult = {
    isCompliant: true,
    overdueCount: 0,
    criticals: [],
    pendingCount: 0,
    warnings: [],
    oldestPendingAge: null
  };
  try {
    cronLogger.info("Checking GDPR compliance...");
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

  let consentResults = { processed: 0, resolved: 0, expired: 0, errors: 0 };
  try {
    cronLogger.info("Reconciling pending consent...");
    consentResults = await reconcilePendingConsent();
    cronLogger.info("Consent reconciliation completed", { ...consentResults });
  } catch (error) {
    cronLogger.error("Consent reconciliation failed", error);
  }

  let jobResults = { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0, skipped: 0 };
  try {
    cronLogger.info("Processing conversion jobs...");
    jobResults = await processConversionJobs();
    cronLogger.info("Conversion jobs completed", { ...jobResults });
  } catch (error) {
    cronLogger.error("Conversion jobs failed", error);
  }

  let pendingResults = { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0 };
  if (process.env.LEGACY_LOG_SENDER === "1") {
    try {
      cronLogger.info("[LEGACY] Processing pending conversions...");
      pendingResults = await processPendingConversions();
      cronLogger.info("[LEGACY] Pending conversions completed", pendingResults);
    } catch (error) {
      cronLogger.error("[LEGACY] Pending conversions failed", error);
    }
  } else {
    cronLogger.debug("Skipping legacy pending conversions (LEGACY_LOG_SENDER not enabled)");
  }

  let retryResults = { processed: 0, succeeded: 0, failed: 0, limitExceeded: 0 };
  if (process.env.LEGACY_LOG_SENDER === "1") {
    try {
      cronLogger.info("[LEGACY] Processing pending conversion retries...");
      retryResults = await processRetries();
      cronLogger.info("[LEGACY] Retries completed", retryResults);
    } catch (error) {
      cronLogger.error("[LEGACY] Retries processing failed", error);
    }
  } else {
    cronLogger.debug("Skipping legacy retries (LEGACY_LOG_SENDER not enabled)");
  }

  let healthCheckResults: DeliveryHealthJobResult[] = [];
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

  let reconciliationResults: {
    processed: number;
    succeeded: number;
    failed: number;
    results: ReconciliationResult[];
  } = { processed: 0, succeeded: 0, failed: 0, results: [] };

  try {
    cronLogger.info("Running daily reconciliation...");
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
    migrationDraftsDeleted: 0,
  };
  try {
    cronLogger.info("Cleaning up expired data...");
    cleanupResults = await cleanupExpiredData();
    cronLogger.info("Cleanup completed", { ...cleanupResults });

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
      cleanupResults.eventNoncesDeleted +
      cleanupResults.migrationDraftsDeleted;

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

  let alertResults = { shopsChecked: 0, totalTriggered: 0, totalSent: 0 };
  try {
    cronLogger.info("Running alert checks...");
    alertResults = await runAllShopAlertChecks();
    cronLogger.info("Alert checks completed", { ...alertResults });
  } catch (error) {
    cronLogger.error("Alert checks failed", error);
  }

  let noncesCleanedUp = 0;
  try {
    cronLogger.info("Cleaning up expired event nonces...");
    noncesCleanedUp = await cleanupExpiredNonces();
    if (noncesCleanedUp > 0) {
      cronLogger.info("Nonces cleanup completed", { count: noncesCleanedUp });
    }
  } catch (error) {
    cronLogger.error("Nonces cleanup failed", error);
  }

  return {
    gdpr: {
        processed: gdprResults.processed,
        succeeded: gdprResults.succeeded,
        failed: gdprResults.failed
    },
    gdprCompliance,

    consent: {
      processed: consentResults.processed,
      matched: consentResults.resolved,
      unmatched: consentResults.expired + consentResults.errors,
    },
    jobs: {
        processed: jobResults.processed,
        succeeded: jobResults.succeeded,
        failed: jobResults.failed,
        limitExceeded: jobResults.limitExceeded,
        skipped: jobResults.skipped
    },
    pending: {
        processed: pendingResults.processed,
        succeeded: pendingResults.succeeded,
        failed: pendingResults.failed,
        limitExceeded: pendingResults.limitExceeded
    },
    retries: {
        processed: retryResults.processed,
        succeeded: retryResults.succeeded,
        failed: retryResults.failed,
        limitExceeded: retryResults.limitExceeded
    },

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
    alerts: {
      shopsChecked: alertResults.shopsChecked,
      triggered: alertResults.totalTriggered,
      sent: alertResults.totalSent,
    },
    noncesCleanedUp,
  };
}

export { cleanupExpiredData } from "./cleanup";
export { refreshAllShopsStatus } from "./shop-status";
