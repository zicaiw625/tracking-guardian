import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { authenticate } from "../../shopify.server";
import { validateRiskItemsArray, validateStringArray } from "../../utils/scan-data-validation";
import { checkFeatureAccess } from "../../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../../services/billing/plans";
import { escapeCSV } from "../../utils/csv.server";
import { sanitizeFilename } from "../../utils/responses";
import { withSecurityHeaders } from "../../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const reportId = url.searchParams.get("reportId");

    if (!reportId) {
      return new Response("Missing reportId", { status: 400 });
    }

    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, shopDomain: true, plan: true },
    });

    if (!shop) {
      return new Response("Shop not found", { status: 404 });
    }

    const planId = normalizePlanId(shop.plan || "free") as PlanId;
    const gateResult = checkFeatureAccess(planId, "report_export");
    if (!gateResult.allowed) {
      return new Response(gateResult.reason || "Report export requires Growth plan or above", { status: 402 });
    }

    const scanReport = await prisma.scanReport.findFirst({
      where: {
        id: reportId,
        shopId: shop.id,
      },
      select: {
        id: true,
        shopId: true,
        riskScore: true,
        riskItems: true,
        identifiedPlatforms: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!scanReport) {
      return new Response("Report not found", { status: 404 });
    }

    const riskItems = validateRiskItemsArray(scanReport.riskItems);
    const identifiedPlatforms = validateStringArray(scanReport.identifiedPlatforms);

    const csvLines: string[] = [];
    csvLines.push("Scan Report");
    csvLines.push(`Shop: ${shop.shopDomain}`);
    csvLines.push(`Report ID: ${scanReport.id}`);
    csvLines.push(`Risk Score: ${scanReport.riskScore}/100`);
    csvLines.push(`Status: ${scanReport.status}`);
    csvLines.push(`Created At: ${scanReport.createdAt.toISOString()}`);
    if (scanReport.completedAt) {
      csvLines.push(`Completed At: ${scanReport.completedAt.toISOString()}`);
    }
    csvLines.push("");
    csvLines.push("Identified Platforms");
    csvLines.push(identifiedPlatforms.join(", ") || "None");
    csvLines.push("");
    csvLines.push("Risk Items");
    csvLines.push("ID,Name,Severity,Platform,Description,Recommendation");
    for (const item of riskItems) {
      csvLines.push([
        item.id,
        item.name,
        item.severity,
        item.platform || "",
        item.description || "",
        item.recommendation || "",
      ].map(escapeCSV).join(","));
    }

    const csvContent = csvLines.join("\n");
    const filename = `scan-report-${shop.shopDomain.replace(/\./g, "_")}-${scanReport.id}-${new Date().toISOString().split("T")[0]}.csv`;

    return new Response(csvContent, {
      headers: withSecurityHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      }),
    });
  } catch (error) {
    logger.error("Failed to export scan report CSV", {
      error,
      reportId: new URL(request.url).searchParams.get("reportId"),
    });
    return new Response(
      error instanceof Error ? error.message : "Failed to export scan report CSV",
      { status: 500 }
    );
  }
};
