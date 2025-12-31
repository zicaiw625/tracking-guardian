/**
 * 批量 Audit 服务 - 为多个店铺运行扫描
 */

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

// 内存存储，用于快速访问
const batchAuditJobs = new Map<string, BatchAuditResult>();

// Redis缓存键前缀
const CACHE_PREFIX = "batch-audit:";
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24小时

/**
 * 启动批量 Audit
 */
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

  // 异步处理每个店铺的扫描
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

      // 运行扫描
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

  // 等待所有扫描完成
  await Promise.allSettled(processPromises);

  const result: BatchAuditResult = {
    jobId,
    totalShops: options.shopIds.length,
    startedAt: new Date(),
    status: "completed",
    results,
  };

  // 存储到内存
  batchAuditJobs.set(jobId, result);

  // 存储到Redis缓存
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

/**
 * 获取批量 Audit 状态
 */
export async function getBatchAuditStatus(
  jobId: string
): Promise<BatchAuditResult | null> {
  // 首先从内存缓存获取
  const memoryResult = batchAuditJobs.get(jobId);
  if (memoryResult) {
    return memoryResult;
  }

  // 从Redis缓存获取
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

      // 回填到内存缓存
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

