import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface BatchJob {
  id: string;
  type: "pixel_apply" | "audit" | "export";
  shopId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
  result?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const batchJobs = new Map<string, BatchJob>();

export function createBatchJob(
  type: BatchJob["type"],
  shopId: string,
  totalItems: number
): string {
  const jobId = `batch-${type}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const job: BatchJob = {
    id: jobId,
    type,
    shopId,
    status: "pending",
    progress: 0,
    totalItems,
    completedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  batchJobs.set(jobId, job);
  return jobId;
}

export function updateBatchJobProgress(
  jobId: string,
  updates: Partial<Pick<BatchJob, "status" | "progress" | "completedItems" | "failedItems" | "skippedItems" | "result" | "error">>
): void {
  const job = batchJobs.get(jobId);
  if (!job) {
    logger.warn(`Batch job not found: ${jobId}`);
    return;
  }

  const completedItems = updates.completedItems ?? job.completedItems;
  const failedItems = updates.failedItems ?? job.failedItems;
  const skippedItems = updates.skippedItems ?? job.skippedItems;
  const progress = updates.progress ?? Math.round(((completedItems + failedItems + skippedItems) / job.totalItems) * 100);

  Object.assign(job, {
    ...updates,
    progress: Math.min(100, Math.max(0, progress)),
    updatedAt: new Date(),
    completedAt: updates.status === "completed" || updates.status === "failed" ? new Date() : job.completedAt,
  });

  batchJobs.set(jobId, job);
}

export function getBatchJobStatus(jobId: string): BatchJob | null {
  return batchJobs.get(jobId) || null;
}

export function cleanupExpiredJobs(): void {
  const now = new Date();
  const expireTime = 24 * 60 * 60 * 1000;

  for (const [jobId, job] of batchJobs.entries()) {
    const age = now.getTime() - job.createdAt.getTime();
    if (age > expireTime && (job.status === "completed" || job.status === "failed")) {
      batchJobs.delete(jobId);
    }
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupInterval(): void {
  if (cleanupInterval !== null) {
    return;
  }

  if (typeof setInterval !== "undefined") {
    cleanupInterval = setInterval(cleanupExpiredJobs, 60 * 60 * 1000);

    if (cleanupInterval && typeof cleanupInterval.unref === "function") {
      cleanupInterval.unref();
    }
  }
}

export function stopCleanupInterval(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

if (typeof setInterval !== "undefined") {
  startCleanupInterval();
}
