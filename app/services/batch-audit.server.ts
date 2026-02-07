import { randomUUID } from "crypto";
import { logger } from "../utils/logger.server";
import { createAdminClientForShop } from "./shopify/admin-client.server";
import { scanShopTracking } from "./scanner";
import prisma from "../db.server";
import type { Prisma } from "@prisma/client";

const JOB_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function startBatchAudit(options: {
  groupId: string;
  requesterId: string;
  concurrency?: number;
  skipRecentHours?: number;
}): Promise<{ error: string } | { jobId: string }> {
  const { groupId, requesterId } = options;

  // Concurrency check (per shop)
  // If a job is already running for this shop, return its ID
  const existingJob = await prisma.batchAuditJob.findFirst({
    where: {
      shopId: groupId,
      status: { in: ["pending", "processing"] }
    }
  });

  if (existingJob) {
    logger.info("Batch audit already running for shop", { shopId: groupId, jobId: existingJob.id });
    return { jobId: existingJob.id };
  }

  const jobId = randomUUID();
  
  // Create job in DB
  try {
    await prisma.batchAuditJob.create({
      data: {
        id: jobId,
        shopId: groupId,
        requesterId,
        status: "pending",
        progress: 0,
      }
    });
  } catch (error) {
    logger.error("Failed to create batch audit job", { error });
    return { error: "Failed to create audit job" };
  }

  // Cleanup old jobs probabilistically (10% chance) to avoid memory leaks/DB bloat
  if (Math.random() < 0.1) {
    cleanupOldJobs().catch(err => logger.error("Failed to cleanup old jobs", { error: err }));
    failStuckJobs().catch(err => logger.error("Failed to fail stuck jobs", { error: err }));
  }

  // Start processing asynchronously
  // We don't await this, so the API returns immediately
  processBatchAudit(jobId, groupId).catch(err => {
    logger.error("Unhandled error in batch audit job", { jobId, error: err });
    prisma.batchAuditJob.update({
        where: { id: jobId },
        data: { status: "failed", error: String(err) }
    }).catch(() => {});
  });

  return { jobId };
}

async function processBatchAudit(jobId: string, shopId: string) {
  try {
    await prisma.batchAuditJob.update({
      where: { id: jobId },
      data: { status: "processing", updatedAt: new Date() }
    });
    
    logger.info("Starting batch audit job", { jobId, shopId });

    // Obtain an offline admin client for the shop
    const admin = await createAdminClientForShop(shopId);
    if (!admin) {
      throw new Error(`Could not create admin client for shop ${shopId}. App might not be installed.`);
    }

    // Perform the scan
    // We use force: true to ensure we get fresh data
    
    // WARNING: In a Serverless environment (e.g. Vercel), this background process might be killed
    // if the main request ends or if it runs longer than the function timeout.
    // For production robust architecture, consider offloading this to a job queue (e.g. BullMQ, Redis, Shopify Flow).

    // Add a 5-minute timeout protection to prevent stuck jobs
    const scanPromise = scanShopTracking(admin, shopId, { force: true });
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error("Batch audit scan timed out after 5 minutes")), 5 * 60 * 1000)
    );

    const result = await Promise.race([scanPromise, timeoutPromise]);

    const resultData = {
      riskScore: result.riskScore,
      riskItemsCount: result.riskItems.length,
      identifiedPlatforms: result.identifiedPlatforms,
      scriptTagsCount: result.scriptTags.length,
      webPixelsCount: result.webPixels.length,
      completedAt: new Date().toISOString()
    };

    await prisma.batchAuditJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        result: resultData as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    });

    logger.info("Batch audit job completed", { jobId, shopId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.batchAuditJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: errorMessage,
        updatedAt: new Date()
      }
    });
    logger.error("Batch audit job failed", { jobId, shopId, error });
  }
}

export async function getBatchAuditStatus(jobId: string): Promise<{ id: string; groupId: string; status: string; error?: string | null; result?: any } | null> {
  const job = await prisma.batchAuditJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  return {
    id: job.id,
    groupId: job.shopId,
    status: job.status,
    error: job.error,
    result: job.result
  };
}

export async function getBatchAuditHistory(limit: number): Promise<Array<{ createdAt: Date; status: string; groupId: string; id: string }>> {
  const jobs = await prisma.batchAuditJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return jobs.map(j => ({ 
    id: j.id,
    createdAt: j.createdAt, 
    status: j.status, 
    groupId: j.shopId 
  }));
}

export async function getBatchAuditStatistics(): Promise<{
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  runningJobs: number;
  avgSuccessRate: number;
}> {
  const [totalJobs, completedJobs, failedJobs, pendingJobs, processingJobs] = await Promise.all([
    prisma.batchAuditJob.count(),
    prisma.batchAuditJob.count({ where: { status: "completed" } }),
    prisma.batchAuditJob.count({ where: { status: "failed" } }),
    prisma.batchAuditJob.count({ where: { status: "pending" } }),
    prisma.batchAuditJob.count({ where: { status: "processing" } }),
  ]);

  const runningJobs = pendingJobs + processingJobs;
  
  return {
    totalJobs,
    completedJobs,
    failedJobs,
    runningJobs,
    avgSuccessRate: totalJobs > 0 ? completedJobs / totalJobs : 0,
  };
}

export async function cleanupOldJobs(maxAgeMs: number = JOB_RETENTION_MS): Promise<number> {
  const cutoffDate = new Date(Date.now() - maxAgeMs);
  try {
    const result = await prisma.batchAuditJob.deleteMany({
      where: {
        status: { in: ["completed", "failed"] },
        createdAt: { lt: cutoffDate }
      }
    });
    return result.count;
  } catch (error) {
    logger.error("Failed to cleanup old jobs", {
      maxAgeMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function failStuckJobs(maxAgeMs: number = 60 * 60 * 1000): Promise<number> {
  const cutoffDate = new Date(Date.now() - maxAgeMs);
  try {
    const result = await prisma.batchAuditJob.updateMany({
      where: {
        status: { in: ["pending", "processing"] },
        updatedAt: { lt: cutoffDate }
      },
      data: {
        status: "failed",
        error: "Job timed out (stuck)"
      }
    });
    if (result.count > 0) {
      logger.info("Failed stuck batch audit jobs", { count: result.count });
    }
    return result.count;
  } catch (error) {
    logger.error("Failed to fail stuck jobs", {
      maxAgeMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
