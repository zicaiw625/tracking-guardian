

import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { scanShopTracking } from "../scanner.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { Prisma } from "@prisma/client";
import { toInputJsonValue } from "../../utils/prisma-json";

export interface BatchScanJob {
  id: string;
  workspaceId?: string;
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
    scanReportId?: string;
    error?: string;
  }>;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

const activeJobs = new Map<string, BatchScanJob>();

export async function createBatchScanJob(
  shopIds: string[],
  workspaceId?: string
): Promise<BatchScanJob> {
  const job: BatchScanJob = {
    id: `batch-scan-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    workspaceId,
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

export function getBatchScanJob(jobId: string): BatchScanJob | null {
  return activeJobs.get(jobId) || null;
}

export async function executeBatchScan(
  jobId: string,
  adminContexts: Map<string, AdminApiContext>
): Promise<BatchScanJob> {
  const job = activeJobs.get(jobId);
  if (!job) {
    throw new Error(`Batch scan job not found: ${jobId}`);
  }

  if (job.status === "running") {
    logger.warn(`Batch scan job ${jobId} is already running`);
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

  logger.info(`Starting batch scan job ${jobId} for ${job.shopIds.length} shops`);

  const concurrency = 3;
  const shopIds = [...job.shopIds];

  async function processShop(shopId: string): Promise<BatchScanJob["results"][number]> {
    try {
      const admin = adminContexts.get(shopId);
      if (!admin) {
        throw new Error(`Admin context not found for shop ${shopId}`);
      }

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      if (!shop) {
        throw new Error(`Shop not found: ${shopId}`);
      }

      const scanResult = await scanShopTracking(admin, shopId);

      // Create ScanReport record in database
      const scanReport = await prisma.scanReport.create({
        data: {
          id: randomUUID(),
          shopId,
          scriptTags: toInputJsonValue(scanResult.scriptTags),
          checkoutConfig: scanResult.checkoutConfig ? toInputJsonValue(scanResult.checkoutConfig) : Prisma.JsonNull,
          riskItems: toInputJsonValue(scanResult.riskItems),
          riskScore: scanResult.riskScore,
          identifiedPlatforms: toInputJsonValue(scanResult.identifiedPlatforms),
          status: "completed",
          completedAt: new Date(),
        },
      });

      return {
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        scanReportId: scanReport.id,
      };
    } catch (error) {
      logger.error(`Batch scan failed for shop ${shopId}`, error);

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      return {
        shopId,
        shopDomain: shop?.shopDomain || "unknown",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  for (let i = 0; i < shopIds.length; i += concurrency) {
    const batch = shopIds.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processShop));
    
    for (const result of batchResults) {
      job.results.push(result);
      if (result.status === "success") {
        job.progress.completed++;
      } else {
        job.progress.failed++;
      }
    }
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
    `Batch scan job ${jobId} completed: ${job.progress.completed} success, ${job.progress.failed} failed`
  );

  return job;
}

export async function getBatchScanHistory(
  workspaceId: string,
  limit: number = 10
): Promise<BatchScanJob[]> {

  const jobs = Array.from(activeJobs.values())
    .filter((job) => job.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return jobs;
}

export async function getBatchScanSummary(job: BatchScanJob): Promise<{
  total: number;
  success: number;
  failed: number;
  successRate: number;
  averageRiskScore?: number;
  platforms: Record<string, number>;
}> {
  const summary = {
    total: job.progress.total,
    success: job.progress.completed,
    failed: job.progress.failed,
    successRate: job.progress.total > 0
      ? (job.progress.completed / job.progress.total) * 100
      : 0,
    platforms: {} as Record<string, number>,
  };

  const successResults = job.results.filter((r) => r.status === "success" && r.scanReportId);
  
  await Promise.all(
    successResults.map(async (result) => {
      try {
        const scanReport = await prisma.scanReport.findUnique({
          where: { id: result.scanReportId! },
          select: { identifiedPlatforms: true },
        });

        if (scanReport?.identifiedPlatforms) {
          const platforms = Array.isArray(scanReport.identifiedPlatforms)
            ? (scanReport.identifiedPlatforms as string[])
            : [];
          platforms.forEach((platform: string) => {
            summary.platforms[platform] = (summary.platforms[platform] || 0) + 1;
          });
        }
      } catch (error) {
        logger.error(`Failed to get scan report ${result.scanReportId}`, error);
      }
    })
  );

  return summary;
}

