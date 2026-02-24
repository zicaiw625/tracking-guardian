import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { TFunction } from "i18next";
import { authenticate } from "../../shopify.server";
import { i18nServer } from "../../i18n.server";
import prisma from "../../db.server";
import {
  getExistingWebPixels,
  updateWebPixel,
  isOurWebPixel,
} from "../../services/migration.server";
import { generateEncryptedIngestionSecret } from "../../utils/token-encryption.server";
import { logger } from "../../utils/logger.server";
import { invalidateAllShopCaches } from "../../services/shop-cache.server";
import { invalidateAlertConfigsCache } from "../../services/db/cached-queries.server";

import {
  switchEnvironment,
  rollbackConfig,
  type PixelEnvironment,
} from "../../services/pixel-rollback.server";

export async function handleRotateIngestionSecret(
  t: TFunction,
  shopId: string,
  sessionShop: string,
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]
) {
  const currentShop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { ingestionSecret: true },
  });
  const { plain: newPlainSecret, encrypted: newEncryptedSecret } =
    generateEncryptedIngestionSecret();
  const graceWindowMinutes = 30;
  const graceWindowExpiry = new Date(
    Date.now() + graceWindowMinutes * 60 * 1000
  );
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      ingestionSecret: newEncryptedSecret,
      previousIngestionSecret: currentShop?.ingestionSecret || null,
      previousSecretExpiry: graceWindowExpiry,
    },
  });
  await invalidateAllShopCaches(sessionShop, shopId);
  let pixelSyncResult = { success: false, message: "" };
  try {
    const existingPixels = await getExistingWebPixels(admin);
    const ourPixel = existingPixels.find((p) => {
      try {
        const settings = JSON.parse(p.settings || "{}");
        return isOurWebPixel(settings, sessionShop);
      } catch {
        return false;
      }
    });
    if (ourPixel) {
      const result = await updateWebPixel(admin, ourPixel.id, newPlainSecret, sessionShop);
      if (result.success) {
        pixelSyncResult = {
          success: true,
          message: t("settings.action.pixelSyncSuccess"),
        };
      } else {
        pixelSyncResult = {
          success: false,
          message: t("settings.action.pixelSyncFailed", { error: result.error }),
        };
      }
    } else {
      pixelSyncResult = {
        success: false,
        message: t("settings.action.pixelNotFound"),
      };
    }
  } catch (pixelError) {
    logger.error("Failed to sync ingestion token to Web Pixel", pixelError);
    pixelSyncResult = {
      success: false,
      message: t("settings.action.pixelSyncError"),
    };
  }
  const baseMessage = t("settings.action.tokenUpdated");
  const graceMessage = t("settings.action.graceWindow", { minutes: graceWindowMinutes });
  const syncMessage = pixelSyncResult.success
    ? pixelSyncResult.message
    : `⚠️ ${pixelSyncResult.message}`;
  return json({
    success: true,
    message: `${baseMessage}${graceMessage}${syncMessage}`,
    pixelSyncSuccess: pixelSyncResult.success,
    graceWindowExpiry: graceWindowExpiry.toISOString(),
  });
}

export async function handleUpdatePrivacySettings(
  t: TFunction,
  formData: FormData,
  shopId: string,
  _sessionShop: string
) {
  const consentStrategy =
    (formData.get("consentStrategy") as string) || "strict";
  const dataRetentionDays =
    parseInt(formData.get("dataRetentionDays") as string) || 90;
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      consentStrategy,
      dataRetentionDays,
    },
  });
  return json({
    success: true,
    message: t("settings.action.privacyUpdated"),
  });
}

export async function handleSaveAlertConfigs(
  t: TFunction,
  formData: FormData,
  shopId: string
) {
  const configsJson = formData.get("alertConfigs");
  let alertConfigs: Array<{
    id: string;
    channel: string;
    settings?: Record<string, unknown> | null;
    frequency?: string;
    discrepancyThreshold: number;
    isEnabled: boolean;
  }> = [];
  if (typeof configsJson === "string" && configsJson.trim()) {
    try {
      const parsed = JSON.parse(configsJson) as unknown;
      if (Array.isArray(parsed)) {
        alertConfigs = parsed.map((c: unknown, i: number) => {
          const item = c && typeof c === "object" ? c as Record<string, unknown> : {};
          return {
            id: typeof item.id === "string" ? item.id : `alert-${i}-${Date.now()}`,
            channel: typeof item.channel === "string" ? item.channel : "email",
            settings: item.settings && typeof item.settings === "object" ? item.settings as Record<string, unknown> : null,
            frequency: typeof item.frequency === "string" ? item.frequency : undefined,
            discrepancyThreshold: typeof item.discrepancyThreshold === "number" ? item.discrepancyThreshold : 10,
            isEnabled: typeof item.isEnabled === "boolean" ? item.isEnabled : true,
          };
        });
      }
    } catch {
      alertConfigs = [];
    }
  }
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  });
  const currentSettings = shop?.settings && typeof shop.settings === "object" ? shop.settings as Record<string, unknown> : {};
  const newSettings = JSON.parse(JSON.stringify({ ...currentSettings, alertConfigs }));
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      settings: newSettings,
    },
  });
  invalidateAlertConfigsCache(shopId);
  return json({
    success: true,
    message: t("settings.action.alertConfigSaved"),
  });
}

export async function settingsAction({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }
  const t = await i18nServer.getFixedT(request);
  const formData = await request.formData();
  const action = formData.get("_action");
  switch (action) {
    case "rotateIngestionSecret":
      return handleRotateIngestionSecret(t, shop.id, session.shop, admin);
    case "updatePrivacySettings":
      return handleUpdatePrivacySettings(t, formData, shop.id, session.shop);
    case "switchEnvironment": {
      const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
      const gateResult = checkV1FeatureBoundary("server_side");
      if (!gateResult.allowed) {
        return json({ error: gateResult.reason || t("settings.action.featureNotAvailable") }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      const newEnvironment = formData.get("environment") as PixelEnvironment;
      if (!platform || !newEnvironment) {
        return json({
          success: false,
          error: t("settings.action.missingPlatformOrEnv")
        }, { status: 400 });
      }
      if (!["test", "live"].includes(newEnvironment)) {
        return json({
          success: false,
          error: t("settings.action.invalidEnvironment")
        }, { status: 400 });
      }
      const result = await switchEnvironment(shop.id, platform, newEnvironment);
      if (result.success) {
        try {
          const shopData = await prisma.shop.findUnique({
            where: { id: shop.id },
            select: { webPixelId: true, ingestionSecret: true, shopDomain: true },
          });
          if (shopData?.webPixelId) {
            const { decryptIngestionSecret } = await import("../../utils/token-encryption.server");
            const ingestionKey = shopData.ingestionSecret
              ? decryptIngestionSecret(shopData.ingestionSecret)
              : undefined;
            await updateWebPixel(
              admin,
              shopData.webPixelId,
              ingestionKey,
              shopData.shopDomain || session.shop,
              newEnvironment
            );
          }
        } catch (syncError) {
          logger.warn("Failed to sync environment to pixel settings", {
            shopId: shop.id,
            platform,
            environment: newEnvironment,
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
        await invalidateAllShopCaches(session.shop, shop.id);
      }
      return json({
        success: result.success,
        message: result.message,
        previousEnvironment: result.previousEnvironment,
        newEnvironment: result.newEnvironment,
      });
    }
    case "rollbackEnvironment": {
      const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
      const gateResult = checkV1FeatureBoundary("server_side");
      if (!gateResult.allowed) {
        return json({ error: gateResult.reason || t("settings.action.featureNotAvailable") }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      if (!platform) {
        return json({
          success: false,
          error: t("settings.action.missingPlatform")
        }, { status: 400 });
      }
      const result = await rollbackConfig(shop.id, platform);
      if (result.success) {
        await invalidateAllShopCaches(session.shop, shop.id);
      }
      return json({
        success: result.success,
        message: result.message,
        previousVersion: result.previousVersion,
        currentVersion: result.currentVersion,
      });
    }
    case "saveAlertConfigs":
      return handleSaveAlertConfigs(t, formData, shop.id);
    default:
      return json({ error: "Unknown action" }, { status: 400 });
  }
}
