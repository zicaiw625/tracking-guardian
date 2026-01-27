import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { cleanupExpiredDrafts } from "../../services/migration-draft.server";
import { WebhookStatus, GDPRJobStatus } from "../../types/enums";
import { processShopRedact } from "../../services/gdpr/handlers/shop-redact";
import { RETENTION_CONFIG } from "../../utils/config.server";

const EVENT_NONCE_EXPIRY_HOURS = RETENTION_CONFIG.NONCE_EXPIRY_MS / (60 * 60 * 1000);
const GDPR_JOB_RETENTION_DAYS = 30;
const MIN_AUDIT_LOG_RETENTION_DAYS = 180;
const UNINSTALL_DELETION_HOURS = 48;
const CLEANUP_BATCH_SIZE = 1000;

export interface CleanupResult {
  eventNoncesDeleted: number;
  migrationDraftsDeleted: number;
  gdprJobsDeleted: number;
  shopsProcessed: number;
  surveyResponsesDeleted: number;
  auditLogsDeleted: number;
  pixelEventReceiptsDeleted: number;
  webhookLogsDeleted: number;
  scanReportsDeleted: number;
  eventLogsDeleted: number;
  deliveryAttemptsDeleted: number;
  uninstalledShopsDeleted: number;
  auditAssetsDeleted: number;
}

async function deleteInBatches(
  fetchBatch: (cursor?: string) => Promise<Array<{ id: string }>>,
  deleteBatch: (ids: string[]) => Promise<number>
): Promise<number> {
  let totalDeleted = 0;
  let cursor: string | undefined;
  for (;;) {
    const records = await fetchBatch(cursor);
    if (records.length === 0) {
      break;
    }
    const ids = records.map((record) => record.id);
    totalDeleted += await deleteBatch(ids);
    cursor = records[records.length - 1].id;
    if (records.length < CLEANUP_BATCH_SIZE) {
      break;
    }
  }
  return totalDeleted;
}

export async function cleanupExpiredData(): Promise<CleanupResult> {
  const result: CleanupResult = {
    eventNoncesDeleted: 0,
    migrationDraftsDeleted: 0,
    gdprJobsDeleted: 0,
    shopsProcessed: 0,
    surveyResponsesDeleted: 0,
    auditLogsDeleted: 0,
    pixelEventReceiptsDeleted: 0,
    webhookLogsDeleted: 0,
    scanReportsDeleted: 0,
    eventLogsDeleted: 0,
    deliveryAttemptsDeleted: 0,
    uninstalledShopsDeleted: 0,
    auditAssetsDeleted: 0,
  };

  try {
    const eventNonceCutoff = new Date(Date.now() - EVENT_NONCE_EXPIRY_HOURS * 60 * 60 * 1000);
    const eventNonceResult = await prisma.eventNonce.deleteMany({
      where: {
        expiresAt: {
          lt: eventNonceCutoff,
        },
      },
    });
    result.eventNoncesDeleted = eventNonceResult.count;
    if (result.eventNoncesDeleted > 0) {
      logger.info(`Cleaned up ${result.eventNoncesDeleted} expired event nonces`);
    }
  } catch (error) {
    logger.error("Failed to cleanup expired event nonces", { error });
  }

  try {
    result.migrationDraftsDeleted = await cleanupExpiredDrafts();
  } catch (error) {
    logger.error("Failed to cleanup expired migration drafts", { error });
  }

  try {
    const gdprJobCutoff = new Date(Date.now() - GDPR_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const gdprJobResult = await prisma.gDPRJob.deleteMany({
      where: {
        status: {
          in: [GDPRJobStatus.COMPLETED, GDPRJobStatus.FAILED],
        },
        createdAt: {
          lt: gdprJobCutoff,
        },
      },
    });
    result.gdprJobsDeleted = gdprJobResult.count;
    if (result.gdprJobsDeleted > 0) {
      logger.info(`Cleaned up ${result.gdprJobsDeleted} old GDPR jobs`);
    }
  } catch (error) {
    logger.error("Failed to cleanup old GDPR jobs", { error });
  }

  try {
    const shops = await prisma.shop.findMany({
      where: {
        isActive: true,
        dataRetentionDays: {
          gt: 0,
        },
      },
      select: {
        id: true,
        shopDomain: true,
        dataRetentionDays: true,
      },
    });

    result.shopsProcessed = shops.length;

    for (const shop of shops) {
      const retentionDays = shop.dataRetentionDays || 90;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      try {
        result.surveyResponsesDeleted += await deleteInBatches(
          (cursor) =>
            prisma.surveyResponse.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  lt: cutoffDate,
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.surveyResponse.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup survey responses", { shopId: shop.id, error });
      }

      try {
        const auditLogCutoff = new Date(
          Date.now() - Math.max(retentionDays, MIN_AUDIT_LOG_RETENTION_DAYS) * 24 * 60 * 60 * 1000
        );
        result.auditLogsDeleted += await deleteInBatches(
          (cursor) =>
            prisma.auditLog.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  lt: auditLogCutoff,
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.auditLog.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup audit logs", { shopId: shop.id, error });
      }

      try {
        result.pixelEventReceiptsDeleted += await deleteInBatches(
          (cursor) =>
            prisma.pixelEventReceipt.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  lt: cutoffDate,
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.pixelEventReceipt.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup pixel event receipts", { shopId: shop.id, error });
      }

      try {
        result.webhookLogsDeleted += await deleteInBatches(
          (cursor) =>
            prisma.webhookLog.findMany({
              where: {
                shopDomain: shop.shopDomain,
                receivedAt: {
                  lt: cutoffDate,
                },
                status: {
                  in: [WebhookStatus.PROCESSED, WebhookStatus.FAILED],
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.webhookLog.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup webhook logs", { shopId: shop.id, error });
      }

      try {
        result.scanReportsDeleted += await deleteInBatches(
          (cursor) =>
            prisma.scanReport.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  lt: cutoffDate,
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.scanReport.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup scan reports", { shopId: shop.id, error });
      }

      try {
        result.deliveryAttemptsDeleted += await deleteInBatches(
          (cursor) =>
            prisma.deliveryAttempt.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  lt: cutoffDate,
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.deliveryAttempt.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup delivery attempts", { shopId: shop.id, error });
      }

      try {
        result.eventLogsDeleted += await deleteInBatches(
          (cursor) =>
            prisma.eventLog.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  lt: cutoffDate,
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.eventLog.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup event logs", { shopId: shop.id, error });
      }

      try {
        result.auditAssetsDeleted += await deleteInBatches(
          (cursor) =>
            prisma.auditAsset.findMany({
              where: {
                shopId: shop.id,
                createdAt: {
                  lt: cutoffDate,
                },
              },
              select: {
                id: true,
              },
              orderBy: {
                id: "asc",
              },
              take: CLEANUP_BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
          async (ids) => {
            const deleteResult = await prisma.auditAsset.deleteMany({
              where: {
                id: {
                  in: ids,
                },
              },
            });
            return deleteResult.count;
          }
        );
      } catch (error) {
        logger.error("Failed to cleanup audit assets", { shopId: shop.id, error });
      }
    }
  } catch (error) {
    logger.error("Failed to cleanup shop data", { error });
  }

  try {
    const now = new Date();
    const expiredSecretsResult = await prisma.shop.updateMany({
      where: {
        previousIngestionSecret: {
          not: null,
        },
        previousSecretExpiry: {
          lt: now,
        },
      },
      data: {
        previousIngestionSecret: null,
        previousSecretExpiry: null,
      },
    });
    if (expiredSecretsResult.count > 0) {
      logger.info(`Cleaned up ${expiredSecretsResult.count} expired previous ingestion secrets`);
    }
  } catch (error) {
    logger.error("Failed to cleanup expired previous ingestion secrets", { error });
  }

  try {
    const uninstallCutoff = new Date(Date.now() - UNINSTALL_DELETION_HOURS * 60 * 60 * 1000);
    const uninstalledShops = await prisma.shop.findMany({
      where: {
        isActive: false,
        uninstalledAt: {
          not: null,
          lte: uninstallCutoff,
        },
      },
      select: {
        shopDomain: true,
      },
    });

    for (const shop of uninstalledShops) {
      try {
        await processShopRedact(shop.shopDomain, {});
        result.uninstalledShopsDeleted++;
        logger.info(`Deleted all data for uninstalled shop ${shop.shopDomain} (uninstalled > ${UNINSTALL_DELETION_HOURS}h ago)`);
      } catch (error) {
        logger.error(`Failed to delete data for uninstalled shop ${shop.shopDomain}`, { error });
      }
    }
  } catch (error) {
    logger.error("Failed to cleanup uninstalled shops", { error });
  }

  return result;
}
