import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState } from "react";
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
  Divider,
  ProgressBar,
  Icon,
  DataTable,
  EmptyState,
  Spinner,
  Link,
  Tabs,
  TextField,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  SearchIcon,
  ArrowRightIcon,
  ClipboardIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking, getScanHistory, analyzeScriptContent, type ScriptAnalysisResult } from "../services/scanner.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ shop: null, latestScan: null, scanHistory: [] });
  }

  const latestScan = await prisma.scanReport.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const scanHistory = await getScanHistory(shop.id, 5);

  return json({
    shop: { id: shop.id, domain: shopDomain },
    latestScan,
    scanHistory,
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
  const actionType = formData.get("_action");

  // P2-1: Handle manual script analysis
  if (actionType === "analyzeScript") {
    const scriptContent = formData.get("scriptContent") as string;
    
    if (!scriptContent || scriptContent.trim().length === 0) {
      return json({ error: "请粘贴要分析的脚本内容" }, { status: 400 });
    }

    try {
      const analysisResult = analyzeScriptContent(scriptContent);
      return json({ 
        success: true, 
        actionType: "analyzeScript",
        analysisResult 
      });
    } catch (error) {
      console.error("Script analysis error:", error);
      return json(
        { error: error instanceof Error ? error.message : "分析失败" },
        { status: 500 }
      );
    }
  }

  // Default: Full shop scan
  try {
    const scanResult = await scanShopTracking(admin, shop.id);
    return json({ success: true, actionType: "scan", result: scanResult });
  } catch (error) {
    console.error("Scan error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 }
    );
  }
};

export default function ScanPage() {
  const { shop, latestScan, scanHistory } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedTab, setSelectedTab] = useState(0);
  const [scriptContent, setScriptContent] = useState("");

  const isScanning = navigation.state === "submitting";

  const handleScan = () => {
    const formData = new FormData();
    formData.append("_action", "scan");
    submit(formData, { method: "post" });
  };

  const handleAnalyzeScript = () => {
    const formData = new FormData();
    formData.append("_action", "analyzeScript");
    formData.append("scriptContent", scriptContent);
    submit(formData, { method: "post" });
  };

  // Get analysis result from action data
  const analysisResult = actionData && "analysisResult" in actionData 
    ? actionData.analysisResult as ScriptAnalysisResult
    : null;

  const tabs = [
    { id: "auto-scan", content: "自动扫描" },
    { id: "manual-analyze", content: "手动分析" },
  ];

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "high":
        return <Badge tone="critical">高风险</Badge>;
      case "medium":
        return <Badge tone="warning">中风险</Badge>;
      case "low":
        return <Badge tone="info">低风险</Badge>;
      default:
        return <Badge>未知</Badge>;
    }
  };

  const getPlatformName = (platform: string) => {
    const names: Record<string, string> = {
      google: "Google Ads / GA4",
      meta: "Meta (Facebook) Pixel",
      tiktok: "TikTok Pixel",
      bing: "Microsoft Ads (Bing)",
      clarity: "Microsoft Clarity",
      pinterest: "Pinterest Tag",
      snapchat: "Snapchat Pixel",
      twitter: "Twitter/X Pixel",
    };
    return names[platform] || platform;
  };

  const riskItems = (latestScan?.riskItems as any[]) || [];
  const identifiedPlatforms = (latestScan?.identifiedPlatforms as string[]) || [];

  return (
    <Page
      title="追踪脚本扫描"
      subtitle="扫描店铺中的追踪脚本，识别迁移风险"
    >
      <BlockStack gap="500">
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {/* Auto Scan Tab */}
          {selectedTab === 0 && (
            <BlockStack gap="500">
              <Box paddingBlockStart="400">
                <InlineStack align="end">
                  <Button
                    variant="primary"
                    onClick={handleScan}
                    loading={isScanning}
                    icon={SearchIcon}
                  >
                    {isScanning ? "扫描中..." : "开始扫描"}
                  </Button>
                </InlineStack>
              </Box>

              {/* Scanning Progress */}
              {isScanning && (
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="200" align="center">
                      <Spinner size="small" />
                      <Text as="p">正在扫描店铺追踪配置...</Text>
                    </InlineStack>
                    <ProgressBar progress={75} tone="primary" />
                  </BlockStack>
                </Card>
              )}

              {/* No Scan Yet - Empty State with primary CTA */}
              {!latestScan && !isScanning && (
                <Card>
                  <EmptyState
                    heading="还没有扫描报告"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={{
                      content: "开始扫描",
                      onAction: handleScan,
                      loading: isScanning,
                    }}
                  >
                    <BlockStack gap="300">
                      <Text as="p">
                        点击开始扫描，我们会自动检测 <strong>ScriptTags</strong> 和已安装的像素配置，并给出风险等级与迁移建议。
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        预计耗时约 10 秒，不会修改任何设置
                      </Text>
                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="p">
                            <strong>关于 Additional Scripts：</strong>Shopify API 无法自动读取 checkout.liquid 中的 Additional Scripts。
                            请切换到「手动分析」标签页，粘贴脚本内容进行分析。
                          </Text>
                        </BlockStack>
                      </Banner>
                      <Link
                        url="https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status"
                        external
                      >
                        了解为何需要迁移（Checkout Extensibility）
                      </Link>
                    </BlockStack>
                  </EmptyState>
                </Card>
              )}

        {/* Latest Scan Results */}
        {latestScan && !isScanning && (
          <Layout>
            {/* Risk Score Overview */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    风险评分
                  </Text>
                  <Box
                    background={
                      latestScan.riskScore > 60
                        ? "bg-fill-critical"
                        : latestScan.riskScore > 30
                          ? "bg-fill-warning"
                          : "bg-fill-success"
                    }
                    padding="600"
                    borderRadius="200"
                  >
                    <BlockStack gap="200" align="center">
                      <Text
                        as="p"
                        variant="heading3xl"
                        fontWeight="bold"
                      >
                        {latestScan.riskScore}
                      </Text>
                      <Text as="p" variant="bodySm">
                        / 100
                      </Text>
                    </BlockStack>
                  </Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    扫描时间:{" "}
                    {new Date(latestScan.createdAt).toLocaleString("zh-CN")}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Identified Platforms */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    检测到的平台
                  </Text>
                  {identifiedPlatforms.length > 0 ? (
                    <BlockStack gap="200">
                      {identifiedPlatforms.map((platform) => (
                        <InlineStack key={platform} gap="200" align="start">
                          <Icon source={CheckCircleIcon} tone="success" />
                          <Text as="span">{getPlatformName(platform)}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  ) : (
                    <Text as="p" tone="subdued">
                      未检测到追踪平台
                    </Text>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Script Tags Count */}
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    ScriptTags
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span">已安装数量</Text>
                      <Text as="span" fontWeight="semibold">
                        {(latestScan.scriptTags as any[])?.length || 0}
                      </Text>
                    </InlineStack>
                    {((latestScan.scriptTags as any[])?.length || 0) > 0 && (
                      <Banner tone="warning">
                        <p>ScriptTags 即将被弃用，建议迁移到 Web Pixels</p>
                      </Banner>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        {/* Risk Items Detail */}
        {latestScan && riskItems.length > 0 && !isScanning && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                风险详情
              </Text>
              <BlockStack gap="300">
                {riskItems.map((item, index) => (
                  <Box
                    key={index}
                    background="bg-surface-secondary"
                    padding="400"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <InlineStack gap="200">
                          <Icon
                            source={AlertCircleIcon}
                            tone={
                              item.severity === "high"
                                ? "critical"
                                : item.severity === "medium"
                                  ? "warning"
                                  : "info"
                            }
                          />
                          <Text as="span" fontWeight="semibold">
                            {item.name}
                          </Text>
                        </InlineStack>
                        {getSeverityBadge(item.severity)}
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        {item.description}
                      </Text>
                      {item.details && (
                        <Text as="p" variant="bodySm">
                          {item.details}
                        </Text>
                      )}
                      {/* Impact and Action Row */}
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200">
                          {item.platform && (
                            <Badge>{getPlatformName(item.platform)}</Badge>
                          )}
                          {item.impact && (
                            <Text as="span" variant="bodySm" tone="critical">
                              影响: {item.impact}
                            </Text>
                          )}
                        </InlineStack>
                        <Button
                          url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`}
                          size="slim"
                          icon={ArrowRightIcon}
                        >
                          一键迁移
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* Scan History */}
        {scanHistory.length > 1 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                扫描历史
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text"]}
                headings={["扫描时间", "风险分", "检测平台", "状态"]}
                rows={scanHistory.filter((scan): scan is NonNullable<typeof scan> => scan !== null).map((scan) => [
                  new Date(scan.createdAt).toLocaleString("zh-CN"),
                  String(scan.riskScore),
                  ((scan.identifiedPlatforms as string[]) || []).join(", ") || "-",
                  scan.status === "completed" ? "完成" : scan.status,
                ])}
              />
            </BlockStack>
          </Card>
        )}

              {/* Migration CTA */}
              {latestScan && latestScan.riskScore > 0 && (
                <Banner
                  title="建议进行迁移"
                  tone="warning"
                  action={{ content: "前往迁移工具", url: "/app/migrate" }}
                >
                  <p>
                    检测到您的店铺存在需要迁移的追踪脚本。
                    建议使用我们的迁移工具将追踪代码更新为 Shopify Web Pixel 格式。
                  </p>
                </Banner>
              )}
            </BlockStack>
          )}

          {/* Manual Analysis Tab */}
          {selectedTab === 1 && (
            <BlockStack gap="500">
              <Box paddingBlockStart="400">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      手动分析 Additional Scripts
                    </Text>
                    <Text as="p" tone="subdued">
                      Shopify API 无法自动读取 Additional Scripts 内容。
                      请从 Shopify 后台复制脚本代码，粘贴到下方进行分析。
                    </Text>

                    <Banner tone="info">
                      <BlockStack gap="200">
                        <Text as="p" fontWeight="semibold">如何获取 Additional Scripts：</Text>
                        <Text as="p" variant="bodySm">
                          1. 前往 Shopify 后台 → 设置 → 结账
                          <br />2. 找到「订单状态页面」或「Additional Scripts」区域
                          <br />3. 复制其中的所有代码
                          <br />4. 粘贴到下方文本框中
                        </Text>
                      </BlockStack>
                    </Banner>

                    <TextField
                      label="粘贴脚本内容"
                      value={scriptContent}
                      onChange={setScriptContent}
                      multiline={8}
                      autoComplete="off"
                      placeholder={`<!-- 示例 -->
<script>
  gtag('event', 'purchase', {...});
  fbq('track', 'Purchase', {...});
</script>`}
                      helpText="支持检测 Google、Meta、TikTok、Bing 等平台的追踪代码"
                    />

                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        onClick={handleAnalyzeScript}
                        loading={isScanning}
                        disabled={!scriptContent.trim()}
                        icon={ClipboardIcon}
                      >
                        分析脚本
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Box>

              {/* Analysis Results */}
              {analysisResult && (
                <Layout>
                  {/* Risk Score */}
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                          风险评分
                        </Text>
                        <Box
                          background={
                            analysisResult.riskScore > 60
                              ? "bg-fill-critical"
                              : analysisResult.riskScore > 30
                                ? "bg-fill-warning"
                                : "bg-fill-success"
                          }
                          padding="600"
                          borderRadius="200"
                        >
                          <BlockStack gap="200" align="center">
                            <Text as="p" variant="heading3xl" fontWeight="bold">
                              {analysisResult.riskScore}
                            </Text>
                            <Text as="p" variant="bodySm">
                              / 100
                            </Text>
                          </BlockStack>
                        </Box>
                      </BlockStack>
                    </Card>
                  </Layout.Section>

                  {/* Detected Platforms */}
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                          检测到的平台
                        </Text>
                        {analysisResult.identifiedPlatforms.length > 0 ? (
                          <BlockStack gap="200">
                            {analysisResult.identifiedPlatforms.map((platform) => (
                              <InlineStack key={platform} gap="200" align="start">
                                <Icon source={CheckCircleIcon} tone="success" />
                                <Text as="span">{getPlatformName(platform)}</Text>
                              </InlineStack>
                            ))}
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">
                            未检测到已知追踪平台
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </Layout.Section>

                  {/* Platform Details */}
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                          检测详情
                        </Text>
                        {analysisResult.platformDetails.length > 0 ? (
                          <BlockStack gap="200">
                            {analysisResult.platformDetails.slice(0, 5).map((detail, idx) => (
                              <Box
                                key={idx}
                                background="bg-surface-secondary"
                                padding="200"
                                borderRadius="100"
                              >
                                <BlockStack gap="100">
                                  <InlineStack gap="200" align="space-between">
                                    <Text as="span" variant="bodySm" fontWeight="semibold">
                                      {detail.type}
                                    </Text>
                                    <Badge tone={detail.confidence === "high" ? "success" : "info"}>
                                      {detail.confidence === "high" ? "高可信度" : "中可信度"}
                                    </Badge>
                                  </InlineStack>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {detail.matchedPattern}
                                  </Text>
                                </BlockStack>
                              </Box>
                            ))}
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">
                            无检测详情
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                </Layout>
              )}

              {/* Risk Items */}
              {analysisResult && analysisResult.risks.length > 0 && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      风险详情
                    </Text>
                    <BlockStack gap="300">
                      {analysisResult.risks.map((risk, index) => (
                        <Box
                          key={index}
                          background="bg-surface-secondary"
                          padding="400"
                          borderRadius="200"
                        >
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <InlineStack gap="200">
                                <Icon
                                  source={AlertCircleIcon}
                                  tone={
                                    risk.severity === "high"
                                      ? "critical"
                                      : risk.severity === "medium"
                                        ? "warning"
                                        : "info"
                                  }
                                />
                                <Text as="span" fontWeight="semibold">
                                  {risk.name}
                                </Text>
                              </InlineStack>
                              {getSeverityBadge(risk.severity)}
                            </InlineStack>
                            <Text as="p" tone="subdued">
                              {risk.description}
                            </Text>
                            {risk.details && (
                              <Text as="p" variant="bodySm">
                                {risk.details}
                              </Text>
                            )}
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}

              {/* Recommendations */}
              {analysisResult && analysisResult.recommendations.length > 0 && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      迁移建议
                    </Text>
                    <BlockStack gap="200">
                      {analysisResult.recommendations.map((rec, index) => (
                        <InlineStack key={index} gap="200" align="start">
                          <Icon source={ArrowRightIcon} tone="success" />
                          <Text as="p">{rec}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                    <Divider />
                    <Button url="/app/migrate" variant="primary">
                      前往迁移工具
                    </Button>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          )}
        </Tabs>
      </BlockStack>
    </Page>
  );
}

