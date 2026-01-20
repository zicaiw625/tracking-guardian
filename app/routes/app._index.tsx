import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData , useNavigate } from "@remix-run/react";
import { useState, useEffect, memo, useMemo , lazy, Suspense } from "react";
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
import { CheckCircleIcon, ArrowRightIcon, ClockIcon, LockIcon } from "~/components/icons";
import { EnhancedEmptyState, CardSkeleton } from "~/components/ui";
import { UpgradeHealthCheck } from "~/components/onboarding/UpgradeHealthCheck";
import { PostInstallScanProgress } from "~/components/onboarding/PostInstallScanProgress";
const RiskDistributionChart = lazy(() => import("~/components/dashboard/RiskDistributionChart").then(module => ({ default: module.RiskDistributionChart })));
const DependencyGraphPreview = lazy(() => import("~/components/dashboard/DependencyGraphPreview").then(module => ({ default: module.DependencyGraphPreview })));
import { HealthMetrics24hCard } from "~/components/dashboard/HealthMetrics24hCard";
import { AlertsTodoCard } from "~/components/dashboard/AlertsTodoCard";
import { PageIntroCard } from "~/components/layout/PageIntroCard";

import { authenticate } from "../shopify.server";
import { getDashboardData } from "../services/dashboard.server";
import {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
  type DashboardData,
  type SetupStep,
} from "../types/dashboard";
import { isPlanAtLeast } from "../utils/plans";
import { DEPRECATION_DATES, formatDeadlineDate, SHOPIFY_HELP_LINKS } from "../utils/migration-deadlines";
import { getPixelEventIngestionUrl } from "../utils/config.server";
import { getShopifyAdminUrl } from "../utils/helpers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const data = await getDashboardData(session.shop);
  const { checkCustomerAccountsEnabled } = await import("../services/customer-accounts.server");
  const customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
  const backendUrlInfo = getPixelEventIngestionUrl();
  return json({
    ...data,
    customerAccountsEnabled: customerAccountsStatus.enabled,
    shopDomain: session.shop,
    backendUrlInfo,
  });
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for dashboard
const MigrationStatusCard = memo(function MigrationStatusCard({
  typOspPagesEnabled,
  riskScore,
  estimatedMigrationTimeMinutes,
  scriptTagsCount,
  identifiedPlatforms,
}: {
  typOspPagesEnabled: boolean;
  riskScore: number | null;
  estimatedMigrationTimeMinutes: number | null;
  scriptTagsCount: number;
  identifiedPlatforms: string[];
}) {
  const upgradeStatusBadge = typOspPagesEnabled
    ? { tone: "success" as const, label: "已升级" }
    : { tone: "warning" as const, label: "未升级" };
  const riskBadge =
    riskScore === null
      ? { tone: "info" as const, label: "待评估" }
      : riskScore >= 70
        ? { tone: "critical" as const, label: "高风险" }
        : riskScore >= 40
          ? { tone: "warning" as const, label: "中风险" }
          : { tone: "success" as const, label: "低风险" };
  const formatEstimatedTime = (minutes: number | null): string => {
    if (minutes === null) return "待计算";
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            升级状态概览
          </Text>
        </InlineStack>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              Checkout 升级状态
            </Text>
            <Badge tone={upgradeStatusBadge.tone}>{upgradeStatusBadge.label}</Badge>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              风险评分
            </Text>
            <InlineStack gap="200" blockAlign="center">
              {riskScore !== null && (
                <Text as="span" variant="bodyMd" fontWeight="bold">
                  {riskScore} / 100
                </Text>
              )}
              <Badge tone={riskBadge.tone}>{riskBadge.label}</Badge>
            </InlineStack>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              预计迁移时间
            </Text>
            <Text as="span" variant="bodyMd">
              {formatEstimatedTime(estimatedMigrationTimeMinutes)}
            </Text>
          </InlineStack>
          {scriptTagsCount > 0 && (
            <>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  待迁移 ScriptTags
                </Text>
                <Badge>{`${scriptTagsCount} 个`}</Badge>
              </InlineStack>
            </>
          )}
          {identifiedPlatforms.length > 0 && (
            <>
              <Divider />
              <BlockStack gap="200">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  识别到的平台
                </Text>
                <InlineStack gap="100" wrap>
                  {identifiedPlatforms.map((platform) => (
                    <Badge key={platform}>{platform}</Badge>
                  ))}
                </InlineStack>
              </BlockStack>
            </>
          )}
          {!typOspPagesEnabled && (
            <>
              <Divider />
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  您的店铺尚未升级到新的 Checkout 系统。建议尽快升级以避免追踪脚本失效。
                </Text>
              </Banner>
            </>
          )}
        </BlockStack>
      </BlockStack>
    </Card>
  );
});

const UpgradeStatusCard = memo(function UpgradeStatusCard({
  upgradeStatus,
}: {
  upgradeStatus?: import("../types/dashboard").UpgradeStatus;
}) {
  if (!upgradeStatus) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">升级状态</Text>
          <EnhancedEmptyState
            icon="📊"
            title="状态待确认"
            description="正在加载升级状态信息..."
          />
        </BlockStack>
      </Card>
    );
  }
  const statusBadge = upgradeStatus.isUpgraded
    ? { tone: "success" as const, label: "已升级（新版本）" }
    : { tone: "warning" as const, label: "未升级（旧版本）" };
  const urgencyBadge = {
    critical: { tone: "critical" as const, label: "紧急" },
    high: { tone: "critical" as const, label: "高" },
    medium: { tone: "warning" as const, label: "中" },
    low: { tone: "info" as const, label: "低" },
    resolved: { tone: "success" as const, label: "已完成" },
  }[upgradeStatus.urgency];
  const deadlineLabel = upgradeStatus.deadlineDate;
  const autoUpgradeLabel = upgradeStatus.autoUpgradeStartDate || "";
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">升级状态</Text>
          <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
        </InlineStack>
        <BlockStack gap="300">
          {}
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                Checkout Extensibility 状态
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {upgradeStatus.isUpgraded
                  ? "您的店铺已使用新版 Checkout Extensibility"
                  : "您的店铺仍在使用旧版 Checkout 系统"}
              </Text>
            </BlockStack>
            <Badge tone={statusBadge.tone}>
              {upgradeStatus.isUpgraded ? "新版本" : "旧版本"}
            </Badge>
          </InlineStack>
          {}
          {!upgradeStatus.isUpgraded && (
            <>
              <Divider />
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    <strong>影响提示：</strong>
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        旧版 ScriptTags 和 Additional Scripts 将在截止日期后停止执行
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        追踪脚本可能失效，导致转化数据丢失
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        建议尽快完成迁移以避免追踪中断
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
            </>
          )}
          {}
          <Button
            url="/app/audit/start"
            variant="primary"
            size="large"
            fullWidth
          >
            开始 Audit
          </Button>
          <Divider />
          {upgradeStatus.shopTier === "plus" && (
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  迁移截止日期
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="bold">{deadlineLabel}</Text>
                  <Badge tone={urgencyBadge.tone}>{urgencyBadge.label}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                日期来源：来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。
              </Text>
              {upgradeStatus.daysRemaining > 0 && upgradeStatus.daysRemaining <= 365 && (
                <Box
                  padding="400"
                  background={
                    upgradeStatus.urgency === "critical"
                      ? "bg-surface-critical"
                      : upgradeStatus.urgency === "high"
                        ? "bg-surface-warning"
                        : "bg-surface-info"
                  }
                  borderRadius="200"
                >
                  <InlineStack gap="300" blockAlign="center">
                    <Icon source={ClockIcon} />
                    <BlockStack gap="100">
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        剩余 {upgradeStatus.daysRemaining} 天
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        建议尽快完成迁移以避免功能丢失
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
              )}
              {autoUpgradeLabel && (
                <>
                  <Divider />
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      自动升级开始
                    </Text>
                    <Text as="span" variant="bodyMd" fontWeight="bold">{autoUpgradeLabel}</Text>
                  </InlineStack>
                  <Banner tone="warning">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm">
                        <strong>{autoUpgradeLabel}</strong> 起，Shopify 开始自动升级 Plus 商家到新版 TYP/OSP 页面，legacy 定制会丢失。
                      </Text>
                      <Link
                        url="https://help.shopify.com/en/manual/checkout-settings/upgrade-guide"
                        external
                      >
                        查看 Plus 商家升级指南
                      </Link>
                    </BlockStack>
                  </Banner>
                </>
              )}
            </BlockStack>
          )}
          {upgradeStatus.shopTier === "non_plus" && (
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  迁移截止日期
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="bold">{deadlineLabel}</Text>
                  <Badge tone={urgencyBadge.tone}>{urgencyBadge.label}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                日期来源：来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。
              </Text>
              {upgradeStatus.daysRemaining > 0 && upgradeStatus.daysRemaining <= 365 && (
                <Box
                  padding="400"
                  background={
                    upgradeStatus.urgency === "critical"
                      ? "bg-surface-critical"
                      : upgradeStatus.urgency === "high"
                        ? "bg-surface-warning"
                        : "bg-surface-info"
                  }
                  borderRadius="200"
                >
                  <InlineStack gap="300" blockAlign="center">
                    <Icon source={ClockIcon} />
                    <BlockStack gap="100">
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        剩余 {upgradeStatus.daysRemaining} 天
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        建议尽快完成迁移以避免功能丢失
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          )}
          {upgradeStatus.daysRemaining <= 0 && (
            <>
              <Divider />
              <Banner tone="critical">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    截止日期已过，请立即完成迁移以避免追踪中断。
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    日期来源：来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。
                  </Text>
                </BlockStack>
              </Banner>
            </>
          )}
        </BlockStack>
      </BlockStack>
    </Card>
  );
});

const RiskScoreCard = memo(function RiskScoreCard({
  riskScore,
  riskLevel,
  estimatedMigrationTimeMinutes,
  topRiskSources,
}: {
  riskScore?: number | null;
  riskLevel?: "high" | "medium" | "low" | null;
  estimatedMigrationTimeMinutes?: number | null;
  topRiskSources?: Array<{ source: string; count: number; category: string }>;
}) {
  const riskBadge =
    riskLevel === "high"
      ? { tone: "critical" as const, label: "高风险" }
      : riskLevel === "medium"
        ? { tone: "warning" as const, label: "中风险" }
        : riskLevel === "low"
          ? { tone: "success" as const, label: "低风险" }
          : { tone: "info" as const, label: "待评估" };
  const formatEstimatedTime = (minutes: number | null): string => {
    if (minutes === null) return "待计算";
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };
  const riskColor = riskLevel === "high"
    ? "bg-fill-critical"
    : riskLevel === "medium"
      ? "bg-fill-caution"
      : riskLevel === "low"
        ? "bg-fill-success"
        : "bg-surface-secondary";
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          风险分数
        </Text>
        <Box background={riskColor} padding="600" borderRadius="200">
          <BlockStack gap="200" align="center">
            {riskScore !== null ? (
              <>
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {riskScore}
                </Text>
                <Text as="p" variant="bodySm">/ 100</Text>
              </>
            ) : (
              <>
                <Text as="p" variant="headingLg" fontWeight="semibold">
                  待评估
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  完成体检后显示
                </Text>
              </>
            )}
          </BlockStack>
        </Box>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            风险等级
          </Text>
          <Badge tone={riskBadge.tone}>{riskBadge.label}</Badge>
        </InlineStack>
        <Divider />
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            预计迁移时长
          </Text>
          <Text as="span" variant="bodyMd">
            {formatEstimatedTime(estimatedMigrationTimeMinutes ?? null)}
          </Text>
        </InlineStack>
        {}
        {topRiskSources && topRiskSources.length > 0 && (
          <>
            <Divider />
            <BlockStack gap="200">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                主要风险来源
              </Text>
              <List>
                {topRiskSources.map((source, index) => (
                  <List.Item key={`${source.category}-${source.source}`}>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm">
                        {index + 1}. {source.source}
                      </Text>
                      <Badge tone="critical">{`${source.count} 个`}</Badge>
                    </InlineStack>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
});

const MigrationProgressCard = memo(function MigrationProgressCard({
  migrationProgress,
}: {
  migrationProgress?: import("../types/dashboard").MigrationProgress;
}) {
  if (!migrationProgress) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            迁移进度
          </Text>
          <EnhancedEmptyState
            icon="📊"
            title="暂无迁移进度"
            description="开始迁移后，进度将在这里显示。"
            primaryAction={{
              content: "开始体检",
              url: "/app/audit/start",
            }}
          />
        </BlockStack>
      </Card>
    );
  }
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            迁移进度
          </Text>
          <Text as="span" variant="bodyMd" tone="subdued">
            {migrationProgress.progressPercentage}%
          </Text>
        </InlineStack>
        <ProgressBar progress={migrationProgress.progressPercentage} />
        {}
        {(migrationProgress.auditCompletion || migrationProgress.pixelsStatus || migrationProgress.modulesEnabled !== undefined || migrationProgress.verificationLatest) && (
          <BlockStack gap="300">
            <Divider />
            <Text as="h3" variant="headingSm">
              详细进度
            </Text>
            <BlockStack gap="200">
              {migrationProgress.auditCompletion && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">Audit 完成度</Text>
                  <Badge tone={migrationProgress.auditCompletion.completed ? "success" : migrationProgress.auditCompletion.status === "in_progress" ? "info" : undefined}>
                    {migrationProgress.auditCompletion.completed ? "已完成" : migrationProgress.auditCompletion.status === "in_progress" ? "进行中" : "待开始"}
                  </Badge>
                </InlineStack>
              )}
              {migrationProgress.pixelsStatus && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">Pixels 状态</Text>
                  <InlineStack gap="200">
                    <Badge tone={migrationProgress.pixelsStatus.test > 0 ? "warning" : undefined}>
                      {`Test: ${migrationProgress.pixelsStatus.test}`}
                    </Badge>
                    <Badge tone={migrationProgress.pixelsStatus.live > 0 ? "success" : undefined}>
                      {`Live: ${migrationProgress.pixelsStatus.live}`}
                    </Badge>
                  </InlineStack>
                </InlineStack>
              )}
              {migrationProgress.modulesEnabled !== undefined && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">Modules 启用数</Text>
                  <Badge tone={migrationProgress.modulesEnabled > 0 ? "success" : undefined}>
                    {`${migrationProgress.modulesEnabled} 个`}
                  </Badge>
                </InlineStack>
              )}
              {migrationProgress.verificationLatest && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm">Verification 最近结果</Text>
                  <Badge tone={migrationProgress.verificationLatest.status === "completed" ? "success" : migrationProgress.verificationLatest.status === "running" ? "info" : undefined}>
                    {migrationProgress.verificationLatest.status === "completed" ? "已完成" : migrationProgress.verificationLatest.status === "running" ? "运行中" : migrationProgress.verificationLatest.status === "pending" ? "待开始" : "无记录"}
                  </Badge>
                </InlineStack>
              )}
            </BlockStack>
          </BlockStack>
        )}
        <BlockStack gap="200">
          {migrationProgress.stages.map((stage, _index) => {
            const isCompleted = stage.completed;
            const isCurrent = stage.stage === migrationProgress.currentStage;
            return (
              <InlineStack key={stage.stage} gap="300" blockAlign="center">
                {isCompleted ? (
                  <Icon source={CheckCircleIcon} tone="success" />
                ) : isCurrent || stage.inProgress ? (
                  <Icon source={ClockIcon} tone="info" />
                ) : (
                  <Box minWidth="20px" />
                )}
                <Text
                  as="span"
                  variant="bodyMd"
                  tone={isCompleted ? "success" : isCurrent ? undefined : undefined}
                  fontWeight={isCurrent ? "semibold" : "regular"}
                >
                  {stage.label}
                </Text>
                {isCurrent && (
                  <Badge tone="info">进行中</Badge>
                )}
              </InlineStack>
            );
          })}
        </BlockStack>
        {migrationProgress.progressPercentage < 100 && (
          <Button url="/app/audit/start" variant="primary">
            {migrationProgress.currentStage === "audit" ? "开始体检" : "继续迁移"}
          </Button>
        )}
      </BlockStack>
    </Card>
  );
});

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
              url: "/app/audit/start",
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
        <Button url="/app/audit/report" fullWidth>
          查看完整报告
        </Button>
      </BlockStack>
    </Card>
  );
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for dashboard
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
});

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
      secondaryAction={{ content: "查看扫描详情", url: "/app/audit/report" }}
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
  const plusDeadline = formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact");
  const plusAutoUpgrade = formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month");
  const nonPlusDeadline = formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact");
  return (
    <Banner
      title="重要迁移截止日期"
      tone={scriptTagsCount > 0 ? "warning" : "info"}
      action={{
        content: "了解更多",
        url: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE,
        external: true,
      }}
    >
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>重要提示：</strong>以下日期来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。Shopify 可能会更新策略，我们建议您定期查看 Shopify 官方文档。
        </Text>
        <BlockStack gap="100">
          <Text as="p">
            <strong>Plus 商家:</strong> <strong>{plusDeadline}</strong> 开始限制（ScriptTag/Additional Scripts 停止执行，关键节点：升级/限制开始），<strong>{plusAutoUpgrade}</strong> 起 Shopify 开始自动升级（legacy 定制会丢失）。参考 <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>Shopify Help Center</Link>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}
              external
            >
              查看 Plus 商家升级指南
            </Link>
          </Text>
        </BlockStack>
        <BlockStack gap="100">
          <Text as="p">
            <strong>非 Plus 商家:</strong> 最晚 <strong>{nonPlusDeadline}</strong> 截止。参考 <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>Shopify Help Center</Link>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}
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
  estimatedTimeMinutes: _estimatedTimeMinutes,
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
              url: "/app/audit/start",
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
          <Badge tone="info">{`${checklist.totalItems} 项`}</Badge>
        </InlineStack>
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
              <Text as="span" fontWeight="semibold">
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
                              {`优先级 ${item.priority}/10`}
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
        <Button url="/app/audit/report" fullWidth icon={ArrowRightIcon}>
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
  const data = {
    ...loaderData,
    latestScan: loaderData.latestScan
      ? {
          ...loaderData.latestScan,
          createdAt: new Date(loaderData.latestScan.createdAt as string),
        }
      : null,
    migrationProgress: loaderData.migrationProgress
      ? {
          ...loaderData.migrationProgress,
          verificationLatest: loaderData.migrationProgress.verificationLatest
            ? {
                ...loaderData.migrationProgress.verificationLatest,
                completedAt:
                  loaderData.migrationProgress.verificationLatest.completedAt != null
                    ? new Date(loaderData.migrationProgress.verificationLatest.completedAt as string)
                    : null,
              }
            : undefined,
        }
      : undefined,
  } as DashboardData;
  const customerAccountsEnabled = loaderData.customerAccountsEnabled ?? false;
  const shopDomain = loaderData.shopDomain ?? "";
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
    navigate("/app/audit/start");
  };
  const handleViewDashboard = () => {
  };
  return (
    <Page
      title="升级迁移交付平台"
      subtitle={`Shopify 官方 deadline：Plus 商家 ${formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} 开始限制，${formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month")} 起自动升级 • 非 Plus 商家 ${formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 截止 • 升级不丢功能/不丢数据 • 可交付的验收报告 • 上线后有断档告警`}
      primaryAction={
        !progress.allComplete && nextStep
          ? { content: nextStep.cta, url: nextStep.url }
          : undefined
      }
    >
      <BlockStack gap="500">
        {loaderData.backendUrlInfo?.placeholderDetected && (
          <Banner tone="critical" title="⚠️ 严重错误：BACKEND_URL 未在构建时替换">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>检测到占位符 __BACKEND_URL_PLACEHOLDER__，URL 未在构建时替换</strong>
              </Text>
              <Text as="p" variant="bodySm">
                像素扩展配置中仍包含占位符，这表明构建流程未正确替换占位符。如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是一个严重的配置错误，必须在上线前修复。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                修复步骤（必须在生产环境部署前完成）：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在 CI/CD 流程中，部署前必须运行 <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code>
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    确保环境变量 <code>SHOPIFY_APP_URL</code> 已正确设置
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    验证扩展构建产物中不再包含占位符
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    禁止直接使用 <code>shopify app deploy</code>，必须使用 <code>pnpm deploy:ext</code>
                  </Text>
                </List.Item>
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                💡 提示：如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。
              </Text>
            </BlockStack>
          </Banner>
        )}
        {customerAccountsEnabled === false && (
          <Banner tone="critical" title="⚠️ 重要：Customer Accounts 未启用">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>检测到您的店铺未启用 Customer Accounts 功能</strong>
              </Text>
              <Text as="p" variant="bodySm">
                Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，当前无法使用。这是 Shopify 平台的设计限制，不是应用限制。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                解决方案：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    点击下方按钮，直接跳转到 Shopify Admin 设置页面
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在"客户账户"设置页面中启用 Customer Accounts 功能
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    返回本页面，刷新后即可使用 Order Status 模块
                  </Text>
                </List.Item>
              </List>
              <InlineStack gap="200" align="start">
                <Button
                  url={getShopifyAdminUrl(shopDomain, "/settings/customer-accounts")}
                  variant="primary"
                  size="medium"
                  external
                >
                  立即前往启用 Customer Accounts
                </Button>
                <Button
                  url="/app/modules"
                  variant="secondary"
                  size="medium"
                >
                  查看模块配置
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                💡 提示：如果您的店铺使用旧版订单状态页（非 Customer Accounts），Order Status 模块将不会显示。请参考 <a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">Customer Accounts UI Extensions 官方文档</a>。
              </Text>
            </BlockStack>
          </Banner>
        )}
        {showWelcomeBanner && (
          <Banner title="Shopify 升级迁移交付平台" tone="info" onDismiss={handleDismissWelcomeBanner}>
            <BlockStack gap="300">
              <Text as="p">
                <strong>Shopify 硬 deadline（官方公告）：</strong>
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                以下日期来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。Shopify 可能会更新策略，我们建议您定期查看 Shopify 官方文档。
              </Text>
              <List>
                <List.Item>
                  <strong>Plus 商家</strong>：<strong>{formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")}</strong> 开始限制（ScriptTag/Additional Scripts 停止执行，关键节点：升级/限制开始），<strong>{formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month")}</strong> 起 Shopify 开始自动升级（legacy 定制会丢失）。参考{" "}
                  <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>
                    Shopify Help Center 升级指南
                  </Link>
                </List.Item>
                <List.Item>
                  <strong>非 Plus 商家</strong>：最晚 <strong>{formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")}</strong> 必须完成升级。参考{" "}
                  <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>
                    Shopify Help Center 升级指南
                  </Link>
                </List.Item>
                <List.Item>
                  Legacy 的 <code>checkout.liquid</code>、<code>additional scripts</code>、<code>script tags</code> 会逐步被 sunset
                </List.Item>
              </List>
              <div style={{ marginTop: "8px" }}>
              <Text as="p" variant="bodyMd">
                <strong>我们的承诺：</strong>
              </Text>
              </div>
              <List>
                <List.Item>
                  ✅ <strong>升级不丢功能/不丢数据</strong>（在 Shopify 允许范围内）
                </List.Item>
                <List.Item>
                  ✅ <strong>可交付的验收报告</strong>（PDF/CSV，给老板/客户看的证据）
                </List.Item>
                <List.Item>
                  ✅ <strong>上线后有断档告警</strong>（事件量骤降、失败率监控）
                </List.Item>
              </List>
              <Box paddingBlockStart="200">
                <Text as="p" variant="bodySm">
                  基于 <strong>Web Pixels + Customer Accounts UI Extensions</strong> 的合规迁移方案，替换 Additional Scripts，减少结账页脚本风险。
                </Text>
              </Box>
            </BlockStack>
          </Banner>
        )}
        <PageIntroCard
          title="30 秒看懂迁移进度"
          description="快速确认升级风险、迁移进度、最近 24h 健康度，并获取下一步行动建议。"
          items={[
            "优先完成 Audit 扫描生成迁移清单",
            "Test 环境验证事件与参数完整率",
            "上线后开启 Monitoring 与告警",
          ]}
          primaryAction={{ content: "开始 Audit", url: "/app/audit/start" }}
          secondaryAction={{ content: "查看报告", url: "/app/reports" }}
        />
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
        {}
        <Layout>
          <Layout.Section variant="oneThird">
            <UpgradeStatusCard upgradeStatus={data.upgradeStatus} />
          </Layout.Section>
          {}
          <Layout.Section variant="oneThird">
            <RiskScoreCard
              riskScore={data.riskScore}
              riskLevel={data.riskLevel}
              estimatedMigrationTimeMinutes={data.estimatedMigrationTimeMinutes}
              topRiskSources={data.topRiskSources}
            />
          </Layout.Section>
          {}
          <Layout.Section variant="oneThird">
            <MigrationProgressCard migrationProgress={data.migrationProgress} />
          </Layout.Section>
        </Layout>
        {}
        {data.healthMetrics24h && (
          <Layout>
            <Layout.Section>
              <HealthMetrics24hCard metrics={data.healthMetrics24h} />
            </Layout.Section>
          </Layout>
        )}
        {}
        <Banner tone="info" title="事件口径说明">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <strong>checkout_started 事件说明：</strong>在 extensible 店铺中，每次进入 checkout 页面都会触发 checkout_started 事件。
              这意味着如果用户多次进入 checkout（例如返回修改信息），该事件会被多次触发，可能影响事件量统计和去重逻辑。
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              建议：在分析事件量时，请考虑 checkout_started 的重复触发特性，重点关注 checkout_completed 等最终转化事件。
            </Text>
          </BlockStack>
        </Banner>
        {}
        {data.activeAlerts && data.activeAlerts.length > 0 && (
          <Layout>
            <Layout.Section>
              <AlertsTodoCard alerts={data.activeAlerts} />
            </Layout.Section>
          </Layout>
        )}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  {data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                    ? "免费体检（Audit 风险报告）"
                    : "查看完整 Audit 报告"}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {data.latestScan
                    ? "✅ 迁移清单 + 风险分级 + 替代路径（Web Pixel / Checkout UI Extension / 不可迁移）• 明确提示 checkout.liquid / additional scripts / script tags 在 Thank you/Order status 的弃用与限制 • 可分享链接并导出 PDF/CSV"
                    : "免费开始：自动扫描 ScriptTags/Web Pixels，手动粘贴识别 Additional Scripts，生成完整的迁移清单、风险分级和替代路径。报告会明确提示 checkout.liquid / additional scripts / script tags 在 Thank you/Order status 的弃用与限制"}
                </Text>
              </BlockStack>
              <Button
                url={
                  data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                    ? "/app/audit/start"
                    : "/app/audit/report"
                }
                variant="primary"
                size="large"
                icon={ArrowRightIcon}
              >
                {data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                  ? "开始免费体检"
                  : "查看完整报告"}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
        {data.latestScan && (
          <Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        🎯 启用像素迁移（Test 环境）
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        标准事件映射 + 参数完整率 + 可下载 payload 证据（GA4/Meta/TikTok 三选一）
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>技术说明：</strong>Web Pixel 是 strict sandbox（Web Worker），很多能力受限
                      </Text>
                      <Badge tone="info">Migration $49/月</Badge>
                    </BlockStack>
                    <Icon source={LockIcon} />
                  </InlineStack>
                  <Button
                    url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/migrate" : "/app/billing"}
                    variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                    fullWidth
                  >
                    {isPlanAtLeast(data.planId || "free", "starter") ? "开始迁移" : "升级到 Migration"}
                  </Button>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        📦 发布 Thank you/Order status 模块
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        可替代 legacy thank-you/order-status 自定义脚本的模块库：Survey 问卷、Helpdesk 帮助中心、Reorder 再购按钮等
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>迁移价值：</strong>基于 Customer Accounts UI Extensions，符合 Shopify 官方推荐，替代 Additional Scripts 中的问卷、售后按钮等自定义脚本
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>重要提示：</strong>Order status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），Order status 模块将不会显示。请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
                      </Text>
                      <Badge tone="info">Migration $49/月</Badge>
                    </BlockStack>
                    <Icon source={LockIcon} />
                  </InlineStack>
                  <Button
                    url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/modules" : "/app/billing"}
                    variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                    fullWidth
                  >
                    {isPlanAtLeast(data.planId || "free", "starter") ? "配置模块" : "升级到 Migration"}
                  </Button>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        📄 生成验收报告（PDF/CSV）
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        测试清单 + 事件参数完整率 + 订单金额/币种一致性 + 隐私合规检查（consent/customerPrivacy）• 给老板/客户看的证据
                      </Text>
                      <Badge tone="warning">Growth $79/月 或 Agency $199/月</Badge>
                    </BlockStack>
                    <Icon source={LockIcon} />
                  </InlineStack>
                  <Button
                    url={isPlanAtLeast(data.planId || "free", "growth") ? "/app/verification" : "/app/billing"}
                    variant={isPlanAtLeast(data.planId || "free", "growth") ? "primary" : "secondary"}
                    fullWidth
                  >
                    {isPlanAtLeast(data.planId || "free", "growth") ? "生成报告" : "升级到 Go-Live"}
                  </Button>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  报告中心
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  管理 Audit / Verification / Monitoring 报告导出与历史记录。
                </Text>
              </BlockStack>
              <Button url="/app/reports" size="slim" variant="primary">
                进入报告中心
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
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
        {(data.dependencyGraph || data.riskDistribution) && (
          <Layout>
            {data.dependencyGraph && (
              <Layout.Section variant="oneHalf">
                <Suspense fallback={<CardSkeleton />}>
                  <DependencyGraphPreview dependencyGraph={data.dependencyGraph} />
                </Suspense>
              </Layout.Section>
            )}
            {data.riskDistribution && (
              <Layout.Section variant="oneHalf">
                <Suspense fallback={<CardSkeleton />}>
                  <RiskDistributionChart distribution={data.riskDistribution} />
                </Suspense>
              </Layout.Section>
            )}
          </Layout>
        )}
        <ScriptTagMigrationBanner
          scriptTagsCount={data.scriptTagsCount}
          hasOrderStatusScripts={data.hasOrderStatusScripts}
        />
        <MigrationDeadlineBanner scriptTagsCount={data.scriptTagsCount} />
      </BlockStack>
    </Page>
  );
}
