

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { CONFIG } from "../utils/config";
import { safeFireAndForget } from "../utils/helpers";
import { fetchReconciliationReportData, fetchScanReportData } from "./report-generator.server";
import { generateVerificationReportData, generateVerificationReportCSV , generateVerificationReportPDF } from "./verification-report.server";
import { generateReconciliationReportPdf, generateScanReportPdf } from "./pdf-generator.server";
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
  progress?: number;
  error?: string;
  resultUrl?: string;
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

  safeFireAndForget(processReportJob(job.id), {
    operation: "processReportJob",
    metadata: { jobId: job.id },
  });

  return mapToReportJob(job);
}

export async function getReportJobStatus(jobId: string): Promise<ReportJob | null> {
  const job = await prisma.reportJob.findUnique({
    where: { id: jobId },
  });
  return job ? mapToReportJob(job) : null;
}

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

async function processReportJob(jobId: string): Promise<void> {
  const job = await prisma.reportJob.findUnique({
    where: { id: jobId },
  });

  if (!job || job.status !== "pending") {
    return;
  }

  await prisma.reportJob.update({
    where: { id: jobId },
    data: {
      status: "processing",
      progress: 0,
    },
  });

  let resultUrl: string | undefined;
  let progress = 0;
  let progressInterval: NodeJS.Timeout | null = null;

  try {

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

          resultUrl = await saveReportResult(jobId, result);
          break;
        }
        case "reconciliation": {
          const metadata = typeof job.metadata === "object" && job.metadata !== null && !Array.isArray(job.metadata)
            ? (job.metadata as Record<string, unknown>)
            : {};
          const requestedDays = Number(metadata.days);
          const days = Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : 7;

          if (job.format === "pdf") {
            const pdfResult = await generateReconciliationReportPdf(job.shopId, days);
            if (!pdfResult) {
              throw new Error("Failed to generate reconciliation report PDF");
            }
            resultUrl = await saveReportResult(jobId, {
              content: pdfResult.buffer,
              filename: pdfResult.filename,
              mimeType: "application/pdf",
            });
          } else if (job.format === "csv") {
            const data = await fetchReconciliationReportData(job.shopId, days);
            if (!data) {
              throw new Error("Failed to fetch reconciliation report data");
            }
            const reportDate = data.reportDate.toISOString().split("T")[0];
            const summaryRows = [
              ["Report Date", reportDate],
              ["Total Orders", data.summary.totalOrders.toString()],
              ["Matched Orders", data.summary.matchedOrders.toString()],
              ["Unmatched Orders", data.summary.unmatchedOrders.toString()],
              ["Match Rate", `${data.summary.matchRate.toFixed(1)}%`],
              [],
              ["Platform", "Orders", "Revenue", "Match Rate"],
            ];
            const platformRows = Object.entries(data.platformBreakdown).map(([platform, stats]) => ([
              platform,
              stats.orders.toString(),
              stats.revenue.toFixed(2),
              `${stats.matchRate.toFixed(1)}%`,
            ]));
            const csv = [...summaryRows, ...platformRows]
              .map((row) => row.map((value) => `"${value}"`).join(","))
              .join("\n");
            resultUrl = await saveReportResult(jobId, {
              content: csv,
              filename: `reconciliation-report-${data.shopDomain}-${reportDate}.csv`,
              mimeType: "text/csv",
            });
          } else {
            throw new Error(`Unsupported format for reconciliation report: ${job.format}`);
          }
          break;
        }
        default:
          throw new Error(`Unsupported report type: ${job.reportType}`);
      }

      if (progressInterval !== null) {
        clearInterval(progressInterval);
        progressInterval = null;
      }

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

      if (progressInterval !== null) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      throw error;
    }
  } catch (error) {

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

async function saveReportResult(
  jobId: string,
  result: { content: string | Buffer; filename: string; mimeType: string }
): Promise<string> {

  const baseUrl = CONFIG.getEnv("SHOPIFY_APP_URL", "https://app.tracking-guardian.com");
  return `${baseUrl}/api/reports/download/${jobId}`;
}

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
