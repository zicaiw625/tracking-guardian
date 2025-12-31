/**
 * 批量 Audit 服务 - 为多个店铺运行扫描
 */

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { scanShopTracking } from "../scanner.server";
import type { AdminApiContext } from "../shopify.server";

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

  return {
    jobId,
    totalShops: options.shopIds.length,
    startedAt: new Date(),
    status: "completed",
    results,
  };
}

/**
 * 获取批量 Audit 状态
 */
export async function getBatchAuditStatus(
  jobId: string
): Promise<BatchAuditResult | null> {
  // TODO: 实现从数据库或缓存中获取状态
  // 这里简化实现，实际应该存储到数据库
  return null;
}

