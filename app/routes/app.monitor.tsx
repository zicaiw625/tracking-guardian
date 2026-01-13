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
    reconciliation = {
      last7Days: reconData.reports.map(r => ({
        platform: r.platform,
        shopifyOrders: r.shopifyOrders,
        platformConversions: r.platformConversions,
        orderDiscrepancy: r.orderDiscrepancy,
        revenueDiscrepancy: r.revenueDiscrepancy,
      })),
      summary: {
        totalOrders: reconData.summary.totalShopifyOrders,
        totalConversions: reconData.summary.totalPlatformConversions,
        avgDiscrepancy: reconData.summary.avgOrderDiscrepancy,
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
  return json<LoaderData>({
    alerts,
    reconciliation,
    health,
    monitoring,
    volume,
    extensionErrors,
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
