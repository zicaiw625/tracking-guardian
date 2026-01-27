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
  return json({
    shop: { id: shop.id },
    dashboardData: null,
    selectedDays: validDays,
    canAccessOrderLayer,
    gateResult: canAccessOrderLayer ? undefined : gateResult,
    currentPlan: planId,
  });
};

function OverviewCard({
  overview,
}: {
  overview: null;
}) {
  return null;
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
        <Banner tone="info" title="PRD 2.5: 订单层验收说明（v1.1+ 功能）">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              <strong>订单层验收范围（v1.1+）：</strong>
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
              <strong>v1.0 说明：</strong>订单和退款相关 webhooks 将在 v1.1+ 版本中启用。v1.0 版本仅订阅应用生命周期和 GDPR 合规 webhooks，保持最小订阅范围。
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>说明：</strong>标准事件覆盖的是"店内行为+checkout链路"，它并不天然覆盖退款/取消等订单后事件，所以订单层验收是第二层验收。
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              当前页面复用订单对账数据，帮助快速查看订单级缺口与匹配率。
            </Text>
          </BlockStack>
        </Banner>
        {!dashboardData && (
          <Banner tone="info">
            <Text as="p">订单层对账功能已移除</Text>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
