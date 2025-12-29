

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { testNotification } from "../../services/notification.server";
import { createAuditLog } from "../../services/audit.server";
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
  PinterestCredentials,
} from "../../types/platform";
import {
  encryptAlertSettings,
  encryptJson,
} from "../../services/alert-settings.server";
import { logger } from "../../utils/logger.server";
import { invalidateAllShopCaches } from "../../services/shop-cache.server";
import type { AlertSettings } from "./types";

import {
  checkRateLimitAsync,
  createRateLimitResponse,
} from "../../utils/rate-limiter";
import {
  SecureEmailSchema,
  SecureUrlSchema,
} from "../../utils/security";
import { PCD_CONFIG } from "../../utils/config";

export async function handleSaveAlert(

  formData: FormData,
  shopId: string,
  sessionShop: string
) {
  const channel = formData.get("channel") as string;
  const threshold = parseFloat(formData.get("threshold") as string) / 100;
  const enabled = formData.get("enabled") === "true";

  const rawSettings: Record<string, unknown> = {};
  if (channel === "email") {
    rawSettings.email = formData.get("email");
  } else if (channel === "slack") {
    rawSettings.webhookUrl = formData.get("webhookUrl");
  } else if (channel === "telegram") {
    rawSettings.botToken = formData.get("botToken");
    rawSettings.chatId = formData.get("chatId");
  }

  const encryptedSettings = encryptAlertSettings(channel, rawSettings);

  const nonSensitiveSettings: Record<string, unknown> = {
    channel,
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
  };

  await prisma.alertConfig.upsert({
    where: {
      id: (formData.get("configId") as string) || "new",
    },
    update: {
      channel,
      settings: nonSensitiveSettings as Prisma.InputJsonValue,
      settingsEncrypted: encryptedSettings,
      discrepancyThreshold: threshold,
      isEnabled: enabled,
    },
    create: {
      shopId,
      channel,
      settings: nonSensitiveSettings as Prisma.InputJsonValue,
      settingsEncrypted: encryptedSettings,
      discrepancyThreshold: threshold,
      isEnabled: enabled,
    },
  });

  await createAuditLog({
    shopId,
    actorType: "user",
    actorId: sessionShop,
    action: "alert_config_updated",
    resourceType: "alert_config",
    resourceId: (formData.get("configId") as string) || "new",
    metadata: {
      channel,
      threshold,
    },
  });

  return json({ success: true, message: "警报配置已保存" });
}

export async function handleTestAlert(request: Request, formData: FormData) {

  const { isLimited, retryAfter } = await checkRateLimitAsync(request, "alert-test", {
    maxRequests: 5,
    windowMs: 60 * 1000,
  });

  if (isLimited) {
    return createRateLimitResponse(retryAfter);
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
  await prisma.alertConfig.delete({
    where: { id: configId },
  });
  return json({ success: true, message: "警报配置已删除" });
}

export async function handleSaveServerSide(
  formData: FormData,
  shopId: string,
  sessionShop: string
) {
  const platform = formData.get("platform") as string;
  const enabled = formData.get("enabled") === "true";

  let credentials: GoogleCredentials | MetaCredentials | TikTokCredentials | PinterestCredentials;
  let platformId = "";

  if (platform === "google") {
    const measurementId = (formData.get("measurementId") as string) || "";
    const apiSecret = (formData.get("apiSecret") as string) || "";
    
    // 验证：如果启用服务端追踪，必须填写所有凭证字段
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
    
    // 验证：如果启用服务端追踪，必须填写所有凭证字段
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
    
    // 验证：如果启用服务端追踪，必须填写所有凭证字段
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
  } else if (platform === "pinterest") {
    const adAccountId = (formData.get("adAccountId") as string) || "";
    const accessToken = (formData.get("accessToken") as string) || "";
    
    // 验证：如果启用服务端追踪，必须填写所有凭证字段
    if (enabled && (!adAccountId || !accessToken)) {
      return json(
        { error: "启用服务端追踪时必须填写 Ad Account ID 和 Access Token" },
        { status: 400 }
      );
    }
    
    const pinterestCreds: PinterestCredentials = {
      adAccountId,
      accessToken,
    };
    credentials = pinterestCreds;
    platformId = adAccountId;
  } else {
    return json({ error: "Unsupported platform" }, { status: 400 });
  }

  // 检查凭证是否为空（所有必需字段都为空字符串）
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
    } else if (platform === "pinterest") {
      const creds = credentials as PinterestCredentials;
      return !!(creds.adAccountId && creds.accessToken);
    }
    return false;
  })();

  // 注意：即使禁用服务端追踪，我们仍然保存凭证，以便用户稍后重新启用时无需重新输入
  // 这样用户可以暂时禁用追踪，而不会丢失已配置的凭证信息
  // 但是，如果凭证为空（用户清空了所有字段），则不保存空凭证，保留现有凭证
  const encryptedCredentials = hasNonEmptyCredentials ? encryptJson(credentials) : null;

  // 构建更新数据：如果凭证为空且禁用，则不更新凭证字段（保留现有凭证）
  const updateData: {
    credentialsEncrypted?: string | null;
    serverSideEnabled: boolean;
  } = {
    serverSideEnabled: enabled,
  };

  if (enabled || hasNonEmptyCredentials) {
    // 启用时或凭证非空时，更新凭证
    updateData.credentialsEncrypted = encryptedCredentials;
  }
  // 如果禁用且凭证为空，不更新 credentialsEncrypted（保留现有凭证）

  await prisma.pixelConfig.upsert({
    where: {
      shopId_platform: {
        shopId,
        platform,
      },
    },
    update: updateData,
    create: {
      shopId,
      platform,
      platformId,
      credentialsEncrypted: encryptedCredentials,
      serverSideEnabled: enabled,
    },
  });

  await invalidateAllShopCaches(sessionShop, shopId);

  // 处理 platformId 为空字符串的情况
  const maskedPlatformId = platformId ? platformId.slice(0, 8) + "****" : "未设置";

  await createAuditLog({
    shopId,
    action: "pixel_config_updated",
    actorType: "user",
    resourceType: "pixel_config",
    resourceId: platform,
    metadata: {
      platform,
      platformId: maskedPlatformId,
      serverSideEnabled: enabled,
      actor: sessionShop,
      operationType: "credentials_updated",
    },
  });

  logger.info("Server-side tracking credentials updated", {
    shopId,
    platform,
    enabled,
    platformIdMasked: maskedPlatformId,
  });

  return json({ success: true, message: "服务端追踪配置已保存" });
}

export async function handleTestConnection(formData: FormData) {
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

  await createAuditLog({
    shopId,
    actorType: "user",
    actorId: sessionShop,
    action: "ingestion_secret_rotated",
    resourceType: "shop",
    resourceId: shopId,
    metadata: {
      reason: "Manual rotation from settings",
      pixelSyncSuccess: pixelSyncResult.success,
      graceWindowExpiry: graceWindowExpiry.toISOString(),
    },
  });

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
  const piiRequested = formData.get("piiEnabled") === "true";
  const pcdAcknowledged = formData.get("pcdAcknowledged") === "true";
  const consentStrategy =
    (formData.get("consentStrategy") as string) || "strict";
  const dataRetentionDays =
    parseInt(formData.get("dataRetentionDays") as string) || 90;

  if (piiRequested && !PCD_CONFIG.APPROVED) {
    logger.warn("PII enable attempt blocked: PCD approval is not granted", {
      shopId,
      sessionShop,
    });
    return json({
      success: false,
      message:
        "Shopify Protected Customer Data (PCD) 审核未通过，当前禁止开启增强匹配/PII 发送。",
      requirePcdApproval: true,
    });
  }

  const piiEnabled = piiRequested && PCD_CONFIG.APPROVED;

  if (piiEnabled && !pcdAcknowledged) {
    return json({
      success: false,
      message: "启用 PII 发送需要先确认您的合规义务",
      requirePcdAcknowledgement: true,
    });
  }

  const updateData: {
    piiEnabled: boolean;
    weakConsentMode: boolean;
    consentStrategy: string;
    dataRetentionDays: number;
    pcdAcknowledged?: boolean;
    pcdAcknowledgedAt?: Date | null;
  } = {
    piiEnabled,
    weakConsentMode: false,
    consentStrategy,
    dataRetentionDays,
  };

  if (piiEnabled && pcdAcknowledged) {
    updateData.pcdAcknowledged = true;
    updateData.pcdAcknowledgedAt = new Date();
  }

  await prisma.shop.update({
    where: { id: shopId },
    data: updateData,
  });

  await createAuditLog({
    shopId,
    actorType: "user",
    actorId: sessionShop,
    action: "privacy_settings_updated",
    resourceType: "shop",
    resourceId: shopId,
    metadata: {
      piiEnabled,
      pcdAcknowledged,
      consentStrategy,
      dataRetentionDays,
      pcdApproved: PCD_CONFIG.APPROVED,
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

    default:
      return json({ error: "Unknown action" }, { status: 400 });
  }
}
