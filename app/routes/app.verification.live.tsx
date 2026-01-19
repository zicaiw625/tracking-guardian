import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Suspense, lazy } from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Banner,
} from "@shopify/polaris";
import { CardSkeleton } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  checkFeatureAccess,
  type FeatureGateResult,
} from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers.server";

const RealtimeEventMonitor = lazy(() => import("~/components/verification/RealtimeEventMonitor").then(module => ({
  default: module.RealtimeEventMonitor,
})));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true },
      },
    },
  });
  if (!shop) {
    return json({
      shop: null,
      configuredPlatforms: [],
      canAccessVerification: false,
      gateResult: null as FeatureGateResult | null,
      currentPlan: "free" as PlanId,
    });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "verification");
  const canAccessVerification = gateResult.allowed;
  const configuredPlatforms = shop.pixelConfigs.map((c) => c.platform);
    if (!canAccessVerification) {
    safeFireAndForget(
      trackEvent({
        shopId: shop.id,
        shopDomain,
        event: "app_paywall_viewed",
        metadata: {
          triggerPage: "verification_live",
          plan: shop.plan ?? "free",
        },
      })
    );
  }
  return json({
    shop: { id: shop.id, domain: shopDomain },
    configuredPlatforms,
    canAccessVerification,
    gateResult: gateResult.allowed ? null : gateResult,
    currentPlan: planId,
  });
};

export default function VerificationLivePage() {
  const { shop, configuredPlatforms, canAccessVerification, gateResult, currentPlan } = useLoaderData<typeof loader>();
  if (!shop) {
    return (
      <Page title="实时事件流">
        <Banner tone="warning">
          <Text as="p">店铺信息未找到，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }
  return (
    <Page
      title="实时事件流"
      subtitle="实时事件 + payload + 缺参提示"
      backAction={{ content: "返回验收页面", url: "/app/verification" }}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title="实时事件流"
          description="用于验收对账，实时查看事件触发与参数完整率。"
          items={[
            "建议配合测试清单逐步触发事件",
            "重点关注 checkout_completed 完整率",
          ]}
          primaryAction={{ content: "返回验收", url: "/app/verification" }}
          secondaryAction={{ content: "查看测试清单", url: "/app/verification/start" }}
        />
        {!canAccessVerification && gateResult != null && (
          <UpgradePrompt
            feature="verification"
            currentPlan={currentPlan}
            gateResult={gateResult}
          />
        )}
        {canAccessVerification ? (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                PRD 2.5: 实时事件流
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                实时显示像素事件、payload参数完整率和缺参提示。用于验收对账，确保事件正确发送到各平台。
              </Text>
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  <strong>使用说明：</strong>
                </Text>
                <ul>
                  <li>进入 checkout 测试 checkout_started 事件</li>
                  <li>填写 shipping 信息测试 shipping_submitted 事件</li>
                  <li>完成订单测试 checkout_completed 事件</li>
                  <li>检查 payload 参数完整率（value/currency/items）</li>
                  <li>查看缺参提示，确保关键参数不缺失</li>
                </ul>
              </Banner>
              <Suspense fallback={<CardSkeleton />}>
                <RealtimeEventMonitor
                  shopId={shop.id}
                  platforms={configuredPlatforms}
                  autoStart={true}
                  useVerificationEndpoint={true}
                />
              </Suspense>
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                实时事件流（需要升级）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                实时事件流功能需要 Growth ($79/月) 或 Agency ($199/月) 套餐。
              </Text>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
