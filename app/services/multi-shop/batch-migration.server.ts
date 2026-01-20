import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
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
  logger.debug(`batch-migration: pixelTemplate table no longer exists, skipping template lookup`, { templateId: job.templateId });
  if (!job.templateId) {
    throw new Error(`Template ID is required but pixelTemplate table no longer exists`);
  }
  logger.info(`Starting batch migration job ${jobId} for ${job.shopIds.length} shops (template feature disabled)`);
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
      const currentJob = activeJobs.get(jobId);
      if (!currentJob) {
        throw new Error(`Job not found: ${jobId}`);
      }
      logger.debug(`batch-migration: pixelTemplate table no longer exists, skipping platform config from template`);
      const platforms: Array<{
        platform: string;
        eventMappings?: Record<string, string>;
        clientSideEnabled?: boolean;
        serverSideEnabled?: boolean;
      }> = [];
      const v1SupportedPlatforms = ["google", "meta", "tiktok"];
      for (const platformConfig of platforms) {
        if (!v1SupportedPlatforms.includes(platformConfig.platform)) {
          logger.warn(`batch-migration: 跳过不支持的平台 ${platformConfig.platform}`, { shopId });
          continue;
        }
        const existingConfig = await prisma.pixelConfig.findFirst({
          where: {
            shopId,
            platform: platformConfig.platform,
            environment: "test",
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
              id: randomUUID(),
              shopId,
              platform: platformConfig.platform,
              platformId: null,
              eventMappings: platformConfig.eventMappings || {} as object,
              clientSideEnabled: platformConfig.clientSideEnabled ?? true,
              serverSideEnabled: platformConfig.serverSideEnabled ?? false,
              environment: "test",
              updatedAt: new Date(),
            },
          });
        }
      }
      let pixelId: string | undefined;
      try {
        const pixelResult = await createWebPixel(admin, shop.shopDomain, shopId);
        if (pixelResult.success && pixelResult.webPixelId) {
          pixelId = pixelResult.webPixelId;
        }
      } catch (error) {
        logger.warn(`Failed to create web pixel for ${shop.shopDomain}`, { error });
      }
      currentJob.results.push({
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        pixelId,
      });
      currentJob.progress.completed++;
    } catch (error) {
      logger.error(`Batch migration failed for shop ${shopId}`, { error });
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });
      const currentJob = activeJobs.get(jobId);
      if (!currentJob) {
        logger.error(`Job ${jobId} not found when recording failure`);
        return;
      }
      currentJob.results.push({
        shopId,
        shopDomain: shop?.shopDomain || "unknown",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      currentJob.progress.failed++;
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
    // no-op: template used for future template-based summary
  }
  return summary;
}
