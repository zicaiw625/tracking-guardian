import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { generateSimpleId } from "../../utils/helpers";
import { safeFireAndForget } from "../../utils/helpers.server";
import { isPlanAtLeast } from "../../utils/plans";
import { normalizePlanId } from "../../services/billing/plans";
import { createWebPixel, getExistingWebPixels, isOurWebPixel, updateWebPixel } from "../../services/migration.server";
import { decryptIngestionSecret, encryptIngestionSecret, isTokenEncrypted } from "../../utils/token-encryption.server";
import { randomBytes } from "crypto";
import { trackEvent } from "../../services/analytics.server";

const SUPPORTED_PLATFORMS = ["google", "meta", "tiktok"] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

function generateIngestionSecret(): string {
  return randomBytes(32).toString("hex");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      ingestionSecret: true,
      webPixelId: true,
      plan: true,
    },
  });
  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }
  if (actionType === "savePixelConfigs") {
    const configsJson = formData.get("configs") as string;
    if (!configsJson) {
      return json({ error: "缺少配置数据" }, { status: 400 });
    }
    if (!isPlanAtLeast(shop.plan, "starter")) {
      return json({
        success: false,
        error: "启用像素迁移需要 Migration ($49/月) 及以上套餐。请先升级套餐。",
      }, { status: 403 });
    }
    try {
      const configs = JSON.parse(configsJson) as Array<{
        platform: string;
        platformId: string;
        credentials: Record<string, string>;
        eventMappings: Record<string, string>;
        environment: "test" | "live";
      }>;
      const configIds: string[] = [];
      const createdPlatforms: string[] = [];
      for (const config of configs) {
        const platform = config.platform as SupportedPlatform;
        if (!SUPPORTED_PLATFORMS.includes(platform)) {
          return json({
            success: false,
            error: `平台 ${config.platform} 尚未在 v1 支持，请仅选择 GA4、Meta 或 TikTok。`,
          }, { status: 400 });
        }
        const platformIdValue = config.platformId?.trim() || null;
        const existingConfig = await prisma.pixelConfig.findFirst({
          where: {
            shopId: shop.id,
            platform,
            environment: config.environment,
            ...(platformIdValue
              ? { platformId: platformIdValue }
              : {
                  OR: [
                    { platformId: null },
                    { platformId: "" },
                  ],
                }),
          },
          select: { id: true },
        });
        const fullFunnelEvents = ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_started"];
        const hasFullFunnelEvents = Object.keys(config.eventMappings || {}).some(eventName =>
          fullFunnelEvents.includes(eventName)
        );
        const mode: "purchase_only" | "full_funnel" = hasFullFunnelEvents ? "full_funnel" : "purchase_only";
        const clientConfig = { mode };
        const savedConfig = await prisma.pixelConfig.upsert({
          where: {
            shopId_platform_environment_platformId: {
              shopId: shop.id,
              platform,
              environment: config.environment,
              platformId: platformIdValue || "",
            },
          },
          update: {
            platformId: platformIdValue as string | null,
            credentialsEncrypted: null,
            serverSideEnabled: false,
            eventMappings: config.eventMappings as object,
            clientConfig: clientConfig as object,
            environment: config.environment,
            migrationStatus: "in_progress",
            updatedAt: new Date(),
          },
          create: {
            id: generateSimpleId("pixel-config"),
            shopId: shop.id,
            platform,
            platformId: platformIdValue,
            credentialsEncrypted: null,
            serverSideEnabled: false,
            eventMappings: config.eventMappings as object,
            clientConfig: clientConfig as object,
            environment: config.environment,
            migrationStatus: "in_progress",
            updatedAt: new Date(),
          },
          select: { id: true },
        });
        configIds.push(savedConfig.id);
        if (!existingConfig) {
          createdPlatforms.push(platform);
        }
      }
      let ingestionSecret: string | undefined = undefined;
      if (shop.ingestionSecret) {
        try {
          if (isTokenEncrypted(shop.ingestionSecret)) {
            ingestionSecret = decryptIngestionSecret(shop.ingestionSecret);
          } else {
            ingestionSecret = shop.ingestionSecret;
            const encryptedSecret = encryptIngestionSecret(ingestionSecret as string);
            await prisma.shop.update({
              where: { id: shop.id },
              data: { ingestionSecret: encryptedSecret },
            });
          }
        } catch (error) {
          logger.error(`[PixelsNew] Failed to decrypt ingestionSecret for ${shopDomain}`, error);
        }
      }
      if (!ingestionSecret) {
        ingestionSecret = generateIngestionSecret();
        const encryptedSecret = encryptIngestionSecret(ingestionSecret);
        await prisma.shop.update({
          where: { id: shop.id },
          data: { ingestionSecret: encryptedSecret },
        });
      }
      let ourPixelId = shop.webPixelId;
      if (!ourPixelId) {
        const existingPixels = await getExistingWebPixels(admin);
        const ourPixel = existingPixels.find((p) => {
          if (!p.settings) return false;
          try {
            const settings = JSON.parse(p.settings);
            return isOurWebPixel(settings, shopDomain);
          } catch {
            return false;
          }
        });
        ourPixelId = ourPixel?.id ?? null;
      }
      if (ourPixelId) {
        await updateWebPixel(admin, ourPixelId, ingestionSecret, shopDomain);
      } else {
        const result = await createWebPixel(admin, ingestionSecret, shopDomain);
        if (result.success && result.webPixelId) {
          await prisma.shop.update({
            where: { id: shop.id },
            data: { webPixelId: result.webPixelId },
          });
        }
      }
      if (createdPlatforms.length > 0) {
        const planId = normalizePlanId(shop.plan ?? "free");
        const isAgency = isPlanAtLeast(planId, "agency");
        const firstPlatform = createdPlatforms[0];
        let riskScore: number | undefined;
        let assetCount: number | undefined;
        try {
          const latestScan = await prisma.scanReport.findFirst({
            where: { shopId: shop.id },
            orderBy: { createdAt: "desc" },
            select: { riskScore: true },
          });
          if (latestScan) {
            riskScore = latestScan.riskScore;
            const assets = await prisma.auditAsset.count({
              where: { shopId: shop.id },
            });
            assetCount = assets;
          }
        } catch {
          // no-op: ignore errors when counting assets
        }
        safeFireAndForget(
          trackEvent({
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            event: "cfg_pixel_created",
            metadata: {
              count: createdPlatforms.length,
              platforms: createdPlatforms,
              plan: shop.plan ?? "free",
              role: isAgency ? "agency" : "merchant",
              destination_type: firstPlatform,
              environment: "test",
              risk_score: riskScore,
              asset_count: assetCount,
            },
          })
        );
      }
      return json({ success: true, configIds });
    } catch (error) {
      logger.error("Failed to save pixel configs", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "保存配置失败",
      }, { status: 500 });
    }
  }
  return json({ error: "Unknown action" }, { status: 400 });
};
