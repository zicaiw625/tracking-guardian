import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateVerificationReportData, generateVerificationReportPDF } from "../services/verification-report.server";
import { logger } from "../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const runId = url.searchParams.get("runId");

    if (!type || type !== "verification") {
      return json({ error: "Invalid report type" }, { status: 400 });
    }

    if (!runId) {
      return json({ error: "Missing runId" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    const { checkFeatureAccess } = await import("../services/billing/feature-gates.server");
    const gateResult = checkFeatureAccess(shop.plan as any, "report_export");
    if (!gateResult.allowed) {
      return json({ error: gateResult.reason || "需要 Growth 及以上套餐才能导出报告" }, { status: 402 });
    }

    const reportData = await generateVerificationReportData(shop.id, runId);
    const pdfBuffer = await generateVerificationReportPDF(reportData);
    const filename = `verification_report_${reportData.runId}_${new Date().toISOString().split("T")[0]}.pdf`;

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error("Failed to export verification report PDF", { error });
    return json(
      { error: error instanceof Error ? error.message : "Failed to export report PDF" },
      { status: 500 }
    );
  }
};
