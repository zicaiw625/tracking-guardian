import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { testNotification } from "../../services/notification.server";
import {
  getExistingWebPixels,
  updateWebPixel,
  isOurWebPixel,
} from "../../services/migration.server";
import { generateEncryptedIngestionSecret } from "../../utils/token-encryption";
import type {
  MetaCredentials,
  GoogleCredentials,
  TikTokCredentials,
} from "../../types/platform";
import { encryptAlertSettings } from "../../services/alert-settings.server";
import { encryptJson } from "../../utils/crypto.server";
import { logger } from "../../utils/logger.server";
import { invalidateAllShopCaches } from "../../services/shop-cache.server";
import type { AlertSettings } from "./types";

import {
  checkRateLimitAsync,
  pathShopKeyExtractor,
} from "../../middleware/rate-limit";
import {
  SecureEmailSchema,
  SecureUrlSchema,
} from "../../utils/security";

import {
  switchEnvironment,
  rollbackConfig,
  type PixelEnvironment,
} from "../../services/pixel-rollback.server";

export async function handleSaveAlert(
  formData: FormData,
  shopId: string,
  sessionShop: string
) {
  const { requireEntitlementOrThrow } = await import("../../services/billing/entitlement.server");
  await requireEntitlementOrThrow(shopId, "alerts");
  const channel = formData.get("channel") as string;
  const threshold = parseFloat(formData.get("threshold") as string) / 100;
  const enabled = formData.get("enabled") === "true";
  const failureRateThreshold = formData.get("failureRateThreshold")
    ? parseFloat(formData.get("failureRateThreshold") as string) / 100
    : threshold;
  const missingParamsThreshold = formData.get("missingParamsThreshold")
    ? parseFloat(formData.get("missingParamsThreshold") as string) / 100
    : threshold * 2.5;
  const volumeDropThreshold = formData.get("volumeDropThreshold")
    ? parseFloat(formData.get("volumeDropThreshold") as string) / 100
    : 0.5;
  const frequency = (formData.get("frequency") as "instant" | "daily" | "weekly") || "daily";
  const rawSettings: Record<string, unknown> = {};
  if (channel === "email") {
    rawSettings.email = formData.get("email");
  } else if (channel === "slack") {
    rawSettings.webhookUrl = formData.get("webhookUrl");
  } else if (channel === "telegram") {
    rawSettings.botToken = formData.get("botToken");
    rawSettings.chatId = formData.get("chatId");
  }
  const encryptedSettings = await encryptAlertSettings(rawSettings as AlertSettings);
  let shop;
  try {
    shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, settings: true },
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("settings") && (error.message.includes("does not exist") || error.message.includes("P2022")))) {
      logger.error("Shop.settings column does not exist. Database migration required. Please run: ALTER TABLE \"Shop\" ADD COLUMN IF NOT EXISTS \"settings\" JSONB;", { shopId, error: error.message });
      shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { id: true },
      });
      if (shop) {
        (shop as { settings?: unknown }).settings = null;
      }
    } else {
      throw error;
    }
  }
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const currentSettings = ((shop.settings as Record<string, unknown>) || {}) as Record<string, unknown>;
  const alertConfigs = (currentSettings.alertConfigs as Array<Record<string, unknown>>) || [];
  const existingIndex = alertConfigs.findIndex((cfg) => cfg.channel === channel);
  const alertConfig: Record<string, unknown> = {
    channel,
    enabled,
    frequency,
    thresholds: {
      failureRate: failureRateThreshold,
      missingParams: missingParamsThreshold,
      volumeDrop: volumeDropThreshold,
    },
    settingsEncrypted: encryptedSettings,
    ...(channel === "email" && rawSettings.email
      ? {
          emailMasked: String(rawSettings.email).replace(
            /(.{2}).*(@.*)/,
            "$1***$2"
          ),
        }
      : {}),
    ...(channel === "slack" && rawSettings.webhookUrl
      ? { configured: true }
      : {}),
    ...(channel === "telegram" && rawSettings.botToken
      ? {
          botTokenMasked: String(rawSettings.botToken).slice(0, 8) + "****",
          chatId: rawSettings.chatId,
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    alertConfigs[existingIndex] = alertConfig;
  } else {
    alertConfig.id = `alert_${Date.now()}`;
    alertConfigs.push(alertConfig);
  }
  try {
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        settings: {
          ...currentSettings,
          alertConfigs,
        },
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("settings") && error.message.includes("does not exist") || error.message.includes("P2022"))) {
      logger.error("Shop.settings column does not exist. Database migration required.", { shopId, error: error.message });
      return json({ success: false, error: "Database migration required. Please run: ALTER TABLE \"Shop\" ADD COLUMN IF NOT EXISTS \"settings\" JSONB;" }, { status: 500 });
    } else {
      throw error;
    }
  }
  await invalidateAllShopCaches(sessionShop, shopId);
  logger.info("Alert config saved to Shop.settings", {
    shopId,
    channel,
    enabled,
    threshold,
  });
  return json({ success: true, message: "警报配置已保存" });
}

export async function handleTestAlert(request: Request, formData: FormData) {
  const rateLimitKey = `alert-test:${pathShopKeyExtractor(request)}`;
  const rateLimit = await checkRateLimitAsync(rateLimitKey, 5, 60 * 1000);
  if (!rateLimit.allowed) {
    return json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
          retryAfter: rateLimit.retryAfter,
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfter || 60),
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": String(rateLimit.remaining || 0),
          "X-RateLimit-Reset": String(Math.ceil((rateLimit.resetAt || Date.now()) / 1000)),
        },
      }
    );
  }
  const channel = formData.get("channel") as string;
  let settings: AlertSettings;
  try {
    if (channel === "email") {
      const email = formData.get("email") as string;
      const result = SecureEmailSchema.safeParse(email);
      if (!result.success) {
        return json({ success: false, error: "无效的邮箱格式" });
      }
      settings = { email: result.data };
    } else if (channel === "slack") {
      const webhookUrl = formData.get("webhookUrl") as string;
      const result = SecureUrlSchema.safeParse(webhookUrl);
      if (!result.success) {
        return json({ success: false, error: "无效的 Webhook URL" });
      }
      settings = { webhookUrl: result.data };
    } else if (channel === "telegram") {
      const botToken = formData.get("botToken") as string;
      const chatId = formData.get("chatId") as string;
      if (!/^\d+:[a-zA-Z0-9_-]+$/.test(botToken)) {
        return json({ success: false, error: "无效的 Bot Token 格式" });
      }
      settings = {
        botToken,
        chatId,
      };
    } else {
      return json({ success: false, error: "Invalid channel" });
    }
    const result = await testNotification(channel, settings);
    return json(result);
  } catch (error) {
    logger.error("Test alert failed", error);
    return json({ success: false, error: "测试失败: 输入验证错误" });
  }
}

export async function handleDeleteAlert(formData: FormData) {
  const configId = formData.get("configId") as string;
  logger.debug("handleDeleteAlert called but alertConfig table no longer exists", { configId });
  return json({ success: true, message: "警报配置已删除" });
}

export async function handleSaveServerSide(
  formData: FormData,
  shopId: string,
  sessionShop: string
) {
  const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
  const gateResult = checkV1FeatureBoundary("server_side");
  if (!gateResult.allowed) {
    return json({ error: gateResult.reason || "此功能在当前版本中不可用" }, { status: 403 });
  }
  const { requireEntitlementOrThrow } = await import("../../services/billing/entitlement.server");
  const platform = formData.get("platform") as string;
  const v1SupportedPlatforms = ["google", "meta", "tiktok"];
  if (!v1SupportedPlatforms.includes(platform)) {
    return json({ error: `平台 ${platform} 在 v1.0 版本中不支持。v1.0 仅支持: ${v1SupportedPlatforms.join(", ")}。` }, { status: 400 });
  }
  const enabled = formData.get("enabled") === "true";
  if (enabled) {
    await requireEntitlementOrThrow(shopId, "pixel_destinations");
  }
  let credentials: GoogleCredentials | MetaCredentials | TikTokCredentials;
  let platformId = "";
  if (platform === "google") {
    const measurementId = (formData.get("measurementId") as string) || "";
    const apiSecret = (formData.get("apiSecret") as string) || "";
    if (enabled && (!measurementId || !apiSecret)) {
      return json(
        { error: "启用服务端追踪时必须填写 Measurement ID 和 API Secret" },
        { status: 400 }
      );
    }
    const googleCreds: GoogleCredentials = {
      measurementId,
      apiSecret,
    };
    credentials = googleCreds;
    platformId = measurementId;
  } else if (platform === "meta") {
    const pixelId = (formData.get("pixelId") as string) || "";
    const accessToken = (formData.get("accessToken") as string) || "";
    const testEventCode = (formData.get("testEventCode") as string) || undefined;
    if (enabled && (!pixelId || !accessToken)) {
      return json(
        { error: "启用服务端追踪时必须填写 Pixel ID 和 Access Token" },
        { status: 400 }
      );
    }
    const metaCreds: MetaCredentials = {
      pixelId,
      accessToken,
      testEventCode,
    };
    credentials = metaCreds;
    platformId = pixelId;
  } else if (platform === "tiktok") {
    const pixelId = (formData.get("pixelId") as string) || "";
    const accessToken = (formData.get("accessToken") as string) || "";
    if (enabled && (!pixelId || !accessToken)) {
      return json(
        { error: "启用服务端追踪时必须填写 Pixel ID 和 Access Token" },
        { status: 400 }
      );
    }
    const tiktokCreds: TikTokCredentials = {
      pixelId,
      accessToken,
    };
    credentials = tiktokCreds;
    platformId = pixelId;
  } else {
    return json({ error: "Unsupported platform" }, { status: 400 });
  }
  const hasNonEmptyCredentials = (() => {
    if (platform === "google") {
      const creds = credentials as GoogleCredentials;
      return !!(creds.measurementId && creds.apiSecret);
    } else if (platform === "meta") {
      const creds = credentials as MetaCredentials;
      return !!(creds.pixelId && creds.accessToken);
    } else if (platform === "tiktok") {
      const creds = credentials as TikTokCredentials;
      return !!(creds.pixelId && creds.accessToken);
    }
    return false;
  })();
  const encryptedCredentials = hasNonEmptyCredentials ? encryptJson(credentials) : null;
  const updateData: {
    credentialsEncrypted?: string | null;
    serverSideEnabled: boolean;
  } = {
    serverSideEnabled: enabled,
  };
  if (enabled || hasNonEmptyCredentials) {
    updateData.credentialsEncrypted = encryptedCredentials;
  }
  const environment = (formData.get("environment") as "test" | "live") || "live";
  const existing = await prisma.pixelConfig.findFirst({
    where: {
      shopId,
      platform,
      environment,
      platformId: platformId || null,
    },
  });
  if (existing) {
    await prisma.pixelConfig.update({
      where: { id: existing.id },
      data: updateData,
    });
  } else {
    await prisma.pixelConfig.create({
      data: {
        id: randomUUID(),
        shopId,
        platform,
        platformId,
        environment,
        serverSideEnabled: enabled ?? false,
        credentialsEncrypted: encryptedCredentials,
      } as unknown as Prisma.PixelConfigCreateInput,
    });
  }
  await invalidateAllShopCaches(sessionShop, shopId);
  const maskedPlatformId = platformId ? platformId.slice(0, 8) + "****" : "未设置";
  logger.info("Server-side tracking credentials updated", {
    shopId,
    platform,
    enabled,
    platformIdMasked: maskedPlatformId,
  });
  return json({ success: true, message: "服务端追踪配置已保存" });
}

export async function handleTestConnection(formData: FormData) {
  const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
  const gateResult = checkV1FeatureBoundary("server_side");
  if (!gateResult.allowed) {
    return json({ error: gateResult.reason || "此功能在当前版本中不可用" }, { status: 403 });
  }
  const platform = formData.get("platform") as string;
  if (platform === "meta") {
    const pixelId = formData.get("pixelId") as string;
    const accessToken = formData.get("accessToken") as string;
    if (!pixelId || !accessToken) {
      return json({
        success: false,
        message: "请填写 Pixel ID 和 Access Token",
      });
    }
    if (!/^\d+$/.test(pixelId)) {
      return json({
        success: false,
        message: "无效的 Pixel ID 格式（应为纯数字）",
      });
    }
    if (!accessToken.startsWith("EA")) {
      return json({
        success: false,
        message: "无效的 Access Token 格式（通常以 EA 开头）",
      });
    }
  }
  return json({
    success: true,
    message: "连接配置格式验证通过。请注意：这仅验证了格式，并未实际发送测试事件。",
  });
}

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
          message: "已自动同步到 Web Pixel 配置",
        };
      } else {
        pixelSyncResult = {
          success: false,
          message: `Web Pixel 同步失败: ${result.error}`,
        };
      }
    } else {
      pixelSyncResult = {
        success: false,
        message: "未找到已安装的 Web Pixel，请先在「迁移」页面安装像素",
      };
    }
  } catch (pixelError) {
    logger.error("Failed to sync ingestion secret to Web Pixel", pixelError);
    pixelSyncResult = {
      success: false,
      message: "Web Pixel 同步失败，请手动重新配置",
    };
  }
  const baseMessage = "关联令牌已更新。";
  const graceMessage = ` 旧令牌将在 ${graceWindowMinutes} 分钟内继续有效。`;
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
  formData: FormData,
  shopId: string,
  sessionShop: string
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
    message: "隐私设置已更新",
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
  const formData = await request.formData();
  const action = formData.get("_action");
  switch (action) {
    case "saveAlert":
      return handleSaveAlert(formData, shop.id, session.shop);
    case "testAlert":
      return handleTestAlert(request, formData);
    case "saveServerSide":
      return handleSaveServerSide(formData, shop.id, session.shop);
    case "deleteAlert":
      return handleDeleteAlert(formData);
    case "testConnection":
      return handleTestConnection(formData);
    case "rotateIngestionSecret":
      return handleRotateIngestionSecret(shop.id, session.shop, admin);
    case "updatePrivacySettings":
      return handleUpdatePrivacySettings(formData, shop.id, session.shop);
    case "switchEnvironment": {
      const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
      const gateResult = checkV1FeatureBoundary("server_side");
      if (!gateResult.allowed) {
        return json({ error: gateResult.reason || "此功能在当前版本中不可用" }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      const newEnvironment = formData.get("environment") as PixelEnvironment;
      if (!platform || !newEnvironment) {
        return json({
          success: false,
          error: "缺少 platform 或 environment 参数"
        }, { status: 400 });
      }
      if (!["test", "live"].includes(newEnvironment)) {
        return json({
          success: false,
          error: "无效的环境参数"
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
            const { decryptIngestionSecret } = await import("../../utils/token-encryption");
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
        return json({ error: gateResult.reason || "此功能在当前版本中不可用" }, { status: 403 });
      }
      const platform = formData.get("platform") as string;
      if (!platform) {
        return json({
          success: false,
          error: "缺少 platform 参数"
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
    default:
      return json({ error: "Unknown action" }, { status: 400 });
  }
}
