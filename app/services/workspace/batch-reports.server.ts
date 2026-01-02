

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
  downloadUrl?: string;
}

export async function generateBatchReports(
  options: BatchReportOptions
): Promise<BatchReportResult> {
  const jobId = `batch-report-${Date.now()}`;

  logger.info("Starting batch report generation", {
    jobId,
    workspaceId: options.workspaceId,
    shopCount: options.shopIds.length,
    format: options.format,
  });

  const processPromises = options.shopIds.map(async (shopId): Promise<BatchReportResult["results"][number]> => {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      if (!shop) {
        return {
          shopId,
          shopDomain: "unknown",
          status: "skipped",
          error: "Shop not found",
        };
      }

      const reportData = await generateVerificationReportData(shopId);

      if (!reportData) {
        return {
          shopId,
          shopDomain: shop.shopDomain,
          status: "skipped",
          error: "No verification data available",
        };
      }

      const reportUrl = `/api/reports/${shopId}?format=${options.format}`;

      return {
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        reportUrl,
      };
    } catch (error) {
      logger.error("Failed to generate report in batch", {
        shopId,
        error,
      });

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
  });

  const settledResults = await Promise.allSettled(processPromises);
  const results: BatchReportResult["results"] = settledResults.map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      return {
        shopId: "unknown",
        shopDomain: "unknown",
        status: "failed" as const,
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
      };
    }
  });

  return {
    jobId,
    totalShops: options.shopIds.length,
    startedAt: new Date(),
    status: "completed",
    results,
  };
}

