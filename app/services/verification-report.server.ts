import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import PDFDocument from "pdfkit";
import { getVerificationRun, type VerificationSummary } from "./verification.server";

export interface VerificationReportData {
  runId: string;
  runName: string;
  shopId: string;
  shopDomain: string;
  runType: "quick" | "full" | "custom";
  status: string;
  platforms: string[];
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    missingParamTests: number;
    parameterCompleteness: number;
    valueAccuracy: number;
  };
  platformResults: Record<string, { sent: number; failed: number }>;
  events: Array<{
    testItemId?: string;
    eventType: string;
    platform: string;
    orderId?: string;
    status: string;
    params?: {
      value?: number;
      currency?: string;
    };
    discrepancies?: string[];
    errors?: string[];
  }>;
  reconciliation?: VerificationSummary["reconciliation"];
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export async function generateVerificationReportData(
  shopId: string,
  runId: string
): Promise<VerificationReportData> {
  const verificationSummary = await getVerificationRun(runId);
  if (!verificationSummary) {
    throw new Error("Verification run not found");
  }
  if (verificationSummary.shopId !== shopId) {
    throw new Error("Access denied");
  }
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: {
      createdAt: true,
      Shop: {
        select: {
          shopDomain: true,
        },
      },
    },
  });
  if (!run) {
    throw new Error("Verification run not found");
  }
  return {
    runId: verificationSummary.runId,
    runName: verificationSummary.runName,
    shopId: verificationSummary.shopId,
    shopDomain: run.Shop.shopDomain,
    runType: verificationSummary.runType,
    status: verificationSummary.status,
    platforms: verificationSummary.platforms,
    summary: {
      totalTests: verificationSummary.totalTests,
      passedTests: verificationSummary.passedTests,
      failedTests: verificationSummary.failedTests,
      missingParamTests: verificationSummary.missingParamTests,
      parameterCompleteness: verificationSummary.parameterCompleteness,
      valueAccuracy: verificationSummary.valueAccuracy,
    },
    platformResults: verificationSummary.platformResults || {},
    events: verificationSummary.results.map((result) => ({
      testItemId: result.testItemId,
      eventType: result.eventType,
      platform: result.platform,
      orderId: result.orderId,
      status: result.status,
      params: result.params,
      discrepancies: result.discrepancies,
      errors: result.errors,
    })),
    reconciliation: verificationSummary.reconciliation,
    startedAt: verificationSummary.startedAt,
    completedAt: verificationSummary.completedAt,
    createdAt: run.createdAt,
  };
}

export function generateVerificationReportCSV(data: VerificationReportData): string {
  const lines: string[] = [];
  lines.push("Run ID,Run Name,Shop Domain,Run Type,Status,Platforms,Total Tests,Passed Tests,Failed Tests,Missing Param Tests,Parameter Completeness,Value Accuracy");
  lines.push(
    [
      data.runId,
      data.runName,
      data.shopDomain,
      data.runType,
      data.status,
      data.platforms.join(";"),
      data.summary.totalTests,
      data.summary.passedTests,
      data.summary.failedTests,
      data.summary.missingParamTests,
      `${data.summary.parameterCompleteness.toFixed(2)}%`,
      `${data.summary.valueAccuracy.toFixed(2)}%`,
    ].join(",")
  );
  lines.push("");
  lines.push("Platform,Sent,Failed");
  for (const [platform, stats] of Object.entries(data.platformResults)) {
    lines.push(
      [
        platform,
        stats.sent,
        stats.failed,
      ].join(",")
    );
  }
  lines.push("");
  lines.push("Test Item ID,Event Type,Platform,Order ID,Status,Value,Currency,Discrepancies,Errors");
  for (const event of data.events) {
    lines.push(
      [
        event.testItemId || "",
        event.eventType,
        event.platform,
        event.orderId || "",
        event.status,
        event.params?.value?.toFixed(2) || "",
        event.params?.currency || "",
        event.discrepancies?.join("; ") || "",
        event.errors?.join("; ") || "",
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
      doc.text(`Run Type: ${data.runType}`);
      doc.text(`Status: ${data.status}`);
      doc.text(`Platforms: ${data.platforms.join(", ")}`);
      if (data.completedAt) {
        doc.text(`Completed At: ${new Date(data.completedAt).toLocaleString("zh-CN")}`);
      }
      doc.moveDown();
      doc.fontSize(16).text("Summary", { underline: true });
      doc.fontSize(12);
      doc.text(`Total Tests: ${data.summary.totalTests}`);
      doc.text(`Passed: ${data.summary.passedTests}`);
      doc.text(`Failed: ${data.summary.failedTests}`);
      doc.text(`Missing Params: ${data.summary.missingParamTests}`);
      doc.text(`Parameter Completeness: ${data.summary.parameterCompleteness.toFixed(2)}%`);
      doc.text(`Value Accuracy: ${data.summary.valueAccuracy.toFixed(2)}%`);
      doc.moveDown();
      if (Object.keys(data.platformResults).length > 0) {
        doc.fontSize(16).text("Platform Results", { underline: true });
        doc.fontSize(12);
        for (const [platform, stats] of Object.entries(data.platformResults)) {
          const total = stats.sent + stats.failed;
          const successRate = total > 0 ? (stats.sent / total) * 100 : 0;
          doc.text(`${platform}: ${stats.sent} sent, ${stats.failed} failed (${successRate.toFixed(2)}% success rate)`);
        }
        doc.moveDown();
      }
      if (data.events.length > 0) {
        doc.fontSize(16).text("Event Details", { underline: true });
        doc.fontSize(10);
        for (let i = 0; i < Math.min(data.events.length, 50); i++) {
          const event = data.events[i];
          doc.text(`${i + 1}. ${event.eventType} (${event.platform}) - ${event.status}`);
          if (event.orderId) {
            doc.text(`   Order ID: ${event.orderId}`);
          }
          if (event.params?.value) {
            doc.text(`   Value: ${event.params.value} ${event.params.currency || ""}`);
          }
          if (event.discrepancies && event.discrepancies.length > 0) {
            doc.text(`   Discrepancies: ${event.discrepancies.join(", ")}`);
          }
          if (event.errors && event.errors.length > 0) {
            doc.text(`   Errors: ${event.errors.join(", ")}`);
          }
          doc.moveDown(0.5);
        }
        if (data.events.length > 50) {
          doc.text(`... and ${data.events.length - 50} more events`);
        }
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
