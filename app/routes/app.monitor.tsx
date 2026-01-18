import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  DataTable,
} from "@shopify/polaris";
import { RefreshIcon } from "~/components/icons";
import { EnhancedEmptyState, useToastContext } from "~/components/ui";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runAlertChecks } from "../services/alert-dispatcher.server";
import { getReconciliationDashboardData } from "../services/reconciliation.server";
import { getDeliveryHealthSummary } from "../services/delivery-health.server";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "../services/monitoring.server";
import { getEventLossStats } from "../services/pixel-event-loss.server";
import { logger } from "../utils/logger.server";

interface LoaderData {
  alerts: Array<{
    triggered: boolean;
    severity: "low" | "medium" | "high";
    message: string;
    details?: Record<string, unknown>;
  }>;
  reconciliation: {
    last7Days: Array<{
      platform: string;
      shopifyOrders: number;
      platformConversions: number;
      orderDiscrepancy: number;
      revenueDiscrepancy: number;
    }>;
    summary: {
      totalOrders: number;
      totalConversions: number;
      avgDiscrepancy: number;
    };
  };
  health: Record<string, {
    platform: string;
    last7DaysAttempted: number;
    last7DaysSent: number;
    avgSuccessRate: number;
    topFailureReasons: Array<{ reason: string; count: number }>;
  }>;
  monitoring: {
    successRate: number;
    failureRate: number;
    totalEvents: number;
    missingParamsRate: number;
  };
  volume: {
    current: number;
    previous: number;
    changePercent: number;
  };
  extensionErrors: {
    last24h: number;
    byExtension: Array<{ extension: string; count: number }>;
    byEndpoint: Array<{ endpoint: string; count: number }>;
  };
  eventLoss: {
    totalAttempted: number;
    totalReceived: number;
    totalLost: number;
    lossRate: number;
    byFailureReason: Record<string, number>;
    byPlatform: Record<string, {
      attempted: number;
      received: number;
      lost: number;
      lossRate: number;
    }>;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json<LoaderData>({
      alerts: [],
      reconciliation: { last7Days: [], summary: { totalOrders: 0, totalConversions: 0, avgDiscrepancy: 0 } },
      health: {},
      monitoring: { successRate: 0, failureRate: 0, totalEvents: 0, missingParamsRate: 0 },
      volume: { current: 0, previous: 0, changePercent: 0 },
      extensionErrors: { last24h: 0, byExtension: [], byEndpoint: [] },
      eventLoss: { totalAttempted: 0, totalReceived: 0, totalLost: 0, lossRate: 0, byFailureReason: {}, byPlatform: {} },
    });
  }
  let alerts: LoaderData["alerts"] = [];
  try {
    const alertResults = await runAlertChecks(shop.id);
    alerts = alertResults.filter(r => r.triggered).map(r => ({
      triggered: r.triggered,
      severity: r.severity,
      message: r.message,
      details: r.details,
    }));
  } catch (error) {
    logger.error("Failed to get alerts", { shopId: shop.id, error });
  }
  let reconciliation: LoaderData["reconciliation"] = {
    last7Days: [],
    summary: { totalOrders: 0, totalConversions: 0, avgDiscrepancy: 0 },
  };
  try {
    const reconData = await getReconciliationDashboardData(shop.id, 7);
    const ov = reconData.overview;
    reconciliation = {
      last7Days: reconData.platformBreakdown.map((p) => ({
        platform: p.platform,
        shopifyOrders: p.webhookOrders,
        platformConversions: p.pixelReceipts,
        orderDiscrepancy: p.gapPercentage,
        revenueDiscrepancy: p.gapPercentage,
      })),
      summary: {
        totalOrders: ov.totalWebhookOrders || ov.totalPixelReceipts,
        totalConversions: ov.totalSentToPlatforms,
        avgDiscrepancy: ov.gapPercentage,
      },
    };
  } catch (error) {
    logger.error("Failed to get reconciliation data", { shopId: shop.id, error });
  }
  let health: LoaderData["health"] = {};
  try {
    health = await getDeliveryHealthSummary(shop.id);
  } catch (error) {
    logger.error("Failed to get delivery health", { shopId: shop.id, error });
  }
  let monitoring: LoaderData["monitoring"] = {
    successRate: 0,
    failureRate: 0,
    totalEvents: 0,
    missingParamsRate: 0,
  };
  try {
    const monitoringStats = await getEventMonitoringStats(shop.id, 24);
    const missingStats = await getMissingParamsStats(shop.id, 24);
    monitoring = {
      successRate: monitoringStats.successRate || 0,
      failureRate: monitoringStats.failureRate || 0,
      totalEvents: monitoringStats.totalEvents || 0,
      missingParamsRate: missingStats.missingParamsRate || 0,
    };
  } catch (error) {
    logger.error("Failed to get monitoring stats", { shopId: shop.id, error });
  }
  let volume: LoaderData["volume"] = { current: 0, previous: 0, changePercent: 0 };
  try {
    const volumeStats = await getEventVolumeStats(shop.id);
    volume = {
      current: volumeStats.current || 0,
      previous: volumeStats.previous || 0,
      changePercent: volumeStats.changePercent || 0,
    };
  } catch (error) {
    logger.error("Failed to get volume stats", { shopId: shop.id, error });
  }
  let extensionErrors: LoaderData["extensionErrors"] = {
    last24h: 0,
    byExtension: [],
    byEndpoint: [],
  };
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const errors = await prisma.extensionError.findMany({
      where: {
        shopId: shop.id,
        createdAt: {
          gte: since,
        },
      },
      select: {
        extension: true,
        endpoint: true,
      },
    });
    const byExtensionMap = new Map<string, number>();
    const byEndpointMap = new Map<string, number>();
    errors.forEach((error) => {
      byExtensionMap.set(error.extension, (byExtensionMap.get(error.extension) || 0) + 1);
      byEndpointMap.set(error.endpoint, (byEndpointMap.get(error.endpoint) || 0) + 1);
    });
    extensionErrors = {
      last24h: errors.length,
      byExtension: Array.from(byExtensionMap.entries())
        .map(([extension, count]) => ({ extension, count }))
        .sort((a, b) => b.count - a.count),
      byEndpoint: Array.from(byEndpointMap.entries())
        .map(([endpoint, count]) => ({ endpoint, count }))
        .sort((a, b) => b.count - a.count),
    };
  } catch (error) {
    logger.error("Failed to get extension errors", { shopId: shop.id, error });
  }
  let eventLoss = {
    totalAttempted: 0,
    totalReceived: 0,
    totalLost: 0,
    lossRate: 0,
    byFailureReason: {} as Record<string, number>,
    byPlatform: {} as Record<string, { attempted: number; received: number; lost: number; lossRate: number }>,
  };
  try {
    eventLoss = await getEventLossStats(shop.id, 24);
  } catch (error) {
    logger.error("Failed to get event loss stats", { shopId: shop.id, error });
  }
  return json<LoaderData>({
    alerts,
    reconciliation,
    health,
    monitoring,
    volume,
    extensionErrors,
    eventLoss,
  });
};

export default function MonitorPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const { showSuccess } = useToastContext();
  const handleRefresh = () => {
    revalidator.revalidate();
    showSuccess("监控数据已刷新");
  };
  const getSeverityBadge = (severity: "low" | "medium" | "high") => {
    switch (severity) {
      case "high":
        return <Badge tone="critical">高</Badge>;
      case "medium":
        return <Badge tone="warning">中</Badge>;
      case "low":
        return <Badge tone="info">低</Badge>;
    }
  };
  return (
    <Page
      title="监控中心"
      subtitle="实时追踪系统健康状态、对账数据和告警信息"
      primaryAction={{
        content: "刷新",
        icon: RefreshIcon,
        onAction: handleRefresh,
        loading: revalidator.state === "loading",
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                活跃告警
              </Text>
              <Divider />
              {data.alerts.length === 0 ? (
                <Banner tone="success">
                  <Text as="p">当前没有活跃告警，系统运行正常。</Text>
                </Banner>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["严重程度", "告警类型", "详情"]}
                  rows={data.alerts.map((alert, index) => [
                    getSeverityBadge(alert.severity),
                    alert.message,
                    alert.details ? JSON.stringify(alert.details) : "-",
                  ])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                监控指标 (24小时)
              </Text>
              <Divider />
              <InlineStack gap="400" align="space-between">
                <Box minWidth="45%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      事件成功率
                    </Text>
                    <Text as="p" variant="headingLg" tone={data.monitoring.successRate >= 90 ? "success" : data.monitoring.successRate >= 70 ? "caution" : "critical"}>
                      {data.monitoring.successRate.toFixed(1)}%
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="45%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      事件失败率
                    </Text>
                    <Text as="p" variant="headingLg" tone={data.monitoring.failureRate <= 10 ? "success" : data.monitoring.failureRate <= 30 ? "caution" : "critical"}>
                      {data.monitoring.failureRate.toFixed(1)}%
                    </Text>
                  </BlockStack>
                </Box>
              </InlineStack>
              <Divider />
              <InlineStack gap="400" align="space-between">
                <Box minWidth="45%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      总事件数
                    </Text>
                    <Text as="p" variant="headingLg">
                      {data.monitoring.totalEvents}
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="45%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      缺失参数率
                    </Text>
                    <Text as="p" variant="headingLg" tone={data.monitoring.missingParamsRate <= 10 ? "success" : data.monitoring.missingParamsRate <= 30 ? "caution" : "critical"}>
                      {data.monitoring.missingParamsRate.toFixed(1)}%
                    </Text>
                  </BlockStack>
                </Box>
              </InlineStack>
              <Divider />
              <Box>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    事件量变化
                  </Text>
                  <Text as="p" variant="headingLg" tone={data.volume.changePercent >= 0 ? "success" : "critical"}>
                    {data.volume.changePercent >= 0 ? "+" : ""}{data.volume.changePercent.toFixed(1)}%
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    当前: {data.volume.current} | 之前: {data.volume.previous}
                  </Text>
                </BlockStack>
              </Box>
              <Divider />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Web Pixel 事件丢失率
                </Text>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        总尝试发送
                      </Text>
                      <Text as="span" variant="headingMd">
                        {data.eventLoss.totalAttempted}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        成功接收
                      </Text>
                      <Text as="span" variant="headingMd" tone="success">
                        {data.eventLoss.totalReceived}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        丢失事件
                      </Text>
                      <Text as="span" variant="headingMd" tone={data.eventLoss.lossRate <= 5 ? "success" : data.eventLoss.lossRate <= 15 ? "caution" : "critical"}>
                        {data.eventLoss.totalLost}
                      </Text>
                    </InlineStack>
                    <Divider />
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        丢失率
                      </Text>
                      <Text as="span" variant="headingLg" tone={data.eventLoss.lossRate <= 5 ? "success" : data.eventLoss.lossRate <= 15 ? "caution" : "critical"}>
                        {data.eventLoss.lossRate.toFixed(2)}%
                      </Text>
                    </InlineStack>
                    {data.eventLoss.lossRate > 5 && (
                      <Banner tone={data.eventLoss.lossRate > 15 ? "critical" : "warning"}>
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {data.eventLoss.lossRate > 15 ? "⚠️ 高丢失率警告" : "⚠️ 丢失率偏高"}
                          </Text>
                          <Text as="p" variant="bodySm">
                            事件丢失可能由以下原因导致：
                          </Text>
                          <List type="bullet">
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                网络连接问题（客户端到服务端）
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                Web Pixel strict sandbox 环境限制（如 keepalive 超时）
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                HMAC 签名验证失败
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                服务端速率限制或异常
                              </Text>
                            </List.Item>
                          </List>
                          {Object.keys(data.eventLoss.byFailureReason).length > 0 && (
                            <BlockStack gap="200">
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                主要失败原因：
                              </Text>
                              {Object.entries(data.eventLoss.byFailureReason)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 3)
                                .map(([reason, count]) => (
                                  <Text key={reason} as="p" variant="bodySm">
                                    • {reason}: {count} 次
                                  </Text>
                                ))}
                            </BlockStack>
                          )}
                        </BlockStack>
                      </Banner>
                    )}
                    {Object.keys(data.eventLoss.byPlatform).length > 0 && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          按平台统计：
                        </Text>
                        {Object.entries(data.eventLoss.byPlatform)
                          .sort(([, a], [, b]) => b.lossRate - a.lossRate)
                          .map(([platform, stats]) => (
                            <Box key={platform} padding="200" background="bg-surface" borderRadius="100">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  {platform}
                                </Text>
                                <InlineStack gap="300">
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    尝试: {stats.attempted} | 接收: {stats.received} | 丢失: {stats.lost}
                                  </Text>
                                  <Badge tone={stats.lossRate <= 5 ? "success" : stats.lossRate <= 15 ? "attention" : "critical"}>
                                    {stats.lossRate.toFixed(1)}%
                                  </Badge>
                                </InlineStack>
                              </InlineStack>
                            </Box>
                          ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                对账数据 (过去7天)
              </Text>
              <Divider />
              {data.reconciliation.last7Days.length === 0 ? (
                <EnhancedEmptyState
                  icon="📊"
                  title="暂无对账数据"
                  description="完成订单后，对账数据将显示在这里。"
                />
              ) : (
                <>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">汇总</Text>
                      <InlineStack gap="400">
                        <Box>
                          <Text as="p" variant="bodySm" tone="subdued">Shopify 订单数</Text>
                          <Text as="p" variant="headingMd">{data.reconciliation.summary.totalOrders}</Text>
                        </Box>
                        <Box>
                          <Text as="p" variant="bodySm" tone="subdued">平台转化数</Text>
                          <Text as="p" variant="headingMd">{data.reconciliation.summary.totalConversions}</Text>
                        </Box>
                        <Box>
                          <Text as="p" variant="bodySm" tone="subdued">平均差异率</Text>
                          <Text as="p" variant="headingMd" tone={data.reconciliation.summary.avgDiscrepancy <= 0.1 ? "success" : data.reconciliation.summary.avgDiscrepancy <= 0.2 ? "caution" : "critical"}>
                            {(data.reconciliation.summary.avgDiscrepancy * 100).toFixed(1)}%
                          </Text>
                        </Box>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                    headings={["平台", "Shopify 订单", "平台转化", "订单差异率", "收入差异率"]}
                    rows={data.reconciliation.last7Days.map((r) => [
                      r.platform,
                      r.shopifyOrders.toString(),
                      r.platformConversions.toString(),
                      `${(r.orderDiscrepancy * 100).toFixed(1)}%`,
                      `${(r.revenueDiscrepancy * 100).toFixed(1)}%`,
                    ])}
                  />
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                交付健康度 (过去7天)
              </Text>
              <Divider />
              {Object.keys(data.health).length === 0 ? (
                <EnhancedEmptyState
                  icon="💚"
                  title="暂无健康度数据"
                  description="配置平台凭证并发送事件后，健康度数据将显示在这里。"
                />
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
                  headings={["平台", "尝试发送", "成功发送", "成功率", "主要失败原因"]}
                  rows={Object.values(data.health).map((h) => [
                    h.platform,
                    h.last7DaysAttempted.toString(),
                    h.last7DaysSent.toString(),
                    `${(h.avgSuccessRate * 100).toFixed(1)}%`,
                    h.topFailureReasons.length > 0 ? h.topFailureReasons.map(r => `${r.reason}(${r.count})`).join(", ") : "-",
                  ])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Web Pixel 事件丢失率与发送失败率 (24小时)
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    监控 Web Pixel 在 strict sandbox 环境中的事件发送情况，包括事件丢失率和发送失败率统计。Web Pixel 在 strict sandbox（web worker）环境中运行，某些浏览器可能对 keepalive 和批量 flush 有不同行为，导致事件丢失。
                  </Text>
                </BlockStack>
                {data.eventLoss.lossRate > 5 && (
                  <Badge tone={data.eventLoss.lossRate > 15 ? "critical" : "warning"} size="large">
                    {data.eventLoss.lossRate > 15 ? "严重" : "警告"}
                  </Badge>
                )}
              </InlineStack>
              <Divider />
              <Box background={data.eventLoss.lossRate > 10 ? "bg-surface-critical" : data.eventLoss.lossRate > 5 ? "bg-surface-warning" : "bg-surface-secondary"} padding="500" borderRadius="300">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      总体统计
                    </Text>
                    <Badge tone={data.eventLoss.lossRate <= 5 ? "success" : data.eventLoss.lossRate <= 10 ? "warning" : "critical"} size="large">
                      {data.eventLoss.lossRate <= 5 ? "正常" : data.eventLoss.lossRate <= 10 ? "偏高" : "严重"}
                    </Badge>
                  </InlineStack>
                  <Divider />
                  <InlineStack gap="400" align="space-between" wrap>
                    <Box minWidth="45%">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          总尝试数
                        </Text>
                        <Text as="p" variant="headingLg">
                          {data.eventLoss.totalAttempted}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box minWidth="45%">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          已接收
                        </Text>
                        <Text as="p" variant="headingLg" tone="success">
                          {data.eventLoss.totalReceived}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box minWidth="45%">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          已丢失
                        </Text>
                        <Text as="p" variant="headingLg" tone={data.eventLoss.totalLost === 0 ? "success" : "critical"}>
                          {data.eventLoss.totalLost}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Box minWidth="45%">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                          丢失率（关键指标）
                        </Text>
                        <Text as="p" variant="headingXl" tone={data.eventLoss.lossRate <= 5 ? "success" : data.eventLoss.lossRate <= 10 ? "caution" : "critical"}>
                          {data.eventLoss.lossRate.toFixed(2)}%
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {data.eventLoss.lossRate <= 5 
                            ? "✅ 正常范围（≤5%）" 
                            : data.eventLoss.lossRate <= 10 
                            ? "⚠️ 偏高（5-10%）" 
                            : "❌ 严重（>10%）"}
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Box>
              <Banner tone={data.eventLoss.lossRate <= 5 ? "success" : data.eventLoss.lossRate <= 10 ? "warning" : "critical"}>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {data.eventLoss.lossRate <= 5 
                      ? "✅ 事件丢失率正常" 
                      : data.eventLoss.lossRate <= 10 
                      ? "⚠️ 事件丢失率偏高" 
                      : "❌ 事件丢失率严重"}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {data.eventLoss.lossRate <= 5 
                      ? "Web Pixel 事件发送正常，丢失率在可接受范围内（≤5%）。" 
                      : data.eventLoss.lossRate <= 10 
                      ? "检测到事件丢失率偏高（5-10%），建议检查网络连接和浏览器兼容性。Web Pixel 在 strict sandbox 环境中运行，某些浏览器可能对 keepalive 和批量 flush 有不同行为。" 
                      : "检测到严重的事件丢失（>10%），可能原因包括：网络不稳定、浏览器兼容性问题、strict sandbox 环境限制、keepalive 或批量 flush 失败。建议立即检查事件发送日志和浏览器控制台错误。"}
                  </Text>
                  {data.eventLoss.lossRate > 5 && (
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          检查浏览器控制台是否有网络错误或 CORS 错误
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          验证 Web Pixel 配置是否正确（ingestion key、后端 URL 等）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          检查网络连接稳定性，特别是在 checkout_completed 事件发送时
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          查看下方失败原因统计，定位具体问题
                        </Text>
                      </List.Item>
                    </List>
                  )}
                </BlockStack>
              </Banner>
              {Object.keys(data.eventLoss.byFailureReason).length > 0 && (
                <>
                  <Divider />
                  <Text as="h3" variant="headingSm">按失败原因分类</Text>
                  <DataTable
                    columnContentTypes={["text", "numeric"]}
                    headings={["失败原因", "次数"]}
                    rows={Object.entries(data.eventLoss.byFailureReason)
                      .sort(([, a], [, b]) => b - a)
                      .map(([reason, count]) => [reason, count.toString()])}
                  />
                </>
              )}
              {Object.keys(data.eventLoss.byPlatform).length > 0 && (
                <>
                  <Divider />
                  <Text as="h3" variant="headingSm">按平台分类</Text>
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                    headings={["平台", "尝试数", "接收数", "丢失数", "丢失率"]}
                    rows={Object.entries(data.eventLoss.byPlatform).map(([platform, stats]) => [
                      platform,
                      stats.attempted.toString(),
                      stats.received.toString(),
                      stats.lost.toString(),
                      `${stats.lossRate.toFixed(1)}%`,
                    ])}
                  />
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                扩展错误统计 (24小时)
              </Text>
              <Divider />
              {data.extensionErrors.last24h === 0 ? (
                <Banner tone="success">
                  <Text as="p">过去24小时内没有扩展错误报告，系统运行正常。</Text>
                </Banner>
              ) : (
                <>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">总错误数</Text>
                      <Text as="p" variant="headingLg" tone={data.extensionErrors.last24h <= 10 ? "success" : data.extensionErrors.last24h <= 50 ? "caution" : "critical"}>
                        {data.extensionErrors.last24h}
                      </Text>
                    </BlockStack>
                  </Box>
                  {data.extensionErrors.byExtension.length > 0 && (
                    <>
                      <Text as="h3" variant="headingSm">按扩展分类</Text>
                      <DataTable
                        columnContentTypes={["text", "numeric"]}
                        headings={["扩展", "错误数"]}
                        rows={data.extensionErrors.byExtension.map((item) => [
                          item.extension,
                          item.count.toString(),
                        ])}
                      />
                    </>
                  )}
                  {data.extensionErrors.byEndpoint.length > 0 && (
                    <>
                      <Text as="h3" variant="headingSm">按接口分类</Text>
                      <DataTable
                        columnContentTypes={["text", "numeric"]}
                        headings={["接口", "错误数"]}
                        rows={data.extensionErrors.byEndpoint.map((item) => [
                          item.endpoint,
                          item.count.toString(),
                        ])}
                      />
                    </>
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
