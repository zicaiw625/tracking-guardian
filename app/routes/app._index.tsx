/**
 * Dashboard Page
 *
 * Main entry point for the Tracking Guardian app.
 * Shows setup progress, health score, and quick stats.
 */

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
  Icon,
  Box,
  Divider,
  Banner,
  Link,
  ProgressBar,
} from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";

import { authenticate } from "../shopify.server";
import { getDashboardData } from "../services/dashboard.server";
import {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
  type DashboardData,
  type SetupStep,
} from "../types/dashboard";

// =============================================================================
// Loader
// =============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const data = await getDashboardData(session.shop);
  return json(data);
};

// =============================================================================
// Components
// =============================================================================

/**
 * Health score badge component.
 */
function HealthBadge({ status }: { status: DashboardData["healthStatus"] }) {
  switch (status) {
    case "critical":
      return <Badge tone="critical">需要关注</Badge>;
    case "warning":
      return <Badge tone="warning">有风险</Badge>;
    case "success":
      return <Badge tone="success">健康</Badge>;
    default:
      return <Badge tone="info">未初始化</Badge>;
  }
}

/**
 * Health score card component.
 */
function HealthScoreCard({
  score,
  status,
}: {
  score: number | null;
  status: DashboardData["healthStatus"];
}) {
  const backgroundColor =
    score === null
      ? "bg-surface-secondary"
      : score > 80
        ? "bg-fill-success"
        : score > 60
          ? "bg-fill-warning"
          : "bg-fill-critical";

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            健康度
          </Text>
          <HealthBadge status={status} />
        </InlineStack>
        <Box background={backgroundColor} padding="600" borderRadius="200">
          <BlockStack gap="200" align="center">
            {score !== null ? (
              <>
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {score}
                </Text>
                <Text as="p" variant="bodySm">
                  / 100
                </Text>
              </>
            ) : (
              <>
                <Text as="p" variant="headingLg" fontWeight="semibold">
                  未初始化
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  完成平台连接后开始评分
                </Text>
              </>
            )}
          </BlockStack>
        </Box>
        <Text as="p" variant="bodySm" tone="subdued">
          {score !== null
            ? "评分依据：过去 7 天对账差异率 / 漏报率"
            : "连接平台并产生订单数据后，系统将自动计算健康度评分"}
        </Text>
      </BlockStack>
    </Card>
  );
}

/**
 * Quick stats card component.
 */
function QuickStatsCard({
  configuredPlatforms,
  weeklyConversions,
  plan,
}: {
  configuredPlatforms: number;
  weeklyConversions: number;
  plan: string;
}) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          快速统计
        </Text>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text as="span">已配置平台</Text>
            <Text as="span" fontWeight="semibold">
              {configuredPlatforms} 个
            </Text>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between">
            <Text as="span">本周转化记录</Text>
            <Text as="span" fontWeight="semibold">
              {weeklyConversions} 条
            </Text>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between">
            <Text as="span">当前套餐</Text>
            <Badge>{plan === "free" ? "免费版" : plan}</Badge>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

/**
 * Serialized latest scan type (Date becomes string after JSON serialization)
 */
type SerializedLatestScan = {
  status: string;
  riskScore: number;
  createdAt: string | Date;
  identifiedPlatforms: string[];
} | null;

/**
 * Latest scan card component.
 */
function LatestScanCard({ latestScan }: { latestScan: SerializedLatestScan }) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            最新扫描
          </Text>
          {latestScan && (
            <Badge
              tone={
                latestScan.riskScore > 60
                  ? "critical"
                  : latestScan.riskScore > 30
                    ? "warning"
                    : "success"
              }
            >
              {`风险分 ${latestScan.riskScore}`}
            </Badge>
          )}
        </InlineStack>
        {latestScan ? (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              扫描时间: {new Date(latestScan.createdAt).toLocaleDateString("zh-CN")}
            </Text>
            <Text as="p" variant="bodySm">
              识别到的平台: {latestScan.identifiedPlatforms.join(", ") || "无"}
            </Text>
          </BlockStack>
        ) : (
          <Text as="p" tone="subdued">
            尚未进行扫描
          </Text>
        )}
        {latestScan ? (
          <Button url="/app/scan" fullWidth>
            查看扫描报告
          </Button>
        ) : (
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              完成上方第 1 步开始扫描
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              预计耗时约 10 秒，不会修改任何设置
            </Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * Setup progress card component.
 */
function SetupProgressCard({
  steps,
  nextStep,
}: {
  steps: SetupStep[];
  nextStep: SetupStep | undefined;
}) {
  const progress = getSetupProgress(steps);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            开始设置
          </Text>
          <Badge tone="attention">{`${progress.completed}/${progress.total} 已完成`}</Badge>
        </InlineStack>
        <ProgressBar progress={progress.percentage} tone="primary" size="small" />
        <BlockStack gap="300">
          {steps.map((step, index) => (
            <Box
              key={step.id}
              background={step.done ? "bg-surface-success" : "bg-surface-secondary"}
              padding="400"
              borderRadius="200"
            >
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Box>
                    {step.done ? (
                      <Icon source={CheckCircleIcon} tone="success" />
                    ) : (
                      <Text as="span" variant="bodyMd" fontWeight="bold">
                        {index + 1}
                      </Text>
                    )}
                  </Box>
                  <BlockStack gap="100">
                    <Text
                      as="span"
                      fontWeight="semibold"
                      tone={step.done ? "success" : undefined}
                    >
                      {step.label}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {step.description}
                    </Text>
                  </BlockStack>
                </InlineStack>
                {!step.done && (
                  <Button
                    url={step.url}
                    size="slim"
                    variant={step.id === nextStep?.id ? "primary" : undefined}
                  >
                    {step.cta}
                  </Button>
                )}
              </InlineStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

/**
 * ScriptTag migration banner.
 */
function ScriptTagMigrationBanner({
  scriptTagsCount,
  hasOrderStatusScripts,
}: {
  scriptTagsCount: number;
  hasOrderStatusScripts: boolean;
}) {
  if (scriptTagsCount === 0) return null;

  return (
    <Banner
      title={`检测到 ${scriptTagsCount} 个 ScriptTag 需要迁移`}
      tone="critical"
      action={{ content: "查看迁移方案", url: "/app/migrate" }}
      secondaryAction={{ content: "查看扫描详情", url: "/app/scan" }}
    >
      <BlockStack gap="300">
        {hasOrderStatusScripts && (
          <Text as="p">
            ⚠️ 检测到 <strong>订单状态页 ScriptTag</strong>，这是 Shopify 废弃公告的主要目标。
            请尽快迁移到 Web Pixel 以避免追踪中断。
          </Text>
        )}
        <BlockStack gap="100">
          <Text as="p" fontWeight="semibold">
            推荐迁移步骤：
          </Text>
          <Text as="p" variant="bodySm">
            1. 在「设置」页面配置平台凭证（Meta CAPI / GA4 / TikTok）
          </Text>
          <Text as="p" variant="bodySm">
            2. 在「迁移」页面安装 Tracking Guardian Web Pixel
          </Text>
          <Text as="p" variant="bodySm">
            3. 验证新配置正常工作后，在 Shopify 后台手动删除旧的 ScriptTag
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            （前往「设置 → 应用和销售渠道」找到创建 ScriptTag 的应用并卸载）
          </Text>
        </BlockStack>
      </BlockStack>
    </Banner>
  );
}

/**
 * Migration deadline banner.
 */
function MigrationDeadlineBanner({ scriptTagsCount }: { scriptTagsCount: number }) {
  return (
    <Banner
      title="重要迁移截止日期"
      tone={scriptTagsCount > 0 ? "warning" : "info"}
      action={{
        content: "了解更多",
        url: "https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status",
        external: true,
      }}
    >
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="p">
            <strong>所有商家:</strong> 附加脚本（Additional Scripts）自{" "}
            <strong>2025-08-28</strong> 起在 Checkout 设置中只读（不可再编辑）
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url="https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status/plus-upgrade-guide"
              external
            >
              查看 Plus 商家升级指南
            </Link>
          </Text>
        </BlockStack>
        <BlockStack gap="100">
          <Text as="p">
            <strong>非 Plus 商家:</strong> Order status 页 ScriptTags 将于{" "}
            <strong>2026-08-26</strong> 关闭
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url="https://shopify.dev/docs/apps/build/online-store/blocking-script-tags"
              external
            >
              查看 ScriptTags 弃用时间表
            </Link>
          </Text>
        </BlockStack>
        <Text as="p" tone="subdued">
          checkout.liquid、附加脚本（Additional Scripts）、ScriptTags 将逐步下线，建议尽早迁移到 Web
          Pixels
        </Text>
      </BlockStack>
    </Banner>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  
  // Transform the serialized data back to the expected format
  // Note: Dates are serialized as strings in the loader response
  const data: DashboardData = {
    ...loaderData,
    latestScan: loaderData.latestScan
      ? {
          ...loaderData.latestScan,
          createdAt: new Date(loaderData.latestScan.createdAt),
        }
      : null,
  };

  const setupSteps = getSetupSteps(data);
  const nextStep = getNextSetupStep(setupSteps);
  const progress = getSetupProgress(setupSteps);

  return (
    <Page
      title="Tracking Guardian"
      primaryAction={
        !progress.allComplete && nextStep
          ? { content: nextStep.cta, url: nextStep.url }
          : undefined
      }
    >
      <BlockStack gap="500">
        {/* Welcome Banner */}
        <Banner title="欢迎使用 Tracking Guardian" tone="info" onDismiss={() => {}}>
          <p>
            帮助您扫描、迁移和监控 Thank you / Order status 页面的追踪脚本，
            确保在 Checkout Extensibility 迁移后转化追踪正常工作。
          </p>
        </Banner>

        {/* Setup Progress */}
        {!progress.allComplete && <SetupProgressCard steps={setupSteps} nextStep={nextStep} />}

        {/* Stats Grid */}
        <Layout>
          <Layout.Section variant="oneThird">
            <HealthScoreCard score={data.healthScore} status={data.healthStatus} />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <QuickStatsCard
              configuredPlatforms={data.configuredPlatforms}
              weeklyConversions={data.weeklyConversions}
              plan={data.plan}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <LatestScanCard latestScan={loaderData.latestScan} />
          </Layout.Section>
        </Layout>

        {/* Migration Banners */}
        <ScriptTagMigrationBanner
          scriptTagsCount={data.scriptTagsCount}
          hasOrderStatusScripts={data.hasOrderStatusScripts}
        />
        <MigrationDeadlineBanner scriptTagsCount={data.scriptTagsCount} />
      </BlockStack>
    </Page>
  );
}
