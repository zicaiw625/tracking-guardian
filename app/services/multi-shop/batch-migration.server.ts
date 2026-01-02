

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { AdminApiContext } from "../../types";
import { createWebPixel, updateWebPixel } from "../migration.server";

export interface BatchMigrationJob {
  id: string;
  workspaceId?: string;
  templateId: string;
  shopIds: string[];
  status: "pending" | "running" | "completed" | "failed" | "partial";
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed";
    pixelId?: string;
    error?: string;
  }>;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

const activeJobs = new Map<string, BatchMigrationJob>();

export async function createBatchMigrationJob(
  templateId: string,
  shopIds: string[],
  workspaceId?: string
): Promise<BatchMigrationJob> {
  const job: BatchMigrationJob = {
    id: `batch-migration-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    workspaceId,
    templateId,
    shopIds,
    status: "pending",
    progress: {
      total: shopIds.length,
      completed: 0,
      failed: 0,
    },
    results: [],
    createdAt: new Date(),
  };

  activeJobs.set(job.id, job);
  return job;
}

export function getBatchMigrationJob(jobId: string): BatchMigrationJob | null {
  return activeJobs.get(jobId) || null;
}

export async function executeBatchMigration(
  jobId: string,
  adminContexts: Map<string, AdminApiContext>
): Promise<BatchMigrationJob> {
  const job = activeJobs.get(jobId);
  if (!job) {
    throw new Error(`Batch migration job not found: ${jobId}`);
  }

  if (job.status === "running") {
    logger.warn(`Batch migration job ${jobId} is already running`);
    return job;
  }

  job.status = "running";
  job.startedAt = new Date();
  job.progress = {
    total: job.shopIds.length,
    completed: 0,
    failed: 0,
  };
  job.results = [];

  const template = await prisma.pixelTemplate.findUnique({
    where: { id: job.templateId },
  });

  if (!template) {
    throw new Error(`Template not found: ${job.templateId}`);
  }

  logger.info(`Starting batch migration job ${jobId} for ${job.shopIds.length} shops`);

  const concurrency = 2;
  const shopIds = [...job.shopIds];

  async function processShop(shopId: string): Promise<void> {
    try {
      const admin = adminContexts.get(shopId);
      if (!admin) {
        throw new Error(`Admin context not found for shop ${shopId}`);
      }

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true, ingestionSecret: true },
      });

      if (!shop) {
        throw new Error(`Shop not found: ${shopId}`);
      }

      const platforms = template.platforms as Array<{
        platform: string;
        eventMappings?: Record<string, string>;
        clientSideEnabled?: boolean;
        serverSideEnabled?: boolean;
      }>;

      for (const platformConfig of platforms) {

        const existingConfig = await prisma.pixelConfig.findUnique({
          where: {
            shopId_platform: {
              shopId,
              platform: platformConfig.platform,
            },
          },
        });

        if (existingConfig) {

          await prisma.pixelConfig.update({
            where: { id: existingConfig.id },
            data: {
              eventMappings: platformConfig.eventMappings || {},
              clientSideEnabled: platformConfig.clientSideEnabled ?? true,
              serverSideEnabled: platformConfig.serverSideEnabled ?? false,
            },
          });
        } else {

          await prisma.pixelConfig.create({
            data: {
              shopId,
              platform: platformConfig.platform,
              eventMappings: platformConfig.eventMappings || {},
              clientSideEnabled: platformConfig.clientSideEnabled ?? true,
              serverSideEnabled: platformConfig.serverSideEnabled ?? false,
              environment: "test",
            },
          });
        }
      }

      let pixelId: string | undefined;
      try {
        const pixelResult = await createWebPixel(admin, shop.shopDomain, shopId);
        if (pixelResult.success && pixelResult.pixelId) {
          pixelId = pixelResult.pixelId;
        }
      } catch (error) {

        logger.warn(`Failed to create web pixel for ${shop.shopDomain}, trying to update`, error);
        try {
          const updateResult = await updateWebPixel(admin, shop.shopDomain, shopId);
          if (updateResult.success && updateResult.pixelId) {
            pixelId = updateResult.pixelId;
          }
        } catch (updateError) {
          logger.error(`Failed to update web pixel for ${shop.shopDomain}`, updateError);
        }
      }

      job.results.push({
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        pixelId,
      });

      job.progress.completed++;
    } catch (error) {
      logger.error(`Batch migration failed for shop ${shopId}`, error);

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      job.results.push({
        shopId,
        shopDomain: shop?.shopDomain || "unknown",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      job.progress.failed++;
    }
  }

  for (let i = 0; i < shopIds.length; i += concurrency) {
    const batch = shopIds.slice(i, i + concurrency);
    await Promise.all(batch.map(processShop));
  }

  if (job.progress.failed === 0) {
    job.status = "completed";
  } else if (job.progress.completed === 0) {
    job.status = "failed";
  } else {
    job.status = "partial";
  }

  job.completedAt = new Date();

  logger.info(
    `Batch migration job ${jobId} completed: ${job.progress.completed} success, ${job.progress.failed} failed`
  );

  return job;
}

export async function getBatchMigrationHistory(
  workspaceId: string,
  limit: number = 10
): Promise<BatchMigrationJob[]> {

  const jobs = Array.from(activeJobs.values())
    .filter((job) => job.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return jobs;
}

export function getBatchMigrationSummary(job: BatchMigrationJob): {
  total: number;
  success: number;
  failed: number;
  successRate: number;
  platforms: Record<string, number>;
} {
  const summary = {
    total: job.progress.total,
    success: job.progress.completed,
    failed: job.progress.failed,
    successRate: job.progress.total > 0
      ? (job.progress.completed / job.progress.total) * 100
      : 0,
    platforms: {} as Record<string, number>,
  };

  const template = activeJobs.get(job.id);
  if (template) {

  }

  return summary;
}

