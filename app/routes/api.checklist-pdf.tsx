import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateMigrationChecklist } from "../services/migration-checklist.server";
import { generateChecklistPDF } from "../services/checklist-pdf.server";
import { logger } from "../utils/logger.server";
import { sanitizeFilename } from "../utils/responses";
import { jsonApi, withSecurityHeaders } from "../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (!shop) {
      return jsonApi({ error: "Shop not found" }, { status: 404 });
    }

    const { checkFeatureAccess } = await import("../services/billing/feature-gates.server");
    const { normalizePlanId } = await import("../services/billing/plans");
    const planId = normalizePlanId(shop.plan || "free");
    const gateResult = checkFeatureAccess(planId, "report_export");
    if (!gateResult.allowed) {
      return jsonApi({ error: gateResult.reason || "需要 Growth 及以上套餐才能导出报告" }, { status: 402 });
    }

    const checklist = await generateMigrationChecklist(shop.id);
    const pdfBuffer = await generateChecklistPDF(checklist, shopDomain);
    const filename = `migration_checklist_${shopDomain}_${new Date().toISOString().split("T")[0]}.pdf`;

    const headers = withSecurityHeaders({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      "Content-Length": pdfBuffer.length.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    });

    return new Response(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers,
    });
  } catch (error) {
    logger.error("Failed to export migration checklist PDF", { error });
    return jsonApi(
      { error: error instanceof Error ? error.message : "Failed to export checklist PDF" },
      { status: 500 }
    );
  }
};
