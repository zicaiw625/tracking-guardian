

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
                <Badge tone="warning">{scriptTagsCount} 个</Badge>
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
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              当前状态
            </Text>
            <Badge tone={statusBadge.tone}>
              {upgradeStatus.isUpgraded ? "新版本" : "旧版本"}
            </Badge>
          </InlineStack>

          <Divider />

          {}
          {upgradeStatus.shopTier === "plus" && (
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  截止日期
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="bold">{deadlineLabel}</Text>
                  <Badge tone={urgencyBadge.tone}>{urgencyBadge.label}</Badge>
                </InlineStack>
              </InlineStack>
              {upgradeStatus.daysRemaining > 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  剩余 {upgradeStatus.daysRemaining} 天
                </Text>
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

          {}
          {upgradeStatus.shopTier === "non_plus" && (
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  截止日期
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="bold">{deadlineLabel}</Text>
                  <Badge tone={urgencyBadge.tone}>{urgencyBadge.label}</Badge>
                </InlineStack>
              </InlineStack>
              {upgradeStatus.daysRemaining > 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  剩余 {upgradeStatus.daysRemaining} 天
                </Text>
              )}
            </BlockStack>
          )}

          {upgradeStatus.daysRemaining <= 0 && (
            <>
              <Divider />
              <Banner tone="critical">
                <Text as="p" variant="bodySm">
                  截止日期已过，请立即完成迁移以避免追踪中断。
                </Text>
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
}: {
  riskScore?: number | null;
  riskLevel?: "high" | "medium" | "low" | null;
  estimatedMigrationTimeMinutes?: number | null;
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
              url: "/app/scan",
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

        <BlockStack gap="200">
          {migrationProgress.stages.map((stage, index) => {
            const isCompleted = stage.completed;
            const isCurrent = stage.stage === migrationProgress.currentStage;
            const isPending = !isCompleted && !isCurrent && !stage.inProgress;

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
                  tone={isCompleted ? "success" : isCurrent ? "info" : isPending ? "subdued" : "base"}
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
          <Button url="/app/scan" variant="primary">
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
        url: "https://help.shopify.com/en/manual/checkout-settings/upgrade-guide",
        external: true,
      }}
    >
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="p">
            <strong>Plus 商家:</strong> 截止 <strong>2025-08-28</strong>，且 <strong>2026-01</strong> 自动升级开始（legacy 定制会丢失）
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url="https://help.shopify.com/en/manual/checkout-settings/upgrade-guide"
              external
            >
              查看 Plus 商家升级指南
            </Link>
          </Text>
        </BlockStack>
        <BlockStack gap="100">
          <Text as="p">
            <strong>非 Plus 商家:</strong> 截止 <strong>2026-08-26</strong>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url="https://help.shopify.com/en/manual/checkout-settings/upgrade-guide"
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
        {}
        <Layout>
          <Layout.Section variant="oneThird">
            <UpgradeStatusCard upgradeStatus={data.upgradeStatus} />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <RiskScoreCard
              riskScore={data.riskScore}
              riskLevel={data.riskLevel}
              estimatedMigrationTimeMinutes={data.estimatedMigrationTimeMinutes}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <MigrationProgressCard migrationProgress={data.migrationProgress} />
          </Layout.Section>
        </Layout>

        {}
        {}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  {data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                    ? "开始体检"
                    : "继续上次体检"}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {data.latestScan
                    ? "完成体检后将获得详细的迁移清单和推荐方案"
                    : "开始扫描现有的追踪脚本和像素，生成迁移清单"}
                </Text>
              </BlockStack>
              <Button
                url="/app/scan"
                variant="primary"
                size="large"
                icon={ArrowRightIcon}
              >
                {data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                  ? "开始体检"
                  : "继续上次体检"}
              </Button>
            </InlineStack>
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
