import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchScanReportData,
  fetchReconciliationReportData,
  generateScanReportHtml,
  generateReconciliationReportHtml,
  generateMigrationReportHtml,
  type MigrationReportData,
} from "../services/report-generator.server";
import { generateEnhancedRiskReport } from "../services/risk-report.server";
import { generateRiskReportHtml } from "../services/risk-report-html.server";
import { generateMigrationActions } from "../services/scanner/migration-actions";
import type { EnhancedScanResult } from "../services/scanner/types";
import type { ScriptTag, RiskItem } from "../types";
import { logger } from "../utils/logger.server";
import {
  generateVerificationReportData,
  generateVerificationReportHtml,
  generateVerificationReportCSV,
} from "../services/verification-report.server";
import { generateRiskReportCSV } from "../services/risk-report.server";
import { generateVerificationReportPdf } from "../services/pdf-generator.server";

type ReportType = "scan" | "migration" | "reconciliation" | "risk" | "verification" | "comprehensive";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (!admin) {
    return new Response("Unauthorized", { status: 401 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return new Response("Shop not found", { status: 404 });
  }
  const url = new URL(request.url);
  const reportType = (url.searchParams.get("type") || "scan") as ReportType;
  const format = url.searchParams.get("format") || "html"; // html, csv, pdf
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const runId = url.searchParams.get("runId") || undefined;
  logger.info(`Report generation requested: ${reportType} (${format}) for ${shop.shopDomain}`);
  try {
    let html: string | undefined;
    let csv: string | undefined;
    let pdf: Buffer | undefined;
    switch (reportType) {
      case "scan": {
        const data = await fetchScanReportData(shop.id);
        if (!data) {
          return new Response("No scan data available", { status: 404 });
        }
        html = generateScanReportHtml(data);
        break;
      }
      case "migration": {

        const latestScan = await prisma.scanReport.findFirst({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
        });
        if (!latestScan) {
          return new Response("No scan data available", { status: 404 });
        }
        const scriptTags = (latestScan.scriptTags as ScriptTag[] | null) || [];
        const identifiedPlatforms = (latestScan.identifiedPlatforms as string[]) || [];
        const riskItems = (latestScan.riskItems as RiskItem[] | null) || [];
        const enhancedResult: EnhancedScanResult = {
          scriptTags,
          checkoutConfig: null,
          identifiedPlatforms,
          riskItems,
          riskScore: latestScan.riskScore || 0,
          webPixels: [],
          duplicatePixels: [],
          migrationActions: [],
          additionalScriptsPatterns: [],
        };
        const actions = generateMigrationActions(enhancedResult, shop.shopTier || "unknown");
        const migrationData: MigrationReportData = {
          shopDomain: shop.shopDomain,
          generatedAt: new Date().toISOString(),
          reportType: "migration",
          migrationActions: actions.map(action => ({
            title: action.title,
            platform: action.platform,
            priority: action.priority,
            status: "pending" as const,
            description: action.description,
          })),
          completedCount: 0,
          totalCount: actions.length,
        };
        html = generateMigrationReportHtml(migrationData);
        break;
      }
      case "reconciliation": {
        const data = await fetchReconciliationReportData(shop.id, days);
        if (!data) {
          return new Response("No reconciliation data available", { status: 404 });
        }
        html = generateReconciliationReportHtml(data);
        break;
      }
      case "risk": {
        const report = await generateEnhancedRiskReport(shop.id);
        if (!report) {
          return new Response("No risk report data available", { status: 404 });
        }
        if (format === "csv") {
          csv = generateRiskReportCSV(report);
        } else {
          html = generateRiskReportHtml(report);
        }
        break;
      }
      case "verification": {
        const data = await generateVerificationReportData(shop.id, runId);
        if (!data) {
          return new Response("No verification report data available", { status: 404 });
        }
        if (format === "csv") {
          csv = generateVerificationReportCSV(data);
        } else if (format === "pdf") {
          const pdfResult = await generateVerificationReportPdf(data);
          if (pdfResult) {
            pdf = pdfResult.buffer;
          } else {
            return new Response("PDF generation failed", { status: 500 });
          }
        } else {
          html = generateVerificationReportHtml(data);
        }
        break;
      }
      case "comprehensive": {
        const { exportComprehensiveReport } = await import("../services/comprehensive-report.server");
        const result = await exportComprehensiveReport(shop.id, {
          format: format as "pdf" | "csv" | "json",
          includeScan: true,
          includeMigration: true,
          includeVerification: true,
          includeRiskAnalysis: true,
          includeEventStats: true,
        });
        
        if (format === "pdf") {
          pdf = result.content as Buffer;
        } else if (format === "csv") {
          csv = result.content as string;
        } else {
          html = `<pre>${result.content}</pre>`;
        }
        break;
      }
      default:
        return new Response(`Invalid report type: ${reportType}`, { status: 400 });
    }

    // Return PDF if requested
    if (format === "pdf" && pdf) {
      const filename = reportType === "verification"
        ? `verification_report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}.pdf`
        : reportType === "comprehensive"
          ? `comprehensive_report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}.pdf`
          : `report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}.pdf`;
      return new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-cache",
        },
      });
    }

    // Return CSV if requested
    if (format === "csv" && csv) {
      const filename = reportType === "risk"
        ? `risk_report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}.csv`
        : reportType === "comprehensive"
          ? `comprehensive_report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}.csv`
          : `verification_report_${shop.shopDomain}_${new Date().toISOString().split("T")[0]}.csv`;
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-cache",
        },
      });
    }

    // Return HTML (default)
    if (!html) {
      return new Response("Report generation failed: no content", { status: 500 });
    }
    
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    logger.error(`Report generation failed for ${shop.shopDomain}:`, error);
    return new Response("Report generation failed", { status: 500 });
  }
};
