import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useSearchParams } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Box,
  TextField,
  Select,
  Divider,
  Icon,
  ProgressBar,
  Link,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ClipboardIcon,
  PlayIcon,
  SettingsIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  generatePixelCode,
  savePixelConfig,
  getPixelConfigs,
  createWebPixel,
  getExistingWebPixels,
  deleteScriptTag,
  type Platform,
  type MigrationResult,
  type SavePixelConfigOptions,
} from "../services/migration.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      ingestionSecret: true, // P1-1: For Web Pixel request signing
    },
  });

  if (!shop) {
    return json({ shop: null, pixelConfigs: [], latestScan: null });
  }

  const pixelConfigs = await getPixelConfigs(shop.id);

  // Get latest scan for detected platforms
  const latestScan = await prisma.scanReport.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return json({
    shop: { id: shop.id, domain: shopDomain },
    pixelConfigs,
    latestScan,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      ingestionSecret: true, // P1-1: For Web Pixel request signing
    },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action");

  // New: Auto-enable Web Pixel
  if (actionType === "enablePixel") {
    const backendUrl = formData.get("backendUrl") as string;
    
    if (!backendUrl) {
      return json({ error: "Backend URL is required" }, { status: 400 });
    }

    // Get shop's ingestion secret for request signing (P1-1)
    const ingestionSecret = shop.ingestionSecret || undefined;

    // Check if a Web Pixel already exists
    const existingPixels = await getExistingWebPixels(admin);
    
    // Look for our pixel (by checking if settings contain backend_url)
    let ourPixel = existingPixels.find((p) => {
      if (!p.settings) return false;
      try {
        const settings = JSON.parse(p.settings);
        return settings.backend_url !== undefined;
      } catch {
        return false;
      }
    });

    let result;
    if (ourPixel) {
      // Update existing pixel with ingestionSecret
      const { updateWebPixel } = await import("../services/migration.server");
      result = await updateWebPixel(admin, ourPixel.id, backendUrl, ingestionSecret);
    } else {
      // Create new pixel with ingestionSecret
      result = await createWebPixel(admin, backendUrl, ingestionSecret);
    }

    if (result.success) {
      return json({
        _action: "enablePixel",
        success: true,
        message: ourPixel ? "Web Pixel 已更新" : "Web Pixel 已启用",
        webPixelId: result.webPixelId,
      });
    } else {
      return json({
        _action: "enablePixel",
        success: false,
        error: result.error,
      });
    }
  }

  // Delete ScriptTag
  if (actionType === "deleteScriptTag") {
    const scriptTagId = parseInt(formData.get("scriptTagId") as string);
    
    if (!scriptTagId) {
      return json({ error: "ScriptTag ID is required" }, { status: 400 });
    }

    const result = await deleteScriptTag(admin, scriptTagId);
    
    return json({
      _action: "deleteScriptTag",
      success: result.success,
      error: result.error,
    });
  }

  if (actionType === "generate") {
    const platform = formData.get("platform") as Platform;
    const platformId = formData.get("platformId") as string;
    const conversionId = formData.get("conversionId") as string;
    const conversionLabel = formData.get("conversionLabel") as string;

    if (!platform || !platformId) {
      return json({ error: "Platform and ID are required" }, { status: 400 });
    }

    // Separate client-side config (non-sensitive) from server-side credentials (sensitive)
    const clientConfig: Record<string, string> = {};
    if (conversionId) clientConfig.conversionId = conversionId;
    if (conversionLabel) clientConfig.conversionLabel = conversionLabel;

    const result = generatePixelCode({
      platform,
      platformId,
      additionalConfig: clientConfig,
    });

    if (result.success) {
      // Save the config with properly separated fields
      // Note: credentialsEncrypted should be set separately via Settings page
      // where users configure server-side API access tokens
      const options: SavePixelConfigOptions = {
        clientConfig: Object.keys(clientConfig).length > 0 ? clientConfig : undefined,
      };
      await savePixelConfig(shop.id, platform, platformId, options);
    }

    return json({ result, _action: "generate" });
  }

  if (actionType === "verify") {
    const platform = formData.get("platform") as Platform;
    const platformId = formData.get("platformId") as string;

    // Simulate verification - in real implementation, this would send a test event
    // and check if it's received by the platform
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // For demo, return success
    return json({
      _action: "verify",
      success: true,
      message: "测试事件已发送，请在平台后台查看事件是否到达",
      verifiedAt: new Date().toISOString(),
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

const PLATFORMS = [
  { label: "Google Analytics 4 / Google Ads", value: "google" },
  { label: "Meta (Facebook) Pixel", value: "meta" },
  { label: "TikTok Pixel", value: "tiktok" },
  { label: "Microsoft Advertising (Bing UET)", value: "bing" },
  { label: "Microsoft Clarity", value: "clarity" },
];

type WizardStep = "select" | "install" | "verify";

export default function MigratePage() {
  const { shop, pixelConfigs, latestScan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  // Get platform from URL query parameter (from scan page "一键迁移")
  const urlPlatform = searchParams.get("platform");

  const [currentStep, setCurrentStep] = useState<WizardStep>("select");
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(
    (urlPlatform as Platform) || "google"
  );
  const [platformId, setPlatformId] = useState("");
  const [conversionId, setConversionId] = useState("");
  const [conversionLabel, setConversionLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<"idle" | "pending" | "success" | "failed">("idle");

  const isSubmitting = navigation.state === "submitting";

  // Handle action results
  useEffect(() => {
    const data = actionData as any;
    if (data?._action === "generate" && data?.result?.success) {
      setCurrentStep("install");
    }
    if (data?._action === "verify") {
      setVerificationStatus(data.success ? "success" : "failed");
    }
  }, [actionData]);

  const handleGenerate = () => {
    const formData = new FormData();
    formData.append("_action", "generate");
    formData.append("platform", selectedPlatform);
    formData.append("platformId", platformId);
    if (conversionId) formData.append("conversionId", conversionId);
    if (conversionLabel) formData.append("conversionLabel", conversionLabel);
    submit(formData, { method: "post" });
  };

  const handleVerify = () => {
    setVerificationStatus("pending");
    const formData = new FormData();
    formData.append("_action", "verify");
    formData.append("platform", selectedPlatform);
    formData.append("platformId", platformId);
    submit(formData, { method: "post" });
  };

  const handleCopyCode = useCallback(() => {
    const data = actionData as { result?: { pixelCode?: string } } | undefined;
    if (data?.result?.pixelCode) {
      navigator.clipboard.writeText(data.result.pixelCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [actionData]);

  const getPlatformIdLabel = () => {
    switch (selectedPlatform) {
      case "google":
        return "Measurement ID (如: G-XXXXXXXXXX)";
      case "meta":
        return "Pixel ID (15-16位数字)";
      case "tiktok":
        return "Pixel ID";
      case "bing":
        return "UET Tag ID";
      case "clarity":
        return "Project ID";
      default:
        return "Platform ID";
    }
  };

  const identifiedPlatforms = (latestScan?.identifiedPlatforms as string[]) || [];

  // Get existing config for selected platform
  const existingConfig = pixelConfigs.find(
    (config) => config?.platform === selectedPlatform
  );

  // Step indicator
  const steps = [
    { id: "select", label: "选择平台", number: 1 },
    { id: "install", label: "安装像素", number: 2 },
    { id: "verify", label: "验证事件", number: 3 },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <Page
      title="迁移工具"
      subtitle="将追踪脚本迁移到 Shopify Web Pixel / Customer Events"
    >
      <BlockStack gap="500">
        {/* Info Banner with official docs link */}
        <Banner
          title="为什么需要迁移到 Web Pixels？"
          tone="info"
          action={{
            content: "查看官方文档",
            url: "https://shopify.dev/docs/api/web-pixels-api",
            external: true,
          }}
        >
          <BlockStack gap="200">
            <Text as="p">
              Shopify 推荐使用 <strong>Web Pixels API</strong> 和 <strong>Customer Events</strong> 来实现追踪功能。
              新的方式提供更好的性能、隐私合规性，并与 Checkout Extensibility 原生集成。
            </Text>
            <Link
              url="https://help.shopify.com/en/manual/promoting-marketing/pixels"
              external
            >
              了解 Pixels 和 Customer Events
            </Link>
          </BlockStack>
        </Banner>

        {/* Step Progress Indicator */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              {steps.map((step, index) => (
                <InlineStack key={step.id} gap="400" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Box
                      background={
                        index < currentStepIndex
                          ? "bg-fill-success"
                          : index === currentStepIndex
                            ? "bg-fill-info"
                            : "bg-surface-secondary"
                      }
                      padding="200"
                      borderRadius="full"
                      minWidth="32px"
                      minHeight="32px"
                    >
                      <Text
                        as="span"
                        variant="bodySm"
                        fontWeight="bold"
                        alignment="center"
                      >
                        {index < currentStepIndex ? "✓" : step.number}
                      </Text>
                    </Box>
                    <Text
                      as="span"
                      fontWeight={index === currentStepIndex ? "bold" : "regular"}
                      tone={index <= currentStepIndex ? undefined : "subdued"}
                    >
                      {step.label}
                    </Text>
                  </InlineStack>
                  {index < steps.length - 1 && (
                    <Box
                      background={index < currentStepIndex ? "bg-fill-success" : "bg-surface-secondary"}
                      minWidth="60px"
                      minHeight="2px"
                    />
                  )}
                </InlineStack>
              ))}
            </InlineStack>
            <ProgressBar
              progress={((currentStepIndex + 1) / steps.length) * 100}
              tone="primary"
              size="small"
            />
          </BlockStack>
        </Card>

        {/* Detected Platforms from Scan */}
        {identifiedPlatforms.length > 0 && currentStep === "select" && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                扫描检测到的平台
              </Text>
              <InlineStack gap="200">
                {identifiedPlatforms.map((platform) => (
                  <Badge key={platform} tone="info">
                    {PLATFORMS.find((p) => p.value === platform)?.label || platform}
                  </Badge>
                ))}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                这些平台可能需要迁移到 Web Pixels 格式
              </Text>
            </BlockStack>
          </Card>
        )}

        <Layout>
          {/* Main Content Area */}
          <Layout.Section>
            {/* Step 1: Select Platform */}
            {currentStep === "select" && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    第 1 步：选择追踪平台并填写 ID
                  </Text>

                  <Select
                    label="选择追踪平台"
                    options={PLATFORMS}
                    value={selectedPlatform}
                    onChange={(value) => setSelectedPlatform(value as Platform)}
                  />

                  <TextField
                    label={getPlatformIdLabel()}
                    value={platformId}
                    onChange={setPlatformId}
                    autoComplete="off"
                    placeholder={
                      selectedPlatform === "google"
                        ? "G-XXXXXXXXXX"
                        : selectedPlatform === "meta"
                          ? "1234567890123456"
                          : ""
                    }
                  />

                  {selectedPlatform === "google" && (
                    <>
                      <Divider />
                      <Text as="p" variant="bodySm" tone="subdued">
                        可选：添加 Google Ads 转化追踪
                      </Text>
                      <TextField
                        label="Conversion ID (可选)"
                        value={conversionId}
                        onChange={setConversionId}
                        autoComplete="off"
                        placeholder="AW-XXXXXXXXXX"
                      />
                      <TextField
                        label="Conversion Label (可选)"
                        value={conversionLabel}
                        onChange={setConversionLabel}
                        autoComplete="off"
                        placeholder="AbCdEfGhIjKlMnOp"
                      />
                    </>
                  )}

                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={handleGenerate}
                      loading={isSubmitting}
                      disabled={!platformId}
                    >
                      生成并启用像素
                    </Button>
                    <Button
                      onClick={handleGenerate}
                      disabled={!platformId}
                      loading={isSubmitting}
                    >
                      仅生成代码
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {/* Step 2: Install Pixel */}
            {currentStep === "install" && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      第 2 步：安装 Web Pixel 代码
                    </Text>
                    <Button
                      onClick={handleCopyCode}
                      icon={copied ? CheckCircleIcon : ClipboardIcon}
                    >
                      {copied ? "已复制" : "复制代码"}
                    </Button>
                  </InlineStack>

                  {/* Installation status */}
                  {existingConfig ? (
                    <Banner tone="success">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">已安装</Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          上次更新: {new Date(existingConfig.updatedAt).toLocaleDateString("zh-CN")}
                        </Text>
                      </InlineStack>
                    </Banner>
                  ) : (
                    <Banner tone="info">
                      <Text as="span">未安装 - 请按照下方步骤完成安装</Text>
                    </Banner>
                  )}

                  {(() => {
                    const data = actionData as { result?: MigrationResult } | undefined;
                    if (!data?.result?.success) return null;
                    const result = data.result;
                    return (
                      <BlockStack gap="400">
                        <Box
                          background="bg-surface-secondary"
                          padding="400"
                          borderRadius="200"
                        >
                          <pre
                            style={{
                              overflow: "auto",
                              maxHeight: "300px",
                              fontSize: "12px",
                              lineHeight: "1.5",
                              margin: 0,
                            }}
                          >
                            {result.pixelCode}
                          </pre>
                        </Box>

                        <Divider />

                        <Text as="h3" variant="headingSm">
                          安装步骤
                        </Text>
                        <BlockStack gap="200">
                          {result.instructions.map((instruction: string, index: number) => (
                            <InlineStack key={index} gap="200" align="start">
                              <Icon source={CheckCircleIcon} tone="success" />
                              <Text as="span">{instruction}</Text>
                            </InlineStack>
                          ))}
                        </BlockStack>

                        <Banner tone="info">
                          <BlockStack gap="200">
                            <Text as="p">
                              在 Shopify 后台，前往 <strong>Settings → Customer events → Add custom pixel</strong> 来创建新的 Web Pixel。
                            </Text>
                            <Link
                              url="https://admin.shopify.com/settings/customer_events"
                              external
                            >
                              打开 Customer Events 设置
                            </Link>
                          </BlockStack>
                        </Banner>

                        <InlineStack gap="200">
                          <Button
                            variant="primary"
                            onClick={() => setCurrentStep("verify")}
                          >
                            已完成安装，下一步
                          </Button>
                          <Button onClick={() => setCurrentStep("select")}>
                            返回修改
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    );
                  })()}
                </BlockStack>
              </Card>
            )}

            {/* Step 3: Verify Events */}
            {currentStep === "verify" && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    第 3 步：验证事件是否正常触发
                  </Text>

                  {/* Previous verification status */}
                  {existingConfig?.lastVerifiedAt && (
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone="success">上次验证通过</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {new Date(existingConfig.lastVerifiedAt).toLocaleString("zh-CN")}
                      </Text>
                    </InlineStack>
                  )}

                  <Text as="p" tone="subdued">
                    点击下方按钮发送测试事件，然后在平台后台检查事件是否正确到达。
                  </Text>

                  <Box
                    background="bg-surface-secondary"
                    padding="400"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="span" fontWeight="semibold">
                            {PLATFORMS.find((p) => p.value === selectedPlatform)?.label}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            ID: {platformId}
                          </Text>
                        </BlockStack>
                        <Button
                          onClick={handleVerify}
                          loading={verificationStatus === "pending"}
                          icon={PlayIcon}
                        >
                          发送测试事件
                        </Button>
                      </InlineStack>

                      {verificationStatus === "success" && (
                        <Banner tone="success">
                          <BlockStack gap="100">
                            <Text as="p" fontWeight="semibold">
                              测试事件已发送！
                            </Text>
                            <Text as="p" variant="bodySm">
                              请在 {PLATFORMS.find((p) => p.value === selectedPlatform)?.label} 后台检查事件是否到达。
                              通常需要等待 1-5 分钟。
                            </Text>
                          </BlockStack>
                        </Banner>
                      )}

                      {verificationStatus === "failed" && (
                        <Banner tone="critical">
                          <Text as="p">
                            测试事件发送失败，请检查配置是否正确。
                          </Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Box>

                  <Divider />

                  <Text as="h3" variant="headingSm">
                    验证清单
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="start">
                      <Icon source={CheckCircleIcon} tone="subdued" />
                      <Text as="span">在平台后台检查 Purchase / 购买 事件是否触发</Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="start">
                      <Icon source={CheckCircleIcon} tone="subdued" />
                      <Text as="span">确认事件包含正确的订单金额和订单号</Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="start">
                      <Icon source={CheckCircleIcon} tone="subdued" />
                      <Text as="span">检查是否有重复事件触发</Text>
                    </InlineStack>
                  </BlockStack>

                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      url="/app/monitor"
                    >
                      完成，前往监控面板
                    </Button>
                    <Button onClick={() => setCurrentStep("install")}>
                      返回上一步
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}
          </Layout.Section>

          {/* Sidebar - Configured Platforms */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  已配置的平台
                </Text>
                {pixelConfigs.length > 0 ? (
                  <BlockStack gap="300">
                    {pixelConfigs.filter((config): config is NonNullable<typeof config> => config !== null).map((config) => (
                      <Box
                        key={config.id}
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <Text as="span" fontWeight="semibold">
                              {PLATFORMS.find((p) => p.value === config.platform)?.label || config.platform}
                            </Text>
                            <Badge
                              tone={
                                config.migrationStatus === "completed"
                                  ? "success"
                                  : config.migrationStatus === "in_progress"
                                    ? "attention"
                                    : "info"
                              }
                            >
                              {config.migrationStatus === "completed"
                                ? "已完成"
                                : config.migrationStatus === "in_progress"
                                  ? "进行中"
                                  : "未开始"}
                            </Badge>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {config.platformId}
                          </Text>
                          {config.lastVerifiedAt && (
                            <Text as="span" variant="bodySm" tone="success">
                              上次验证: {new Date(config.lastVerifiedAt).toLocaleDateString("zh-CN")}
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                ) : (
                  <Text as="p" tone="subdued">
                    尚未配置任何平台
                  </Text>
                )}
              </BlockStack>
            </Card>

            {/* Server-side tracking info */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={SettingsIcon} tone="base" />
                    <Text as="h2" variant="headingMd">
                      服务端追踪
                    </Text>
                    <Badge tone="info">专业版</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    配置 Conversions API（CAPI）可将追踪准确率提高 15-30%，不受广告拦截器影响。
                  </Text>
                  <Button url="/app/settings">
                    配置服务端追踪
                  </Button>
                </BlockStack>
              </Card>
            </Box>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
