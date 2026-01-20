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
        let cursor: string | undefined;
        for (;;) {
          const receiptIds = await prisma.pixelEventReceipt.findMany({
            where: {
              shopId: shop.id,
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (receiptIds.length === 0) break;
          const deleteResult = await prisma.pixelEventReceipt.deleteMany({
            where: { id: { in: receiptIds.map((r) => r.id) } },
          });
          pixelEventReceiptsDeleted += deleteResult.count;
          if (deleteResult.count > 0) {
            logger.debug(`Cleaned up ${deleteResult.count} pixel event receipts for shop ${shop.shopDomain}`, {
              shopId: shop.id,
              retentionDays,
            });
          }
          if (receiptIds.length < BATCH_SIZE) break;
          cursor = receiptIds[receiptIds.length - 1].id;
        }

        cursor = undefined;
        for (;;) {
          const scanReportIds: { id: string }[] = await prisma.scanReport.findMany({
            where: {
              shopId: shop.id,
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (scanReportIds.length === 0) break;
          const deleteResult = await prisma.scanReport.deleteMany({
            where: { id: { in: scanReportIds.map((r: { id: string }) => r.id) } },
          });
          scanReportsDeleted += deleteResult.count;
          if (deleteResult.count > 0) {
            logger.debug(`Cleaned up ${deleteResult.count} scan reports for shop ${shop.shopDomain}`, {
              shopId: shop.id,
              retentionDays,
            });
          }
          if (scanReportIds.length < BATCH_SIZE) break;
          cursor = scanReportIds[scanReportIds.length - 1].id;
        }

        cursor = undefined;
        for (;;) {
          const eventLogIds: { id: string }[] = await prisma.eventLog.findMany({
            where: {
              shopId: shop.id,
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (eventLogIds.length === 0) break;
          const deleteResult = await prisma.eventLog.deleteMany({
            where: { id: { in: eventLogIds.map((e: { id: string }) => e.id) } },
          });
          eventLogsDeleted += deleteResult.count;
          if (deleteResult.count > 0) {
            logger.debug(`Cleaned up ${deleteResult.count} event logs for shop ${shop.shopDomain}`, {
              shopId: shop.id,
              retentionDays,
            });
          }
          if (eventLogIds.length < BATCH_SIZE) break;
          cursor = eventLogIds[eventLogIds.length - 1].id;
        }

        cursor = undefined;
        for (;;) {
          const deliveryAttemptIds: { id: string }[] = await prisma.deliveryAttempt.findMany({
            where: {
              shopId: shop.id,
              createdAt: { lt: cutoffDate },
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (deliveryAttemptIds.length === 0) break;
          const deleteResult = await prisma.deliveryAttempt.deleteMany({
            where: { id: { in: deliveryAttemptIds.map((d: { id: string }) => d.id) } },
          });
          deliveryAttemptsDeleted += deleteResult.count;
          if (deleteResult.count > 0) {
            logger.debug(`Cleaned up ${deleteResult.count} delivery attempts for shop ${shop.shopDomain}`, {
              shopId: shop.id,
              retentionDays,
            });
          }
          if (deliveryAttemptIds.length < BATCH_SIZE) break;
          cursor = deliveryAttemptIds[deliveryAttemptIds.length - 1].id;
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
