import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Banner,
  IndexTable,
  useIndexResourceState,
  Button,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import {
  AlertCircleIcon,
  XCircleIcon,
} from "~/components/icons";
import { useTranslation } from "react-i18next";

import { getAggregatedMetrics } from "~/services/dashboard-aggregation.server";
import { checkPlanGate } from "~/middleware/plan-gate";
import { normalizePlanId, type PlanId } from "~/services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      AlertEvent: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!shop) {
    return json({ shop: null, stats: null, gate: null, currentPlan: "free" });
  }

  const gate = await checkPlanGate(shop.id, "alerts");
  if (!gate.allowed) {
    return json({ shop, stats: null, gate, currentPlan: shop.plan || "free" });
  }

  const now = new Date();
  const last7DaysStart = new Date(now);
  last7DaysStart.setDate(now.getDate() - 7);
  const last24HoursStart = new Date(now);
  last24HoursStart.setHours(now.getHours() - 24);

  const [metrics7Days, metrics24Hours, currencyRecord] = await Promise.all([
    getAggregatedMetrics(shop.id, last7DaysStart, now),
    getAggregatedMetrics(shop.id, last24HoursStart, now),
    prisma.orderSummary.findFirst({
        where: { shopId: shop.id },
        select: { currency: true },
        orderBy: { createdAt: "desc" }
    })
  ]);

  const currency = currencyRecord?.currency || "USD";

  const shopifyOrders = metrics24Hours.shopifyOrderCount || 0;
  const pixelOrders = metrics24Hours.totalOrders || 0;
  const lossRateVal = shopifyOrders > 0 
    ? Math.max(0, (shopifyOrders - pixelOrders) / shopifyOrders) 
    : 0;

  const stats = {
    last7Days: {
      orders: metrics7Days.totalOrders,
      value: metrics7Days.totalValue.toFixed(2),
      currency: currency,
      successRate: (metrics7Days.successRate * 100).toFixed(1),
      totalEvents: metrics7Days.totalEventVolume,
    },
    last24Hours: {
      totalEvents: metrics24Hours.totalEventVolume,
      successRate: (metrics24Hours.successRate * 100).toFixed(1),
      failureRate: ((1 - metrics24Hours.successRate) * 100).toFixed(1),
      lossRate: (lossRateVal * 100).toFixed(1),
      received: metrics24Hours.totalEventVolume,
    },
  };

  return json({ shop, stats, gate: null, currentPlan: shop.plan || "free" });
};

export default function MonitoringPage() {
  const { t } = useTranslation();
  const { shop, stats, gate, currentPlan } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const planId = normalizePlanId((currentPlan as string) || "free") as PlanId;

  const alerts = shop?.AlertEvent || [];
  const resourceName = {
    singular: "alert",
    plural: "alerts",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(alerts as any[]);

  if (!shop) {
    return (
      <Page title={t("monitoring.title")}>
        <Banner tone="critical">
          <p>{t("monitoring.empty")}</p>
        </Banner>
      </Page>
    );
  }

  if (gate && !gate.allowed) {
    return (
      <Page title={t("monitoring.title")}>
        <UpgradePrompt feature="alerts" currentPlan={planId} gateResult={gate} />
      </Page>
    );
  }

  const safeStats = stats || {
    last7Days: { orders: 0, value: "0", currency: "", successRate: 0, totalEvents: 0 },
    last24Hours: { totalEvents: 0, successRate: 0, failureRate: 0, lossRate: "0.0", received: 0 }
  };

  const rowMarkup = alerts.map(
    (alert: any, index: number) => {
      const { id, type, severity, message, createdAt } = alert;
      return (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>
          {new Date(createdAt).toLocaleString()}
        </IndexTable.Cell>
        <IndexTable.Cell>{type}</IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200" align="start" blockAlign="center">
             {severity === "critical" ? <XCircleIcon style={{ width: 20, height: 20, color: "var(--p-color-text-critical)" }} /> : <AlertCircleIcon style={{ width: 20, height: 20, color: "var(--p-color-text-warning)" }} />}
             <Text as="span" tone={severity === "critical" ? "critical" : undefined}>{severity}</Text>
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>{message}</IndexTable.Cell>
      </IndexTable.Row>
    )}
  );

  return (
    <Page
      title={t("monitoring.title")}
      primaryAction={{
        content: t("monitoring.intro.action"),
        onAction: () => navigate("/app/settings"),
      }}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("monitoring.intro.title")}
          description={t("monitoring.intro.description")}
          items={[
            t("monitoring.intro.items.0"),
            t("monitoring.intro.items.1"),
            t("monitoring.intro.items.2"),
          ]}
          primaryAction={{
            content: t("monitoring.intro.action"),
            url: "/app/settings",
          }}
        />

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {t("monitoring.summary.title")}
                </Text>
                <InlineStack gap="400" align="space-between">
                  <StatItem
                    label={t("monitoring.summary.orders")}
                    value={safeStats.last7Days.orders.toString()}
                  />
                  <StatItem
                    label={t("monitoring.summary.value")}
                    value={`${safeStats.last7Days.currency} ${safeStats.last7Days.value}`}
                  />
                  <StatItem
                    label={t("monitoring.summary.successRate")}
                    value={`${safeStats.last7Days.successRate}%`}
                    tone="success"
                  />
                  <StatItem
                    label={t("monitoring.summary.volume")}
                    value={safeStats.last7Days.totalEvents.toString()}
                  />
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {t("monitoring.recent.title")}
                </Text>
                <InlineStack gap="400" align="space-between">
                  <StatItem
                    label={t("monitoring.recent.total")}
                    value={safeStats.last24Hours.totalEvents.toString()}
                  />
                  <StatItem
                    label={t("monitoring.recent.success")}
                    value={`${safeStats.last24Hours.successRate}%`}
                    tone="success"
                  />
                  <StatItem
                    label={t("monitoring.recent.failure")}
                    value={`${safeStats.last24Hours.failureRate}%`}
                    tone="critical"
                  />
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {t("monitoring.loss.title")}
                </Text>
                <InlineStack gap="400" align="space-between">
                  <StatItem
                    label={t("monitoring.loss.received")}
                    value={safeStats.last24Hours.received.toString()}
                  />
                  <StatItem
                    label={t("monitoring.loss.rate")}
                    value={`${safeStats.last24Hours.lossRate}%`}
                    tone={Number(safeStats.last24Hours.lossRate) < 1 ? "success" : undefined}
                  />
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="400">
                <div style={{ padding: "16px 16px 0 16px" }}>
                   <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        {t("monitoring.alerts.title")}
                      </Text>
                      <Button variant="plain" url="/app/settings">{t("monitoring.alerts.config")}</Button>
                   </InlineStack>
                </div>
                {alerts.length === 0 ? (
                  <div style={{ padding: "16px", textAlign: "center" }}>
                    <Text as="p" tone="subdued">
                      {t("monitoring.alerts.empty")}
                    </Text>
                  </div>
                ) : (
                  <IndexTable
                    resourceName={resourceName}
                    itemCount={alerts.length}
                    selectedItemsCount={
                      allResourcesSelected ? "All" : selectedResources.length
                    }
                    onSelectionChange={handleSelectionChange}
                    headings={[
                      { title: t("monitoring.alerts.table.time") },
                      { title: t("monitoring.alerts.table.type") },
                      { title: t("monitoring.alerts.table.severity") },
                      { title: t("monitoring.alerts.table.message") },
                    ]}
                  >
                    {rowMarkup}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function StatItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "critical";
}) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingLg" tone={tone}>
        {value}
      </Text>
    </BlockStack>
  );
}
