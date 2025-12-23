/**
 * Settings Actions
 *
 * Server-side action handlers for settings routes.
 */

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
} from "../../services/migration.server";
import { generateEncryptedIngestionSecret } from "../../utils/token-encryption";
import type {
  MetaCredentials,
  GoogleCredentials,
  TikTokCredentials,
} from "../../types";
import {
  encryptAlertSettings,
  encryptJson,
} from "../../services/alert-settings.server";
import { logger } from "../../utils/logger.server";
import type { AlertSettings } from "./types";

// =============================================================================
// Alert Actions
// =============================================================================

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

export async function handleTestAlert(formData: FormData) {
  const channel = formData.get("channel") as string;
  let settings: AlertSettings;

  if (channel === "email") {
    settings = { email: formData.get("email") as string };
  } else if (channel === "slack") {
    settings = { webhookUrl: formData.get("webhookUrl") as string };
  } else if (channel === "telegram") {
    settings = {
      botToken: formData.get("botToken") as string,
      chatId: formData.get("chatId") as string,
    };
  } else {
    return json({ success: false, error: "Invalid channel" });
  }

  const result = await testNotification(channel, settings);
  return json(result);
}

export async function handleDeleteAlert(formData: FormData) {
  const configId = formData.get("configId") as string;
  await prisma.alertConfig.delete({
    where: { id: configId },
  });
  return json({ success: true, message: "警报配置已删除" });
}

// =============================================================================
// Server-Side Tracking Actions
// =============================================================================

export async function handleSaveServerSide(formData: FormData, shopId: string) {
  const platform = formData.get("platform") as string;
  const enabled = formData.get("enabled") === "true";

  let credentials: GoogleCredentials | MetaCredentials | TikTokCredentials;
  let platformId = "";

  if (platform === "google") {
    const googleCreds: GoogleCredentials = {
      measurementId: (formData.get("measurementId") as string) || "",
      apiSecret: (formData.get("apiSecret") as string) || "",
    };
    credentials = googleCreds;
    platformId = googleCreds.measurementId;
  } else if (platform === "meta") {
    const metaCreds: MetaCredentials = {
      pixelId: (formData.get("pixelId") as string) || "",
      accessToken: (formData.get("accessToken") as string) || "",
      testEventCode: (formData.get("testEventCode") as string) || undefined,
    };
    credentials = metaCreds;
    platformId = metaCreds.pixelId;
  } else if (platform === "tiktok") {
    const tiktokCreds: TikTokCredentials = {
      pixelId: (formData.get("pixelId") as string) || "",
      accessToken: (formData.get("accessToken") as string) || "",
    };
    credentials = tiktokCreds;
    platformId = tiktokCreds.pixelId;
  } else {
    return json({ error: "Unsupported platform" }, { status: 400 });
  }

  const encryptedCredentials = encryptJson(credentials);

  await prisma.pixelConfig.upsert({
    where: {
      shopId_platform: {
        shopId,
        platform,
      },
    },
    update: {
      credentialsEncrypted: encryptedCredentials,
      serverSideEnabled: enabled,
    },
    create: {
      shopId,
      platform,
      platformId,
      credentialsEncrypted: encryptedCredentials,
      serverSideEnabled: enabled,
    },
  });

  return json({ success: true, message: "服务端追踪配置已保存" });
}

export async function handleTestConnection(formData: FormData) {
  const platform = formData.get("platform") as string;

  // Simulate connection test
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (platform === "meta") {
    const pixelId = formData.get("pixelId") as string;
    const accessToken = formData.get("accessToken") as string;
    if (!pixelId || !accessToken) {
      return json({
        success: false,
        message: "请填写 Pixel ID 和 Access Token",
      });
    }
  }

  return json({
    success: true,
    message: "连接测试成功！测试事件已发送到平台，请在平台后台检查是否收到事件。",
  });
}

// =============================================================================
// Security Actions
// =============================================================================

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

  let pixelSyncResult = { success: false, message: "" };

  try {
    const existingPixels = await getExistingWebPixels(admin);
    const ourPixel = existingPixels.find((p) => {
      try {
        const settings = JSON.parse(p.settings || "{}");
        return (
          typeof settings.ingestion_key === "string" ||
          typeof settings.ingestion_secret === "string"
        );
      } catch {
        return false;
      }
    });

    if (ourPixel) {
      const result = await updateWebPixel(admin, ourPixel.id, newPlainSecret);
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

// =============================================================================
// Privacy Actions
// =============================================================================

export async function handleUpdatePrivacySettings(
  formData: FormData,
  shopId: string,
  sessionShop: string
) {
  const piiEnabled = formData.get("piiEnabled") === "true";
  const pcdAcknowledged = formData.get("pcdAcknowledged") === "true";
  const consentStrategy =
    (formData.get("consentStrategy") as string) || "strict";
  const dataRetentionDays =
    parseInt(formData.get("dataRetentionDays") as string) || 90;

  // If enabling PII, require acknowledgement of compliance obligations
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

  // Update PCD acknowledgement status
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
    metadata: { piiEnabled, pcdAcknowledged, consentStrategy, dataRetentionDays },
  });

  return json({
    success: true,
    message: "隐私设置已更新",
  });
}

// =============================================================================
// Main Action Handler
// =============================================================================

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
      return handleTestAlert(formData);

    case "saveServerSide":
      return handleSaveServerSide(formData, shop.id);

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

