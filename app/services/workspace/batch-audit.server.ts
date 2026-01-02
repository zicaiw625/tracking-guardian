

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { scanShopTracking } from "../scanner.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { getRedisClient } from "~/utils/redis-client";

export interface BatchAuditOptions {
  shopIds: string[];
  workspaceId: string;
  requestedBy: string;
}

export interface BatchAuditResult {
  jobId: string;
  totalShops: number;
  startedAt: Date;
  status: "pending" | "running" | "completed" | "failed";
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed" | "skipped";
    scanReportId?: string;
    error?: string;
  }>;
}

const batchAuditJobs = new Map<string, BatchAuditResult>();

const CACHE_PREFIX = "batch-audit:";
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export async function startBatchAudit(
  options: BatchAuditOptions,
  adminApis: Map<string, AdminApiContext>
): Promise<BatchAuditResult> {
  const jobId = `batch-audit-${Date.now()}`;
  const results: BatchAuditResult["results"] = [];

  logger.info("Starting batch audit", {
    jobId,
    workspaceId: options.workspaceId,
    shopCount: options.shopIds.length,
  });

  const processPromises = options.shopIds.map(async (shopId) => {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      if (!shop) {
        results.push({
          shopId,
          shopDomain: "unknown",
          status: "skipped",
          error: "Shop not found",
        });
        return;
      }

      const admin = adminApis.get(shopId);
      if (!admin) {
        results.push({
          shopId,
          shopDomain: shop.shopDomain,
          status: "skipped",
          error: "Admin API not available",
        });
        return;
      }

      const scanResult = await scanShopTracking(shopId, admin);

      results.push({
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        scanReportId: scanResult.scanReportId,
      });
    } catch (error) {
      logger.error("Failed to audit shop in batch", {
        shopId,
        error,
      });

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      results.push({
        shopId,
        shopDomain: shop?.shopDomain || "unknown",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  await Promise.allSettled(processPromises);

  const result: BatchAuditResult = {
    jobId,
    totalShops: options.shopIds.length,
    startedAt: new Date(),
    status: "completed",
    results,
  };

  batchAuditJobs.set(jobId, result);

  try {
    const redisClient = await getRedisClient();
    const cacheKey = `${CACHE_PREFIX}${jobId}`;
    await redisClient.set(
      cacheKey,
      JSON.stringify({
        ...result,
        startedAt: result.startedAt.toISOString(),
      }),
      { EX: CACHE_TTL_SECONDS }
    );
  } catch (error) {
    logger.warn("Failed to cache batch audit result to Redis", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}

export async function getBatchAuditStatus(
  jobId: string
): Promise<BatchAuditResult | null> {

  const memoryResult = batchAuditJobs.get(jobId);
  if (memoryResult) {
    return memoryResult;
  }

  try {
    const redisClient = await getRedisClient();
    const cacheKey = `${CACHE_PREFIX}${jobId}`;
    const cachedValue = await redisClient.get(cacheKey);

    if (cachedValue) {
      const parsed = JSON.parse(cachedValue) as Omit<BatchAuditResult, "startedAt"> & {
        startedAt: string;
      };
      const result: BatchAuditResult = {
        ...parsed,
        startedAt: new Date(parsed.startedAt),
      };

      batchAuditJobs.set(jobId, result);
      return result;
    }
  } catch (error) {
    logger.warn("Failed to get batch audit status from Redis", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

