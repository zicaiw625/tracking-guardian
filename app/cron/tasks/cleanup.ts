

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

  let totalMigrationDrafts = 0;
  const migrationDraftResult = await prisma.migrationDraft.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  if (migrationDraftResult.count > 0) {
    logger.info(`Cleaned up ${migrationDraftResult.count} expired migration drafts`);
    totalMigrationDrafts = migrationDraftResult.count;
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
  let totalEventLogs = 0;
  let totalDeliveryAttempts = 0;

  for (const [retentionDays, shopsInGroup] of shopsByRetention) {
    const shopIds = shopsInGroup.map((s) => s.id);
    const shopDomains = shopsInGroup.map((s) => s.shopDomain);

    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);

    const auditCutoff = new Date();
    auditCutoff.setUTCDate(auditCutoff.getUTCDate() - Math.max(retentionDays, 180));

    // P2-1: PRD 对齐 - 事件保留策略（可配置）
    // 
    // PRD 要求：event_logs 30 天热 + 90 天冷（可配置）
    // 
    // 实现策略：
    // - 热数据：30天（DeliveryAttempts，用于实时监控和告警）
    // - 冷数据：90天或商家配置的保留期（EventLogs，用于历史记录和验收报告）
    // - 商家可在 Settings -> Security 中配置 dataRetentionDays（30-365 天，默认 90 天）
    // - 清理任务每日自动执行（通过 cron job）
    // 
    // 注意：
    // - DeliveryAttempts 固定保留 30 天（热数据，用于实时监控）
    // - EventLogs 保留 max(retentionDays, 90) 天（冷数据，至少 90 天）
    // - 其他数据（ConversionLog、PixelEventReceipt 等）按商家配置的 retentionDays 清理
    const hotDataCutoff = new Date();
    hotDataCutoff.setUTCDate(hotDataCutoff.getUTCDate() - 30);
    
    const coldDataCutoff = new Date();
    coldDataCutoff.setUTCDate(coldDataCutoff.getUTCDate() - Math.max(retentionDays, 90));

    const [
      conversionLogsCount,
      surveyResponsesCount,
      auditLogsCount,
      conversionJobsCount,
      pixelReceiptsCount,
      webhookLogsCount,
      scanReportsCount,
      reconciliationCount,
      deliveryAttemptsCount,
      eventLogsCount,
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

      // P0-T5: 清理热数据（30天）- DeliveryAttempts
      batchDelete(
        "DeliveryAttempt",
        () =>
          prisma.deliveryAttempt.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: hotDataCutoff },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.deliveryAttempt.deleteMany({ where: { id: { in: ids } } })
      ),

      // P0-T5: 清理冷数据（90天）- EventLogs
      batchDelete(
        "EventLog",
        () =>
          prisma.eventLog.findMany({
            where: {
              shopId: { in: shopIds },
              createdAt: { lt: coldDataCutoff },
            },
            select: { id: true },
            take: CLEANUP_BATCH_SIZE,
          }),
        (ids) => prisma.eventLog.deleteMany({ where: { id: { in: ids } } })
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
    totalDeliveryAttempts += deliveryAttemptsCount;
    totalEventLogs += eventLogsCount;

    const totalDeleted =
      conversionLogsCount +
      surveyResponsesCount +
      auditLogsCount +
      conversionJobsCount +
      pixelReceiptsCount +
      webhookLogsCount +
      scanReportsCount +
      reconciliationCount +
      deliveryAttemptsCount +
      eventLogsCount;

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
        deliveryAttempts: deliveryAttemptsCount,
        eventLogs: eventLogsCount,
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
    eventLogsDeleted: totalEventLogs,
    deliveryAttemptsDeleted: totalDeliveryAttempts,
    gdprJobsDeleted: gdprJobResult.count,
    eventNoncesDeleted: eventNonceResult.count,
    migrationDraftsDeleted: totalMigrationDrafts,
  };
}

