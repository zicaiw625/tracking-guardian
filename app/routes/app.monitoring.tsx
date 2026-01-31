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
import { useLocale } from "~/context/LocaleContext";

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
  const { t, tArray, locale } = useLocale();
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
  const { shop, alerts, aggregatedSummary, eventLossStats, monitoringStats } = useLoaderData<typeof loader>();

  if (!shop) {
    return (
      <Page title="Monitoring">
        <BlockStack gap="400">
          <Text as="p" tone="subdued">{t("monitoring.shopNotFound")}</Text>
        </BlockStack>
      </Page>
    );
  }

  const alertRows = alerts.map((a) => [
    a.sentAt ? new Date(a.sentAt).toLocaleString(dateLocale) : "",
    a.alertType,
    <Badge key={a.id} tone={a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info"}>{a.severity}</Badge>,
    a.message,
  ]);

  return (
    <Page title="Monitoring">
      <BlockStack gap="500">
        <PageIntroCard
          title={t("monitoring.title")}
          description={t("monitoring.description")}
          items={tArray("monitoring.items")}
          primaryAction={{ content: t("monitoring.alertsConfig"), url: "/app/settings?tab=alerts" }}
        />
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {aggregatedSummary !== null && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">{t("monitoring.last7DaysSummary")}</Text>
                    <InlineStack gap="600">
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.orderCount")}</Text>
                        <Text as="p" variant="headingLg">{aggregatedSummary.totalOrders}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.totalAmount")}</Text>
                        <Text as="p" variant="headingLg">{aggregatedSummary.totalValue.toFixed(2)}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.successRate")}</Text>
                        <Text as="p" variant="headingLg">{(aggregatedSummary.successRate * 100).toFixed(1)}%</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.totalEventVolume")}</Text>
                        <Text as="p" variant="headingLg">{aggregatedSummary.totalEventVolume}</Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
              {monitoringStats !== null && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">{t("monitoring.last24hEvents")}</Text>
                    <InlineStack gap="600">
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.totalEvents")}</Text>
                        <Text as="p" variant="headingLg">{monitoringStats.totalEvents}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.successRate")}</Text>
                        <Text as="p" variant="headingLg">{monitoringStats.successRate.toFixed(1)}%</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.failureRate")}</Text>
                        <Text as="p" variant="headingLg">{monitoringStats.failureRate.toFixed(1)}%</Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
              {eventLossStats !== null && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">{t("monitoring.eventLoss24h")}</Text>
                    <InlineStack gap="600">
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.received")}</Text>
                        <Text as="p" variant="headingLg">{eventLossStats.totalReceived}</Text>
                      </Box>
                      <Box>
                        <Text as="p" variant="bodySm" tone="subdued">{t("monitoring.lossRate")}</Text>
                        <Text as="p" variant="headingLg">{(eventLossStats.lossRate * 100).toFixed(1)}%</Text>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">{t("monitoring.alertList")}</Text>
                    <Button url="/app/settings?tab=alerts">{t("monitoring.alertsConfig")}</Button>
                  </InlineStack>
                  {alertRows.length === 0 ? (
                    <Text as="p" tone="subdued">{t("monitoring.noAlertsRecently")}</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={[t("monitoring.time"), t("monitoring.type"), t("monitoring.severity"), t("monitoring.message")]}
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
