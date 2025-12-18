import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
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
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  SearchIcon,
  ArrowRightIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking, getScanHistory } from "../services/scanner.server";

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

  try {
    const scanResult = await scanShopTracking(admin, shop.id);
    return json({ success: true, result: scanResult });
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
  const submit = useSubmit();
  const navigation = useNavigation();

  const isScanning = navigation.state === "submitting";

  const handleScan = () => {
    submit({}, { method: "post" });
  };

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
      primaryAction={{
        content: isScanning ? "扫描中..." : "开始扫描",
        onAction: handleScan,
        loading: isScanning,
        icon: SearchIcon,
      }}
    >
      <BlockStack gap="500">
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
                  点击开始扫描，我们会检测附加脚本（Additional Scripts）、ScriptTags、Web Pixels 配置、Customer Events，并给出风险等级与迁移建议。
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  预计耗时约 10 秒，不会修改任何设置
                </Text>
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
    </Page>
  );
}

