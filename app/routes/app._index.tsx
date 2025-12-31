

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useEffect, memo, useMemo } from "react";
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
  List,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, ArrowRightIcon, ClockIcon } from "~/components/icons";
import { EnhancedEmptyState } from "~/components/ui";
import { UpgradeHealthCheck } from "~/components/onboarding/UpgradeHealthCheck";
import { PostInstallScanProgress } from "~/components/onboarding/PostInstallScanProgress";
import { RiskDistributionChart } from "~/components/dashboard/RiskDistributionChart";
import { DependencyGraphPreview } from "~/components/dashboard/DependencyGraphPreview";
import { useNavigate } from "@remix-run/react";

import { authenticate } from "../shopify.server";
import { getDashboardData } from "../services/dashboard.server";
import {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
  type DashboardData,
  type SetupStep,
} from "../types/dashboard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const data = await getDashboardData(session.shop);
  return json(data);
};

const HealthBadge = memo(function HealthBadge({ status }: { status: DashboardData["healthStatus"] }) {
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
});

const HealthScoreCard = memo(function HealthScoreCard({
  score,
  status,
}: {
  score: number | null;
  status: DashboardData["healthStatus"];
}) {
  const backgroundColor = useMemo(() =>
    score === null
      ? "bg-surface-secondary"
      : score > 80
        ? "bg-fill-success"
        : score > 60
          ? "bg-fill-warning"
          : "bg-fill-critical",
    [score]
  );

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
});

const QuickStatsCard = memo(function QuickStatsCard({
  configuredPlatforms,
  weeklyConversions,
  plan,
  planLabel,
  planTagline,
  planFeatures,
}: {
  configuredPlatforms: number;
  weeklyConversions: number;
  plan: string;
  planLabel?: string;
  planTagline?: string;
  planFeatures?: string[];
}) {
  const displayFeatures = useMemo(() => planFeatures?.slice(0, 3) || [], [planFeatures]);
  const hasMoreFeatures = useMemo(() => (planFeatures?.length || 0) > 3, [planFeatures]);

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
            <Badge>
              {planLabel || (plan === "free" ? "免费版" : plan)}
            </Badge>
          </InlineStack>
          {planTagline && (
            <Text as="p" variant="bodySm" tone="subdued">
              {planTagline}
            </Text>
          )}
          {displayFeatures.length > 0 && (
            <List>
              {displayFeatures.map((f, i) => (
                <List.Item key={i}>
                  <Text as="span" variant="bodySm">{f}</Text>
                </List.Item>
              ))}
              {hasMoreFeatures && (
                <List.Item>
                  <Text as="span" variant="bodySm" tone="subdued">
                    ...更多权益，详见套餐页
                  </Text>
                </List.Item>
              )}
            </List>
          )}
          <Button
            url="/app/settings?tab=subscription"
            size="slim"
          >
            查看套餐/升级
          </Button>
        </BlockStack>
      </BlockStack>
    </Card>
  );
});

type SerializedLatestScan = {
  status: string;
  riskScore: number;
  createdAt: string | Date;
  identifiedPlatforms: string[];
} | null;

const LatestScanCard = memo(function LatestScanCard({ latestScan }: { latestScan: SerializedLatestScan }) {
  if (!latestScan) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            最新扫描
          </Text>
          <EnhancedEmptyState
            icon="🔍"
            title="尚未进行扫描"
            description="完成上方第 1 步开始扫描。预计耗时约 10 秒，不会修改任何设置。"
            primaryAction={{
              content: "开始扫描",
              url: "/app/scan",
            }}
          />
        </BlockStack>
      </Card>
    );
  }

  const riskLevel =
    latestScan.riskScore >= 70
      ? { level: "高风险", tone: "critical" as const }
      : latestScan.riskScore >= 40
        ? { level: "中风险", tone: "warning" as const }
        : { level: "低风险", tone: "success" as const };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            最新扫描
          </Text>
          <Badge tone={riskLevel.tone} size="large">
            {riskLevel.level}
          </Badge>
        </InlineStack>

        {}
        <Box
          background={
            latestScan.riskScore >= 70
              ? "bg-fill-critical"
              : latestScan.riskScore >= 40
                ? "bg-fill-warning"
                : "bg-fill-success"
          }
          padding="500"
          borderRadius="200"
        >
          <BlockStack gap="200" align="center">
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {latestScan.riskScore}
            </Text>
            <Text as="p" variant="bodySm">
              / 100
            </Text>
          </BlockStack>
        </Box>

        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            扫描时间: {new Date(latestScan.createdAt).toLocaleDateString("zh-CN")}
          </Text>
          {latestScan.identifiedPlatforms.length > 0 ? (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                识别到的平台:
              </Text>
              <InlineStack gap="100" wrap>
                {latestScan.identifiedPlatforms.map((platform) => (
                  <Badge key={platform}>{platform}</Badge>
                ))}
              </InlineStack>
            </BlockStack>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              未识别到追踪平台
            </Text>
          )}
        </BlockStack>

        <Button url="/app/scan" fullWidth>
          查看完整报告
        </Button>
      </BlockStack>
    </Card>
  );
});

const SetupProgressCard = memo(function SetupProgressCard({
  steps,
  nextStep,
}: {
  steps: SetupStep[];
  nextStep: SetupStep | undefined;
}) {
  const progress = useMemo(() => getSetupProgress(steps), [steps]);

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

function MigrationDeadlineBanner({ scriptTagsCount }: { scriptTagsCount: number }) {
  return (
    <Banner
      title="重要迁移截止日期"
      tone={scriptTagsCount > 0 ? "warning" : "info"}
      action={{
        content: "了解更多",
        url: "https:
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
              url="https:
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
              url="https:
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

function MigrationChecklistPreviewCard({
  checklist,
  estimatedTimeMinutes,
}: {
  checklist: DashboardData["migrationChecklist"];
  estimatedTimeMinutes?: number;
}) {
  if (!checklist || checklist.totalItems === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            迁移清单
          </Text>
          <EnhancedEmptyState
            icon="📋"
            title="暂无迁移清单"
            description="完成扫描后，我们将为您生成迁移清单和优先级建议。"
            primaryAction={{
              content: "开始扫描",
              url: "/app/scan",
            }}
          />
        </BlockStack>
      </Card>
    );
  }

  const estimatedHours = Math.floor(checklist.estimatedTotalTime / 60);
  const estimatedMinutes = checklist.estimatedTotalTime % 60;
  const timeText =
    estimatedHours > 0
      ? `${estimatedHours} 小时 ${estimatedMinutes > 0 ? estimatedMinutes + " 分钟" : ""}`
      : `${estimatedMinutes} 分钟`;

  const completedItems = checklist.topItems.filter((item) => item.status === "completed").length;
  const remainingItems = checklist.totalItems - completedItems;
  const avgTimePerItem = checklist.totalItems > 0
    ? checklist.estimatedTotalTime / checklist.totalItems
    : 0;
  const remainingTime = Math.ceil(remainingItems * avgTimePerItem);
  const remainingHours = Math.floor(remainingTime / 60);
  const remainingMinutes = remainingTime % 60;
  const remainingTimeText =
    remainingHours > 0
      ? `${remainingHours} 小时 ${remainingMinutes > 0 ? remainingMinutes + " 分钟" : ""}`
      : `${remainingMinutes} 分钟`;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            迁移清单预览
          </Text>
          <Badge tone="info">{checklist.totalItems} 项</Badge>
        </InlineStack>

        {}
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                高风险项
              </Text>
              <Text as="span" fontWeight="semibold" tone="critical">
                {checklist.highPriorityItems}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                中风险项
              </Text>
              <Text as="span" fontWeight="semibold" tone="warning">
                {checklist.mediumPriorityItems}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                低风险项
              </Text>
              <Text as="span" fontWeight="semibold" tone="success">
                {checklist.lowPriorityItems}
              </Text>
            </InlineStack>
            <Divider />
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                预计总时间
              </Text>
              <Text as="span" fontWeight="semibold">
                {timeText}
              </Text>
            </InlineStack>
            {remainingItems > 0 && (
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  剩余时间
                </Text>
                <Text as="span" fontWeight="semibold">
                  {remainingTimeText}
                </Text>
              </InlineStack>
            )}
            {completedItems > 0 && (
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  完成进度
                </Text>
                <Text as="span" fontWeight="semibold">
                  {completedItems} / {checklist.totalItems} ({Math.round((completedItems / checklist.totalItems) * 100)}%)
                </Text>
              </InlineStack>
            )}
          </BlockStack>
        </Box>

        {}
        {checklist.topItems.length > 0 && (
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              优先级最高的项目
            </Text>
            <BlockStack gap="200">
              {checklist.topItems.map((item) => {
                const priorityBadgeTone =
                  item.priority >= 8 ? "critical" :
                  item.priority >= 5 ? "warning" :
                  "info";

                const estimatedTimeText = item.estimatedTime
                  ? item.estimatedTime < 60
                    ? `${item.estimatedTime} 分钟`
                    : `${Math.floor(item.estimatedTime / 60)} 小时 ${item.estimatedTime % 60} 分钟`
                  : "待估算";

                return (
                  <Box
                    key={item.id}
                    background={item.status === "completed" ? "bg-surface-success" : "bg-surface-secondary"}
                    padding="300"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Badge
                            tone={
                              item.riskLevel === "high"
                                ? "critical"
                                : item.riskLevel === "medium"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {item.riskLevel === "high" ? "高" : item.riskLevel === "medium" ? "中" : "低"}
                          </Badge>
                          {item.priority > 0 && (
                            <Badge tone={priorityBadgeTone}>
                              优先级 {item.priority}/10
                            </Badge>
                          )}
                          {item.status === "completed" && (
                            <Icon source={CheckCircleIcon} tone="success" />
                          )}
                          {item.status === "in_progress" && (
                            <Badge tone="info">进行中</Badge>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {item.title}
                        </Text>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            <Icon source={ClockIcon} />
                            {estimatedTimeText}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                      {item.status === "pending" && (
                        <Button
                          size="slim"
                          url={`/app/migrate?asset=${item.id.replace("checklist-", "")}`}
                        >
                          开始迁移
                        </Button>
                      )}
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
            {checklist.totalItems > checklist.topItems.length && (
              <Text as="p" variant="bodySm" tone="subdued">
                还有 {checklist.totalItems - checklist.topItems.length} 项待处理
              </Text>
            )}
          </BlockStack>
        )}

        <Button url="/app/scan" fullWidth icon={ArrowRightIcon}>
          查看完整清单
        </Button>
      </BlockStack>
    </Card>
  );
}

const WELCOME_BANNER_DISMISSED_KEY = "tg-welcome-banner-dismissed";

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(true);
  const [showScanProgress, setShowScanProgress] = useState(false);
  const [scanStartedAt] = useState(() => new Date());

  const data: DashboardData = {
    ...loaderData,
    latestScan: loaderData.latestScan
      ? {
          ...loaderData.latestScan,
          createdAt: new Date(loaderData.latestScan.createdAt),
        }
      : null,
  };

  useEffect(() => {
    const dismissed = localStorage.getItem(WELCOME_BANNER_DISMISSED_KEY);
    if (dismissed === "true") {
      setShowWelcomeBanner(false);
    }

    const isNewInstall = data.showOnboarding && !data.latestScan;
    if (isNewInstall) {
      setShowScanProgress(true);

      const timer = setTimeout(() => {
        setShowScanProgress(false);
      }, 12000);
      return () => clearTimeout(timer);
    }
  }, [data.showOnboarding, data.latestScan]);

  const handleDismissWelcomeBanner = () => {
    localStorage.setItem(WELCOME_BANNER_DISMISSED_KEY, "true");
    setShowWelcomeBanner(false);
  };

  const handleScanComplete = () => {
    setShowScanProgress(false);
  };

  const setupSteps = getSetupSteps(data);
  const nextStep = getNextSetupStep(setupSteps);
  const progress = getSetupProgress(setupSteps);

  const handleStartAudit = () => {
    navigate("/app/scan");
  };

  const handleViewDashboard = () => {

  };

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
        {}
        {showWelcomeBanner && (
          <Banner title="欢迎使用 Tracking Guardian" tone="info" onDismiss={handleDismissWelcomeBanner}>
            <p>
              帮助您扫描、迁移和监控 Thank you / Order status 页面的追踪脚本，
              确保在 Checkout Extensibility 迁移后转化追踪正常工作。
            </p>
          </Banner>
        )}

        {}
        {}
        {showScanProgress && data.showOnboarding && !data.latestScan && (
          <PostInstallScanProgress
            shopId={data.shopDomain}
            scanStartedAt={scanStartedAt}
            onComplete={handleScanComplete}
          />
        )}
        {!showScanProgress && data.showOnboarding && data.latestScan && (
          <UpgradeHealthCheck
            typOspPagesEnabled={data.typOspPagesEnabled ?? false}
            riskScore={data.latestScan?.riskScore ?? 0}
            estimatedMigrationTimeMinutes={data.estimatedMigrationTimeMinutes ?? 30}
            scriptTagsCount={data.scriptTagsCount}
            identifiedPlatforms={data.latestScan?.identifiedPlatforms ?? []}
            onStartAudit={handleStartAudit}
            onViewDashboard={handleViewDashboard}
          />
        )}

        {}
        {!progress.allComplete && <SetupProgressCard steps={setupSteps} nextStep={nextStep} />}

        {}
        {}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              🚀 快速入口
            </Text>
            <Layout>
              <Layout.Section variant="oneThird">
                <Button url="/app/scan" fullWidth variant="primary">
                  🔍 开始扫描
                </Button>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Button url="/app/migrate" fullWidth>
                  🔄 像素迁移
                </Button>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Button url="/app/verification" fullWidth>
                  ✅ 验收测试
                </Button>
              </Layout.Section>
            </Layout>
            <Layout>
              <Layout.Section variant="oneThird">
                <Button url="/app/monitor" fullWidth>
                  📊 监控面板
                </Button>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Button url="/app/settings" fullWidth>
                  ⚙️ 设置
                </Button>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Button url="/app/billing" fullWidth>
                  💳 套餐管理
                </Button>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>

        {}
        <Layout>
          <Layout.Section variant="oneThird">
            <HealthScoreCard score={data.healthScore} status={data.healthStatus} />
          </Layout.Section>
          <Layout.Section variant="oneThird">
          <QuickStatsCard
            configuredPlatforms={data.configuredPlatforms}
            weeklyConversions={data.weeklyConversions}
            plan={data.plan}
            planLabel={data.planLabel}
            planTagline={data.planTagline}
            planFeatures={data.planFeatures}
          />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <LatestScanCard latestScan={loaderData.latestScan} />
          </Layout.Section>
        </Layout>

        {}
        {}
        {data.migrationChecklist && (
          <Layout>
            <Layout.Section>
              <MigrationChecklistPreviewCard
                checklist={data.migrationChecklist}
                estimatedTimeMinutes={data.estimatedMigrationTimeMinutes}
              />
            </Layout.Section>
          </Layout>
        )}

        {}
        {(data.dependencyGraph || data.riskDistribution) && (
          <Layout>
            {data.dependencyGraph && (
              <Layout.Section variant="oneHalf">
                <DependencyGraphPreview dependencyGraph={data.dependencyGraph} />
              </Layout.Section>
            )}
            {data.riskDistribution && (
              <Layout.Section variant="oneHalf">
                <RiskDistributionChart distribution={data.riskDistribution} />
              </Layout.Section>
            )}
          </Layout>
        )}

        {}
        <ScriptTagMigrationBanner
          scriptTagsCount={data.scriptTagsCount}
          hasOrderStatusScripts={data.hasOrderStatusScripts}
        />
        <MigrationDeadlineBanner scriptTagsCount={data.scriptTagsCount} />
      </BlockStack>
    </Page>
  );
}
