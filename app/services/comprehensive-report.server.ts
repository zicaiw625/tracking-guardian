
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateReportData, type ReportData } from "./report-generator.server";
import { exportVerificationReport, exportMigrationChecklist, exportMultiShopReport } from "./report-export.server";
import { generateScanReportPdf, generateVerificationReportPdf, generateBatchReports } from "./pdf-generator.server";
import type { VerificationSummary } from "./verification.server";

export interface ComprehensiveReportOptions {
  format: "pdf" | "csv" | "json";
  includeScan?: boolean;
  includeMigration?: boolean;
  includeVerification?: boolean;
  includeRiskAnalysis?: boolean;
  includeEventStats?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ComprehensiveReportData extends ReportData {
  riskAnalysis?: {
    highRiskCount: number;
    mediumRiskCount: number;
    lowRiskCount: number;
    riskBreakdown: Array<{
      category: string;
      count: number;
      riskLevel: string;
    }>;
  };
  eventStats?: {
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    successRate: number;
    byPlatform: Record<string, {
      total: number;
      success: number;
      failed: number;
    }>;
    byEventType: Record<string, number>;
    recentEvents: Array<{
      id: string;
      eventType: string;
      platform: string;
      status: string;
      timestamp: Date;
    }>;
  };
}

export async function generateComprehensiveReport(
  shopId: string,
  options: ComprehensiveReportOptions
): Promise<ComprehensiveReportData | null> {
  try {
    const reportData = await generateReportData(
      shopId,
      options.includeScan ?? true,
      options.includeMigration ?? true,
      options.includeVerification ?? true
    );

    const comprehensiveData: ComprehensiveReportData = reportData;

    if (options.includeRiskAnalysis ?? true) {
      const auditAssets = await prisma.auditAsset.findMany({
        where: { shopId },
        select: {
          category: true,
          riskLevel: true,
        },
      });

      const riskBreakdown = auditAssets.reduce((acc, asset) => {
        const key = `${asset.category}_${asset.riskLevel}`;
        if (!acc[key]) {
          acc[key] = {
            category: asset.category,
            riskLevel: asset.riskLevel,
            count: 0,
          };
        }
        acc[key].count++;
        return acc;
      }, {} as Record<string, { category: string; riskLevel: string; count: number }>);

      comprehensiveData.riskAnalysis = {
        highRiskCount: auditAssets.filter(a => a.riskLevel === "high").length,
        mediumRiskCount: auditAssets.filter(a => a.riskLevel === "medium").length,
        lowRiskCount: auditAssets.filter(a => a.riskLevel === "low").length,
        riskBreakdown: Object.values(riskBreakdown),
      };
    }

    if (options.includeEventStats ?? true) {
      const dateFilter = options.dateRange
        ? {
            createdAt: {
              gte: options.dateRange.start,
              lte: options.dateRange.end,
            },
          }
        : {};

      const conversionLogs = await prisma.conversionLog.findMany({
        where: {
          shopId,
          ...dateFilter,
        },
        select: {
          id: true,
          eventType: true,
          platform: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      const byPlatform: Record<string, { total: number; success: number; failed: number }> = {};
      const byEventType: Record<string, number> = {};

      conversionLogs.forEach(log => {

        if (!byPlatform[log.platform]) {
          byPlatform[log.platform] = { total: 0, success: 0, failed: 0 };
        }
        byPlatform[log.platform].total++;
        if (log.status === "sent") {
          byPlatform[log.platform].success++;
        } else if (log.status === "failed") {
          byPlatform[log.platform].failed++;
        }

        byEventType[log.eventType] = (byEventType[log.eventType] || 0) + 1;
      });

      const totalEvents = conversionLogs.length;
      const successfulEvents = conversionLogs.filter(l => l.status === "sent").length;
      const failedEvents = conversionLogs.filter(l => l.status === "failed").length;

      comprehensiveData.eventStats = {
        totalEvents,
        successfulEvents,
        failedEvents,
        successRate: totalEvents > 0 ? Math.round((successfulEvents / totalEvents) * 100) : 0,
        byPlatform,
        byEventType,
        recentEvents: conversionLogs.slice(0, 20).map(log => ({
          id: log.id,
          eventType: log.eventType,
          platform: log.platform,
          status: log.status,
          timestamp: log.createdAt,
        })),
      };
    }

    return comprehensiveData;
  } catch (error) {
    logger.error("Failed to generate comprehensive report", { shopId, error });
    return null;
  }
}

export async function exportComprehensiveReport(
  shopId: string,
  options: ComprehensiveReportOptions
): Promise<{ content: string | Buffer; filename: string; mimeType: string }> {
  const data = await generateComprehensiveReport(shopId, options);

  if (!data) {
    throw new Error("Failed to generate comprehensive report data");
  }

  switch (options.format) {
    case "csv":
      return exportComprehensiveReportCSV(data, options);
    case "json":
      return exportComprehensiveReportJSON(data);
    case "pdf":
      return await exportComprehensiveReportPDF(data, options);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

function exportComprehensiveReportCSV(
  data: ComprehensiveReportData,
  options: ComprehensiveReportOptions
): { content: string; filename: string; mimeType: string } {
  const lines: string[] = [];

  lines.push("综合迁移报告");
  lines.push(`店铺: ${data.shopDomain}`);
  lines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  if (data.scanResults) {
    lines.push("=== 扫描结果 ===");
    lines.push(`风险分数: ${data.scanResults.riskScore}`);
    lines.push(`识别的平台: ${data.scanResults.identifiedPlatforms.join(", ")}`);
    lines.push(`ScriptTags 数量: ${data.scanResults.scriptTagsCount}`);
    lines.push("");
  }

  if (data.migrationProgress) {
    lines.push("=== 迁移进度 ===");
    lines.push(`总计: ${data.migrationProgress.total}`);
    lines.push(`已完成: ${data.migrationProgress.completed}`);
    lines.push(`进行中: ${data.migrationProgress.inProgress}`);
    lines.push(`待处理: ${data.migrationProgress.pending}`);
    lines.push(`完成率: ${data.migrationProgress.progressPercent}%`);
    lines.push("");
  }

  if (data.scanResults?.auditAssets && data.scanResults.auditAssets.length > 0) {
    lines.push("=== 迁移清单 ===");
    lines.push("优先级,风险等级,资产名称,平台,分类,建议迁移方式,预计时间(分钟),状态");
    data.scanResults.auditAssets.forEach((asset) => {
      const row = [
        asset.priority?.toString() || "",
        asset.riskLevel || "",
        asset.id || "",
        asset.platform || "",
        asset.category || "",
        "web_pixel",
        asset.estimatedTimeMinutes?.toString() || "",
        asset.migrationStatus || "",
      ];
      lines.push(row.map((cell) => `"${cell}"`).join(","));
    });
    lines.push("");
  }

  if (data.riskAnalysis) {
    lines.push("=== 风险分析 ===");
    lines.push(`高风险: ${data.riskAnalysis.highRiskCount}`);
    lines.push(`中风险: ${data.riskAnalysis.mediumRiskCount}`);
    lines.push(`低风险: ${data.riskAnalysis.lowRiskCount}`);
    lines.push("");
    lines.push("风险分类明细");
    lines.push("分类,风险等级,数量");
    data.riskAnalysis.riskBreakdown.forEach((item) => {
      lines.push(`"${item.category}","${item.riskLevel}",${item.count}`);
    });
    lines.push("");
  }

  if (data.verificationResults) {
    lines.push("=== 验收结果 ===");
    lines.push(`运行名称: ${data.verificationResults.runName}`);
    lines.push(`状态: ${data.verificationResults.status}`);
    lines.push(`总事件数: ${data.verificationResults.summary.totalEvents}`);
    lines.push(`成功事件: ${data.verificationResults.summary.successfulEvents}`);
    lines.push(`失败事件: ${data.verificationResults.summary.failedEvents}`);
    lines.push("");
  }

  if (data.eventStats) {
    lines.push("=== 事件统计 ===");
    lines.push(`总事件数: ${data.eventStats.totalEvents}`);
    lines.push(`成功事件: ${data.eventStats.successfulEvents}`);
    lines.push(`失败事件: ${data.eventStats.failedEvents}`);
    lines.push(`成功率: ${data.eventStats.successRate}%`);
    lines.push("");
    lines.push("按平台统计");
    lines.push("平台,总数,成功,失败");
    Object.entries(data.eventStats.byPlatform).forEach(([platform, stats]) => {
      lines.push(`"${platform}",${stats.total},${stats.success},${stats.failed}`);
    });
    lines.push("");
    lines.push("按事件类型统计");
    lines.push("事件类型,数量");
    Object.entries(data.eventStats.byEventType).forEach(([eventType, count]) => {
      lines.push(`"${eventType}",${count}`);
    });
  }

  const timestamp = new Date().toISOString().split("T")[0];
  return {
    content: lines.join("\n"),
    filename: `comprehensive-report-${data.shopDomain.replace(/\./g, "_")}-${timestamp}.csv`,
    mimeType: "text/csv; charset=utf-8",
  };
}

function exportComprehensiveReportJSON(
  data: ComprehensiveReportData
): { content: string; filename: string; mimeType: string } {
  const timestamp = new Date().toISOString().split("T")[0];
  return {
    content: JSON.stringify(data, null, 2),
    filename: `comprehensive-report-${data.shopDomain.replace(/\./g, "_")}-${timestamp}.json`,
    mimeType: "application/json",
  };
}

async function exportComprehensiveReportPDF(
  data: ComprehensiveReportData,
  options: ComprehensiveReportOptions
): Promise<{ content: Buffer; filename: string; mimeType: string }> {
  try {
    // Dynamic import for pdfkit
    // Note: Using any type here because pdfkit's type definitions are incomplete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let PDFDocument: any;
    try {
      const pdfkit = await import("pdfkit");
      PDFDocument = pdfkit.default || pdfkit;
    } catch {
      logger.warn("PDFKit not installed, cannot generate PDF");
      throw new Error("PDFKit not available");
    }

    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(20).text("综合迁移报告", { align: "center" });
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`店铺: ${data.shopDomain}`);
    doc.text(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
    doc.moveDown();

    if (data.scanResults) {
      doc.fontSize(16).text("1. 扫描结果", { underline: true });
      doc.fontSize(12);
      doc.text(`风险分数: ${data.scanResults.riskScore}`);
      doc.text(`识别的平台: ${data.scanResults.identifiedPlatforms.join(", ")}`);
      doc.text(`ScriptTags 数量: ${data.scanResults.scriptTagsCount}`);
      doc.moveDown();
    }

    if (data.migrationProgress) {
      doc.fontSize(16).text("2. 迁移进度", { underline: true });
      doc.fontSize(12);
      doc.text(`总计: ${data.migrationProgress.total} | 已完成: ${data.migrationProgress.completed} | 进行中: ${data.migrationProgress.inProgress} | 待处理: ${data.migrationProgress.pending}`);
      doc.text(`完成率: ${data.migrationProgress.progressPercent}%`);
      doc.moveDown();
    }

    if (data.scanResults?.auditAssets && data.scanResults.auditAssets.length > 0) {
      doc.fontSize(16).text("3. 迁移清单", { underline: true });
      doc.moveDown(0.5);
      data.scanResults.auditAssets.slice(0, 20).forEach((asset, index) => {
        if (index > 0) doc.moveDown(0.3);
        doc.fontSize(10);
        doc.text(`${index + 1}. ${asset.category} (${asset.platform || "N/A"})`, { font: "Helvetica-Bold" });
        doc.text(`   优先级: ${asset.priority || "N/A"} | 风险等级: ${asset.riskLevel} | 状态: ${asset.migrationStatus}`);
        if (asset.estimatedTimeMinutes) {
          doc.text(`   预计时间: ${asset.estimatedTimeMinutes} 分钟`);
        }
      });
      if (data.scanResults.auditAssets.length > 20) {
        doc.moveDown(0.5);
        doc.text(`... 还有 ${data.scanResults.auditAssets.length - 20} 项`, { color: "gray" });
      }
      doc.moveDown();
    }

    if (data.riskAnalysis) {
      doc.fontSize(16).text("4. 风险分析", { underline: true });
      doc.fontSize(12);
      doc.text(`高风险: ${data.riskAnalysis.highRiskCount} | 中风险: ${data.riskAnalysis.mediumRiskCount} | 低风险: ${data.riskAnalysis.lowRiskCount}`);
      doc.moveDown();
    }

    if (data.verificationResults) {
      doc.fontSize(16).text("5. 验收结果", { underline: true });
      doc.fontSize(12);
      doc.text(`运行名称: ${data.verificationResults.runName}`);
      doc.text(`状态: ${data.verificationResults.status}`);
      doc.text(`总事件数: ${data.verificationResults.summary.totalEvents}`);
      doc.text(`成功事件: ${data.verificationResults.summary.successfulEvents}`);
      doc.text(`失败事件: ${data.verificationResults.summary.failedEvents}`);
      doc.moveDown();
    }

    if (data.eventStats) {
      doc.fontSize(16).text("6. 事件统计", { underline: true });
      doc.fontSize(12);
      doc.text(`总事件数: ${data.eventStats.totalEvents}`);
      doc.text(`成功事件: ${data.eventStats.successfulEvents}`);
      doc.text(`失败事件: ${data.eventStats.failedEvents}`);
      doc.text(`成功率: ${data.eventStats.successRate}%`);
      doc.moveDown(0.5);

      if (Object.keys(data.eventStats.byPlatform).length > 0) {
        doc.fontSize(14).text("按平台统计", { underline: true });
        doc.moveDown(0.3);
        Object.entries(data.eventStats.byPlatform).forEach(([platform, stats]) => {
          doc.fontSize(10);
          doc.text(`${platform}: 总数 ${stats.total} | 成功 ${stats.success} | 失败 ${stats.failed}`);
        });
      }
    }

    doc.end();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("PDF generation timeout"));
      }, 60000);

      doc.on("end", () => {
        clearTimeout(timeout);
        const pdfBuffer = Buffer.concat(chunks);
        const timestamp = new Date().toISOString().split("T")[0];
        resolve({
          content: pdfBuffer,
          filename: `comprehensive-report-${data.shopDomain.replace(/\./g, "_")}-${timestamp}.pdf`,
          mimeType: "application/pdf",
        });
      });

      doc.on("error", (error: Error) => {
        clearTimeout(timeout);
        logger.error("PDF generation error", error);
        reject(error);
      });
    });
  } catch (error) {
    logger.error("Comprehensive PDF export failed", error);
    throw error;
  }
}

export async function exportBatchComprehensiveReports(
  shopIds: string[],
  options: ComprehensiveReportOptions & {
    workspaceName?: string;
    agencyBranding?: {
      name?: string;
      logo?: string;
    };
  }
): Promise<{ content: Buffer; filename: string; mimeType: string }> {
  try {
    const archiverModule = await import("archiver").catch(() => null);
    if (!archiverModule) {
      throw new Error("archiver package not available for batch report generation");
    }

    // Handle both default export and named export
    const archiverFactory = (archiverModule as { default?: typeof import("archiver") }).default || archiverModule;
    if (typeof archiverFactory !== "function") {
      throw new Error("archiver module is not a function");
    }

    const results: Array<{ buffer: Buffer; filename: string }> = [];

    for (const shopId of shopIds) {
      try {
        const data = await generateComprehensiveReport(shopId, options);
        if (!data) continue;

        const exportResult = await exportComprehensiveReport(shopId, options);
        if (exportResult.mimeType === "application/pdf") {
          results.push({
            buffer: exportResult.content as Buffer,
            filename: exportResult.filename,
          });
        }
      } catch (error) {
        logger.warn(`Failed to generate report for shop ${shopId}`, {
          shopId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (results.length === 0) {
      throw new Error("No reports generated");
    }

    const chunks: Buffer[] = [];
    const archive = archiverFactory("zip", { zlib: { level: 9 } });
    if (!archive) {
      throw new Error("Archiver not available");
    }

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", (err: Error) => {
      throw err;
    });

    for (const { buffer, filename } of results) {
      archive.append(buffer, { name: filename });
    }

    await archive.finalize();

    const timestamp = new Date().toISOString().split("T")[0];
    return {
      content: Buffer.concat(chunks),
      filename: `batch-comprehensive-reports-${timestamp}.zip`,
      mimeType: "application/zip",
    };
  } catch (error) {
    logger.error("Failed to generate batch comprehensive reports", error);
    throw error;
  }
}

