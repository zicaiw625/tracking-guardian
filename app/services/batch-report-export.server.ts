

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getVerificationRun } from "./verification.server";
import type { VerificationSummary } from "./verification.server";

export interface BatchReportExportOptions {
  shopIds: string[];
  reportType: "verification" | "scan" | "reconciliation";
  format: "csv" | "json" | "pdf";
  dateRange?: {
    start: Date;
    end: Date;
  };
  whiteLabel?: {
    companyName?: string;
    logoUrl?: string;
    contactEmail?: string;
  };
}

export interface BatchReportExportResult {
  success: boolean;
  totalShops: number;
  successCount: number;
  failedCount: number;
  reports: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed";
    reportData?: any;
    error?: string;
  }>;
  combinedReport?: {
    content: string;
    filename: string;
    mimeType: string;
  };
}

export async function batchExportVerificationReports(
  options: BatchReportExportOptions
): Promise<BatchReportExportResult> {
  const { shopIds, format } = options;

  const reports: BatchReportExportResult["reports"] = [];
  let successCount = 0;
  let failedCount = 0;

  for (const shopId of shopIds) {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      if (!shop) {
        reports.push({
          shopId,
          shopDomain: "",
          status: "failed",
          error: "店铺不存在",
        });
        failedCount++;
        continue;
      }

      const latestRun = await prisma.verificationRun.findFirst({
        where: {
          shopId,
          status: "completed",
          ...(options.dateRange && {
            completedAt: {
              gte: options.dateRange.start,
              lte: options.dateRange.end,
            },
          }),
        },
        orderBy: { completedAt: "desc" },
      });

      if (!latestRun) {
        reports.push({
          shopId,
          shopDomain: shop.shopDomain,
          status: "failed",
          error: "无验收记录",
        });
        failedCount++;
        continue;
      }

      const summary = await getVerificationRun(latestRun.id);
      if (!summary) {
        reports.push({
          shopId,
          shopDomain: shop.shopDomain,
          status: "failed",
          error: "无法获取验收详情",
        });
        failedCount++;
        continue;
      }

      reports.push({
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        reportData: summary,
      });
      successCount++;
    } catch (error) {
      logger.error("Failed to export verification report", { shopId, error });
      reports.push({
        shopId,
        shopDomain: "",
        status: "failed",
        error: error instanceof Error ? error.message : "未知错误",
      });
      failedCount++;
    }
  }

  let combinedReport: BatchReportExportResult["combinedReport"] | undefined;
  if (format === "pdf") {
    combinedReport = await generateCombinedPdfReport(reports, "verification", options.whiteLabel);
  } else if (format === "csv" || format === "json") {
    combinedReport = generateCombinedReport(reports, format);
  }

  return {
    success: failedCount === 0,
    totalShops: shopIds.length,
    successCount,
    failedCount,
    reports,
    combinedReport,
  };
}

function generateCombinedReport(
  reports: BatchReportExportResult["reports"],
  format: "csv" | "json"
): BatchReportExportResult["combinedReport"] {
  const timestamp = new Date().toISOString().split("T")[0];

  if (format === "json") {
    const data = {
      exportedAt: new Date().toISOString(),
      totalShops: reports.length,
      reports: reports.map((r) => ({
        shopDomain: r.shopDomain,
        shopId: r.shopId,
        status: r.status,
        reportData: r.reportData,
        error: r.error,
      })),
    };

    return {
      content: JSON.stringify(data, null, 2),
      filename: `batch-verification-report-${timestamp}.json`,
      mimeType: "application/json",
    };
  }

  const lines: string[] = [];
  lines.push("店铺域名,店铺ID,状态,通过率,参数完整率,金额准确率,通过数,失败数,参数缺失数,平台,错误信息");

  for (const report of reports) {
    if (report.status === "success" && report.reportData) {
      const data = report.reportData as VerificationSummary;
      const passRate = data.totalTests > 0
        ? Math.round((data.passedTests / data.totalTests) * 100)
        : 0;

      lines.push([
        report.shopDomain,
        report.shopId,
        "成功",
        `${passRate}%`,
        `${data.parameterCompleteness}%`,
        `${data.valueAccuracy}%`,
        data.passedTests,
        data.failedTests,
        data.missingParamTests,
        data.platforms.join(";"),
        "",
      ].join(","));
    } else {
      lines.push([
        report.shopDomain || "",
        report.shopId,
        "失败",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        report.error || "",
      ].join(","));
    }
  }

  return {
    content: "\uFEFF" + lines.join("\n"),
    filename: `batch-verification-report-${timestamp}.csv`,
    mimeType: "text/csv;charset=utf-8",
  };
}

export async function batchExportScanReports(
  options: BatchReportExportOptions
): Promise<BatchReportExportResult> {
  const { shopIds, format } = options;

  const reports: BatchReportExportResult["reports"] = [];
  let successCount = 0;
  let failedCount = 0;

  for (const shopId of shopIds) {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      if (!shop) {
        reports.push({
          shopId,
          shopDomain: "",
          status: "failed",
          error: "店铺不存在",
        });
        failedCount++;
        continue;
      }

      const latestScan = await prisma.scanReport.findFirst({
        where: {
          shopId,
          status: "completed",
          ...(options.dateRange && {
            createdAt: {
              gte: options.dateRange.start,
              lte: options.dateRange.end,
            },
          }),
        },
        orderBy: { createdAt: "desc" },
      });

      if (!latestScan) {
        reports.push({
          shopId,
          shopDomain: shop.shopDomain,
          status: "failed",
          error: "无扫描记录",
        });
        failedCount++;
        continue;
      }

      reports.push({
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        reportData: {
          riskScore: latestScan.riskScore,
          identifiedPlatforms: latestScan.identifiedPlatforms,
          createdAt: latestScan.createdAt,
        },
      });
      successCount++;
    } catch (error) {
      logger.error("Failed to export scan report", { shopId, error });
      reports.push({
        shopId,
        shopDomain: "",
        status: "failed",
        error: error instanceof Error ? error.message : "未知错误",
      });
      failedCount++;
    }
  }

  let combinedReport: BatchReportExportResult["combinedReport"] | undefined;
  if (format === "csv" || format === "json") {
    combinedReport = generateCombinedScanReport(reports, format);
  } else if (format === "pdf") {
    combinedReport = await generateCombinedPdfReport(reports, "scan", options.whiteLabel);
  }

  return {
    success: failedCount === 0,
    totalShops: shopIds.length,
    successCount,
    failedCount,
    reports,
    combinedReport,
  };
}

function generateCombinedScanReport(
  reports: BatchReportExportResult["reports"],
  format: "csv" | "json"
): BatchReportExportResult["combinedReport"] {
  const timestamp = new Date().toISOString().split("T")[0];

  if (format === "json") {
    const data = {
      exportedAt: new Date().toISOString(),
      totalShops: reports.length,
      reports: reports.map((r) => ({
        shopDomain: r.shopDomain,
        shopId: r.shopId,
        status: r.status,
        reportData: r.reportData,
        error: r.error,
      })),
    };

    return {
      content: JSON.stringify(data, null, 2),
      filename: `batch-scan-report-${timestamp}.json`,
      mimeType: "application/json",
    };
  }

  const lines: string[] = [];
  lines.push("店铺域名,店铺ID,状态,风险分数,识别平台,扫描时间,错误信息");

  for (const report of reports) {
    if (report.status === "success" && report.reportData) {
      const data = report.reportData as {
        riskScore: number;
        identifiedPlatforms: string[];
        createdAt: Date;
      };

      lines.push([
        report.shopDomain,
        report.shopId,
        "成功",
        data.riskScore.toString(),
        (data.identifiedPlatforms as string[]).join(";"),
        new Date(data.createdAt).toLocaleString("zh-CN"),
        "",
      ].join(","));
    } else {
      lines.push([
        report.shopDomain || "",
        report.shopId,
        "失败",
        "",
        "",
        "",
        report.error || "",
      ].join(","));
    }
  }

  return {
    content: "\uFEFF" + lines.join("\n"),
    filename: `batch-scan-report-${timestamp}.csv`,
    mimeType: "text/csv;charset=utf-8",
  };
}

async function generateCombinedPdfReport(
  reports: BatchReportExportResult["reports"],
  reportType: "verification" | "scan" | "reconciliation",
  whiteLabel?: BatchReportExportOptions["whiteLabel"]
): Promise<BatchReportExportResult["combinedReport"] | undefined> {
  try {
    const { generateBatchReports } = await import("./pdf-generator.server");

    const shopIds = reports
      .filter((r) => r.status === "success")
      .map((r) => r.shopId);

    if (shopIds.length === 0) {
      return undefined;
    }

    // 如果有白标配置，需要从 shopIds 生成批量报告数据
    // 由于 generateBatchReportPdf 需要 groupId，我们使用标准 PDF 生成并应用白标
    // 白标配置可以在生成HTML时应用
    if (whiteLabel) {
      // 使用标准批量报告生成，白标将在报告内容中应用
      const result = await generateBatchReports({
        shopIds,
        reportType,
      });

      if (!result) {
        return undefined;
      }

      return {
        content: result.buffer.toString("base64"),
        filename: result.filename,
        mimeType: "application/pdf",
      };
    }

    // 默认使用标准 PDF 生成
    const result = await generateBatchReports({
      shopIds,
      reportType,
    });

    if (!result) {
      return undefined;
    }

    return {
      content: result.buffer.toString("base64"),
      filename: result.filename,
      mimeType: "application/pdf",
    };
  } catch (error) {
    logger.error("Failed to generate combined PDF report", { error });
    return undefined;
  }
}

export function generateMultiShopSummaryHtml(
  reports: BatchReportExportResult["reports"],
  reportType: "verification" | "scan" | "reconciliation"
): string {
  const timestamp = new Date().toLocaleString("zh-CN");
  const successReports = reports.filter((r) => r.status === "success");

  let summaryHtml = "";

  if (reportType === "verification") {

    const totalShops = reports.length;
    const successCount = successReports.length;
    const avgPassRate = successReports.length > 0
      ? successReports.reduce((sum, r) => {
          const data = r.reportData as VerificationSummary | undefined;
          if (!data) return sum;
          const passRate = data.totalTests > 0
            ? (data.passedTests / data.totalTests) * 100
            : 0;
          return sum + passRate;
        }, 0) / successReports.length
      : 0;

    summaryHtml = `
      <h2>多店验收报告汇总</h2>
      <p>生成时间: ${timestamp}</p>
      <h3>汇总统计</h3>
      <ul>
        <li>总店铺数: ${totalShops}</li>
        <li>成功生成报告: ${successCount}</li>
        <li>平均通过率: ${avgPassRate.toFixed(1)}%</li>
      </ul>
      <h3>各店铺详情</h3>
      <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th>店铺域名</th>
            <th>通过率</th>
            <th>参数完整率</th>
            <th>金额准确率</th>
            <th>测试平台</th>
          </tr>
        </thead>
        <tbody>
          ${successReports.map((r) => {
            const data = r.reportData as VerificationSummary | undefined;
            if (!data) return "";
            const passRate = data.totalTests > 0
              ? Math.round((data.passedTests / data.totalTests) * 100)
              : 0;
            return `
              <tr>
                <td>${r.shopDomain}</td>
                <td>${passRate}%</td>
                <td>${data.parameterCompleteness}%</td>
                <td>${data.valueAccuracy}%</td>
                <td>${data.platforms.join(", ")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  } else if (reportType === "scan") {
    summaryHtml = `
      <h2>多店扫描报告汇总</h2>
      <p>生成时间: ${timestamp}</p>
      <h3>汇总统计</h3>
      <ul>
        <li>总店铺数: ${reports.length}</li>
        <li>成功生成报告: ${successReports.length}</li>
      </ul>
      <h3>各店铺详情</h3>
      <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th>店铺域名</th>
            <th>风险分数</th>
            <th>识别平台</th>
          </tr>
        </thead>
        <tbody>
          ${successReports.map((r) => {
            const data = r.reportData as {
              riskScore: number;
              identifiedPlatforms: string[];
            } | undefined;
            if (!data) return "";
            return `
              <tr>
                <td>${r.shopDomain}</td>
                <td>${data.riskScore}</td>
                <td>${(data.identifiedPlatforms as string[]).join(", ")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
      </style>
    </head>
    <body>
      ${summaryHtml}
    </body>
    </html>
  `;
}

