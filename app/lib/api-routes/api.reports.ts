import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { generateVerificationReportData, generateVerificationReportCSV } from "../../services/verification-report.server";
import { logger } from "../../utils/logger.server";
import { sanitizeFilename } from "../../utils/responses";
import { jsonApi } from "../../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const runId = url.searchParams.get("runId");
    const format = url.searchParams.get("format") || "csv";

    if (!type || type !== "verification") {
      return jsonApi({ error: "Invalid report type" }, { status: 400 });
    }

    if (!runId) {
      return jsonApi({ error: "Missing runId" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (!shop) {
      return jsonApi({ error: "Shop not found" }, { status: 404 });
    }

    const { checkFeatureAccess } = await import("../../services/billing/feature-gates.server");
    const { normalizePlanId } = await import("../../services/billing/plans");
    const planId = normalizePlanId(shop.plan || "free");
    const gateResult = checkFeatureAccess(planId, "report_export");
    if (!gateResult.allowed) {
      return jsonApi({ error: gateResult.reason || "需要 Growth 及以上套餐才能导出报告" }, { status: 402 });
    }

    const reportData = await generateVerificationReportData(shop.id, runId);

    if (format === "csv") {
      const csv = generateVerificationReportCSV(reportData);
      const filename = `verification_report_${reportData.runId}_${new Date().toISOString().split("T")[0]}.csv`;
      return new Response("\uFEFF" + csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
        },
      });
    }

    if (format === "json") {
      return jsonApi(reportData);
    }

    return jsonApi({ error: "Unsupported format" }, { status: 400 });
  } catch (error) {
    logger.error("Failed to export verification report", { error });
    return jsonApi(
      { error: error instanceof Error ? error.message : "Failed to export report" },
      { status: 500 }
    );
  }
};
