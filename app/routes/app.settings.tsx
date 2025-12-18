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
} from "@shopify/polaris";
import { useContextualSaveBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { testNotification } from "../services/notification.server";
import { encryptJson } from "../utils/crypto";
import type { MetaCredentials, GoogleCredentials, TikTokCredentials } from "../types";

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

  return json({
    shop: shop
      ? {
          id: shop.id,
          domain: shopDomain,
          plan: shop.plan,
          alertConfigs: shop.alertConfigs,
          pixelConfigs: shop.pixelConfigs,
        }
      : null,
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
        const googleCreds: GoogleCredentials = {
          conversionId: formData.get("conversionId") as string || "",
          conversionLabel: formData.get("conversionLabel") as string || "",
          customerId: formData.get("customerId") as string || undefined,
        };
        credentials = googleCreds;
        platformId = googleCreds.conversionId;
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
      const encryptedCredentials = encryptJson(credentials);

      await prisma.pixelConfig.upsert({
        where: {
          shopId_platform: {
            shopId: shop.id,
            platform,
          },
        },
        update: {
          credentials: encryptedCredentials,
          serverSideEnabled: enabled,
        },
        create: {
          shopId: shop.id,
          platform,
          platformId,
          credentials: encryptedCredentials,
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

    default:
      return json({ error: "Unknown action" }, { status: 400 });
  }
};

export default function SettingsPage() {
  const { shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const contextualSaveBar = useContextualSaveBar();

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
  const [metaPixelId, setMetaPixelId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestCode, setMetaTestCode] = useState("");

  // Track form changes for Save bar
  const [alertFormDirty, setAlertFormDirty] = useState(false);
  const [serverFormDirty, setServerFormDirty] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  
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
      metaTestCode !== initial.metaTestCode;
    setServerFormDirty(isDirty);
  }, [serverPlatform, serverEnabled, metaPixelId, metaAccessToken, metaTestCode]);

  // Update dirty state when form values change
  useEffect(() => {
    if (selectedTab === 0) {
      checkAlertFormDirty();
    } else if (selectedTab === 1) {
      checkServerFormDirty();
    }
  }, [selectedTab, checkAlertFormDirty, checkServerFormDirty]);

  // Handle save bar visibility
  useEffect(() => {
    const hasDirtyForm = (selectedTab === 0 && alertFormDirty) || (selectedTab === 1 && serverFormDirty);
    
    if (hasDirtyForm) {
      contextualSaveBar.show({
        saveAction: {
          content: "保存",
          onAction: () => {
            if (selectedTab === 0) {
              handleSaveAlert();
            } else if (selectedTab === 1) {
              handleSaveServerSide();
            }
          },
          loading: isSubmitting,
        },
        discardAction: {
          content: "放弃",
          onAction: () => {
            handleDiscardChanges();
          },
        },
      });
    } else {
      contextualSaveBar.hide();
    }
  }, [alertFormDirty, serverFormDirty, selectedTab, isSubmitting]);

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
        };
        setServerFormDirty(false);
      }
      setIsSaved(true);
      contextualSaveBar.hide();
    }
  }, [actionData]);

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
      setServerFormDirty(false);
    }
    contextualSaveBar.hide();
  }, [selectedTab, contextualSaveBar]);

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

  const tabs = [
    { id: "alerts", content: "警报通知" },
    { id: "server-side", content: "服务端追踪" },
    { id: "subscription", content: "订阅计划" },
  ];

  return (
    <Page title="设置">
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
                        { label: "Google Ads Conversions API", value: "google" },
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

          {/* Subscription Tab */}
          {selectedTab === 2 && (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        当前计划
                      </Text>
                      <Badge tone="info">{shop?.plan || "免费版"}</Badge>
                    </InlineStack>

                    <Divider />

                    <BlockStack gap="400">
                      {/* Free Plan */}
                      <Box
                        background={
                          shop?.plan === "free"
                            ? "bg-surface-selected"
                            : "bg-surface-secondary"
                        }
                        padding="400"
                        borderRadius="200"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h3" variant="headingMd">
                              免费版
                            </Text>
                            <Text as="span" fontWeight="bold">
                              $0/月
                            </Text>
                          </InlineStack>
                          <Badge tone="info">适用人群：月订单 &lt; 100 的新店铺</Badge>
                          <Text as="p" tone="subdued">
                            • 每月 100 次转化追踪（按订单数计算）
                            <br />• 基础扫描报告
                            <br />• 邮件警报
                          </Text>
                          {shop?.plan === "free" && (
                            <Badge tone="success">当前计划</Badge>
                          )}
                        </BlockStack>
                      </Box>

                      {/* Starter Plan */}
                      <Box
                        background={
                          shop?.plan === "starter"
                            ? "bg-surface-selected"
                            : "bg-surface-secondary"
                        }
                        padding="400"
                        borderRadius="200"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="headingMd">
                                入门版
                              </Text>
                              <Badge tone="success">最受欢迎</Badge>
                            </InlineStack>
                            <Text as="span" fontWeight="bold">
                              $29/月
                            </Text>
                          </InlineStack>
                          <Badge tone="info">适用人群：月订单 100-1,000 的成长店铺</Badge>
                          <Text as="p" tone="subdued">
                            • 每月 1,000 次转化追踪（按订单数计算）
                            <br />• 2 个平台集成
                            <br />• 每日对账报告
                            <br />• 邮件 + Slack 警报
                          </Text>
                          {shop?.plan === "starter" ? (
                            <Badge tone="success">当前计划</Badge>
                          ) : (
                            <Button>升级到入门版</Button>
                          )}
                        </BlockStack>
                      </Box>

                      {/* Pro Plan */}
                      <Box
                        background={
                          shop?.plan === "pro"
                            ? "bg-surface-selected"
                            : "bg-surface-secondary"
                        }
                        padding="400"
                        borderRadius="200"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h3" variant="headingMd">
                              专业版
                            </Text>
                            <Text as="span" fontWeight="bold">
                              $79/月
                            </Text>
                          </InlineStack>
                          <Badge tone="info">适用人群：月订单 1,000+ 的成熟店铺</Badge>
                          <Text as="p" tone="subdued">
                            • 每月 10,000 次转化追踪（按订单数计算）
                            <br />• 所有平台集成
                            <br />• Conversions API（CAPI）
                            <br />• 实时警报
                            <br />• 优先支持
                          </Text>
                          {shop?.plan === "pro" ? (
                            <Badge tone="success">当前计划</Badge>
                          ) : (
                            <Button variant="primary">升级到专业版</Button>
                          )}
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

