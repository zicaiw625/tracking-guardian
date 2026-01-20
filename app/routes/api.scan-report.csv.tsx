import type { LoaderFunctionArgs } from "@remix-run/node";
import { createHash } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { authenticate } from "../shopify.server";
import { validateRiskItemsArray, validateStringArray } from "../utils/scan-data-validation";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { escapeCSV } from "../utils/csv.server";
import { sanitizeFilename } from "../utils/responses";
import { timingSafeEqualHex } from "../utils/timing-safe.server";
import { withSecurityHeaders } from "../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const reportId = url.searchParams.get("reportId");
    const token = url.searchParams.get("token");

    if (!reportId) {
      return new Response("Missing reportId", { status: 400 });
    }

    let scanReport: {
      id: string;
      shopId: string;
      riskScore: number;
      riskItems: unknown;
      identifiedPlatforms: unknown;
      status: string;
      createdAt: Date;
      completedAt: Date | null;
      shareTokenHash: string | null;
      shareTokenExpiresAt: Date | null;
    } | null = null;

    let shop: { id: string; shopDomain: string; plan: string | null } | null = null;

    if (token) {
      scanReport = await prisma.scanReport.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          shopId: true,
          riskScore: true,
          riskItems: true,
          identifiedPlatforms: true,
          status: true,
          createdAt: true,
          completedAt: true,
          shareTokenHash: true,
          shareTokenExpiresAt: true,
        },
      });

      if (!scanReport) {
        return new Response("Report not found", { status: 404 });
      }

      if (!scanReport.shareTokenHash) {
        return new Response("Share link not available", { status: 403 });
      }

      shop = await prisma.shop.findUnique({
        where: { id: scanReport.shopId },
        select: { shopDomain: true, id: true, plan: true },
      });

      if (!shop) {
        return new Response("Shop not found", { status: 404 });
      }

      const expectedTokenHash = createHash("sha256")
        .update(`${scanReport.id}-${scanReport.shopId}-${token}`)
        .digest("hex");

      if (!timingSafeEqualHex(expectedTokenHash, scanReport.shareTokenHash)) {
        return new Response("Invalid share token", { status: 403 });
      }

      if (scanReport.shareTokenExpiresAt && new Date() > scanReport.shareTokenExpiresAt) {
        return new Response("Share link has expired", { status: 403 });
      }

      const planId = normalizePlanId(shop.plan || "free") as PlanId;
      const gateResult = checkFeatureAccess(planId, "report_export");
      if (!gateResult.allowed) {
        return new Response(gateResult.reason || "需要 Growth 及以上套餐才能导出报告", { status: 402 });
      }
    } else {
      const { session } = await authenticate.admin(request);
      const shopDomain = session.shop;
      shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true, shopDomain: true, plan: true },
      });

      if (!shop) {
        return new Response("Shop not found", { status: 404 });
      }

      const planId = normalizePlanId(shop.plan || "free") as PlanId;
      const gateResult = checkFeatureAccess(planId, "report_export");
      if (!gateResult.allowed) {
        return new Response(gateResult.reason || "需要 Growth 及以上套餐才能导出报告", { status: 402 });
      }

      scanReport = await prisma.scanReport.findFirst({
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
          shareTokenHash: true,
          shareTokenExpiresAt: true,
        },
      });

      if (!scanReport) {
        return new Response("Report not found", { status: 404 });
      }
    }

    const riskItems = validateRiskItemsArray(scanReport.riskItems);
    const identifiedPlatforms = validateStringArray(scanReport.identifiedPlatforms);

    const csvLines: string[] = [];
    csvLines.push("扫描报告");
    csvLines.push(`店铺: ${shop.shopDomain}`);
    csvLines.push(`报告ID: ${scanReport.id}`);
    csvLines.push(`风险评分: ${scanReport.riskScore}/100`);
    csvLines.push(`状态: ${scanReport.status}`);
    csvLines.push(`创建时间: ${scanReport.createdAt.toISOString()}`);
    if (scanReport.completedAt) {
      csvLines.push(`完成时间: ${scanReport.completedAt.toISOString()}`);
    }
    csvLines.push("");
    csvLines.push("识别的平台");
    csvLines.push(identifiedPlatforms.join(", ") || "无");
    csvLines.push("");
    csvLines.push("风险项目");
    csvLines.push("ID,名称,严重程度,平台,描述,建议");
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
