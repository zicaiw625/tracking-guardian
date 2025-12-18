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
  EmptyState,
  ProgressBar,
  Banner,
} from "@shopify/polaris";
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

  // Calculate overall health score
  const calculateHealthScore = (): number => {
    const platforms = Object.keys(summaryData);
    if (platforms.length === 0) return 100;

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
    <Page title="监控面板" subtitle="追踪健康状况和转化对账报告">
      <BlockStack gap="500">
        {/* Health Overview */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  整体健康度
                </Text>
                <Box
                  background={
                    healthScore > 80
                      ? "bg-fill-success"
                      : healthScore > 60
                        ? "bg-fill-warning"
                        : "bg-fill-critical"
                  }
                  padding="600"
                  borderRadius="200"
                >
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading3xl" fontWeight="bold">
                      {healthScore}
                    </Text>
                    <Text as="p" variant="bodySm">
                      / 100
                    </Text>
                  </BlockStack>
                </Box>
                <ProgressBar
                  progress={healthScore}
                  tone={
                    healthScore > 80
                      ? "success"
                      : healthScore > 60
                        ? "highlight"
                        : "critical"
                  }
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  基于过去 7 天的对账数据
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
                      Shopify 订单
                    </Text>
                    <Text as="span" fontWeight="semibold">
                      {data.totalShopifyOrders}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      平台转化
                    </Text>
                    <Text as="span" fontWeight="semibold">
                      {data.totalPlatformConversions}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          ))}

          {Object.keys(summaryData).length === 0 && (
            <Layout.Section>
              <Card>
                <EmptyState
                  heading="暂无监控数据"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{
                    content: "配置追踪平台",
                    url: "/app/migrate",
                  }}
                >
                  <p>配置追踪平台后，我们将自动收集转化数据并生成对账报告。</p>
                </EmptyState>
              </Card>
            </Layout.Section>
          )}
        </Layout>

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
                  历史对账报告
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
                  "Shopify 订单",
                  "平台转化",
                  "差异率",
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

        {/* Tips Banner */}
        <Banner title="提高追踪准确性的建议" tone="info">
          <BlockStack gap="200">
            <Text as="p">
              <strong>1. 启用服务端追踪：</strong>
              配置 Conversion API 可将追踪准确率提高 15-30%
            </Text>
            <Text as="p">
              <strong>2. 检查 Web Pixel：</strong>
              确保 Web Pixel 代码在所有页面正常加载
            </Text>
            <Text as="p">
              <strong>3. 定期扫描：</strong>
              建议每月进行一次扫描，确保追踪配置最新
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}

