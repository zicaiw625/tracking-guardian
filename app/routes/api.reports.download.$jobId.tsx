import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fetchReconciliationReportData, fetchScanReportData } from "../services/report-generator.server";
import { generateReconciliationReportPdf, generateScanReportPdf } from "../services/pdf-generator.server";
import {
  generateVerificationReportCSV,
  generateVerificationReportData,
  generateVerificationReportPDF,
} from "../services/verification-report.server";
import { exportComprehensiveReport } from "../services/comprehensive-report.server";
import { logger } from "../utils/logger.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return new Response("Shop not found", { status: 404 });
  }

  const jobId = params.jobId;
  if (!jobId) {
    return new Response("Job ID required", { status: 400 });
  }

  const job = await prisma.reportJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  if (job.shopId !== shop.id) {
    return new Response("Unauthorized", { status: 403 });
  }

  if (job.status !== "completed") {
    return new Response("Report not ready", { status: 409 });
  }

  try {
    if (job.reportType === "scan") {
      if (job.format === "pdf") {
        const pdfResult = await generateScanReportPdf(job.shopId);
        if (!pdfResult) {
          return new Response("Failed to generate scan report", { status: 500 });
        }
        return new Response(pdfResult.buffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdfResult.filename}"`,
            "Cache-Control": "no-cache",
          },
        });
      }
      if (job.format === "csv") {
        const data = await fetchScanReportData(job.shopId);
        if (!data) {
          return new Response("No scan data available", { status: 404 });
        }
        const csv = `Shop Domain,Risk Score,Platforms\n${data.shopDomain},${data.riskScore},"${data.identifiedPlatforms.join(",")}"\n`;
        const filename = `scan-report-${data.shopDomain}-${new Date().toISOString().split("T")[0]}.csv`;
        return new Response(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-cache",
          },
        });
      }
    }

    if (job.reportType === "verification") {
      const metadata = typeof job.metadata === "object" && job.metadata !== null && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
      const runId = metadata.runId as string | undefined;
      if (!runId) {
        return new Response("Missing runId for verification report", { status: 400 });
      }
      const data = await generateVerificationReportData(job.shopId, runId);
      if (!data) {
        return new Response("No verification report data available", { status: 404 });
      }
      if (job.format === "pdf") {
        const pdfResult = await generateVerificationReportPDF(data);
        if (!pdfResult) {
          return new Response("Failed to generate verification report", { status: 500 });
        }
        return new Response(pdfResult.buffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdfResult.filename}"`,
            "Cache-Control": "no-cache",
          },
        });
      }
      if (job.format === "csv") {
        const csv = generateVerificationReportCSV(data);
        const filename = `verification-report-${data.shopDomain}-${new Date().toISOString().split("T")[0]}.csv`;
        return new Response(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-cache",
          },
        });
      }
    }

    if (job.reportType === "comprehensive") {
      const result = await exportComprehensiveReport(job.shopId, {
        format: job.format as "pdf" | "csv" | "json",
        includeScan: true,
        includeMigration: true,
        includeVerification: true,
        includeRiskAnalysis: true,
        includeEventStats: true,
      });

      return new Response(result.content as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "Cache-Control": "no-cache",
        },
      });
    }

    if (job.reportType === "reconciliation") {
      const metadata = typeof job.metadata === "object" && job.metadata !== null && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
      const requestedDays = Number(metadata.days);
      const days = Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : 7;

      if (job.format === "pdf") {
        const pdfResult = await generateReconciliationReportPdf(job.shopId, days);
        if (!pdfResult) {
          return new Response("Failed to generate reconciliation report", { status: 500 });
        }
        return new Response(pdfResult.buffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdfResult.filename}"`,
            "Cache-Control": "no-cache",
          },
        });
      }
      if (job.format === "csv") {
        const data = await fetchReconciliationReportData(job.shopId, days);
        if (!data) {
          return new Response("No reconciliation report data available", { status: 404 });
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
        const filename = `reconciliation-report-${data.shopDomain}-${reportDate}.csv`;
        return new Response(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-cache",
          },
        });
      }
    }

    return new Response("Unsupported report type", { status: 400 });
  } catch (error) {
    logger.error("Failed to download report", { jobId, error });
    return new Response("Report download failed", { status: 500 });
  }
};
