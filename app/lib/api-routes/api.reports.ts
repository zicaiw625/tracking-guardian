import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { generateVerificationReportData, generateVerificationReportCSV } from "../../services/verification-report.server";
import { logger } from "../../utils/logger.server";
import { sanitizeFilename } from "../../utils/responses";
import { jsonApi, withSecurityHeaders } from "../../utils/security-headers";
import { validateRiskItemsArray, validateStringArray } from "../../utils/scan-data-validation";
import { escapeCSV } from "../../utils/csv.server";
import { resolveEffectivePlan } from "../../services/billing/effective-plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const runId = url.searchParams.get("runId");
    const reportId = url.searchParams.get("reportId");
    const format = url.searchParams.get("format") || "csv";

    if (!type || (type !== "verification" && type !== "scan")) {
      return jsonApi({ error: "Invalid report type" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true, entitledUntil: true },
    });

    if (!shop) {
      return jsonApi({ error: "Shop not found" }, { status: 404 });
    }

    const { checkFeatureAccess } = await import("../../services/billing/feature-gates.server");
    const { normalizePlanId } = await import("../../services/billing/plans");
    const planId = normalizePlanId(resolveEffectivePlan(shop.plan, shop.entitledUntil));
    const gateResult = checkFeatureAccess(planId, "report_export");
    if (!gateResult.allowed) {
      return jsonApi({ error: gateResult.reason || "Report export requires Growth plan or above" }, { status: 402 });
    }

    if (type === "verification") {
      if (!runId) {
        return jsonApi({ error: "Missing runId" }, { status: 400 });
      }
      const reportData = await generateVerificationReportData(shop.id, runId);

      if (format === "csv") {
        const csv = generateVerificationReportCSV(reportData);
        const filename = `verification_report_${reportData.runId}_${new Date().toISOString().split("T")[0]}.csv`;
        return new Response("\uFEFF" + csv, {
          status: 200,
          headers: withSecurityHeaders({
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
          }),
        });
      }

      if (format === "json") {
        return jsonApi(reportData);
      }

      return jsonApi({ error: "Unsupported format" }, { status: 400 });
    }

    const effectiveReportId = reportId || runId;
    if (!effectiveReportId) {
      return jsonApi({ error: "Missing reportId" }, { status: 400 });
    }
    const scanReport = await prisma.scanReport.findFirst({
      where: {
        id: effectiveReportId,
        shopId: shop.id,
      },
      select: {
        id: true,
        riskScore: true,
        riskItems: true,
        identifiedPlatforms: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!scanReport) {
      return jsonApi({ error: "Scan report not found" }, { status: 404 });
    }
    const riskItems = validateRiskItemsArray(scanReport.riskItems);
    const identifiedPlatforms = validateStringArray(scanReport.identifiedPlatforms);
    if (format === "json") {
      return jsonApi({
        reportId: scanReport.id,
        riskScore: scanReport.riskScore,
        status: scanReport.status,
        createdAt: scanReport.createdAt,
        completedAt: scanReport.completedAt,
        identifiedPlatforms,
        riskItems,
      });
    }
    if (format === "csv") {
      const csvLines: string[] = [];
      csvLines.push("Scan Report");
      csvLines.push(`Shop ID: ${shop.id}`);
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
      const filename = `scan_report_${scanReport.id}_${new Date().toISOString().split("T")[0]}.csv`;
      return new Response("\uFEFF" + csvLines.join("\n"), {
        status: 200,
        headers: withSecurityHeaders({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
        }),
      });
    }
    return jsonApi({ error: "Unsupported format" }, { status: 400 });
  } catch (error) {
    logger.error("Failed to export report", { error });
    return jsonApi(
      { error: error instanceof Error ? error.message : "Failed to export report" },
      { status: 500 }
    );
  }
};
