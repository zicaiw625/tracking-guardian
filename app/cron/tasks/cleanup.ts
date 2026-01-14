import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { cleanupExpiredDrafts } from "../../services/migration-draft.server";

const EVENT_NONCE_EXPIRY_HOURS = 24;
const GDPR_JOB_RETENTION_DAYS = 90;
const MIN_AUDIT_LOG_RETENTION_DAYS = 180;

export interface CleanupResult {
  eventNoncesDeleted: number;
  migrationDraftsDeleted: number;
  gdprJobsDeleted: number;
  shopsProcessed: number;
  conversionLogsDeleted: number;
  surveyResponsesDeleted: number;
  auditLogsDeleted: number;
  conversionJobsDeleted: number;
  pixelEventReceiptsDeleted: number;
  webhookLogsDeleted: number;
  reconciliationReportsDeleted: number;
  scanReportsDeleted: number;
}

export async function cleanupExpiredData(): Promise<CleanupResult> {
  const result: CleanupResult = {
    eventNoncesDeleted: 0,
    migrationDraftsDeleted: 0,
    gdprJobsDeleted: 0,
    shopsProcessed: 0,
    conversionLogsDeleted: 0,
    surveyResponsesDeleted: 0,
    auditLogsDeleted: 0,
    conversionJobsDeleted: 0,
    pixelEventReceiptsDeleted: 0,
    webhookLogsDeleted: 0,
    reconciliationReportsDeleted: 0,
    scanReportsDeleted: 0,
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
          in: ["completed", "failed"],
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
        const conversionLogs = await prisma.conversionLog.findMany({
          where: {
            shopId: shop.id,
            createdAt: {
              lt: cutoffDate,
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (conversionLogs.length > 0) {
          const deleteResult = await prisma.conversionLog.deleteMany({
            where: {
              id: {
                in: conversionLogs.map((log) => log.id),
              },
            },
          });
          result.conversionLogsDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup conversion logs", { shopId: shop.id, error });
      }

      try {
        const surveyResponses = await prisma.surveyResponse.findMany({
          where: {
            shopId: shop.id,
            createdAt: {
              lt: cutoffDate,
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (surveyResponses.length > 0) {
          const deleteResult = await prisma.surveyResponse.deleteMany({
            where: {
              id: {
                in: surveyResponses.map((r) => r.id),
              },
            },
          });
          result.surveyResponsesDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup survey responses", { shopId: shop.id, error });
      }

      try {
        const auditLogCutoff = new Date(
          Date.now() - Math.max(retentionDays, MIN_AUDIT_LOG_RETENTION_DAYS) * 24 * 60 * 60 * 1000
        );
        const auditLogs = await prisma.auditLog.findMany({
          where: {
            shopId: shop.id,
            createdAt: {
              lt: auditLogCutoff,
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (auditLogs.length > 0) {
          const deleteResult = await prisma.auditLog.deleteMany({
            where: {
              id: {
                in: auditLogs.map((log) => log.id),
              },
            },
          });
          result.auditLogsDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup audit logs", { shopId: shop.id, error });
      }

      try {
        const conversionJobs = await prisma.conversionJob.findMany({
          where: {
            shopId: shop.id,
            createdAt: {
              lt: cutoffDate,
            },
            status: {
              in: ["completed", "failed"],
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (conversionJobs.length > 0) {
          const deleteResult = await prisma.conversionJob.deleteMany({
            where: {
              id: {
                in: conversionJobs.map((job) => job.id),
              },
            },
          });
          result.conversionJobsDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup conversion jobs", { shopId: shop.id, error });
      }

      try {
        const pixelEventReceipts = await prisma.pixelEventReceipt.findMany({
          where: {
            shopId: shop.id,
            createdAt: {
              lt: cutoffDate,
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (pixelEventReceipts.length > 0) {
          const deleteResult = await prisma.pixelEventReceipt.deleteMany({
            where: {
              id: {
                in: pixelEventReceipts.map((r) => r.id),
              },
            },
          });
          result.pixelEventReceiptsDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup pixel event receipts", { shopId: shop.id, error });
      }

      try {
        const webhookLogs = await prisma.webhookLog.findMany({
          where: {
            shopDomain: shop.shopDomain,
            receivedAt: {
              lt: cutoffDate,
            },
            status: {
              in: ["processed", "failed"],
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (webhookLogs.length > 0) {
          const deleteResult = await prisma.webhookLog.deleteMany({
            where: {
              id: {
                in: webhookLogs.map((log) => log.id),
              },
            },
          });
          result.webhookLogsDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup webhook logs", { shopId: shop.id, error });
      }

      try {
        const reconciliationReports = await prisma.reconciliationReport.findMany({
          where: {
            shopId: shop.id,
            createdAt: {
              lt: cutoffDate,
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (reconciliationReports.length > 0) {
          const deleteResult = await prisma.reconciliationReport.deleteMany({
            where: {
              id: {
                in: reconciliationReports.map((r) => r.id),
              },
            },
          });
          result.reconciliationReportsDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup reconciliation reports", { shopId: shop.id, error });
      }

      try {
        const scanReports = await prisma.scanReport.findMany({
          where: {
            shopId: shop.id,
            createdAt: {
              lt: cutoffDate,
            },
          },
          select: {
            id: true,
          },
          take: 1000,
        });

        if (scanReports.length > 0) {
          const deleteResult = await prisma.scanReport.deleteMany({
            where: {
              id: {
                in: scanReports.map((r) => r.id),
              },
            },
          });
          result.scanReportsDeleted += deleteResult.count;
        }
      } catch (error) {
        logger.error("Failed to cleanup scan reports", { shopId: shop.id, error });
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

  return result;
}
