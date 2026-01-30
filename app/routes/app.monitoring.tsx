import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge, Box, DataTable } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getAggregatedMetrics } from "../services/dashboard-aggregation.server";
import { getEventLossStats } from "../services/pixel-event-loss.server";
import { getEventMonitoringStats } from "../services/monitoring.server";
import { PageIntroCard } from "~/components/layout/PageIntroCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({
      shop: null,
      alerts: [],
      aggregatedSummary: null,
      eventLossStats: null,
      monitoringStats: null,
    });
  }
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const alerts = await prisma.alertEvent.findMany({
    where: { shopId: shop.id, sentAt: { gte: thirtyDaysAgo } },
    orderBy: { sentAt: "desc" },
    take: 50,
  });
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  let aggregatedSummary: {
    totalOrders: number;
    totalValue: number;
    successRate: number;
    totalEventVolume: number;
    eventVolumeByType: Record<string, number>;
  } | null = null;
  let eventLossStats: Awaited<ReturnType<typeof getEventLossStats>> | null = null;
  let monitoringStats: Awaited<ReturnType<typeof getEventMonitoringStats>> | null = null;
  try {
    const agg = await getAggregatedMetrics(shop.id, sevenDaysAgo, new Date());
    aggregatedSummary = {
      totalOrders: agg.totalOrders,
      totalValue: agg.totalValue,
      successRate: agg.successRate,
      totalEventVolume: agg.totalEventVolume,
      eventVolumeByType: agg.eventVolumeByType,
    };
  } catch {
    aggregatedSummary = null;
  }
  try {
    eventLossStats = await getEventLossStats(shop.id, 24);
  } catch {
    eventLossStats = null;
  }
  try {
    monitoringStats = await getEventMonitoringStats(shop.id, 24);
  } catch {
    monitoringStats = null;
  }
  return json({
    shop: { id: shop.id },
    alerts,
    aggregatedSummary,
    eventLossStats,
    monitoringStats,
  });
};

export default function MonitoringPage() {
  const { shop, alerts, aggregatedSummary, eventLossStats, monitoringStats } = useLoaderData<typeof loader>();

  if (!shop) {
    return (
      <Page title="Monitoring">
        <BlockStack gap="400">
          <Text as="p" tone="subdued">未找到店铺信息。</Text>
        </BlockStack>
      </Page>
    );
  }

  const alertRows = alerts.map((a) => [
    a.sentAt ? new Date(a.sentAt).toLocaleString() : "",
    a.alertType,
    <Badge key={a.id} tone={a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info"}>{a.severity}</Badge>,
    a.message,
  ]);

  return (
    <Page title="Monitoring">
      <BlockStack gap="500">
        <PageIntroCard
          title="断档监控与告警"
          description="查看近期告警、事件成功率与流失统计；在设置中配置告警通道与阈值。"
          items={[
            "告警列表：最近 30 天触发的异常告警",
            "近 7 日转化与成功率汇总",
            "近 24 小时事件流失与成功率",
          ]}
          primaryAction={{ content: "告警配置", url: "/app/settings?tab=alerts" }}
        />
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {aggregatedSummary !== null && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">近 7 日汇总</Text>
                    <InlineStack gap="600">
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">订单数</Text>
                        <Text as="p" variant="headingLg">{aggregatedSummary.totalOrders}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">总金额</Text>
                        <Text as="p" variant="headingLg">{aggregatedSummary.totalValue.toFixed(2)}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">成功率</Text>
                        <Text as="p" variant="headingLg">{(aggregatedSummary.successRate * 100).toFixed(1)}%</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">总事件量（含全漏斗）</Text>
                        <Text as="p" variant="headingLg">{aggregatedSummary.totalEventVolume}</Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
              {monitoringStats !== null && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">近 24 小时事件</Text>
                    <InlineStack gap="600">
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">总事件</Text>
                        <Text as="p" variant="headingLg">{monitoringStats.totalEvents}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">成功率</Text>
                        <Text as="p" variant="headingLg">{monitoringStats.successRate.toFixed(1)}%</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">失败率</Text>
                        <Text as="p" variant="headingLg">{monitoringStats.failureRate.toFixed(1)}%</Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
              {eventLossStats !== null && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">事件流失（24h）</Text>
                    <InlineStack gap="600">
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">接收</Text>
                        <Text as="p" variant="headingLg">{eventLossStats.totalReceived}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">流失率</Text>
                        <Text as="p" variant="headingLg">{(eventLossStats.lossRate * 100).toFixed(1)}%</Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">告警列表</Text>
                    <Button url="/app/settings?tab=alerts">告警配置</Button>
                  </InlineStack>
                  {alertRows.length === 0 ? (
                    <Text as="p" tone="subdued">近期无告警。</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["时间", "类型", "严重程度", "消息"]}
                      rows={alertRows}
                    />
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
