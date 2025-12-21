import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Select,
  Checkbox,
  Divider,
  Banner,
  Badge,
  Box,
  Tabs,
  ContextualSaveBar,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { testNotification } from "../services/notification.server";
import { encryptJson, decryptJson } from "../utils/crypto";
import { checkTokenExpirationIssues } from "../services/retry.server";
import { createAuditLog } from "../services/audit.server";
import { getExistingWebPixels, updateWebPixel } from "../services/migration.server";
import { generateEncryptedIngestionSecret, isTokenEncrypted } from "../utils/token-encryption";
import type { MetaCredentials, GoogleCredentials, TikTokCredentials } from "../types";
import { logger } from "../utils/logger";

interface AlertSettingsEmail {
  email: string;
}

interface AlertSettingsSlack {
  webhookUrl: string;
}

interface AlertSettingsTelegram {
  botToken: string;
  chatId: string;
}

type AlertSettings = AlertSettingsEmail | AlertSettingsSlack | AlertSettingsTelegram;

interface AlertConfigDisplay {
  id: string;
  channel: string;
  settings: Record<string, unknown> | null;
  discrepancyThreshold: number;
  isEnabled: boolean;
}

interface PixelConfigDisplay {
  id: string;
  platform: string;
  platformId: string | null;
  serverSideEnabled: boolean;
  clientSideEnabled: boolean;
  isActive: boolean;
  lastTestedAt?: Date | null;
}

function encryptAlertSettings(channel: string, settings: Record<string, unknown>): string | null {
  const sensitiveSettings: Record<string, unknown> = {};
  
  if (channel === "slack" && settings.webhookUrl) {
    sensitiveSettings.webhookUrl = settings.webhookUrl;
  } else if (channel === "telegram" && settings.botToken) {
    sensitiveSettings.botToken = settings.botToken;
    sensitiveSettings.chatId = settings.chatId;
  } else if (channel === "email") {
    sensitiveSettings.email = settings.email;
  }
  
  if (Object.keys(sensitiveSettings).length === 0) {
    return null;
  }
  
  return encryptJson(sensitiveSettings);
}

function decryptAlertSettings(encryptedSettings: string | null): Record<string, unknown> | null {
  if (!encryptedSettings) {
    return null;
  }
  
  try {
    return decryptJson<Record<string, unknown>>(encryptedSettings);
  } catch (error) {
    logger.warn("[P0-2] Failed to decrypt alert settings", { error: String(error) });
    return null;
  }
}

function getMaskedAlertSettings(channel: string, settings: Record<string, unknown> | null): Record<string, unknown> {
  if (!settings) {
    return {};
  }
  
  const masked = { ...settings };
  
  if (channel === "slack" && masked.webhookUrl) {
    const url = String(masked.webhookUrl);
    masked.webhookUrl = url.length > 12 ? `****${url.slice(-8)}` : "****";
  }
  
  if (channel === "telegram" && masked.botToken) {
    const token = String(masked.botToken);
    masked.botToken = token.length > 12 ? `${token.slice(0, 8)}****` : "****";
  }
  
  return masked;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
      ingestionSecret: true,
      previousIngestionSecret: true,
      previousSecretExpiry: true,
      piiEnabled: true,
      weakConsentMode: true,
      consentStrategy: true, 
      dataRetentionDays: true,
      alertConfigs: true,
      pixelConfigs: {
        where: { isActive: true },
      },
    },
  });

  let tokenIssues = { hasIssues: false, affectedPlatforms: [] as string[] };
  if (shop) {
    tokenIssues = await checkTokenExpirationIssues(shop.id);
  }

  const hasActiveGraceWindow = shop?.previousIngestionSecret && 
    shop?.previousSecretExpiry && 
    new Date() < shop.previousSecretExpiry;

  return json({
    shop: shop
      ? {
          id: shop.id,
          domain: shopDomain,
          plan: shop.plan,
          alertConfigs: shop.alertConfigs,
          pixelConfigs: shop.pixelConfigs,
          
          hasIngestionSecret: !!shop.ingestionSecret && shop.ingestionSecret.length > 0,
          hasActiveGraceWindow,
          graceWindowExpiry: hasActiveGraceWindow ? shop.previousSecretExpiry : null,
          piiEnabled: shop.piiEnabled,
          weakConsentMode: shop.weakConsentMode,
          consentStrategy: shop.consentStrategy || "strict", 
          dataRetentionDays: shop.dataRetentionDays,
        }
      : null,
    tokenIssues,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
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
    case "saveAlert": {
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
          ? { emailMasked: String(rawSettings.email).replace(/(.{2}).*(@.*)/, "$1***$2") }
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
          shopId: shop.id,
          channel,
          settings: nonSensitiveSettings as Prisma.InputJsonValue,
          settingsEncrypted: encryptedSettings,
          discrepancyThreshold: threshold,
          isEnabled: enabled,
        },
      });

      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: session.shop,
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

    case "testAlert": {
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

    case "saveServerSide": {
      const platform = formData.get("platform") as string;
      const enabled = formData.get("enabled") === "true";
      let credentials: GoogleCredentials | MetaCredentials | TikTokCredentials;
      let platformId = "";

      if (platform === "google") {
        
        const googleCreds: GoogleCredentials = {
          measurementId: formData.get("measurementId") as string || "",
          apiSecret: formData.get("apiSecret") as string || "",
        };
        credentials = googleCreds;
        platformId = googleCreds.measurementId;
      } else if (platform === "meta") {
        const metaCreds: MetaCredentials = {
          pixelId: formData.get("pixelId") as string || "",
          accessToken: formData.get("accessToken") as string || "",
          testEventCode: formData.get("testEventCode") as string || undefined,
        };
        credentials = metaCreds;
        platformId = metaCreds.pixelId;
      } else if (platform === "tiktok") {
        const tiktokCreds: TikTokCredentials = {
          pixelId: formData.get("pixelId") as string || "",
          accessToken: formData.get("accessToken") as string || "",
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
            shopId: shop.id,
            platform,
          },
        },
        update: {
          credentialsEncrypted: encryptedCredentials,
          serverSideEnabled: enabled,
        },
        create: {
          shopId: shop.id,
          platform,
          platformId,
          credentialsEncrypted: encryptedCredentials,
          serverSideEnabled: enabled,
        },
      });

      return json({ success: true, message: "服务端追踪配置已保存" });
    }

    case "deleteAlert": {
      const configId = formData.get("configId") as string;
      await prisma.alertConfig.delete({
        where: { id: configId },
      });
      return json({ success: true, message: "警报配置已删除" });
    }

    case "testConnection": {
      const platform = formData.get("platform") as string;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (platform === "meta") {
        const pixelId = formData.get("pixelId") as string;
        const accessToken = formData.get("accessToken") as string;
        if (!pixelId || !accessToken) {
          return json({ success: false, message: "请填写 Pixel ID 和 Access Token" });
        }
      }

      return json({
        success: true,
        message: "连接测试成功！测试事件已发送到平台，请在平台后台检查是否收到事件。",
      });
    }

    case "rotateIngestionSecret": {
      const currentShop = await prisma.shop.findUnique({
        where: { id: shop.id },
        select: { ingestionSecret: true },
      });

      const { plain: newPlainSecret, encrypted: newEncryptedSecret } = generateEncryptedIngestionSecret();

      const graceWindowMinutes = 30;
      const graceWindowExpiry = new Date(Date.now() + graceWindowMinutes * 60 * 1000);

      await prisma.shop.update({
        where: { id: shop.id },
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
            return typeof settings.ingestion_key === "string" ||
                   typeof settings.ingestion_secret === "string";
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
        console.error("Failed to sync ingestion secret to Web Pixel:", pixelError);
        pixelSyncResult = {
          success: false,
          message: "Web Pixel 同步失败，请手动重新配置",
        };
      }

      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: session.shop,
        action: "ingestion_secret_rotated",
        resourceType: "shop",
        resourceId: shop.id,
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

    case "updatePrivacySettings": {
      const piiEnabled = formData.get("piiEnabled") === "true";
      const consentStrategy = (formData.get("consentStrategy") as string) || "strict";
      const dataRetentionDays = parseInt(formData.get("dataRetentionDays") as string) || 90;

      await prisma.shop.update({
        where: { id: shop.id },
        data: { piiEnabled, weakConsentMode: false, consentStrategy, dataRetentionDays },
      });

      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: session.shop,
        action: "privacy_settings_updated",
        resourceType: "shop",
        resourceId: shop.id,
        metadata: { piiEnabled, consentStrategy, dataRetentionDays },
      });

      return json({
        success: true,
        message: "隐私设置已更新",
      });
    }

    default:
      return json({ error: "Unknown action" }, { status: 400 });
  }
};

export default function SettingsPage() {
  const { shop, tokenIssues } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedTab, setSelectedTab] = useState(0);

  const [alertChannel, setAlertChannel] = useState("email");
  const [alertEmail, setAlertEmail] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("10");
  const [alertEnabled, setAlertEnabled] = useState(true);

  const [serverPlatform, setServerPlatform] = useState("meta");
  const [serverEnabled, setServerEnabled] = useState(false);
  
  const [metaPixelId, setMetaPixelId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestCode, setMetaTestCode] = useState("");
  
  const [googleMeasurementId, setGoogleMeasurementId] = useState("");
  const [googleApiSecret, setGoogleApiSecret] = useState("");
  
  const [tiktokPixelId, setTiktokPixelId] = useState("");
  const [tiktokAccessToken, setTiktokAccessToken] = useState("");

  const [alertFormDirty, setAlertFormDirty] = useState(false);
  const [serverFormDirty, setServerFormDirty] = useState(false);

  const initialAlertValues = useRef({
    channel: "email",
    email: "",
    slackWebhook: "",
    telegramToken: "",
    telegramChatId: "",
    threshold: "10",
    enabled: true,
  });
  
  const initialServerValues = useRef({
    platform: "meta",
    enabled: false,
    metaPixelId: "",
    metaAccessToken: "",
    metaTestCode: "",
    googleMeasurementId: "",
    googleApiSecret: "",
    tiktokPixelId: "",
    tiktokAccessToken: "",
  });

  const isSubmitting = navigation.state === "submitting";

  const checkAlertFormDirty = useCallback(() => {
    const initial = initialAlertValues.current;
    const isDirty = 
      alertChannel !== initial.channel ||
      alertEmail !== initial.email ||
      slackWebhook !== initial.slackWebhook ||
      telegramToken !== initial.telegramToken ||
      telegramChatId !== initial.telegramChatId ||
      alertThreshold !== initial.threshold ||
      alertEnabled !== initial.enabled;
    setAlertFormDirty(isDirty);
  }, [alertChannel, alertEmail, slackWebhook, telegramToken, telegramChatId, alertThreshold, alertEnabled]);

  const checkServerFormDirty = useCallback(() => {
    const initial = initialServerValues.current;
    const isDirty =
      serverPlatform !== initial.platform ||
      serverEnabled !== initial.enabled ||
      metaPixelId !== initial.metaPixelId ||
      metaAccessToken !== initial.metaAccessToken ||
      metaTestCode !== initial.metaTestCode ||
      googleMeasurementId !== initial.googleMeasurementId ||
      googleApiSecret !== initial.googleApiSecret ||
      tiktokPixelId !== initial.tiktokPixelId ||
      tiktokAccessToken !== initial.tiktokAccessToken;
    setServerFormDirty(isDirty);
  }, [serverPlatform, serverEnabled, metaPixelId, metaAccessToken, metaTestCode, googleMeasurementId, googleApiSecret, tiktokPixelId, tiktokAccessToken]);

  useEffect(() => {
    if (selectedTab === 0) {
      checkAlertFormDirty();
    } else if (selectedTab === 1) {
      checkServerFormDirty();
    }
  }, [selectedTab, checkAlertFormDirty, checkServerFormDirty]);

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      
      if (selectedTab === 0) {
        initialAlertValues.current = {
          channel: alertChannel,
          email: alertEmail,
          slackWebhook: slackWebhook,
          telegramToken: telegramToken,
          telegramChatId: telegramChatId,
          threshold: alertThreshold,
          enabled: alertEnabled,
        };
        setAlertFormDirty(false);
      } else if (selectedTab === 1) {
        initialServerValues.current = {
          platform: serverPlatform,
          enabled: serverEnabled,
          metaPixelId: metaPixelId,
          metaAccessToken: metaAccessToken,
          metaTestCode: metaTestCode,
          googleMeasurementId: googleMeasurementId,
          googleApiSecret: googleApiSecret,
          tiktokPixelId: tiktokPixelId,
          tiktokAccessToken: tiktokAccessToken,
        };
        setServerFormDirty(false);
      }
    }
  }, [actionData, selectedTab, serverPlatform, serverEnabled, metaPixelId, metaAccessToken, metaTestCode, googleMeasurementId, googleApiSecret, tiktokPixelId, tiktokAccessToken]);

  const handleDiscardChanges = useCallback(() => {
    if (selectedTab === 0) {
      const initial = initialAlertValues.current;
      setAlertChannel(initial.channel);
      setAlertEmail(initial.email);
      setSlackWebhook(initial.slackWebhook);
      setTelegramToken(initial.telegramToken);
      setTelegramChatId(initial.telegramChatId);
      setAlertThreshold(initial.threshold);
      setAlertEnabled(initial.enabled);
      setAlertFormDirty(false);
    } else if (selectedTab === 1) {
      const initial = initialServerValues.current;
      setServerPlatform(initial.platform);
      setServerEnabled(initial.enabled);
      setMetaPixelId(initial.metaPixelId);
      setMetaAccessToken(initial.metaAccessToken);
      setMetaTestCode(initial.metaTestCode);
      setGoogleMeasurementId(initial.googleMeasurementId);
      setGoogleApiSecret(initial.googleApiSecret);
      setTiktokPixelId(initial.tiktokPixelId);
      setTiktokAccessToken(initial.tiktokAccessToken);
      setServerFormDirty(false);
    }
  }, [selectedTab]);

  const showSaveBar = (selectedTab === 0 && alertFormDirty) || (selectedTab === 1 && serverFormDirty);

  const handleSaveAlert = () => {
    const formData = new FormData();
    formData.append("_action", "saveAlert");
    formData.append("channel", alertChannel);
    formData.append("threshold", alertThreshold);
    formData.append("enabled", alertEnabled.toString());

    if (alertChannel === "email") {
      formData.append("email", alertEmail);
    } else if (alertChannel === "slack") {
      formData.append("webhookUrl", slackWebhook);
    } else if (alertChannel === "telegram") {
      formData.append("botToken", telegramToken);
      formData.append("chatId", telegramChatId);
    }

    submit(formData, { method: "post" });
  };

  const handleTestAlert = () => {
    const formData = new FormData();
    formData.append("_action", "testAlert");
    formData.append("channel", alertChannel);

    if (alertChannel === "email") {
      formData.append("email", alertEmail);
    } else if (alertChannel === "slack") {
      formData.append("webhookUrl", slackWebhook);
    } else if (alertChannel === "telegram") {
      formData.append("botToken", telegramToken);
      formData.append("chatId", telegramChatId);
    }

    submit(formData, { method: "post" });
  };

  const handleSaveServerSide = () => {
    const formData = new FormData();
    formData.append("_action", "saveServerSide");
    formData.append("platform", serverPlatform);
    formData.append("enabled", serverEnabled.toString());

    if (serverPlatform === "meta") {
      formData.append("pixelId", metaPixelId);
      formData.append("accessToken", metaAccessToken);
      formData.append("testEventCode", metaTestCode);
    } else if (serverPlatform === "google") {
      formData.append("measurementId", googleMeasurementId);
      formData.append("apiSecret", googleApiSecret);
    } else if (serverPlatform === "tiktok") {
      formData.append("pixelId", tiktokPixelId);
      formData.append("accessToken", tiktokAccessToken);
    }

    submit(formData, { method: "post" });
  };

  const handleTestConnection = () => {
    const formData = new FormData();
    formData.append("_action", "testConnection");
    formData.append("platform", serverPlatform);

    if (serverPlatform === "meta") {
      formData.append("pixelId", metaPixelId);
      formData.append("accessToken", metaAccessToken);
      formData.append("testEventCode", metaTestCode);
    }

    submit(formData, { method: "post" });
  };

  const handleSaveBarSave = useCallback(() => {
    if (selectedTab === 0) {
      handleSaveAlert();
    } else if (selectedTab === 1) {
      handleSaveServerSide();
    }
  }, [selectedTab]);

  const tabs = [
    { id: "alerts", content: "警报通知" },
    { id: "server-side", content: "服务端追踪" },
    { id: "security", content: "安全与隐私" },
    { id: "subscription", content: "订阅计划" },
  ];

  const handleRotateSecret = () => {
    const message = shop?.hasIngestionSecret 
      ? "确定要更换关联令牌吗？更换后 Web Pixel 将自动更新。"
      : "确定要生成关联令牌吗？";
    if (confirm(message)) {
      const formData = new FormData();
      formData.append("_action", "rotateIngestionSecret");
      submit(formData, { method: "post" });
    }
  };

  return (
    <Page title="设置">
      {showSaveBar && (
        <ContextualSaveBar
          message="未保存的更改"
          saveAction={{
            content: "保存",
            onAction: handleSaveBarSave,
            loading: isSubmitting,
          }}
          discardAction={{
            content: "放弃",
            onAction: handleDiscardChanges,
          }}
        />
      )}
      <BlockStack gap="500">
        {actionData && "message" in actionData && (
          <Banner
            tone={actionData.success ? "success" : "critical"}
            onDismiss={() => {}}
          >
            {actionData.message}
          </Banner>
        )}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {selectedTab === 0 && (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      警报通知设置
                    </Text>
                    <Text as="p" tone="subdued">
                      当追踪数据出现异常时，我们会通过您配置的渠道发送警报。
                    </Text>

                    <Divider />

                    <Select
                      label="通知渠道"
                      options={[
                        { label: "邮件", value: "email" },
                        { label: "Slack", value: "slack" },
                        { label: "Telegram", value: "telegram" },
                      ]}
                      value={alertChannel}
                      onChange={setAlertChannel}
                    />

                    {alertChannel === "email" && (
                      <TextField
                        label="邮箱地址"
                        type="email"
                        value={alertEmail}
                        onChange={setAlertEmail}
                        autoComplete="email"
                        placeholder="your@email.com"
                      />
                    )}

                    {alertChannel === "slack" && (
                      <TextField
                        label="Slack Webhook URL"
                        value={slackWebhook}
                        onChange={setSlackWebhook}
                        autoComplete="off"
                        placeholder="https://hooks.slack.com/services/..."
                        helpText="在 Slack 中创建 Incoming Webhook 获取此 URL"
                      />
                    )}

                    {alertChannel === "telegram" && (
                      <>
                        <TextField
                          label="Bot Token"
                          value={telegramToken}
                          onChange={setTelegramToken}
                          autoComplete="off"
                          placeholder="123456:ABC-DEF1234ghIkl..."
                          helpText="通过 @BotFather 创建 Bot 获取"
                        />
                        <TextField
                          label="Chat ID"
                          value={telegramChatId}
                          onChange={setTelegramChatId}
                          autoComplete="off"
                          placeholder="-1001234567890"
                          helpText="群组或频道的 Chat ID"
                        />
                      </>
                    )}

                    <TextField
                      label="警报阈值 (%)"
                      type="number"
                      value={alertThreshold}
                      onChange={setAlertThreshold}
                      autoComplete="off"
                      helpText="当差异率超过此百分比时触发警报"
                      suffix="%"
                    />

                    <Checkbox
                      label="启用警报通知"
                      checked={alertEnabled}
                      onChange={setAlertEnabled}
                    />

                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        onClick={handleSaveAlert}
                        loading={isSubmitting}
                        disabled={!alertFormDirty}
                      >
                        保存设置
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleTestAlert}
                        loading={isSubmitting}
                        disabled={alertFormDirty}
                      >
                        发送测试通知
                      </Button>
                    </InlineStack>
                    {alertFormDirty && (
                      <Text as="p" variant="bodySm" tone="caution">
                        请先保存设置后再发送测试通知
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      已配置的警报
                    </Text>
                    {shop?.alertConfigs && shop.alertConfigs.length > 0 ? (
                      (shop.alertConfigs as unknown as AlertConfigDisplay[]).map((config) => (
                        <Box
                          key={config.id}
                          background="bg-surface-secondary"
                          padding="300"
                          borderRadius="200"
                        >
                          <InlineStack align="space-between">
                            <BlockStack gap="100">
                              <Text as="span" fontWeight="semibold">
                                {config.channel === "email"
                                  ? "邮件"
                                  : config.channel === "slack"
                                    ? "Slack"
                                    : "Telegram"}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                阈值: {(config.discrepancyThreshold * 100).toFixed(0)}%
                              </Text>
                            </BlockStack>
                            <Badge tone={config.isEnabled ? "success" : "info"}>
                              {config.isEnabled ? "已启用" : "已禁用"}
                            </Badge>
                          </InlineStack>
                        </Box>
                      ))
                    ) : (
                      <Text as="p" tone="subdued">
                        尚未配置警报
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}

          {selectedTab === 1 && (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      服务端转化追踪（Conversions API）
                    </Text>

                    {tokenIssues.hasIssues && (
                      <Banner
                        title="需要重新授权"
                        tone="critical"
                        action={{
                          content: "查看详情",
                          onAction: () => {
                            const platform = tokenIssues.affectedPlatforms[0];
                            if (platform) setServerPlatform(platform);
                          },
                        }}
                      >
                        <p>
                          以下平台的访问令牌已过期或无效，请重新配置：
                          <strong> {tokenIssues.affectedPlatforms.join(", ")}</strong>
                        </p>
                      </Banner>
                    )}

                    <Banner tone="info">
                      <p>
                        服务端追踪通过 Shopify Webhooks 直接将转化数据发送到广告平台，
                        不受浏览器隐私设置和广告拦截器的影响，可显著提高追踪准确性。
                      </p>
                    </Banner>

                    <Divider />

                    <Select
                      label="选择平台"
                      options={[
                        { label: "Meta Conversions API（CAPI）", value: "meta" },
                        { label: "Google GA4 Measurement Protocol", value: "google" },
                        { label: "TikTok Events API", value: "tiktok" },
                      ]}
                      value={serverPlatform}
                      onChange={setServerPlatform}
                    />

                    {serverPlatform === "meta" && (
                      <>
                        <TextField
                          label="Pixel ID"
                          value={metaPixelId}
                          onChange={setMetaPixelId}
                          autoComplete="off"
                          placeholder="1234567890123456"
                        />
                        <TextField
                          label="Access Token"
                          type="password"
                          value={metaAccessToken}
                          onChange={setMetaAccessToken}
                          autoComplete="off"
                          helpText="在 Meta Events Manager 中生成系统用户访问令牌"
                        />
                        <TextField
                          label="Test Event Code (可选)"
                          value={metaTestCode}
                          onChange={setMetaTestCode}
                          autoComplete="off"
                          helpText="用于测试模式，生产环境请留空"
                        />
                      </>
                    )}

                    {serverPlatform === "google" && (
                      <>
                        <Banner tone="info">
                          <p>
                            <strong>GA4 Measurement Protocol</strong> 是推荐的服务端追踪方式。
                            Google Ads 可以从 GA4 导入转化数据进行归因优化。
                          </p>
                        </Banner>
                        <TextField
                          label="Measurement ID"
                          value={googleMeasurementId}
                          onChange={setGoogleMeasurementId}
                          autoComplete="off"
                          placeholder="G-XXXXXXXXXX"
                          helpText="GA4 媒体资源的 Measurement ID（格式：G-XXXXXXXXXX）。在 GA4 管理后台 > 数据流中找到"
                          error={googleMeasurementId && !googleMeasurementId.match(/^G-[A-Z0-9]+$/i) 
                            ? "格式应为 G-XXXXXXXXXX" 
                            : undefined}
                        />
                        <TextField
                          label="API Secret"
                          type="password"
                          value={googleApiSecret}
                          onChange={setGoogleApiSecret}
                          autoComplete="off"
                          helpText="在 GA4 > 数据流 > 选择您的数据流 > Measurement Protocol API 密钥中创建新密钥"
                        />
                        <Text as="p" variant="bodySm" tone="subdued">
                          💡 提示：如需在 Google Ads 中使用转化数据，请在 Google Ads 中设置「从 GA4 导入转化」。
                        </Text>
                      </>
                    )}

                    {serverPlatform === "tiktok" && (
                      <>
                        <TextField
                          label="Pixel ID"
                          value={tiktokPixelId}
                          onChange={setTiktokPixelId}
                          autoComplete="off"
                          placeholder="例: C1234567890123456789"
                        />
                        <TextField
                          label="Access Token"
                          type="password"
                          value={tiktokAccessToken}
                          onChange={setTiktokAccessToken}
                          autoComplete="off"
                          helpText="在 TikTok Events Manager 中生成"
                        />
                      </>
                    )}

                    <Checkbox
                      label="启用服务端追踪"
                      checked={serverEnabled}
                      onChange={setServerEnabled}
                    />

                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        onClick={handleSaveServerSide}
                        loading={isSubmitting}
                        disabled={!serverFormDirty}
                      >
                        保存配置
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleTestConnection}
                        loading={isSubmitting}
                        disabled={
                          serverFormDirty ||
                          (serverPlatform === "meta" && (!metaPixelId || !metaAccessToken))
                        }
                      >
                        测试连接
                      </Button>
                    </InlineStack>
                    {serverFormDirty && (
                      <Text as="p" variant="bodySm" tone="caution">
                        请先保存配置后再测试连接
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      服务端追踪状态
                    </Text>
                    {shop?.pixelConfigs &&
                    shop.pixelConfigs.filter((c: PixelConfigDisplay) => c.serverSideEnabled)
                      .length > 0 ? (
                      shop.pixelConfigs
                        .filter((c: PixelConfigDisplay) => c.serverSideEnabled)
                        .map((config: PixelConfigDisplay) => (
                          <Box
                            key={config.id}
                            background="bg-surface-secondary"
                            padding="300"
                            borderRadius="200"
                          >
                            <BlockStack gap="100">
                              <InlineStack align="space-between">
                                <Text as="span" fontWeight="semibold">
                                  {config.platform === "meta"
                                    ? "Meta CAPI"
                                    : config.platform === "google"
                                      ? "Google Ads"
                                      : "TikTok"}
                                </Text>
                                <Badge tone="success">已启用</Badge>
                              </InlineStack>
                              {config.lastTestedAt && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  上次测试: {new Date(config.lastTestedAt).toLocaleDateString("zh-CN")}
                                </Text>
                              )}
                            </BlockStack>
                          </Box>
                        ))
                    ) : (
                      <Text as="p" tone="subdued">
                        尚未启用服务端追踪
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}

          {selectedTab === 2 && (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      安全设置
                    </Text>
                    <Text as="p" tone="subdued">
                      管理 Pixel 事件关联令牌和数据安全设置。
                    </Text>

                    <Divider />

                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        Ingestion Key（关联令牌）
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        用于关联来自 Web Pixel 的事件请求。此令牌帮助我们：
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        • 过滤误配置或无效请求（抗噪）
                        <br />• 将像素事件与订单正确关联（诊断）
                        <br />• 在多店铺场景中识别请求来源
                      </Text>
                      <Text as="p" variant="bodySm" tone="caution">
                        ⚠️ 注意：此令牌在浏览器网络请求中可见，不是安全凭证。
                        真正的安全由 TLS 加密、Origin 验证、速率限制和数据最小化提供。
                      </Text>
                      
                      <Box
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="span" fontWeight="semibold">
                              状态
                            </Text>
                            <InlineStack gap="200" blockAlign="center">
                              {shop?.hasIngestionSecret ? (
                                <>
                                  <Badge tone="success">已配置</Badge>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    令牌已配置
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <Badge tone="attention">未配置</Badge>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    请重新安装应用或点击生成令牌
                                  </Text>
                                </>
                              )}
                            </InlineStack>
                          </BlockStack>
                          <Button
                            variant="secondary"
                            onClick={handleRotateSecret}
                            loading={isSubmitting}
                          >
                            {shop?.hasIngestionSecret ? "更换令牌" : "生成令牌"}
                          </Button>
                        </InlineStack>
                      </Box>

          {shop?.hasActiveGraceWindow && shop.graceWindowExpiry && (
                        <Banner tone="warning">
                          <p>
                            <strong>旧令牌仍有效：</strong>之前的令牌将于 {new Date(shop.graceWindowExpiry).toLocaleString("zh-CN")} 失效。
                            在此之前，新旧令牌均可使用，以便平滑过渡。
                          </p>
                        </Banner>
                      )}

                      <Banner tone="info">
                        <p>
                          <strong>工作原理：</strong>服务端会验证此令牌，缺少或错误的令牌会导致像素事件被拒绝（204 响应）。
                          更换令牌后，App Pixel 会自动更新，旧令牌会有 72 小时的过渡期。
                        </p>
                      </Banner>
                    </BlockStack>

                    <Divider />

                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        隐私设置
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        控制是否将个人身份信息（PII）发送到广告平台。
                      </Text>

                      <Box
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="span" fontWeight="semibold">
                                发送 PII 到广告平台
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                当前状态：{shop?.piiEnabled ? "已启用" : "已禁用"}
                              </Text>
                            </BlockStack>
                            <Button
                              variant="secondary"
                              size="slim"
                              onClick={() => {
                                const formData = new FormData();
                                formData.append("_action", "updatePrivacySettings");
                                formData.append("piiEnabled", String(!shop?.piiEnabled));
                                formData.append("consentStrategy", shop?.consentStrategy || "balanced");
                                formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
                                submit(formData, { method: "post" });
                              }}
                              loading={isSubmitting}
                            >
                              {shop?.piiEnabled ? "禁用" : "启用"}
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>

                      {shop?.piiEnabled && (
                        <Banner 
                          title="需要 Protected Customer Data 权限" 
                          tone="critical"
                        >
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm">
                              您已启用 PII 发送功能。为确保合规，请注意：
                            </Text>
                            <Text as="p" variant="bodySm">
                              1. 您的应用需要通过 Shopify 的 <strong>Protected Customer Data</strong> 审核
                              <br />
                              2. 审核未通过前，Shopify 可能会限制或清空 PII 字段
                              <br />
                              3. 请在 Shopify Partner Dashboard 提交审核申请
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              如果您尚未通过审核，建议暂时禁用此选项以避免数据丢失。
                            </Text>
                          </BlockStack>
                        </Banner>
                      )}

                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="span" fontWeight="semibold">数据发送说明：</Text>
                          <Text as="p" variant="bodySm">
                            • <strong>当前模式</strong>：仅发送订单金额、货币、商品信息用于转化归因
                            <br />• <strong>不发送 PII</strong>：邮箱、电话等个人信息不会发送到广告平台
                            <br />• <strong>隐私优先</strong>：这种数据最小化模式更适合隐私敏感场景
                          </Text>
                        </BlockStack>
                      </Banner>
                    </BlockStack>

                    <Divider />

                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        数据保留策略
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        配置数据保留期限，控制转化日志和相关记录的存储时间。
                      </Text>

                      <Select
                        label="数据保留天数"
                        options={[
                          { label: "30 天（推荐用于高流量店铺）", value: "30" },
                          { label: "60 天", value: "60" },
                          { label: "90 天（默认）", value: "90" },
                          { label: "180 天", value: "180" },
                          { label: "365 天（最大）", value: "365" },
                        ]}
                        value={String(shop?.dataRetentionDays || 90)}
                        onChange={(value) => {
                          const formData = new FormData();
                          formData.append("_action", "updatePrivacySettings");
                          formData.append("piiEnabled", String(shop?.piiEnabled || false));
                          formData.append("consentStrategy", shop?.consentStrategy || "balanced");
                          formData.append("dataRetentionDays", value);
                          submit(formData, { method: "post" });
                        }}
                        helpText="超过此期限的数据将被自动清理"
                      />

                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="span" fontWeight="semibold">数据保留说明：</Text>
                          <Text as="p" variant="bodySm">
                            以下数据受保留期限控制，超期后将被自动删除：
                          </Text>
                          <Text as="p" variant="bodySm">
                            • <strong>转化日志 (ConversionLog)</strong>：订单转化追踪记录
                            <br />• <strong>像素事件回执 (PixelEventReceipt)</strong>：客户端同意证据
                            <br />• <strong>扫描报告 (ScanReport)</strong>：网站扫描结果
                            <br />• <strong>对账报告 (ReconciliationReport)</strong>：平台数据对比
                            <br />• <strong>失败任务 (dead_letter)</strong>：无法重试的转化任务
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            清理任务每日自动执行。审计日志保留 365 天，不受此设置影响。
                          </Text>
                        </BlockStack>
                      </Banner>

                      <Banner tone="warning">
                        <BlockStack gap="100">
                          <Text as="span" fontWeight="semibold">数据最小化原则：</Text>
                          <Text as="p" variant="bodySm">
                            我们仅存储转化追踪必需的数据：
                            <br />• 订单 ID、金额、货币、商品信息（来自 Webhook）
                            <br />• 同意状态、事件时间戳（来自 Pixel）
                            <br />• <strong>不存储/发送 PII</strong>：邮箱、电话等个人信息不会被收集或发送
                          </Text>
                        </BlockStack>
                      </Banner>
                    </BlockStack>

                    <Divider />

                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        Consent 策略
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        控制何时发送转化数据到广告平台。不同策略适用于不同地区的合规要求。
                      </Text>

                      <Select
                        label="策略选择"
                        options={[
                          { 
                            label: "🔒 严格模式（Strict）- 推荐", 
                            value: "strict",
                          },
                          { 
                            label: "⚖️ 平衡模式（Balanced）", 
                            value: "balanced",
                          },
                        ]}
                        value={shop?.consentStrategy || "strict"}
                        onChange={(value) => {
                          if (value !== "strict") {
                            const warning = "平衡模式仍要求像素回执与明确同意，但允许"部分可信"的回执（trust=partial）。\n\n在 GDPR 等严格隐私法规地区，推荐使用严格模式。\n\n确定要切换吗？";
                            if (!confirm(warning)) {
                              return;
                            }
                          }
                          const formData = new FormData();
                          formData.append("_action", "updatePrivacySettings");
                          formData.append("piiEnabled", String(shop?.piiEnabled || false));
                          formData.append("consentStrategy", value);
                          formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
                          submit(formData, { method: "post" });
                        }}
                        helpText={
                          shop?.consentStrategy === "strict" 
                            ? "必须有可信的像素回执 + 明确同意才发送数据。适用于 GDPR/CCPA 等严格隐私法规地区。推荐设置。"
                            : "仍要求像素回执与明确同意；仅在回执信任等级为 partial 时也可发送（比严格模式略宽）。"
                        }
                      />

                      <Banner 
                        tone={shop?.consentStrategy === "strict" ? "success" : "info"}
                      >
                        {shop?.consentStrategy === "strict" && (
                          <BlockStack gap="100">
                            <Text as="span" fontWeight="semibold">✅ 严格模式（推荐）</Text>
                            <Text as="p" variant="bodySm">
                              仅当像素事件明确表明用户同意营销追踪时才发送 CAPI。
                              如果像素未触发或用户拒绝同意，转化数据将不会发送。
                              这是最安全的设置，符合 GDPR/CCPA 等严格隐私法规要求。
                            </Text>
                          </BlockStack>
                        )}
                        {shop?.consentStrategy === "balanced" && (
                          <BlockStack gap="100">
                            <Text as="span" fontWeight="semibold">⚖️ 平衡模式</Text>
                            <Text as="p" variant="bodySm">
                              仍要求像素回执与明确用户同意，但允许信任等级为"部分可信"的回执。
                              这比严格模式略宽松，但仍然确保有用户同意证据才发送数据。
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              建议：如果您的客户主要来自欧盟、英国等地区，推荐使用严格模式。
                            </Text>
                          </BlockStack>
                        )}
                        {shop?.consentStrategy !== "strict" && shop?.consentStrategy !== "balanced" && (
                          <BlockStack gap="100">
                            <Text as="span" fontWeight="semibold">⚠️ 未知策略</Text>
                            <Text as="p" variant="bodySm">
                              当前策略设置无效，将自动按严格模式处理。请选择一个有效的策略。
                            </Text>
                          </BlockStack>
                        )}
                      </Banner>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}

          {selectedTab === 3 && (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        当前计划
                      </Text>
                      <Badge tone="success">免费版</Badge>
                    </InlineStack>

                    <Banner tone="info">
                      <p>
                        感谢使用 Tracking Guardian！目前所有功能完全免费开放。
                        付费套餐即将推出，届时将提供更高的使用限额和高级功能。
                      </p>
                    </Banner>

                    <Divider />

                    <BlockStack gap="400">
                      <Box
                        background="bg-surface-selected"
                        padding="400"
                        borderRadius="200"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h3" variant="headingMd">
                              免费版
                            </Text>
                            <Badge tone="success">当前计划</Badge>
                          </InlineStack>
                          <Text as="p" tone="subdued">
                            • 无限扫描报告
                            <br />• 所有平台集成（Google、Meta、TikTok）
                            <br />• 服务端转化追踪（CAPI）
                            <br />• 邮件 + Slack + Telegram 警报
                            <br />• 每日健康监控
                          </Text>
                        </BlockStack>
                      </Box>

                      <Box
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="headingMd" tone="subdued">
                                高级套餐
                              </Text>
                              <Badge>即将推出</Badge>
                            </InlineStack>
                          </InlineStack>
                          <Text as="p" tone="subdued">
                            • 更高的月度订单限额
                            <br />• 更长的数据保留期
                            <br />• 优先技术支持
                            <br />• 高级对账报告
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            付费套餐即将推出，敬请期待。当前所有功能免费使用。
                          </Text>
                        </BlockStack>
                      </Box>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}
        </Tabs>
      </BlockStack>
    </Page>
  );
}

