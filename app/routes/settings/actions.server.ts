import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
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
  let pixelSyncResult = { success: false };
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
        };
      } else {
        pixelSyncResult = { success: false };
      }
    } else {
      pixelSyncResult = { success: false };
    }
  } catch (pixelError) {
    logger.error("Failed to sync ingestion token to Web Pixel", pixelError);
    pixelSyncResult = { success: false };
  }
  return json({
    success: true,
    messageKey: pixelSyncResult.success
      ? "settings.toast.rotateSecret.synced"
      : "settings.toast.rotateSecret.rotatedSyncFailed",
    messageParams: { minutes: graceWindowMinutes },
    pixelSyncSuccess: pixelSyncResult.success,
    graceWindowExpiry: graceWindowExpiry.toISOString(),
  });
}

export async function handleUpdatePrivacySettings(
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
    messageKey: "settings.toast.privacyUpdated",
  });
}

export async function handleSaveAlertConfigs(
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
    messageKey: "settings.toast.alertsSaved",
  });
}

export async function settingsAction({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  if (!shop) {
    return json({ success: false, errorKey: "settings.errors.shopNotFound" }, { status: 404 });
  }
  const formData = await request.formData();
  const action = formData.get("_action");
  switch (action) {
    case "rotateIngestionSecret":
      return handleRotateIngestionSecret(shop.id, session.shop, admin);
    case "updatePrivacySettings":
      return handleUpdatePrivacySettings(formData, shop.id, session.shop);
    case "switchEnvironment": {
      const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
      const gateResult = checkV1FeatureBoundary("server_side");
      if (!gateResult.allowed) {
        return json({ success: false, errorKey: "settings.errors.featureUnavailable" }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      const newEnvironment = formData.get("environment") as PixelEnvironment;
      if (!platform || !newEnvironment) {
        return json({
          success: false,
          errorKey: "settings.errors.missingPlatformOrEnvironment",
        }, { status: 400 });
      }
      if (!["test", "live"].includes(newEnvironment)) {
        return json({
          success: false,
          errorKey: "settings.errors.invalidEnvironment",
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
      if (!result.success) {
        return json({ success: false, errorKey: "settings.errors.environmentSwitchFailed" }, { status: 400 });
      }
      return json({
        success: true,
        messageKey: result.previousEnvironment === result.newEnvironment
          ? "settings.toast.environmentAlready"
          : "settings.toast.environmentSwitched",
        messageParams: { environment: result.newEnvironment ?? newEnvironment },
        previousEnvironment: result.previousEnvironment,
        newEnvironment: result.newEnvironment,
      });
    }
    case "rollbackEnvironment": {
      const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
      const gateResult = checkV1FeatureBoundary("server_side");
      if (!gateResult.allowed) {
        return json({ success: false, errorKey: "settings.errors.featureUnavailable" }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      if (!platform) {
        return json({
          success: false,
          errorKey: "settings.errors.missingPlatform",
        }, { status: 400 });
      }
      const result = await rollbackConfig(shop.id, platform);
      if (result.success) {
        await invalidateAllShopCaches(session.shop, shop.id);
      }
      if (!result.success) {
        return json({ success: false, errorKey: "settings.errors.rollbackFailed" }, { status: 400 });
      }
      return json({
        success: true,
        messageKey: "settings.toast.rollbackSuccess",
        messageParams: { version: result.currentVersion },
        previousVersion: result.previousVersion,
        currentVersion: result.currentVersion,
      });
    }
    case "saveAlertConfigs":
      return handleSaveAlertConfigs(formData, shop.id);
    default:
      return json({ success: false, errorKey: "settings.errors.unknownAction" }, { status: 400 });
  }
}
