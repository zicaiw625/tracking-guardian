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
  List,
} from "@shopify/polaris";
import { RefreshIcon } from "~/components/icons";
import { EnhancedEmptyState } from "~/components/ui";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getReconciliationDashboardData,
  type ReconciliationDashboardData,
} from "../services/reconciliation.server";
import { normalizePlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import type { PlanId } from "../services/billing/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({
      shop: null,
      dashboardData: null,
      selectedDays: 7,
      canAccessOrderLayer: false,
      currentPlan: "free" as PlanId,
      gateResult: undefined,
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
    const canAccessOrderLayer = isPlanAtLeast(planId, "growth");
  const gateResult = checkFeatureAccess(planId, "reconciliation");

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const validDays = [7, 14, 30].includes(days) ? days : 7;

  const dashboardData = await getReconciliationDashboardData(shop.id, validDays);

  return json({
    shop: { id: shop.id },
    dashboardData,
    selectedDays: validDays,
    canAccessOrderLayer,
    gateResult: canAccessOrderLayer ? undefined : gateResult,
    currentPlan: planId,
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
  const loaderData = useLoaderData<typeof loader>();
  const { shop, dashboardData, selectedDays, canAccessOrderLayer, currentPlan } = loaderData;
  const gateResult = "gateResult" in loaderData ? loaderData.gateResult : undefined;

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

    if (!canAccessOrderLayer && gateResult) {
    return (
      <Page title="订单层验收">
        <UpgradePrompt
          feature="reconciliation"
          currentPlan={currentPlan || "free"}
          gateResult={gateResult}
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
        <PageIntroCard
          title="订单层验收"
          description="核对 orders/create、refunds、cancellations 等订单后事件与 webhook 送达情况。"
          items={[
            "对比 Pixel 与订单数据缺口",
            "识别订单层异常与漏报",
            "适用于 Growth/Agency 验收交付",
          ]}
          primaryAction={{ content: "返回验收", url: "/app/verification" }}
          secondaryAction={{ content: "导出报告", url: "/app/reports" }}
        />
        <Banner tone="info" title="PRD 2.5: 订单层验收说明">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              <strong>订单层验收范围：</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>orders/create 事件对账：</strong>通过 webhook 接收订单创建事件，与 Pixel 收据进行匹配
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>refunds 事件对账：</strong>通过 refunds/create webhook 接收退款事件，验证退款追踪准确性
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>cancellations 事件对账：</strong>通过 orders/cancelled webhook 接收取消事件，验证取消订单追踪
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>说明：</strong>标准事件覆盖的是"店内行为+checkout链路"，它并不天然覆盖退款/取消等订单后事件，所以订单层验收是第二层验收。
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
            {}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Webhook 事件对账详情
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    PRD 2.5要求：订单层验收包括 orders/create、refunds/create、orders/cancelled 等 webhook 事件的对账
                  </Text>
                  <Banner tone="info">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>当前对账数据来源：</strong>
                      </Text>
                      <List type="bullet">
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            <strong>orders/create：</strong>通过 webhook 接收订单创建事件，存储在 ShopifyOrderSnapshot 表中
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            <strong>refunds/create：</strong>通过 webhook 接收退款事件，存储在 RefundSnapshot 表中
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            <strong>orders/cancelled：</strong>通过 webhook 接收取消事件，更新 ShopifyOrderSnapshot 表的 cancelledAt 字段
                          </Text>
                        </List.Item>
                      </List>
                      <Text as="p" variant="bodySm" tone="subdued">
                        对账逻辑：将 webhook 订单与 Pixel 收据进行匹配，计算缺口和匹配率
                      </Text>
                    </BlockStack>
                  </Banner>
                  <Button url="/app/reconciliation" variant="primary">
                    查看完整对账详情
                  </Button>
                </BlockStack>
              </Card>
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
