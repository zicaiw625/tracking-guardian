import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  DataTable,
  Select,
  ProgressBar,
  Button,
  Icon,
  Link,
} from "@shopify/polaris";
import {
  SettingsIcon,
  SearchIcon,
  RefreshIcon,
  ArrowRightIcon,
} from "@shopify/polaris-icons";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getReconciliationHistory,
  getReconciliationSummary,
} from "../services/reconciliation.server";
import type { ReconciliationSummary, ReconciliationReportData, Platform } from "../types";
import { PLATFORM_NAMES } from "../types";

interface ConversionStat {
  platform: string;
  status: string;
  _count: number;
  _sum: {
    orderValue: number | null;
  };
}

interface ProcessedStat {
  total: number;
  sent: number;
  failed: number;
  revenue: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ shop: null, summary: {}, history: [], conversionStats: null });
  }

  const summary = await getReconciliationSummary(shop.id);
  const history = await getReconciliationHistory(shop.id, 30);

  // Get conversion stats for the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const conversionStats = await prisma.conversionLog.groupBy({
    by: ["platform", "status"],
    where: {
      shopId: shop.id,
      createdAt: { gte: sevenDaysAgo },
    },
    _count: true,
    _sum: { orderValue: true },
  });

  return json({
    shop: { id: shop.id, domain: shopDomain },
    summary,
    history,
    conversionStats,
  });
};

// PLATFORM_NAMES imported from types

export default function MonitorPage() {
  const { shop, summary, history, conversionStats } =
    useLoaderData<typeof loader>();
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");

  // Cast summary to proper type and handle serialization
  const summaryData = summary as unknown as Record<string, ReconciliationSummary>;
  const historyData = (history as unknown as ReconciliationReportData[]).map((h) => ({
    ...h,
    reportDate: new Date(h.reportDate),
  }));
  const statsData = conversionStats as ConversionStat[] | null;

  // Calculate overall health score - return null if no data to show "uninitialized"
  const calculateHealthScore = (): number | null => {
    const platforms = Object.keys(summaryData);
    if (platforms.length === 0) return null; // Return null instead of 100 when no data

    const avgDiscrepancy =
      platforms.reduce(
        (sum, p) => sum + (summaryData[p]?.avgDiscrepancy || 0),
        0
      ) / platforms.length;

    if (avgDiscrepancy > 0.2) return 40;
    if (avgDiscrepancy > 0.1) return 70;
    if (avgDiscrepancy > 0.05) return 85;
    return 95;
  };

  const healthScore = calculateHealthScore();
  const hasData = Object.keys(summaryData).length > 0;

  // Filter history by platform
  const filteredHistory =
    selectedPlatform === "all"
      ? historyData
      : historyData.filter((h) => h.platform === selectedPlatform);

  // Process conversion stats for display
  const processedStats = statsData?.reduce<Record<string, ProcessedStat>>(
    (acc, stat) => {
      if (!acc[stat.platform]) {
        acc[stat.platform] = { total: 0, sent: 0, failed: 0, revenue: 0 };
      }
      acc[stat.platform].total += stat._count;
      if (stat.status === "sent") {
        acc[stat.platform].sent += stat._count;
        acc[stat.platform].revenue += Number(stat._sum?.orderValue || 0);
      } else if (stat.status === "failed") {
        acc[stat.platform].failed += stat._count;
      }
      return acc;
    },
    {}
  );

  const platformOptions = [
    { label: "所有平台", value: "all" },
    ...Object.keys(summaryData).map((p) => ({
      label: PLATFORM_NAMES[p] || p,
      value: p,
    })),
  ];

  return (
    <Page
      title="监控面板"
      subtitle="追踪健康状况和转化发送成功率报告"
      primaryAction={{
        content: "配置追踪平台",
        url: "/app/migrate",
      }}
    >
      <BlockStack gap="500">
        {/* Empty State - Show when no data */}
        {!hasData && (
          <Card>
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    还没开始监控
                  </Text>
                  <Text as="p" tone="subdued">
                    连接平台后，我们会基于服务端转化发送日志计算发送成功率，帮助您发现追踪问题。
                  </Text>
                </BlockStack>
                <Badge tone="info">未初始化</Badge>
              </InlineStack>

              <Box
                background="bg-surface-secondary"
                padding="600"
                borderRadius="200"
              >
                <BlockStack gap="200" align="center">
                  <Text as="p" variant="headingLg" fontWeight="semibold" tone="subdued">
                    健康度评分
                  </Text>
                  <Text as="p" variant="heading2xl" fontWeight="bold" tone="subdued">
                    --
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    完成平台连接并产生订单数据后开始评分
                  </Text>
                </BlockStack>
              </Box>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  开始监控
                </Text>
                <InlineStack gap="300">
                  <Button url="/app/migrate" variant="primary">
                    配置追踪平台
                  </Button>
                  <Button url="/app/settings">
                    配置告警通知
                  </Button>
                </InlineStack>
              </BlockStack>

              <Text as="p" variant="bodySm" tone="subdued">
                <Link
                  url="https://help.shopify.com/en/manual/promoting-marketing/pixels"
                  external
                >
                  了解 Pixels 和 Customer Events
                </Link>
              </Text>
            </BlockStack>
          </Card>
        )}

        {/* Health Overview - Only show when has data */}
        {hasData && (
          <Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      整体健康度
                    </Text>
                    <Badge
                      tone={
                        healthScore !== null && healthScore > 80
                          ? "success"
                          : healthScore !== null && healthScore > 60
                            ? "attention"
                            : "critical"
                      }
                    >
                      {healthScore !== null && healthScore > 80
                        ? "健康"
                        : healthScore !== null && healthScore > 60
                          ? "有风险"
                          : "需要关注"}
                    </Badge>
                  </InlineStack>
                  <Box
                    background={
                      healthScore !== null && healthScore > 80
                        ? "bg-fill-success"
                        : healthScore !== null && healthScore > 60
                          ? "bg-fill-warning"
                          : "bg-fill-critical"
                    }
                    padding="600"
                    borderRadius="200"
                  >
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="heading3xl" fontWeight="bold">
                        {healthScore ?? "--"}
                      </Text>
                      <Text as="p" variant="bodySm">
                        / 100
                      </Text>
                    </BlockStack>
                  </Box>
                  <ProgressBar
                    progress={healthScore ?? 0}
                    tone={
                      healthScore !== null && healthScore > 80
                        ? "success"
                        : healthScore !== null && healthScore > 60
                          ? "highlight"
                          : "critical"
                    }
                  />
                  <Text as="p" variant="bodySm" tone="subdued">
                    评分依据：过去 7 天发送成功率
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Platform Summary Cards */}
            {Object.entries(summaryData).map(([platform, data]) => (
              <Layout.Section key={platform} variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">
                        {PLATFORM_NAMES[platform] || platform}
                      </Text>
                      <Badge
                        tone={
                          data.avgDiscrepancy < 0.1
                            ? "success"
                            : data.avgDiscrepancy < 0.2
                              ? "attention"
                              : "critical"
                        }
                      >
                        {`${(data.avgDiscrepancy * 100).toFixed(1)}% 差异`}
                      </Badge>
                    </InlineStack>
                    <Divider />
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">
                        待发送转化
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {data.totalShopifyOrders}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">
                        成功发送
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {data.totalPlatformConversions}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            ))}
          </Layout>
        )}

        {/* Conversion Stats */}
        {processedStats && Object.keys(processedStats).length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                过去 7 天转化发送统计
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
                headings={["平台", "总转化", "成功发送", "发送失败", "发送成功率"]}
                rows={Object.entries(processedStats).map(
                  ([platform, stats]) => [
                    PLATFORM_NAMES[platform] || platform,
                    stats.total,
                    stats.sent,
                    stats.failed,
                    stats.total > 0
                      ? `${((stats.sent / stats.total) * 100).toFixed(1)}%`
                      : "-",
                  ]
                )}
              />
            </BlockStack>
          </Card>
        )}

        {/* Historical Reports */}
        {historyData.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  发送日志核对记录
                </Text>
                <Select
                  label=""
                  labelHidden
                  options={platformOptions}
                  value={selectedPlatform}
                  onChange={setSelectedPlatform}
                />
              </InlineStack>
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                  "text",
                ]}
                headings={[
                  "日期",
                  "平台",
                  "待发送",
                  "成功发送",
                  "失败率",
                  "状态",
                ]}
                rows={filteredHistory.slice(0, 20).map((report) => [
                  new Date(report.reportDate).toLocaleDateString("zh-CN"),
                  PLATFORM_NAMES[report.platform] || report.platform,
                  report.shopifyOrders,
                  report.platformConversions,
                  `${(report.orderDiscrepancy * 100).toFixed(1)}%`,
                  report.alertSent ? "⚠️ 已报警" : "✓ 正常",
                ])}
              />
            </BlockStack>
          </Card>
        )}

        {/* Actionable Tips */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              提高追踪准确性的建议
            </Text>
            <BlockStack gap="300">
              {/* Tip 1: Server-side tracking */}
              <Box
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SettingsIcon} tone="base" />
                      <Text as="span" fontWeight="semibold">
                        启用服务端追踪
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      配置 Conversions API（CAPI）可将追踪准确率提高 15-30%，不受广告拦截器影响
                    </Text>
                  </BlockStack>
                  <Button url="/app/settings" size="slim" icon={ArrowRightIcon}>
                    配置
                  </Button>
                </InlineStack>
              </Box>

              {/* Tip 2: Check Web Pixel */}
              <Box
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SearchIcon} tone="base" />
                      <Text as="span" fontWeight="semibold">
                        检查 Web Pixel 配置
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      确保 Web Pixel 代码在所有页面正常加载，验证事件是否正确触发
                    </Text>
                  </BlockStack>
                  <Button url="/app/migrate" size="slim" icon={ArrowRightIcon}>
                    验证
                  </Button>
                </InlineStack>
              </Box>

              {/* Tip 3: Regular scan */}
              <Box
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={RefreshIcon} tone="base" />
                      <Text as="span" fontWeight="semibold">
                        定期扫描追踪脚本
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      建议每月进行一次扫描，确保追踪配置最新，及时发现问题
                    </Text>
                  </BlockStack>
                  <Button url="/app/scan" size="slim" icon={ArrowRightIcon}>
                    扫描
                  </Button>
                </InlineStack>
              </Box>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

