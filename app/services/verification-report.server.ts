import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import PDFDocument from "pdfkit";
import type { VerificationRun } from "@prisma/client";

export interface VerificationReportData {
  runId: string;
  runName: string;
  shopId: string;
  shopDomain: string;
  status: string;
  platforms: string[];
  summary: {
    totalEvents: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    byPlatform: Record<string, {
      total: number;
      success: number;
      failure: number;
      successRate: number;
    }>;
  };
  events: Array<{
    eventType: string;
    platform: string;
    status: string;
    timestamp: Date;
    details?: Record<string, unknown>;
  }>;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export async function generateVerificationReportData(
  shopId: string,
  runId: string
): Promise<VerificationReportData> {
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    include: {
      Shop: {
        select: {
          shopDomain: true,
        },
      },
      PixelEventReceipt: {
        select: {
          eventType: true,
          pixelTimestamp: true,
        },
      },
    },
  });

  if (!run) {
    throw new Error("Verification run not found");
  }

  const summaryJson = run.summaryJson as {
    totalEvents?: number;
    successCount?: number;
    failureCount?: number;
    byPlatform?: Record<string, { total: number; success: number; failure: number }>;
  } | null;

  const byPlatform: Record<string, { total: number; success: number; failure: number; successRate: number }> = {};
  let totalEvents = 0;
  let successCount = 0;
  let failureCount = 0;

  if (summaryJson?.byPlatform) {
    for (const [platform, stats] of Object.entries(summaryJson.byPlatform)) {
      byPlatform[platform] = {
        ...stats,
        successRate: stats.total > 0 ? (stats.success / stats.total) * 100 : 0,
      };
      totalEvents += stats.total;
      successCount += stats.success;
      failureCount += stats.failure;
    }
  }

  const successRate = totalEvents > 0 ? (successCount / totalEvents) * 100 : 0;

  const events = run.PixelEventReceipt.map((receipt) => ({
    eventType: receipt.eventType,
    platform: "unknown", 
    status: "received",
    timestamp: receipt.pixelTimestamp,
  }));

  return {
    runId: run.id,
    runName: run.runName,
    shopId: run.shopId,
    shopDomain: run.Shop.shopDomain,
    status: run.status,
    platforms: run.platforms,
    summary: {
      totalEvents,
      successCount,
      failureCount,
      successRate,
      byPlatform,
    },
    events,
    startedAt: run.startedAt ?? undefined,
    completedAt: run.completedAt ?? undefined,
    createdAt: run.createdAt,
  };
}

export function generateVerificationReportCSV(data: VerificationReportData): string {
  const lines: string[] = [];

  
  lines.push("Run ID,Run Name,Shop Domain,Status,Platforms,Total Events,Success Count,Failure Count,Success Rate");
  lines.push(
    [
      data.runId,
      data.runName,
      data.shopDomain,
      data.status,
      data.platforms.join(";"),
      data.summary.totalEvents,
      data.summary.successCount,
      data.summary.failureCount,
      `${data.summary.successRate.toFixed(2)}%`,
    ].join(",")
  );

  
  lines.push("");
  lines.push("Platform,Total,Success,Failure,Success Rate");
  for (const [platform, stats] of Object.entries(data.summary.byPlatform)) {
    lines.push(
      [
        platform,
        stats.total,
        stats.success,
        stats.failure,
        `${stats.successRate.toFixed(2)}%`,
      ].join(",")
    );
  }

  
  lines.push("");
  lines.push("Event Type,Platform,Status,Timestamp");
  for (const event of data.events) {
    lines.push(
      [
        event.eventType,
        event.platform,
        event.status,
        event.timestamp.toISOString(),
      ].join(",")
    );
  }

  return lines.join("\n");
}

export async function generateVerificationReportPDF(
  data: VerificationReportData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      
      doc.fontSize(20).text("Verification Report", { align: "center" });
      doc.moveDown();

      
      doc.fontSize(14).text(`Run: ${data.runName}`, { align: "left" });
      doc.text(`Shop: ${data.shopDomain}`);
      doc.text(`Status: ${data.status}`);
      doc.text(`Platforms: ${data.platforms.join(", ")}`);
      doc.moveDown();

      
      doc.fontSize(16).text("Summary", { underline: true });
      doc.fontSize(12);
      doc.text(`Total Events: ${data.summary.totalEvents}`);
      doc.text(`Success: ${data.summary.successCount}`);
      doc.text(`Failure: ${data.summary.failureCount}`);
      doc.text(`Success Rate: ${data.summary.successRate.toFixed(2)}%`);
      doc.moveDown();

      
      doc.fontSize(16).text("Platform Breakdown", { underline: true });
      doc.fontSize(12);
      for (const [platform, stats] of Object.entries(data.summary.byPlatform)) {
        doc.text(`${platform}: ${stats.success}/${stats.total} (${stats.successRate.toFixed(2)}%)`);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
