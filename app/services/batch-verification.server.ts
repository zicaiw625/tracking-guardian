
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { createVerificationRun, startVerificationRun, analyzeRecentEvents } from "./verification.server";
import { canManageMultipleShops, getShopGroupDetails } from "./multi-shop.server";

export interface BatchVerificationOptions {
  groupId: string;
  requesterId: string;
  targetShopIds?: string[];
  runType?: "quick" | "full" | "custom";
  platforms?: string[];
  concurrency?: number;
}

export interface BatchVerificationJob {
  id: string;
  groupId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
  };
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed" | "skipped";
    runId?: string;
    error?: string;
  }>;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const activeJobs = new Map<string, BatchVerificationJob>();

export async function startBatchVerification(
  options: BatchVerificationOptions
): Promise<{ jobId: string } | { error: string }> {
  const {
    groupId,
    requesterId,
    targetShopIds,
    runType = "quick",
    platforms = [],
    concurrency = 3,
  } = options;

  const canManage = await canManageMultipleShops(requesterId);
  if (!canManage) {
    return { error: "当前套餐不支持批量验收，请升级到 Agency 版" };
  }

  const groupDetails = await getShopGroupDetails(groupId, requesterId);
  if (!groupDetails) {
    return { error: "分组不存在或无权访问" };
  }

  let targetShops = groupDetails.members;
  if (targetShopIds && targetShopIds.length > 0) {
    const targetSet = new Set(targetShopIds);
    targetShops = targetShops.filter((m) => targetSet.has(m.shopId));
  }

  if (targetShops.length === 0) {
    return { error: "没有可验收的目标店铺" };
  }

  const jobId = `batch-verification-${groupId}-${Date.now()}`;
  const job: BatchVerificationJob = {
    id: jobId,
    groupId,
    status: "pending",
    progress: {
      total: targetShops.length,
      completed: 0,
      failed: 0,
      skipped: 0,
    },
    results: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  activeJobs.set(jobId, job);

  executeBatchVerificationAsync(jobId, targetShops.map(m => m.shopId), {
    runType,
    platforms,
    concurrency,
  }).catch((err) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Batch verification job failed", err instanceof Error ? err : new Error(String(err)), {
      jobId,
      errorMessage,
      targetShopsCount: targetShops.length,
      runType,
      platforms,
    });
    const failedJob = activeJobs.get(jobId);
    if (failedJob) {
      failedJob.status = "failed";
      failedJob.updatedAt = new Date();
    }
  });

  logger.info(`Batch verification job started: ${jobId}`, {
    groupId,
    shopCount: targetShops.length,
  });

  return { jobId };
}

export function getBatchVerificationStatus(jobId: string): BatchVerificationJob | null {
  return activeJobs.get(jobId) || null;
}

async function executeBatchVerificationAsync(
  jobId: string,
  shopIds: string[],
  options: {
    runType: "quick" | "full" | "custom";
    platforms: string[];
    concurrency: number;
  }
): Promise<void> {
  const job = activeJobs.get(jobId);
  if (!job) {
    throw new Error(`Batch verification job not found: ${jobId}`);
  }

  job.status = "running";
  job.startedAt = new Date();
  job.updatedAt = new Date();

  const { runType, platforms, concurrency } = options;

  // Store job reference for use in nested function
  const jobRef = job;

  async function processShop(shopId: string): Promise<void> {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      if (!shop) {
        throw new Error(`Shop not found: ${shopId}`);
      }

      const configs = await prisma.pixelConfig.findMany({
        where: {
          shopId,
          isActive: true,
          serverSideEnabled: true,
        },
        select: { platform: true },
      });

      if (configs.length === 0) {
        jobRef.results.push({
          shopId,
          shopDomain: shop.shopDomain,
          status: "skipped",
          error: "未配置服务端追踪",
        });
        jobRef.progress.skipped++;
        jobRef.updatedAt = new Date();
        return;
      }

      const targetPlatforms = platforms.length > 0
        ? platforms.filter(p => configs.some(c => c.platform === p))
        : configs.map(c => c.platform);

      if (targetPlatforms.length === 0) {
        jobRef.results.push({
          shopId,
          shopDomain: shop.shopDomain,
          status: "skipped",
          error: "没有匹配的平台配置",
        });
        jobRef.progress.skipped++;
        jobRef.updatedAt = new Date();
        return;
      }

      const runId = await createVerificationRun(shopId, {
        runType,
        platforms: targetPlatforms,
      });

      await startVerificationRun(runId);

      await analyzeRecentEvents(shopId, runId);

      jobRef.results.push({
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        runId,
      });

      jobRef.progress.completed++;
    } catch (error) {
      logger.error(`Batch verification failed for shop ${shopId}`, error);

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      jobRef.results.push({
        shopId,
        shopDomain: shop?.shopDomain || "unknown",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      jobRef.progress.failed++;
    } finally {
      jobRef.updatedAt = new Date();
    }
  }

  for (let i = 0; i < shopIds.length; i += concurrency) {
    const batch = shopIds.slice(i, i + concurrency);
    await Promise.all(batch.map(processShop));
  }

  if (job.progress.failed === 0) {
    job.status = "completed";
  } else if (job.progress.completed > 0) {
    job.status = "completed";
  } else {
    job.status = "failed";
  }

  job.completedAt = new Date();
  job.updatedAt = new Date();

  logger.info(`Batch verification job completed: ${jobId}`, {
    total: job.progress.total,
    completed: jobRef.progress.completed,
    failed: jobRef.progress.failed,
    skipped: jobRef.progress.skipped,
  });
}

export async function getBatchVerificationHistory(
  groupId: string,
  limit: number = 10
): Promise<BatchVerificationJob[]> {
  const jobs = Array.from(activeJobs.values())
    .filter(job => job.groupId === groupId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return jobs;
}
