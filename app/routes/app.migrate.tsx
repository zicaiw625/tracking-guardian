import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState, useCallback } from "react";
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
  Modal,
  Tabs,
  EmptyState,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ClipboardIcon,
  CodeIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  generatePixelCode,
  savePixelConfig,
  getPixelConfigs,
  type Platform,
  type MigrationResult,
} from "../services/migration.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
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

  if (action === "generate") {
    const platform = formData.get("platform") as Platform;
    const platformId = formData.get("platformId") as string;
    const conversionId = formData.get("conversionId") as string;
    const conversionLabel = formData.get("conversionLabel") as string;

    if (!platform || !platformId) {
      return json({ error: "Platform and ID are required" }, { status: 400 });
    }

    const additionalConfig: Record<string, string> = {};
    if (conversionId) additionalConfig.conversionId = conversionId;
    if (conversionLabel) additionalConfig.conversionLabel = conversionLabel;

    const result = generatePixelCode({
      platform,
      platformId,
      additionalConfig,
    });

    if (result.success) {
      // Save the config
      await savePixelConfig(shop.id, platform, platformId, additionalConfig);
    }

    return json({ result });
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

export default function MigratePage() {
  const { shop, pixelConfigs, latestScan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("google");
  const [platformId, setPlatformId] = useState("");
  const [conversionId, setConversionId] = useState("");
  const [conversionLabel, setConversionLabel] = useState("");
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const isGenerating = navigation.state === "submitting";

  const handleGenerate = () => {
    const formData = new FormData();
    formData.append("_action", "generate");
    formData.append("platform", selectedPlatform);
    formData.append("platformId", platformId);
    if (conversionId) formData.append("conversionId", conversionId);
    if (conversionLabel) formData.append("conversionLabel", conversionLabel);
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

  return (
    <Page
      title="迁移工具"
      subtitle="将旧的追踪脚本迁移到 Shopify Web Pixel"
    >
      <BlockStack gap="500">
        {/* Info Banner */}
        <Banner title="为什么需要迁移？" tone="info">
          <BlockStack gap="200">
            <Text as="p">
              Shopify 正在逐步淘汰旧的追踪方式（ScriptTags 和 Additional Scripts），
              建议使用新的 Web Pixel API 来实现追踪功能。
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Web Pixel 提供更好的性能、隐私合规性和与 Shopify 结账流程的原生集成。
            </Text>
          </BlockStack>
        </Banner>

        {/* Detected Platforms from Scan */}
        {identifiedPlatforms.length > 0 && (
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
                这些平台可能需要迁移到 Web Pixel 格式
              </Text>
            </BlockStack>
          </Card>
        )}

        <Layout>
          {/* Migration Form */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  生成 Web Pixel 代码
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

                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  loading={isGenerating}
                  disabled={!platformId}
                >
                  生成 Web Pixel 代码
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Configured Platforms */}
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
                        <InlineStack align="space-between">
                          <BlockStack gap="100">
                            <Text as="span" fontWeight="semibold">
                              {PLATFORMS.find((p) => p.value === config.platform)
                                ?.label || config.platform}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {config.platformId}
                            </Text>
                          </BlockStack>
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
          </Layout.Section>
        </Layout>

        {/* Generated Code Result */}
        {(() => {
          const data = actionData as { result?: MigrationResult } | undefined;
          if (!data?.result) return null;
          const result = data.result;
          return (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    生成的 Web Pixel 代码
                  </Text>
                  <Button
                    onClick={handleCopyCode}
                    icon={copied ? CheckCircleIcon : ClipboardIcon}
                  >
                    {copied ? "已复制" : "复制代码"}
                  </Button>
                </InlineStack>

                {result.success ? (
                  <BlockStack gap="400">
                    <Box
                      background="bg-surface-secondary"
                      padding="400"
                      borderRadius="200"
                    >
                      <pre
                        style={{
                          overflow: "auto",
                          maxHeight: "400px",
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
                      <p>
                        在 Shopify 后台，前往 Settings {'>'} Customer events {'>'} Add custom pixel
                        来创建新的 Web Pixel。
                      </p>
                    </Banner>
                  </BlockStack>
                ) : (
                  <Banner tone="critical">
                    <p>生成失败: {result.error}</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          );
        })()}

        {/* Server-side tracking info */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              服务端转化追踪（推荐）
            </Text>
            <Text as="p">
              除了客户端 Web Pixel，我们还支持服务端转化 API 集成。
              这可以显著提高追踪准确性（通常提升 15-30%），
              不受广告拦截器和浏览器隐私限制的影响。
            </Text>
            <Button url="/app/settings" variant="plain">
              前往设置配置服务端追踪 →
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

