import prisma from "../db.server";
import { logger } from "../utils/logger.server";

const BATCH_SIZE = 1000;
const MIN_AUDIT_LOG_RETENTION_DAYS = 180;

export interface CleanupResult {
  shopsProcessed: number;
  pixelEventReceiptsDeleted: number;
  scanReportsDeleted: number;
  eventLogsDeleted: number;
  deliveryAttemptsDeleted: number;
  totalDeleted: number;
}

export async function cleanupExpiredData(): Promise<CleanupResult> {
  const startTime = Date.now();
  let shopsProcessed = 0;
  let pixelEventReceiptsDeleted = 0;
  let scanReportsDeleted = 0;
  let eventLogsDeleted = 0;
  let deliveryAttemptsDeleted = 0;

  try {
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

    shopsProcessed = shops.length;

    for (const shop of shops) {
      const retentionDays = shop.dataRetentionDays || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      try {
        const receiptIds = await prisma.pixelEventReceipt.findMany({
          where: {
            shopId: shop.id,
            createdAt: { lt: cutoffDate },
          },
          select: { id: true },
          take: BATCH_SIZE,
        });

        if (receiptIds.length > 0) {
          const deleteResult = await prisma.pixelEventReceipt.deleteMany({
            where: { id: { in: receiptIds.map(r => r.id) } },
          });
          pixelEventReceiptsDeleted += deleteResult.count;
          logger.debug(`Cleaned up ${deleteResult.count} pixel event receipts for shop ${shop.shopDomain}`, {
            shopId: shop.id,
            retentionDays,
          });
        }

        const scanReportIds = await prisma.scanReport.findMany({
          where: {
            shopId: shop.id,
            createdAt: { lt: cutoffDate },
          },
          select: { id: true },
          take: BATCH_SIZE,
        });

        if (scanReportIds.length > 0) {
          const deleteResult = await prisma.scanReport.deleteMany({
            where: { id: { in: scanReportIds.map(r => r.id) } },
          });
          scanReportsDeleted += deleteResult.count;
          logger.debug(`Cleaned up ${deleteResult.count} scan reports for shop ${shop.shopDomain}`, {
            shopId: shop.id,
            retentionDays,
          });
        }

        const eventLogIds = await prisma.eventLog.findMany({
          where: {
            shopId: shop.id,
            createdAt: { lt: cutoffDate },
          },
          select: { id: true },
          take: BATCH_SIZE,
        });

        if (eventLogIds.length > 0) {
          const deleteResult = await prisma.eventLog.deleteMany({
            where: { id: { in: eventLogIds.map(e => e.id) } },
          });
          eventLogsDeleted += deleteResult.count;
          logger.debug(`Cleaned up ${deleteResult.count} event logs for shop ${shop.shopDomain}`, {
            shopId: shop.id,
            retentionDays,
          });
        }

        const deliveryAttemptIds = await prisma.deliveryAttempt.findMany({
          where: {
            shopId: shop.id,
            createdAt: { lt: cutoffDate },
          },
          select: { id: true },
          take: BATCH_SIZE,
        });

        if (deliveryAttemptIds.length > 0) {
          const deleteResult = await prisma.deliveryAttempt.deleteMany({
            where: { id: { in: deliveryAttemptIds.map(d => d.id) } },
          });
          deliveryAttemptsDeleted += deleteResult.count;
          logger.debug(`Cleaned up ${deleteResult.count} delivery attempts for shop ${shop.shopDomain}`, {
            shopId: shop.id,
            retentionDays,
          });
        }
      } catch (error) {
        logger.error(`Failed to cleanup data for shop ${shop.shopDomain}`, {
          shopId: shop.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const totalDeleted = pixelEventReceiptsDeleted + scanReportsDeleted + eventLogsDeleted + deliveryAttemptsDeleted;
    const elapsedMs = Date.now() - startTime;

    logger.info(`Data cleanup completed`, {
      shopsProcessed,
      pixelEventReceiptsDeleted,
      scanReportsDeleted,
      eventLogsDeleted,
      deliveryAttemptsDeleted,
      totalDeleted,
      elapsedMs,
    });

    return {
      shopsProcessed,
      pixelEventReceiptsDeleted,
      scanReportsDeleted,
      eventLogsDeleted,
      deliveryAttemptsDeleted,
      totalDeleted,
    };
  } catch (error) {
    logger.error("Data cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
      shopsProcessed,
      pixelEventReceiptsDeleted,
      scanReportsDeleted,
      eventLogsDeleted,
      deliveryAttemptsDeleted,
    });
    throw error;
  }
}
