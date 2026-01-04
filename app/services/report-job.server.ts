/**
 * P2-9: 异步报表生成任务系统
 * 
 * 将耗时的报表生成（PDF/CSV）改为异步任务，避免阻塞请求。
 * 客户端通过轮询获取任务状态和结果。
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export type ReportJobStatus = "pending" | "processing" | "completed" | "failed";
export type ReportFormat = "pdf" | "csv" | "json";
export type ReportType = "scan" | "migration" | "reconciliation" | "risk" | "verification" | "comprehensive";

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
      shopId: options.shopId,
      reportType: options.reportType,
      format: options.format,
      status: "pending",
      metadata: options.metadata || {},
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
  processReportJob(job.id).catch((error) => {
    logger.error("Failed to process report job", error, {
      jobId: job.id,
    });
  });

  return job;
}

/**
 * 获取报表任务状态
 */
export async function getReportJobStatus(jobId: string): Promise<ReportJob | null> {
  return prisma.reportJob.findUnique({
    where: { id: jobId },
  });
}

/**
 * 获取店铺的所有报表任务
 */
export async function getShopReportJobs(
  shopId: string,
  limit: number = 20
): Promise<ReportJob[]> {
  return prisma.reportJob.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
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

  try {
    // 根据报表类型调用相应的生成函数
    let resultUrl: string | undefined;
    let progress = 0;

    // 模拟进度更新
    const progressInterval = setInterval(async () => {
      progress += 10;
      if (progress < 90) {
        await prisma.reportJob.update({
          where: { id: jobId },
          data: { progress },
        });
      }
    }, 500);

    try {
      switch (job.reportType) {
        case "scan": {
          const { generateScanReport } = await import("./report-generator.server");
          const result = await generateScanReport(job.shopId, {
            format: job.format,
          });
          resultUrl = result.url;
          break;
        }
        case "verification": {
          const { generateVerificationReport } = await import("./report-generator.server");
          const runId = job.metadata?.runId as string | undefined;
          const result = await generateVerificationReport(job.shopId, {
            format: job.format,
            runId,
          });
          resultUrl = result.url;
          break;
        }
        case "comprehensive": {
          const { exportComprehensiveReport } = await import("./comprehensive-report.server");
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

      clearInterval(progressInterval);

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
      clearInterval(progressInterval);
      throw error;
    }
  } catch (error) {
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
  const baseUrl = process.env.SHOPIFY_APP_URL || "https://app.tracking-guardian.com";
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

