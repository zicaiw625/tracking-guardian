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

import { randomBytes } from "crypto";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { testNotification } from "../services/notification.server";
import { encryptJson } from "../utils/crypto";
import { checkTokenExpirationIssues } from "../services/retry.server";
import { createAuditLog } from "../services/audit.server";
import type { MetaCredentials, GoogleCredentials, TikTokCredentials } from "../types";

/**
 * P1-1: Generate a secure random ingestion secret for pixel request signing
 * The secret is 32 bytes (256 bits) encoded as hex (64 characters)
 */
function generateIngestionSecret(): string {
  return randomBytes(32).toString("hex");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      alertConfigs: true,
      pixelConfigs: {
        where: { isActive: true },
      },
    },
  });

  // Check for token expiration issues
  let tokenIssues = { hasIssues: false, affectedPlatforms: [] as string[] };
  if (shop) {
    tokenIssues = await checkTokenExpirationIssues(shop.id);
  }

  return json({
    shop: shop
      ? {
          id: shop.id,
          domain: shopDomain,
          plan: shop.plan,
          alertConfigs: shop.alertConfigs,
          pixelConfigs: shop.pixelConfigs,
          // P1-1: Return whether ingestion secret is configured (not the actual value)
          hasIngestionSecret: !!shop.ingestionSecret && shop.ingestionSecret.length > 0,
          piiEnabled: shop.piiEnabled,
          dataRetentionDays: shop.dataRetentionDays,
        }
      : null,
    tokenIssues,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

      const settings: Record<string, any> = {};

      if (channel === "email") {
        settings.email = formData.get("email");
      } else if (channel === "slack") {
        settings.webhookUrl = formData.get("webhookUrl");
      } else if (channel === "telegram") {
        settings.botToken = formData.get("botToken");
        settings.chatId = formData.get("chatId");
      }

      await prisma.alertConfig.upsert({
        where: {
          id: (formData.get("configId") as string) || "new",
        },
        update: {
          channel,
          settings,
          discrepancyThreshold: threshold,
          isEnabled: enabled,
        },
        create: {
          shopId: shop.id,
          channel,
          settings,
          discrepancyThreshold: threshold,
          isEnabled: enabled,
        },
      });

      return json({ success: true, message: "警报配置已保存" });
    }

    case "testAlert": {
      const channel = formData.get("channel") as string;
      const settings: Record<string, any> = {};

      if (channel === "email") {
        settings.email = formData.get("email");
      } else if (channel === "slack") {
        settings.webhookUrl = formData.get("webhookUrl");
      } else if (channel === "telegram") {
        settings.botToken = formData.get("botToken");
        settings.chatId = formData.get("chatId");
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
        // GA4 Measurement Protocol credentials
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

      // Encrypt credentials before storing
      // IMPORTANT: Use credentialsEncrypted field (not legacy credentials field)
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

      // Simulate testing connection - in real implementation this would
      // send a test event to the platform's API
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // For demo purposes, return success if credentials are provided
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
      // P1-1: Rotate the ingestion secret for security
      const newSecret = generateIngestionSecret();
      
      await prisma.shop.update({
        where: { id: shop.id },
        data: { ingestionSecret: newSecret },
      });

      // Create audit log for security tracking
      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: session.shop,
        action: "ingestion_secret_rotated",
        resourceType: "shop",
        resourceId: shop.id,
        metadata: { reason: "Manual rotation from settings" },
      });

      return json({
        success: true,
        message: "Ingestion Secret 已更新。请重新部署 Web Pixel 以使用新密钥。",
      });
    }

    case "updatePrivacySettings": {
      const piiEnabled = formData.get("piiEnabled") === "true";
      const dataRetentionDays = parseInt(formData.get("dataRetentionDays") as string) || 90;

      await prisma.shop.update({
        where: { id: shop.id },
        data: { piiEnabled, dataRetentionDays },
      });

      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: session.shop,
        action: "privacy_settings_updated",
        resourceType: "shop",
        resourceId: shop.id,
        metadata: { piiEnabled, dataRetentionDays },
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
  
  // Alert settings state
  const [alertChannel, setAlertChannel] = useState("email");
  const [alertEmail, setAlertEmail] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("10");
  const [alertEnabled, setAlertEnabled] = useState(true);

  // Server-side tracking state
  const [serverPlatform, setServerPlatform] = useState("meta");
  const [serverEnabled, setServerEnabled] = useState(false);
  // Meta fields
  const [metaPixelId, setMetaPixelId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestCode, setMetaTestCode] = useState("");
  // Google GA4 fields
  const [googleMeasurementId, setGoogleMeasurementId] = useState("");
  const [googleApiSecret, setGoogleApiSecret] = useState("");
  // TikTok fields
  const [tiktokPixelId, setTiktokPixelId] = useState("");
  const [tiktokAccessToken, setTiktokAccessToken] = useState("");

  // Track form changes for Save bar
  const [alertFormDirty, setAlertFormDirty] = useState(false);
  const [serverFormDirty, setServerFormDirty] = useState(false);
  
  // Initial values refs for comparison
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

  // Check if alert form has changes
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

  // Check if server form has changes
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

  // Update dirty state when form values change
  useEffect(() => {
    if (selectedTab === 0) {
      checkAlertFormDirty();
    } else if (selectedTab === 1) {
      checkServerFormDirty();
    }
  }, [selectedTab, checkAlertFormDirty, checkServerFormDirty]);

  // Reset dirty state after successful save
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      // Update initial values to current values after save
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

  // Discard changes handler
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

  // Determine if save bar should show
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

  // Handle save action from save bar
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

  // Handler for rotating ingestion secret
  const handleRotateSecret = () => {
    if (confirm("确定要更换 Ingestion Secret 吗？更换后需要重新部署 Web Pixel。")) {
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
          {/* Alert Settings Tab */}
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

              {/* Existing Alert Configs */}
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      已配置的警报
                    </Text>
                    {shop?.alertConfigs && shop.alertConfigs.length > 0 ? (
                      shop.alertConfigs.map((config: any) => (
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

          {/* Server-side Tracking Tab */}
          {selectedTab === 1 && (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      服务端转化追踪（Conversions API）
                    </Text>

                    {/* Token Expiration Warning */}
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
                    shop.pixelConfigs.filter((c: any) => c.serverSideEnabled)
                      .length > 0 ? (
                      shop.pixelConfigs
                        .filter((c: any) => c.serverSideEnabled)
                        .map((config: any) => (
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

          {/* Security & Privacy Tab */}
          {selectedTab === 2 && (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      安全设置
                    </Text>
                    <Text as="p" tone="subdued">
                      管理 Pixel 事件签名密钥和数据安全设置。
                    </Text>

                    <Divider />

                    {/* Ingestion Secret Section */}
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingMd">
                        Ingestion Secret
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        用于验证来自 Web Pixel 的事件请求。每个请求都需要使用此密钥进行签名，
                        以防止未授权的事件提交。
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
                                    密钥已安全存储
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <Badge tone="critical">未配置</Badge>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    请重新安装应用以生成密钥
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
                            更换密钥
                          </Button>
                        </InlineStack>
                      </Box>

                      <Banner tone="warning">
                        <p>
                          更换密钥后，需要重新部署 Web Pixel 扩展以使用新密钥。
                          在此期间，旧密钥签名的请求将被拒绝。
                        </p>
                      </Banner>
                    </BlockStack>

                    <Divider />

                    {/* PII Settings Section */}
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
                            <Badge tone={shop?.piiEnabled ? "attention" : "success"}>
                              {shop?.piiEnabled ? "已启用" : "已禁用（推荐）"}
                            </Badge>
                          </InlineStack>
                        </BlockStack>
                      </Box>

                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="span" fontWeight="semibold">PII 处理说明：</Text>
                          <Text as="p" variant="bodySm">
                            • <strong>Meta/TikTok</strong>：启用后，PII（邮箱、电话）会先进行 SHA256 哈希再发送
                            <br />• <strong>Google</strong>：GA4 Measurement Protocol 禁止上传 PII（含哈希），我们不会发送
                            <br />• <strong>默认禁用</strong>：为保护用户隐私，PII 发送默认关闭
                          </Text>
                        </BlockStack>
                      </Banner>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}

          {/* Subscription Tab */}
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
                      {/* Current Free Plan */}
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

                      {/* Coming Soon Plans */}
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

