import type { loader } from "./app._index/loader.server";
export { loader } from "./app._index/loader.server";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState, useEffect, useMemo } from "react";
import { Page, Banner, BlockStack, Card, Text, InlineStack, Badge, Divider, List, Button, Box, Icon, ProgressBar } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon } from "~/components/icons";
import { DashboardOverview } from "~/components/dashboard/DashboardOverview";
import { DashboardMetrics } from "~/components/dashboard/DashboardMetrics";
import {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
  type DashboardData,
  type SetupStep,
} from "../types/dashboard";
import { DEPRECATION_DATES, formatDeadlineDate } from "../utils/migration-deadlines";
import { ScriptTagMigrationBanner } from "~/components/dashboard/ScriptTagMigrationBanner";
import { MigrationDeadlineBanner } from "~/components/dashboard/MigrationDeadlineBanner";
import { EnhancedEmptyState } from "~/components/ui";
import { memo } from "react";
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
                        旧版 ScriptTags 将在截止日期后停止执行；Additional Scripts 将进入只读模式（不可编辑，PII 不可访问）
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
                        <strong>{autoUpgradeLabel}</strong> 起（Shopify 会提前30天通知），Shopify 开始自动升级 Plus 商家到新版 TYP/OSP 页面，legacy 定制会丢失。
                      </Text>
                      <a
                        href="https://help.shopify.com/en/manual/checkout-settings/upgrade-guide"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        查看 Plus 商家升级指南
                      </a>
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
        <DashboardOverview
          data={data}
          shopDomain={shopDomain}
          showWelcomeBanner={showWelcomeBanner}
          showScanProgress={showScanProgress}
          scanStartedAt={scanStartedAt}
          onDismissWelcomeBanner={handleDismissWelcomeBanner}
          onScanComplete={handleScanComplete}
          backendUrlInfo={loaderData.backendUrlInfo}
        />
        <DashboardMetrics
          data={data}
          latestScan={loaderData.latestScan}
        />
        <ScriptTagMigrationBanner
          scriptTagsCount={data.scriptTagsCount}
          hasOrderStatusScripts={data.hasOrderStatusScripts}
        />
        <MigrationDeadlineBanner scriptTagsCount={data.scriptTagsCount} />
      </BlockStack>
    </Page>
  );
}
