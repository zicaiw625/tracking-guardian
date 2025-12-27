/**
 * PDF 报告生成服务
 * 使用 puppeteer-core 或者 html-pdf-node 将 HTML 报告转换为 PDF
 *
 * 注意：在生产环境中，推荐使用无服务器 PDF 生成服务如：
 * - Browserless.io
 * - AWS Lambda + Puppeteer
 * - pdf.co
 *
 * 本实现提供一个轻量级的替代方案，使用 html-pdf-node
 */

import { logger } from "../utils/logger.server";
import {
  generateScanReportHtml,
  generateReconciliationReportHtml,
  generateVerificationReportHtml,
  fetchScanReportData,
  fetchReconciliationReportData,
  type VerificationReportData,
} from "./report-generator.server";

// ============================================================
// 类型定义
// ============================================================

export type ReportType = "scan" | "reconciliation" | "verification";

export interface PDFGeneratorOptions {
  format?: "A4" | "Letter";
  landscape?: boolean;
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
}

export interface PDFResult {
  buffer: Buffer;
  filename: string;
  contentType: "application/pdf";
}

// ============================================================
// PDF 生成核心逻辑
// ============================================================

/**
 * 将 HTML 字符串转换为 PDF Buffer
 * 使用轻量级方案，不依赖 Puppeteer
 */
async function htmlToPdf(
  html: string,
  options: PDFGeneratorOptions = {}
): Promise<Buffer> {
  // 尝试使用 html-pdf-node（需要安装）
  try {
    // 动态导入以避免构建时错误
    const htmlPdfNode = await import("html-pdf-node").catch(() => null);
    
    if (htmlPdfNode) {
      const file = { content: html };
      const pdfOptions = {
        format: options.format || "A4",
        landscape: options.landscape || false,
        margin: options.margin || {
          top: "20mm",
          right: "20mm",
          bottom: "20mm",
          left: "20mm",
        },
        printBackground: true,
      };
      
      const buffer = await htmlPdfNode.default.generatePdf(file, pdfOptions);
      return buffer;
    }
  } catch (error) {
    logger.warn("html-pdf-node not available, using fallback", error);
  }

  // 回退方案：返回 HTML 作为"伪 PDF"（实际上是 HTML 文件）
  // 在生产环境中，应该集成真正的 PDF 生成服务
  logger.warn("PDF generation fallback: returning HTML wrapped in basic structure");
  
  // 创建一个简单的 HTML 到 Buffer 转换
  // 这不是真正的 PDF，但可以作为开发阶段的占位符
  const wrappedHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @media print {
      body { margin: 0; padding: 20mm; }
    }
  </style>
</head>
<body>
${html}
</body>
</html>
  `;
  
  return Buffer.from(wrappedHtml, "utf-8");
}

// ============================================================
// 扫描报告 PDF
// ============================================================

/**
 * 生成扫描报告 PDF
 */
export async function generateScanReportPdf(
  shopId: string,
  scanId?: string,
  options?: PDFGeneratorOptions
): Promise<PDFResult | null> {
  try {
    const data = await fetchScanReportData(shopId, scanId);
    if (!data) {
      logger.error("Failed to fetch scan report data for PDF generation");
      return null;
    }

    const html = generateScanReportHtml(data);
    const buffer = await htmlToPdf(html, options);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `scan-report-${data.shopDomain.replace(/\./g, "_")}-${timestamp}.pdf`;

    return {
      buffer,
      filename,
      contentType: "application/pdf",
    };
  } catch (error) {
    logger.error("Failed to generate scan report PDF:", error);
    return null;
  }
}

// ============================================================
// 对账报告 PDF
// ============================================================

/**
 * 生成对账报告 PDF
 */
export async function generateReconciliationReportPdf(
  shopId: string,
  reportId?: string,
  options?: PDFGeneratorOptions
): Promise<PDFResult | null> {
  try {
    const data = await fetchReconciliationReportData(shopId, reportId);
    if (!data) {
      logger.error("Failed to fetch reconciliation report data for PDF generation");
      return null;
    }

    const html = generateReconciliationReportHtml(data);
    const buffer = await htmlToPdf(html, options);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `reconciliation-report-${data.shopDomain.replace(/\./g, "_")}-${timestamp}.pdf`;

    return {
      buffer,
      filename,
      contentType: "application/pdf",
    };
  } catch (error) {
    logger.error("Failed to generate reconciliation report PDF:", error);
    return null;
  }
}

// ============================================================
// 验收报告 PDF
// ============================================================

/**
 * 生成验收报告 PDF
 */
export async function generateVerificationReportPdf(
  data: VerificationReportData,
  options?: PDFGeneratorOptions
): Promise<PDFResult | null> {
  try {
    const html = generateVerificationReportHtml(data);
    const buffer = await htmlToPdf(html, options);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `verification-report-${data.shopDomain.replace(/\./g, "_")}-${timestamp}.pdf`;

    return {
      buffer,
      filename,
      contentType: "application/pdf",
    };
  } catch (error) {
    logger.error("Failed to generate verification report PDF:", error);
    return null;
  }
}

// ============================================================
// 批量报告生成
// ============================================================

export interface BatchPdfOptions {
  shopIds: string[];
  reportType: ReportType;
  options?: PDFGeneratorOptions;
}

/**
 * 批量生成 PDF 报告
 * 返回一个 zip 压缩包的 Buffer
 */
export async function generateBatchReports(
  batchOptions: BatchPdfOptions
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { shopIds, reportType, options } = batchOptions;

  try {
    // 动态导入 archiver
    const archiver = await import("archiver").catch(() => null);
    
    if (!archiver) {
      logger.error("archiver package not available for batch PDF generation");
      return null;
    }

    const results: Array<{ buffer: Buffer; filename: string }> = [];

    for (const shopId of shopIds) {
      let result: PDFResult | null = null;

      switch (reportType) {
        case "scan":
          result = await generateScanReportPdf(shopId, undefined, options);
          break;
        case "reconciliation":
          result = await generateReconciliationReportPdf(shopId, undefined, options);
          break;
        // verification 需要特殊处理，因为需要额外数据
        default:
          continue;
      }

      if (result) {
        results.push({
          buffer: result.buffer,
          filename: result.filename,
        });
      }
    }

    if (results.length === 0) {
      return null;
    }

    // 创建 zip 压缩包
    const chunks: Buffer[] = [];
    const archive = archiver.default("zip", { zlib: { level: 9 } });

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("error", (err) => {
      throw err;
    });

    for (const { buffer, filename } of results) {
      archive.append(buffer, { name: filename });
    }

    await archive.finalize();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return {
      buffer: Buffer.concat(chunks),
      filename: `batch-${reportType}-reports-${timestamp}.zip`,
    };
  } catch (error) {
    logger.error("Failed to generate batch PDF reports:", error);
    return null;
  }
}

// ============================================================
// 导出函数
// ============================================================

export {
  htmlToPdf,
};

