import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getExistingWebPixels, isOurWebPixel, needsSettingsUpgrade } from "../services/migration.server";
import { sanitizeFilename } from "../utils/responses";
import { withSecurityHeaders, API_SECURITY_HEADERS } from "../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (!admin) {
    return new Response("Unauthorized", { status: 401 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      consentStrategy: true,
      dataRetentionDays: true,
      pixelConfigs: {
        where: { isActive: true },
        select: {
          platform: true,
          serverSideEnabled: true,
        },
      },
    },
  });
  if (!shop) {
    return new Response("Shop not found", { status: 404 });
  }
  const { checkFeatureAccess } = await import("../services/billing/feature-gates.server");
  const { normalizePlanId } = await import("../services/billing/plans");
  const planId = normalizePlanId(shop.plan || "free");
  const gateResult = checkFeatureAccess(planId, "report_export");
  if (!gateResult.allowed) {
    return new Response(gateResult.reason || "需要 Growth 及以上套餐才能导出诊断包", { status: 402 });
  }
  let webPixelStatus = {
    installed: false,
    needsUpgrade: false,
    pixelId: null as string | null,
    missingFields: [] as string[],
  };
  try {
    const existingPixels = await getExistingWebPixels(admin);
    const ourPixel = existingPixels.find((p) => {
      try {
        const settings = JSON.parse(p.settings || "{}");
        return isOurWebPixel(settings, shop.shopDomain);
      } catch {
        return false;
      }
    });
    let pixelSettings: Record<string, unknown> = {};
    let settingsNeedUpgrade = false;
    if (ourPixel?.settings) {
      try {
        pixelSettings = JSON.parse(ourPixel.settings);
        settingsNeedUpgrade = needsSettingsUpgrade(pixelSettings);
      } catch {
        settingsNeedUpgrade = false;
      }
    }
    const hasShopDomain = typeof pixelSettings.shop_domain === "string" && pixelSettings.shop_domain.length > 0;
    const hasIngestionKey = typeof pixelSettings.ingestion_key === "string" && pixelSettings.ingestion_key.length > 0;
    const missingFields = [
      ...(hasShopDomain ? [] : ["shop_domain"]),
      ...(hasIngestionKey ? [] : ["ingestion_key"]),
    ];
    webPixelStatus = {
      installed: Boolean(ourPixel),
      needsUpgrade: settingsNeedUpgrade,
      pixelId: ourPixel?.id ?? null,
      missingFields,
    };
  } catch (error) {
    logger.warn("Failed to evaluate web pixel status for diagnostics export", {
      shopId: shop.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const serverSidePlatforms = shop.pixelConfigs
    .filter((c) => c.serverSideEnabled)
    .map((c) => c.platform);
  const recentReceipt = await prisma.pixelEventReceipt.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      eventType: true,
      originHost: true,
    },
  });
  const recentConversions = await prisma.pixelEventReceipt.count({
    where: {
      shopId: shop.id,
      eventType: { in: ["purchase", "checkout_completed"] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  const generatedAt = new Date();
  const exportData = {
    metadata: {
      generatedAt: generatedAt.toISOString(),
      shopDomain: shop.shopDomain,
      plan: shop.plan ?? "free",
    },
    privacyNotice:
      "诊断包不包含订单明细、客户邮箱/电话等 PII/PCD，仅包含配置与健康度摘要。",
    configuration: {
      consentStrategy: shop.consentStrategy || "balanced",
      dataRetentionDays: shop.dataRetentionDays,
    },
    webPixel: webPixelStatus,
    serverSideTracking: {
      enabledPlatforms: serverSidePlatforms,
      enabledCount: serverSidePlatforms.length,
    },
    events: {
      recentReceipt: recentReceipt
        ? {
            eventType: recentReceipt.eventType,
            hoursSinceLastEvent: Math.round(
              (Date.now() - recentReceipt.createdAt.getTime()) / (1000 * 60 * 60)
            ),
          }
        : null,
      conversions24h: recentConversions,
    },
  };
  const dateSuffix = generatedAt.toISOString().split("T")[0];
  const filename = `diagnostic-package-${shop.shopDomain}-${dateSuffix}.json`;
  const headers = withSecurityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  }, API_SECURITY_HEADERS);
  return new Response(JSON.stringify(exportData, null, 2), {
    headers,
  });
};
