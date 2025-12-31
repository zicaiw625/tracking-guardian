

import { logger } from "../utils/logger.server";
import {
  generateScanReportHtml,
  generateReconciliationReportHtml,
  generateVerificationReportHtml,
  fetchScanReportData,
  fetchReconciliationReportData,
  type VerificationReportData,
} from "./report-generator.server";

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

export async function htmlToPdf(
  html: string,
  options: PDFGeneratorOptions = {}
): Promise<Buffer> {

  try {

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

  logger.warn("PDF generation fallback: returning HTML wrapped in basic structure");

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

export interface BatchPdfOptions {
  shopIds: string[];
  reportType: ReportType;
  options?: PDFGeneratorOptions;
}

export async function generateBatchReports(
  batchOptions: BatchPdfOptions
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { shopIds, reportType, options } = batchOptions;

  try {

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

