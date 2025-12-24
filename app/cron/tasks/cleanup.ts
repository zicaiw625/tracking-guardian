/**
 * Data Cleanup Task
 *
 * Handles cleanup of expired data based on shop-specific retention settings.
 * Uses batched deletes to avoid long-running transactions.
 *
 * P0-02: Optimized with raw SQL for better performance.
 */

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { CleanupResult, DeletableRecord, BatchDeleteResult } from "../types";

// =============================================================================
// Constants
// =============================================================================

const CLEANUP_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 10;

// =============================================================================
// Batch Delete Utility
// =============================================================================

/**
 * Batch delete records with pagination.
 * Deletes in batches to avoid long-running transactions.
 *
 * @param tableName - Name of the table for logging
 * @param findQuery - Function to find records to delete
 * @param deleteByIds - Function to delete records by IDs
 * @returns Total number of deleted records
 */
async function batchDelete<T extends DeletableRecord>(
  tableName: string,
  findQuery: () => Promise<T[]>,
  deleteByIds: (ids: string[]) => Promise<BatchDeleteResult>
): Promise<number> {
  let totalDeleted = 0;
  let batchCount = 0;

  while (batchCount < MAX_BATCHES_PER_RUN) {
    const records = await findQuery();
    if (records.length === 0) {
      break;
    }

    const ids = records.map((r) => r.id);
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

// =============================================================================
// Optimized Direct Deletes
// =============================================================================

/**
 * Direct delete without pre-fetching IDs.
 * More efficient for PostgreSQL when we have simple WHERE conditions.
 *
 * Uses deleteMany directly instead of find + delete pattern.
 * This is faster because it's a single database round trip.
 *
 * @param tableName - Table name for logging
 * @param deleteOperation - Prisma deleteMany operation to execute
 * @returns Total number of deleted records
 */
async function directBatchDelete(
  tableName: string,
  deleteOperation: () => Promise<{ count: number }>
): Promise<number> {
  try {
    const result = await deleteOperation();
    
    if (result.count > 0) {
      logger.debug(`[Cleanup] Direct deleted ${result.count} ${tableName}`);
    }
    
    return result.count;
  } catch (error) {
    logger.error(`[Cleanup] Failed to delete from ${tableName}`, error);
    return 0;
  }
}

// =============================================================================
// Cleanup Task
// =============================================================================

/**
 * Clean up expired data across all tables.
 * Respects shop-specific data retention settings.
 */
export async function cleanupExpiredData(): Promise<CleanupResult> {
  // Clean up expired event nonces
  const eventNonceResult = await prisma.eventNonce.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  if (eventNonceResult.count > 0) {
    logger.info(`Cleaned up ${eventNonceResult.count} expired event nonces`);
  }

  // Clean up old GDPR jobs (completed/failed > 30 days)
  // P0-3: 使用 UTC 确保跨时区一致性
  const gdprCutoff = new Date();
  gdprCutoff.setUTCDate(gdprCutoff.getUTCDate() - 30);

  const gdprJobResult = await prisma.gDPRJob.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      createdAt: { lt: gdprCutoff },
    },
  });

  if (gdprJobResult.count > 0) {
    logger.info(`Cleaned up ${gdprJobResult.count} old GDPR jobs`);
  }

  // Get active shops with data retention configured
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

  // Process each retention group
  for (const [retentionDays, shopsInGroup] of shopsByRetention) {
    const shopIds = shopsInGroup.map((s) => s.id);
    const shopDomains = shopsInGroup.map((s) => s.shopDomain);

    // Calculate cutoff dates
    // P0-3: 使用 UTC 确保跨时区一致性
    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);

    const auditCutoff = new Date();
    auditCutoff.setUTCDate(auditCutoff.getUTCDate() - Math.max(retentionDays, 180));

    // Batch delete all tables in parallel
    const [
      conversionLogsCount,
      surveyResponsesCount,
      auditLogsCount,
      conversionJobsCount,
      pixelReceiptsCount,
      webhookLogsCount,
      reconciliationCount,
    ] = await Promise.all([
      // Conversion logs
      batchDelete(
        "ConversionLog",
        () =>
          prisma.conversionLog.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: cutoffDate },
              status: { in: ["sent", "dead_letter"] },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.conversionLog.deleteMany({ where: { id: { in: ids } } })
      ),

      // Survey responses
      batchDelete(
        "SurveyResponse",
        () =>
          prisma.surveyResponse.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.surveyResponse.deleteMany({ where: { id: { in: ids } } })
      ),

      // Audit logs (minimum 180 days retention for compliance)
      batchDelete(
        "AuditLog",
        () =>
          prisma.auditLog.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: auditCutoff },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.auditLog.deleteMany({ where: { id: { in: ids } } })
      ),

      // Conversion jobs
      batchDelete(
        "ConversionJob",
        () =>
          prisma.conversionJob.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: cutoffDate },
              status: { in: ["completed", "dead_letter"] },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.conversionJob.deleteMany({ where: { id: { in: ids } } })
      ),

      // Pixel event receipts
      batchDelete(
        "PixelEventReceipt",
        () =>
          prisma.pixelEventReceipt.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.pixelEventReceipt.deleteMany({ where: { id: { in: ids } } })
      ),

      // Webhook logs
      batchDelete(
        "WebhookLog",
        () =>
          prisma.webhookLog.findMany({
            where: {
              shopDomain: { in: shopDomains },
              receivedAt: { lt: cutoffDate },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.webhookLog.deleteMany({ where: { id: { in: ids } } })
      ),

      // Reconciliation reports
      batchDelete(
        "ReconciliationReport",
        () =>
          prisma.reconciliationReport.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.reconciliationReport.deleteMany({ where: { id: { in: ids } } })
      ),
    ]);

    totalConversionLogs += conversionLogsCount;
    totalSurveyResponses += surveyResponsesCount;
    totalAuditLogs += auditLogsCount;
    totalConversionJobs += conversionJobsCount;
    totalPixelEventReceipts += pixelReceiptsCount;
    totalWebhookLogs += webhookLogsCount;
    totalReconciliationReports += reconciliationCount;

    // Clean up old scan reports (keep last 5 per shop)
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
          where: { id: { in: oldScanReports.map((r) => r.id) } },
        });
        totalScanReports += scanReportResult.count;
      }
    }

    // Log batch summary
    const totalDeleted =
      conversionLogsCount +
      surveyResponsesCount +
      auditLogsCount +
      conversionJobsCount +
      pixelReceiptsCount +
      webhookLogsCount +
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

