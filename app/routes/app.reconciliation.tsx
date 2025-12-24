/**
 * P1-4: 对账可视化页面
 *
 * 显示"像素收据 vs webhook 订单"的对比，
 * 帮助商家理解漏单原因并获得策略建议。
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
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
  Icon,
  DataTable,
  Select,
  ProgressBar,
  EmptyState,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getReconciliationDashboardData,
  type ReconciliationDashboardData,
  type GapReason,
} from "../services/reconciliation.server";

// =============================================================================
// Loader
// =============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, consentStrategy: true },
  });

  if (!shop) {
    return json({
      shop: null,
      dashboardData: null,
    });
  }

  // 从 URL 获取天数参数
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const validDays = [7, 14, 30].includes(days) ? days : 7;

  const dashboardData = await getReconciliationDashboardData(shop.id, validDays);

  return json({
    shop: { id: shop.id, consentStrategy: shop.consentStrategy },
    dashboardData,
    selectedDays: validDays,
  });
};

// =============================================================================
// Action
// =============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "changeStrategy") {
    const newStrategy = formData.get("strategy") as string;

    await prisma.shop.update({
      where: { shopDomain },
      data: { consentStrategy: newStrategy },
    });

    return json({ success: true, message: `策略已更新为 ${newStrategy}` });
  }

  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

// =============================================================================
// Components
// =============================================================================

/**
 * 概览卡片
 */
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
            对账概览
          </Text>
          <Badge
            tone={isHealthy ? "success" : isWarning ? "warning" : "critical"}
          >
            {isHealthy ? "健康" : isWarning ? "需关注" : "需干预"}
          </Badge>
        </InlineStack>

        <InlineStack gap="400" align="space-between" wrap>
          {/* Webhook 订单 */}
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

          {/* vs */}
          <Text as="p" variant="headingLg" tone="subdued">
            vs
          </Text>

          {/* Pixel 收据 */}
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

          {/* = */}
          <Text as="p" variant="headingLg" tone="subdued">
            =
          </Text>

          {/* 缺口 */}
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

/**
 * 缺口原因分析卡片
 */
function GapAnalysisCard({
  gapAnalysis,
}: {
  gapAnalysis: ReconciliationDashboardData["gapAnalysis"];
}) {
  const getReasonIcon = (reason: GapReason) => {
    switch (reason) {
      case "no_pixel_receipt":
        return AlertCircleIcon;
      case "consent_denied":
        return AlertCircleIcon;
      case "network_timeout":
        return ClockIcon;
      case "billing_limit":
        return AlertCircleIcon;
      default:
        return AlertCircleIcon;
    }
  };

  const getReasonTone = (reason: GapReason): "critical" | "warning" | "info" => {
    switch (reason) {
      case "no_pixel_receipt":
        return "warning";
      case "consent_denied":
        return "info";
      case "billing_limit":
        return "critical";
      default:
        return "warning";
    }
  };

  if (gapAnalysis.length === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            缺口原因分析
          </Text>
          <Box padding="400">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={CheckCircleIcon} tone="success" />
              <Text as="p" tone="success">
                太棒了！没有检测到任何缺口。
              </Text>
            </InlineStack>
          </Box>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          缺口原因分析
        </Text>

        <BlockStack gap="300">
          {gapAnalysis.map((item) => (
            <Box
              key={item.reason}
              background="bg-surface-secondary"
              padding="300"
              borderRadius="200"
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={getReasonIcon(item.reason)} tone={getReasonTone(item.reason)} />
                    <Text as="span" fontWeight="semibold">
                      {item.count} 个
                    </Text>
                    <Badge tone={getReasonTone(item.reason)}>
                      {item.percentage.toFixed(0)}%
                    </Badge>
                  </InlineStack>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {item.description}
                </Text>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

/**
 * 策略建议卡片
 */
function RecommendationCard({
  recommendation,
  onChangeStrategy,
  isLoading,
}: {
  recommendation: ReconciliationDashboardData["recommendation"];
  onChangeStrategy: (strategy: string) => void;
  isLoading: boolean;
}) {
  const strategyLabels: Record<string, string> = {
    strict: "严格模式",
    balanced: "平衡模式",
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            策略建议
          </Text>
          <Badge>
            当前: {strategyLabels[recommendation.currentStrategy] || recommendation.currentStrategy}
          </Badge>
        </InlineStack>

        {recommendation.suggestedStrategy && recommendation.reason ? (
          <Banner
            title={`建议切换到${strategyLabels[recommendation.suggestedStrategy]}`}
            tone="info"
            action={{
              content: `切换到${strategyLabels[recommendation.suggestedStrategy]}`,
              onAction: () => onChangeStrategy(recommendation.suggestedStrategy!),
              loading: isLoading,
            }}
          >
            <p>{recommendation.reason}</p>
          </Banner>
        ) : (
          <Banner tone="success">
            <p>当前策略表现良好，无需调整。</p>
          </Banner>
        )}

        <Divider />

        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            策略说明：
          </Text>
          <BlockStack gap="100">
            <Text as="p" variant="bodySm">
              • <strong>严格模式</strong>：仅发送有可信像素收据的订单，数据质量高但覆盖率可能较低
            </Text>
            <Text as="p" variant="bodySm">
              • <strong>平衡模式</strong>：在保证合规的前提下提高覆盖率，适合大多数店铺
            </Text>
          </BlockStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

/**
 * 平台分解卡片
 */
function PlatformBreakdownCard({
  platformBreakdown,
}: {
  platformBreakdown: ReconciliationDashboardData["platformBreakdown"];
}) {
  const platformNames: Record<string, string> = {
    google: "Google Analytics (GA4)",
    meta: "Meta (Facebook)",
    tiktok: "TikTok",
  };

  if (platformBreakdown.length === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            平台分解
          </Text>
          <Text as="p" tone="subdued">
            暂无平台数据
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const rows = platformBreakdown.map((item) => [
    platformNames[item.platform] || item.platform,
    String(item.sentToPlatform),
    String(item.gap),
    `${item.gapPercentage.toFixed(1)}%`,
  ]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          平台分解
        </Text>
        <DataTable
          columnContentTypes={["text", "numeric", "numeric", "text"]}
          headings={["平台", "成功发送", "缺口", "缺口率"]}
          rows={rows}
        />
      </BlockStack>
    </Card>
  );
}

/**
 * 趋势图卡片
 */
function TrendCard({
  dailyTrend,
}: {
  dailyTrend: ReconciliationDashboardData["dailyTrend"];
}) {
  if (dailyTrend.length === 0) {
    return null;
  }

  const maxValue = Math.max(
    ...dailyTrend.map((d) => Math.max(d.webhookOrders, d.pixelReceipts))
  );

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          每日趋势
        </Text>

        <BlockStack gap="200">
          {dailyTrend.map((day) => (
            <Box key={day.date} padding="200">
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">
                    {new Date(day.date).toLocaleDateString("zh-CN", {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Webhook: {day.webhookOrders}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      Pixel: {day.pixelReceipts}
                    </Text>
                    {day.gap > 0 && (
                      <Badge tone="warning">缺口: {day.gap}</Badge>
                    )}
                  </InlineStack>
                </InlineStack>
                <InlineStack gap="100" wrap={false}>
                  <Box minWidth="50%">
                    <ProgressBar
                      progress={maxValue > 0 ? (day.webhookOrders / maxValue) * 100 : 0}
                      tone="primary"
                      size="small"
                    />
                  </Box>
                  <Box minWidth="50%">
                    <ProgressBar
                      progress={maxValue > 0 ? (day.pixelReceipts / maxValue) * 100 : 0}
                      tone="success"
                      size="small"
                    />
                  </Box>
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>

        <Divider />

        <InlineStack gap="400">
          <InlineStack gap="100" blockAlign="center">
            <Box background="bg-fill-info" padding="100" borderRadius="100" />
            <Text as="span" variant="bodySm">
              Webhook 订单
            </Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <Box background="bg-fill-success" padding="100" borderRadius="100" />
            <Text as="span" variant="bodySm">
              Pixel 收据
            </Text>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function ReconciliationPage() {
  const { shop, dashboardData, selectedDays } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [days, setDays] = useState(String(selectedDays));

  const isLoading = navigation.state === "submitting";

  const handleDaysChange = (value: string) => {
    setDays(value);
    // 重新加载页面
    window.location.href = `/app/reconciliation?days=${value}`;
  };

  const handleStrategyChange = (strategy: string) => {
    const formData = new FormData();
    formData.append("_action", "changeStrategy");
    formData.append("strategy", strategy);
    submit(formData, { method: "post" });
  };

  if (!shop || !dashboardData) {
    return (
      <Page title="对账分析">
        <Card>
          <EmptyState
            heading="暂无数据"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>请先完成平台配置并产生订单数据。</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const periodLabel = `${new Date(dashboardData.period.startDate).toLocaleDateString("zh-CN")} - ${new Date(dashboardData.period.endDate).toLocaleDateString("zh-CN")}`;

  return (
    <Page
      title="对账分析"
      subtitle={`分析期间：${periodLabel}`}
      primaryAction={{
        content: "刷新数据",
        icon: RefreshIcon,
        onAction: () => window.location.reload(),
      }}
    >
      <BlockStack gap="500">
        {/* 时间范围选择 */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodySm">
              选择分析周期：
            </Text>
            <Select
              label=""
              labelHidden
              options={[
                { label: "过去 7 天", value: "7" },
                { label: "过去 14 天", value: "14" },
                { label: "过去 30 天", value: "30" },
              ]}
              value={days}
              onChange={handleDaysChange}
            />
          </InlineStack>
        </Card>

        {/* 概览 */}
        <OverviewCard overview={dashboardData.overview} />

        <Layout>
          <Layout.Section variant="oneHalf">
            {/* 缺口分析 */}
            <GapAnalysisCard gapAnalysis={dashboardData.gapAnalysis} />
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            {/* 策略建议 */}
            <RecommendationCard
              recommendation={dashboardData.recommendation}
              onChangeStrategy={handleStrategyChange}
              isLoading={isLoading}
            />
          </Layout.Section>
        </Layout>

        {/* 平台分解 */}
        <PlatformBreakdownCard platformBreakdown={dashboardData.platformBreakdown} />

        {/* 趋势图 */}
        <TrendCard dailyTrend={dashboardData.dailyTrend} />

        {/* 帮助信息 */}
        <Banner title="关于对账分析" tone="info">
          <BlockStack gap="200">
            <p>
              对账分析帮助您了解 Webhook 订单与 Pixel 收据之间的匹配情况。
              理想情况下，每个 Webhook 订单都应该有对应的 Pixel 收据。
            </p>
            <p>
              <strong>常见缺口原因：</strong>
            </p>
            <ul>
              <li>用户未到达感谢页（提前关闭浏览器、使用 upsell 应用等）</li>
              <li>用户未授权追踪同意（GDPR/CCPA 限制）</li>
              <li>网络问题导致像素事件未发送</li>
            </ul>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}

