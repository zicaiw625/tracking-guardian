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
import { generateMigrationActions } from "../services/scanner/migration-actions";
import type { EnhancedScanResult } from "../services/scanner/types";
import type { ScriptTag, RiskItem } from "../types";
import { logger } from "../utils/logger.server";

type ReportType = "scan" | "migration" | "reconciliation";

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
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  logger.info(`Report generation requested: ${reportType} for ${shop.shopDomain}`);
  try {
    let html: string;
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
      default:
        return new Response(`Invalid report type: ${reportType}`, { status: 400 });
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
