import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { i18nServer } from "../../i18n.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { generateSimpleId } from "../../utils/helpers";
import { safeFireAndForget } from "../../utils/helpers.server";
import { isPlanAtLeast } from "../../utils/plans";
import { normalizePlanId } from "../../services/billing/plans";
import { createWebPixel, getExistingWebPixels, isOurWebPixel, syncWebPixelMode } from "../../services/migration.server";
import { decryptIngestionSecret, encryptIngestionSecret, isTokenEncrypted } from "../../utils/token-encryption.server";
import { randomBytes } from "crypto";
import { trackEvent } from "../../services/analytics.server";
import { encryptJson } from "../../utils/crypto.server";
import { z } from "zod";
import {
  GoogleCredentialsInputSchema,
  MetaCredentialsInputSchema,
  TikTokCredentialsInputSchema,
} from "../../schemas/platform-credentials";

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
  const t = await i18nServer.getFixedT(request);
  if (actionType === "savePixelConfigs") {
    const configsJson = formData.get("configs") as string;
    if (!configsJson) {
      return json({ error: t("pixels.action.missingConfigData") }, { status: 400 });
    }
    if (!isPlanAtLeast(shop.plan, "starter")) {
      return json({
        success: false,
        error: t("pixels.action.planUpgradeRequired"),
      }, { status: 403 });
    }
    try {
      const BaseConfigSchema = z.object({
        platform: z.string(),
        platformId: z.string().optional().nullable(),
        credentials: z.any(),
        serverSideEnabled: z.boolean().optional(),
        eventMappings: z.any(),
        environment: z.string(),
      });

      const ConfigsArraySchema = z.array(BaseConfigSchema);
      
      let configs;
      try {
        configs = ConfigsArraySchema.parse(JSON.parse(configsJson));
      } catch (error) {
         if (error instanceof z.ZodError) {
             return json({ success: false, error: t("pixels.action.configFormatError", { error: error.issues[0].message }) }, { status: 400 });
         }
         // JSON parse error
         if (error instanceof SyntaxError) {
             return json({ success: false, error: t("pixels.action.invalidJSON") }, { status: 400 });
         }
         throw error;
      }

      const configIds: string[] = [];
      const createdPlatforms: string[] = [];
      for (const config of configs) {
        const platform = config.platform as SupportedPlatform;

        if (!SUPPORTED_PLATFORMS.includes(platform)) {
           return json({
             success: false,
             error: t("pixels.action.unsupportedPlatform", { platform: config.platform }),
           }, { status: 400 });
        }

        if (!["test", "live"].includes(config.environment)) {
             return json({ success: false, error: "Invalid environment" }, { status: 400 });
        }
        
        const platformIdTrimmed = config.platformId?.trim() ?? "";
        const platformIdValue = platformIdTrimmed.length > 0 ? platformIdTrimmed : null;
        const creds = (typeof config.credentials === 'object' && config.credentials !== null) ? config.credentials : {};
        const hasCredentials =
          platform === "google"
            ? !!(creds.measurementId?.trim() && creds.apiSecret?.trim())
            : !!(creds.pixelId?.trim() && creds.accessToken?.trim());

        // Validate credentials format if they are considered "present"
        if (hasCredentials) {
            let validationResult;
            if (platform === 'google') {
                validationResult = GoogleCredentialsInputSchema.safeParse(creds);
            } else if (platform === 'meta') {
                 validationResult = MetaCredentialsInputSchema.safeParse(creds);
            } else if (platform === 'tiktok') {
                 validationResult = TikTokCredentialsInputSchema.safeParse(creds);
            }
            
            if (validationResult && !validationResult.success) {
                 const errorMsg = validationResult.error.issues[0].message;
                 return json({ success: false, error: t("pixels.action.platformConfigError", { platform, error: errorMsg }) }, { status: 400 });
            }
        }

        const credentialsEncrypted = hasCredentials
          ? encryptJson(
              platform === "google"
                ? { measurementId: creds.measurementId ?? "", apiSecret: creds.apiSecret ?? "" }
                : {
                    pixelId: creds.pixelId ?? "",
                    accessToken: creds.accessToken ?? "",
                    ...(creds.testEventCode ? { testEventCode: creds.testEventCode } : {}),
                  }
            )
          : null;
        const serverSideEnabled = (config.serverSideEnabled === true && hasCredentials) || false;
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
        const commonData = {
          credentialsEncrypted,
          serverSideEnabled,
          eventMappings: config.eventMappings as object,
          clientConfig: clientConfig as object,
          environment: config.environment,
          migrationStatus: "in_progress" as const,
          updatedAt: new Date(),
        };
        let savedConfig: { id: string };
        if (platformIdValue) {
          savedConfig = await prisma.pixelConfig.upsert({
            where: {
              shopId_platform_environment_platformId: {
                shopId: shop.id,
                platform,
                environment: config.environment,
                platformId: platformIdValue,
              },
            },
            update: {
              platformId: platformIdValue,
              ...commonData,
            },
            create: {
              id: generateSimpleId("pixel-config"),
              shopId: shop.id,
              platform,
              platformId: platformIdValue,
              ...commonData,
            },
            select: { id: true },
          });
        } else if (existingConfig) {
          savedConfig = await prisma.pixelConfig.update({
            where: { id: existingConfig.id },
            data: {
              platformId: null,
              ...commonData,
            },
            select: { id: true },
          });
        } else {
          savedConfig = await prisma.pixelConfig.create({
            data: {
              id: generateSimpleId("pixel-config"),
              shopId: shop.id,
              platform,
              platformId: null,
              ...commonData,
            },
            select: { id: true },
          });
        }
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
        const globalEnvironment = configs.length > 0 ? (configs[0].environment as "test" | "live") : "live";
        await syncWebPixelMode(admin, shop.id, shopDomain, ourPixelId, ingestionSecret, globalEnvironment);
      } else {
        const globalEnvironment = configs.length > 0 ? (configs[0].environment as "test" | "live") : "live";
        const fullFunnelEventsList = ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_started"];
        const globalMode = configs.some(c => 
            Object.keys(c.eventMappings || {}).some(eventName => fullFunnelEventsList.includes(eventName))
        ) ? "full_funnel" : "purchase_only";
        
        const result = await createWebPixel(admin, ingestionSecret, shopDomain, globalEnvironment, globalMode);
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
        error: error instanceof Error ? error.message : t("pixels.action.saveConfigFailed"),
      }, { status: 500 });
    }
  }
  return json({ error: "Unknown action" }, { status: 400 });
};
