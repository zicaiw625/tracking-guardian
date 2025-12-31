/**
 * 批量验收报告服务 - 为多个店铺生成迁移验收报告
 */

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { generateVerificationReportData } from "../verification-report.server";

export interface BatchReportOptions {
  shopIds: string[];
  workspaceId: string;
  requestedBy: string;
  format: "pdf" | "csv" | "html";
}

export interface BatchReportResult {
  jobId: string;
  totalShops: number;
  startedAt: Date;
  status: "pending" | "running" | "completed" | "failed";
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed" | "skipped";
    reportUrl?: string;
    error?: string;
  }>;
  downloadUrl?: string; // 批量下载链接
}

/**
 * 生成批量验收报告
 */
export async function generateBatchReports(
  options: BatchReportOptions
): Promise<BatchReportResult> {
  const jobId = `batch-report-${Date.now()}`;
  const results: BatchReportResult["results"] = [];

  logger.info("Starting batch report generation", {
    jobId,
    workspaceId: options.workspaceId,
    shopCount: options.shopIds.length,
    format: options.format,
  });

  // 异步处理每个店铺的报告
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

      // 生成报告数据
      const reportData = await generateVerificationReportData(shopId);

      if (!reportData) {
        results.push({
          shopId,
          shopDomain: shop.shopDomain,
          status: "skipped",
          error: "No verification data available",
        });
        return;
      }

      // TODO: 根据 format 生成报告文件并上传到存储
      // 这里简化实现，实际应该生成文件并返回 URL
      const reportUrl = `/api/reports/${shopId}?format=${options.format}`;

      results.push({
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        reportUrl,
      });
    } catch (error) {
      logger.error("Failed to generate report in batch", {
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

  // 等待所有报告生成完成
  await Promise.allSettled(processPromises);

  return {
    jobId,
    totalShops: options.shopIds.length,
    startedAt: new Date(),
    status: "completed",
    results,
  };
}

