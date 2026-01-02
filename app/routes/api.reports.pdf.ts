

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  generateScanReportPdf,
  generateReconciliationReportPdf,
  generateVerificationReportPdf,
} from "../services/pdf-generator.server";
import {
  fetchVerificationReportData,
  fetchBatchReportData,
  generateBatchReportHtml,
  generateScanReportHtml,
  generateReconciliationReportHtml,
  generateVerificationReportHtml,
  fetchScanReportData,
  fetchReconciliationReportData,
} from "../services/report-generator.server";
import { planSupportsFeature, normalizePlanId, type PlanId } from "../services/billing/plans";
import { logger } from "../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const reportType = url.searchParams.get("type") || "scan";
  const groupId = url.searchParams.get("groupId");
  const runId = url.searchParams.get("runId") || undefined;
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const format = url.searchParams.get("format") || "pdf";

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return new Response(JSON.stringify({ error: "Shop not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const planId = normalizePlanId(shop.plan);

  if (reportType === "batch") {
    if (!planSupportsFeature(planId as PlanId, "agency")) {
      return new Response(
        JSON.stringify({ error: "批量报告需要 Agency 套餐" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!groupId) {
      return new Response(
        JSON.stringify({ error: "缺少 groupId 参数" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  try {
    let html: string | null = null;
    let filename = "";

    switch (reportType) {
      case "scan": {
        const data = await fetchScanReportData(shop.id);
        if (!data) {
          return new Response(
            JSON.stringify({ error: "无扫描报告数据" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        html = generateScanReportHtml(data);
        filename = `scan-report-${shopDomain.replace(/\./g, "_")}-${Date.now()}.${format === "html" ? "html" : "pdf"}`;
        break;
      }

      case "reconciliation": {
        const data = await fetchReconciliationReportData(shop.id, days);
        if (!data) {
          return new Response(
            JSON.stringify({ error: "无对账报告数据" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        html = generateReconciliationReportHtml(data);
        filename = `reconciliation-report-${shopDomain.replace(/\./g, "_")}-${Date.now()}.${format === "html" ? "html" : "pdf"}`;
        break;
      }

      case "verification": {
        const data = await fetchVerificationReportData(shop.id, runId);
        if (!data) {
          return new Response(
            JSON.stringify({ error: "无验收报告数据" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        html = generateVerificationReportHtml(data);
        filename = `verification-report-${shopDomain.replace(/\./g, "_")}-${Date.now()}.${format === "html" ? "html" : "pdf"}`;
        break;
      }

      case "batch": {
        const data = await fetchBatchReportData(groupId!, shop.id, days);
        if (!data) {
          return new Response(
            JSON.stringify({ error: "无法获取批量报告数据" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        html = generateBatchReportHtml(data);
        filename = `batch-report-${data.groupName.replace(/\s+/g, "_")}-${Date.now()}.${format === "html" ? "html" : "pdf"}`;
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: "不支持的报告类型" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
    }

    if (!html) {
      return new Response(
        JSON.stringify({ error: "生成报告失败" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (format === "html") {
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${filename}"`,
        },
      });
    }

    const pdfResult = await generatePdfFromHtml(html, reportType, shopDomain);

    if (!pdfResult) {

      logger.warn("PDF generation failed, returning HTML as fallback");
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename.replace('.pdf', '.html')}"`,
        },
      });
    }

    return new Response(pdfResult.buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfResult.filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    logger.error("Report generation error:", error);
    return new Response(
      JSON.stringify({
        error: "生成报告时发生错误",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

async function generatePdfFromHtml(
  html: string,
  reportType: string,
  shopDomain: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {

    const htmlPdfNode = await import("html-pdf-node").catch(() => null);

    if (htmlPdfNode) {
      const file = { content: html };
      const options = {
        format: "A4" as const,
        margin: {
          top: "20mm",
          right: "20mm",
          bottom: "20mm",
          left: "20mm",
        },
        printBackground: true,
      };

      const buffer = await htmlPdfNode.default.generatePdf(file, options);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${reportType}-report-${shopDomain.replace(/\./g, "_")}-${timestamp}.pdf`;

      return { buffer, filename };
    }

    logger.warn("html-pdf-node not available");
    return null;
  } catch (error) {
    logger.error("PDF generation error:", error);
    return null;
  }
}

