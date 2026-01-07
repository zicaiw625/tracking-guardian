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
  Button,
  Box,
  Divider,
  Banner,
} from "@shopify/polaris";
import { RefreshIcon } from "~/components/icons";
import { EnhancedEmptyState } from "~/components/ui";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getReconciliationDashboardData,
  type ReconciliationDashboardData,
} from "../services/reconciliation.server";

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
      dashboardData: null,
      selectedDays: 7,
    });
  }

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const validDays = [7, 14, 30].includes(days) ? days : 7;

  const dashboardData = await getReconciliationDashboardData(shop.id, validDays);

  return json({
    shop: { id: shop.id },
    dashboardData,
    selectedDays: validDays,
  });
};

function OverviewCard({
  overview,
}: {
  overview: ReconciliationDashboardData["overview"];
}) {
  const isHealthy = overview.gapPercentage < 10;
  const isWarning = overview.gapPercentage >= 10 && overview.gapPercentage < 20;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            订单层送达概览
          </Text>
          <Badge
            tone={isHealthy ? "success" : isWarning ? "warning" : "critical"}
          >
            {isHealthy ? "健康" : isWarning ? "需关注" : "需干预"}
          </Badge>
        </InlineStack>

        <InlineStack gap="400" align="space-between" wrap>
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            minWidth="140px"
          >
            <BlockStack gap="100" align="center">
              <Text as="p" variant="bodySm" tone="subdued">
                Webhook 订单
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {overview.totalWebhookOrders}
              </Text>
            </BlockStack>
          </Box>

          <Text as="p" variant="headingLg" tone="subdued">
            vs
          </Text>

          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            minWidth="140px"
          >
            <BlockStack gap="100" align="center">
              <Text as="p" variant="bodySm" tone="subdued">
                Pixel 收据
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {overview.totalPixelReceipts}
              </Text>
            </BlockStack>
          </Box>

          <Text as="p" variant="headingLg" tone="subdued">
            =
          </Text>

          <Box
            background={isHealthy ? "bg-fill-success" : isWarning ? "bg-fill-warning" : "bg-fill-critical"}
            padding="400"
            borderRadius="200"
            minWidth="140px"
          >
            <BlockStack gap="100" align="center">
              <Text as="p" variant="bodySm">
                缺口
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {overview.totalGap}
              </Text>
              <Text as="p" variant="bodySm">
                ({overview.gapPercentage.toFixed(1)}%)
              </Text>
            </BlockStack>
          </Box>
        </InlineStack>

        <Divider />

        <InlineStack gap="400" align="space-between">
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              成功发送到平台
            </Text>
            <Text as="p" variant="headingMd" fontWeight="semibold">
              {overview.totalSentToPlatforms} 个订单
            </Text>
          </BlockStack>
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              整体匹配率
            </Text>
            <Text
              as="p"
              variant="headingMd"
              fontWeight="semibold"
              tone={overview.matchRate > 90 ? "success" : undefined}
            >
              {overview.matchRate.toFixed(1)}%
            </Text>
          </BlockStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function VerificationOrdersPage() {
  const { shop, dashboardData, selectedDays } = useLoaderData<typeof loader>();

  if (!shop) {
    return (
      <Page title="订单层验收">
        <EnhancedEmptyState
          icon="⚠️"
          title="未找到店铺配置"
          description="请确保应用已正确安装。"
          primaryAction={{
            content: "返回验收页",
            url: "/app/verification",
          }}
        />
      </Page>
    );
  }

  return (
    <Page
      title="订单层验收"
      subtitle="聚焦订单 webhook 与退款/取消事件的验收与一致性检查"
      primaryAction={{
        content: "刷新数据",
        icon: RefreshIcon,
        url: `/app/verification/orders?days=${selectedDays}`,
      }}
      secondaryActions={[
        {
          content: "打开完整对账",
          url: "/app/reconciliation",
        },
      ]}
    >
      <BlockStack gap="400">
        <Banner tone="info" title="订单层事件说明">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              Web Pixels 仅覆盖 checkout 漏斗，订单层事件（refund/cancel）需通过 webhook 采集。
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              当前页面复用订单对账数据，帮助快速查看订单级缺口与匹配率。
            </Text>
          </BlockStack>
        </Banner>

        {dashboardData ? (
          <Layout>
            <Layout.Section>
              <OverviewCard overview={dashboardData.overview} />
            </Layout.Section>
          </Layout>
        ) : (
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                暂无订单层验收数据，请稍后再试。
              </Text>
              <Button url="/app/reconciliation" variant="primary">
                前往完整对账
              </Button>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
