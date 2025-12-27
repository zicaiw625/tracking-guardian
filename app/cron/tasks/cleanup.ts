

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { CleanupResult, DeletableRecord, BatchDeleteResult } from "../types";

const CLEANUP_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 10;

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

export async function cleanupExpiredData(): Promise<CleanupResult> {

  const eventNonceResult = await prisma.eventNonce.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  if (eventNonceResult.count > 0) {
    logger.info(`Cleaned up ${eventNonceResult.count} expired event nonces`);
  }

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

  for (const [retentionDays, shopsInGroup] of shopsByRetention) {
    const shopIds = shopsInGroup.map((s) => s.id);
    const shopDomains = shopsInGroup.map((s) => s.shopDomain);

    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);

    const auditCutoff = new Date();
    auditCutoff.setUTCDate(auditCutoff.getUTCDate() - Math.max(retentionDays, 180));

    const [
      conversionLogsCount,
      surveyResponsesCount,
      auditLogsCount,
      conversionJobsCount,
      pixelReceiptsCount,
      webhookLogsCount,
      scanReportsCount,
      reconciliationCount,
    ] = await Promise.all([

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

      batchDelete(
        "ScanReport",
        () =>
          prisma.scanReport.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.scanReport.deleteMany({ where: { id: { in: ids } } })
      ),

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
    totalScanReports += scanReportsCount;
    totalReconciliationReports += reconciliationCount;

    const totalDeleted =
      conversionLogsCount +
      surveyResponsesCount +
      auditLogsCount +
      conversionJobsCount +
      pixelReceiptsCount +
      webhookLogsCount +
      scanReportsCount +
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
        scanReports: scanReportsCount,
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

