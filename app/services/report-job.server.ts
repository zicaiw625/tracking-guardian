/**
 * P2-9: 异步报表生成任务系统
 * 
 * 将耗时的报表生成（PDF/CSV）改为异步任务，避免阻塞请求。
 * 客户端通过轮询获取任务状态和结果。
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { CONFIG } from "../utils/config";
import { safeFireAndForget } from "../utils/helpers";
import { fetchScanReportData, generateScanReportHtml } from "./report-generator.server";
import { generateVerificationReportData, generateVerificationReportCSV , generateVerificationReportPDF } from "./verification-report.server";
import { generateScanReportPdf } from "./pdf-generator.server";
import { exportComprehensiveReport } from "./comprehensive-report.server";
import type { Prisma } from "@prisma/client";

export type ReportJobStatus = "pending" | "processing" | "completed" | "failed";
export type ReportFormat = "pdf" | "csv" | "json";
export type ReportType = "scan" | "migration" | "reconciliation" | "risk" | "verification" | "comprehensive";

function mapToReportJob(prismaJob: {
  id: string;
  shopId: string;
  reportType: string;
  format: string;
  status: string;
  progress: number | null;
  error: string | null;
  resultUrl: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): ReportJob {
  return {
    id: prismaJob.id,
    shopId: prismaJob.shopId,
    reportType: prismaJob.reportType as ReportType,
    format: prismaJob.format as ReportFormat,
    status: prismaJob.status as ReportJobStatus,
    progress: prismaJob.progress ?? undefined,
    error: prismaJob.error ?? undefined,
    resultUrl: prismaJob.resultUrl ?? undefined,
    metadata: typeof prismaJob.metadata === "object" && prismaJob.metadata !== null && !Array.isArray(prismaJob.metadata)
      ? (prismaJob.metadata as Record<string, unknown>)
      : {},
    createdAt: prismaJob.createdAt,
    updatedAt: prismaJob.updatedAt,
    completedAt: prismaJob.completedAt ?? undefined,
  };
}

export interface ReportJob {
  id: string;
  shopId: string;
  reportType: ReportType;
  format: ReportFormat;
  status: ReportJobStatus;
  progress?: number; // 0-100
  error?: string;
  resultUrl?: string; // 生成完成后的下载链接
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface CreateReportJobOptions {
  shopId: string;
  reportType: ReportType;
  format: ReportFormat;
  metadata?: Record<string, unknown>;
}

/**
 * 创建报表生成任务
 */
export async function createReportJob(
  options: CreateReportJobOptions
): Promise<ReportJob> {
  const job = await prisma.reportJob.create({
    data: {
      id: `${options.shopId}-${options.reportType}-${Date.now()}`,
      shopId: options.shopId,
      reportType: options.reportType,
      format: options.format,
      status: "pending",
      metadata: (options.metadata || {}) as Prisma.InputJsonValue,
    },
  });

  logger.info("Report job created", {
    jobId: job.id,
    shopId: options.shopId,
    reportType: options.reportType,
    format: options.format,
  });

  // 触发异步处理（在实际实现中，这里应该发送到任务队列）
  // 为了简化，我们使用 setTimeout 模拟异步处理
  safeFireAndForget(processReportJob(job.id), {
    operation: "processReportJob",
    metadata: { jobId: job.id },
  });

  return mapToReportJob(job);
}

/**
 * 获取报表任务状态
 */
export async function getReportJobStatus(jobId: string): Promise<ReportJob | null> {
  const job = await prisma.reportJob.findUnique({
    where: { id: jobId },
  });
  return job ? mapToReportJob(job) : null;
}

/**
 * 获取店铺的所有报表任务
 */
export async function getShopReportJobs(
  shopId: string,
  limit: number = 20
): Promise<ReportJob[]> {
  const jobs = await prisma.reportJob.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return jobs.map(mapToReportJob);
}

/**
 * 处理报表生成任务（异步）
 */
async function processReportJob(jobId: string): Promise<void> {
  const job = await prisma.reportJob.findUnique({
    where: { id: jobId },
  });

  if (!job || job.status !== "pending") {
    return;
  }

  // 更新状态为处理中
  await prisma.reportJob.update({
    where: { id: jobId },
    data: {
      status: "processing",
      progress: 0,
    },
  });

  // 根据报表类型调用相应的生成函数
  let resultUrl: string | undefined;
  let progress = 0;
  let progressInterval: NodeJS.Timeout | null = null;

  try {
    // 模拟进度更新
    progressInterval = setInterval(async () => {
      progress += 10;
      if (progress < 90) {
        await prisma.reportJob.update({
          where: { id: jobId },
          data: { progress },
        }).catch((error) => {
          logger.warn("Failed to update report job progress", { jobId, error });
        });
      }
    }, 500);

    try {
      switch (job.reportType) {
        case "scan": {
          if (job.format === "pdf") {
            const pdfResult = await generateScanReportPdf(job.shopId);
            if (!pdfResult) {
              throw new Error("Failed to generate scan report PDF");
            }
            resultUrl = await saveReportResult(jobId, {
              content: pdfResult.buffer,
              filename: pdfResult.filename,
              mimeType: "application/pdf",
            });
          } else if (job.format === "csv") {
            const data = await fetchScanReportData(job.shopId);
            if (!data) {
              throw new Error("Failed to fetch scan report data");
            }
            // 生成 CSV（简化版本，实际应该使用专门的 CSV 生成函数）
            const csv = `Shop Domain,Risk Score,Platforms\n${data.shopDomain},${data.riskScore},"${data.identifiedPlatforms.join(",")}"\n`;
            resultUrl = await saveReportResult(jobId, {
              content: csv,
              filename: `scan-report-${data.shopDomain}-${new Date().toISOString().split("T")[0]}.csv`,
              mimeType: "text/csv",
            });
          } else {
            throw new Error(`Unsupported format for scan report: ${job.format}`);
          }
          break;
        }
        case "verification": {
          const metadata = typeof job.metadata === "object" && job.metadata !== null && !Array.isArray(job.metadata)
            ? (job.metadata as Record<string, unknown>)
            : {};
          const runId = metadata.runId as string | undefined;
          if (!runId) {
            throw new Error("runId is required for verification report");
          }
          const data = await generateVerificationReportData(job.shopId, runId);
          if (!data) {
            throw new Error("Failed to fetch verification report data");
          }
          if (job.format === "pdf") {
            const pdfResult = await generateVerificationReportPDF(data);
            if (!pdfResult) {
              throw new Error("Failed to generate verification report PDF");
            }
            resultUrl = await saveReportResult(jobId, {
              content: pdfResult.buffer,
              filename: pdfResult.filename,
              mimeType: "application/pdf",
            });
          } else if (job.format === "csv") {
            const csv = generateVerificationReportCSV(data);
            resultUrl = await saveReportResult(jobId, {
              content: csv,
              filename: `verification-report-${data.shopDomain}-${new Date().toISOString().split("T")[0]}.csv`,
              mimeType: "text/csv",
            });
          } else {
            throw new Error(`Unsupported format for verification report: ${job.format}`);
          }
          break;
        }
        case "comprehensive": {
          const result = await exportComprehensiveReport(job.shopId, {
            format: job.format as "pdf" | "csv" | "json",
            includeScan: true,
            includeMigration: true,
            includeVerification: true,
            includeRiskAnalysis: true,
            includeEventStats: true,
          });
          // 保存结果并生成 URL
          resultUrl = await saveReportResult(jobId, result);
          break;
        }
        default:
          throw new Error(`Unsupported report type: ${job.reportType}`);
      }

      // 清理进度更新定时器
      if (progressInterval !== null) {
        clearInterval(progressInterval);
        progressInterval = null;
      }

      // 更新为完成状态
      await prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          progress: 100,
          resultUrl,
          completedAt: new Date(),
        },
      });

      logger.info("Report job completed", {
        jobId,
        resultUrl,
      });
    } catch (error) {
      // 清理进度更新定时器
      if (progressInterval !== null) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      throw error;
    }
  } catch (error) {
    // 确保清理进度更新定时器（即使外层catch也要清理）
    if (progressInterval !== null) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Report job failed", error instanceof Error ? error : new Error(String(error)), {
      jobId,
      errorMessage,
    });

    await prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: errorMessage,
        completedAt: new Date(),
      },
    });
  }
}

/**
 * 保存报表结果并返回 URL
 */
async function saveReportResult(
  jobId: string,
  result: { content: string | Buffer; filename: string; mimeType: string }
): Promise<string> {
  // 在实际实现中，这里应该将文件保存到对象存储（S3、GCS 等）
  // 并返回可访问的 URL
  // 为了简化，我们返回一个临时 URL
  const baseUrl = CONFIG.getEnv("SHOPIFY_APP_URL", "https://app.tracking-guardian.com");
  return `${baseUrl}/api/reports/download/${jobId}`;
}

/**
 * 清理过期的报表任务（超过 7 天）
 */
export async function cleanupExpiredReportJobs(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const result = await prisma.reportJob.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      completedAt: {
        lt: sevenDaysAgo,
      },
    },
  });

  logger.info("Cleaned up expired report jobs", {
    count: result.count,
  });

  return result.count;
}

