

import { Badge, InlineStack, Text, Tooltip } from "@shopify/polaris";

export type StatusType =
  | "success"
  | "warning"
  | "critical"
  | "info"
  | "attention"
  | "new";

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "limit_exceeded"
  | "dead_letter"
  | "pending"
  | "sent"
  | "retrying";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export type PlatformStatus = "active" | "inactive" | "error" | "pending";

export interface StatusBadgeProps {

  status: StatusType;

  label: string;

  tooltip?: string;
}

export function StatusBadge({ status, label, tooltip }: StatusBadgeProps) {
  const badge = <Badge tone={status}>{label}</Badge>;

  if (tooltip) {
    return <Tooltip content={tooltip}>{badge}</Tooltip>;
  }

  return badge;
}

export interface JobStatusBadgeProps {
  status: JobStatus;
  showTooltip?: boolean;
}

const JOB_STATUS_CONFIG: Record<JobStatus, { label: string; tone: StatusType; tooltip: string }> = {
  queued: { label: "排队中", tone: "info", tooltip: "任务正在队列中等待处理" },
  processing: { label: "处理中", tone: "attention", tooltip: "任务正在处理" },
  completed: { label: "已完成", tone: "success", tooltip: "任务已成功完成" },
  failed: { label: "失败", tone: "critical", tooltip: "任务执行失败，可能会重试" },
  limit_exceeded: { label: "超出限额", tone: "warning", tooltip: "已达到月度使用限额" },
  dead_letter: { label: "已放弃", tone: "critical", tooltip: "任务多次重试后仍失败" },
  pending: { label: "待处理", tone: "info", tooltip: "等待处理" },
  sent: { label: "已发送", tone: "success", tooltip: "已成功发送到平台" },
  retrying: { label: "重试中", tone: "attention", tooltip: "正在重试发送" },
};

export function JobStatusBadge({ status, showTooltip = true }: JobStatusBadgeProps) {
  const config = JOB_STATUS_CONFIG[status] || JOB_STATUS_CONFIG.pending;

  return (
    <StatusBadge
      status={config.tone}
      label={config.label}
      tooltip={showTooltip ? config.tooltip : undefined}
    />
  );
}

export interface HealthStatusBadgeProps {
  status: HealthStatus;
  score?: number;
  showTooltip?: boolean;
}

const HEALTH_STATUS_CONFIG: Record<HealthStatus, { label: string; tone: StatusType; tooltip: string }> = {
  healthy: { label: "健康", tone: "success", tooltip: "所有系统正常运行" },
  degraded: { label: "有风险", tone: "warning", tooltip: "部分指标异常，需要关注" },
  unhealthy: { label: "需关注", tone: "critical", tooltip: "多项指标异常，需要立即处理" },
  unknown: { label: "未初始化", tone: "info", tooltip: "尚未收集到足够数据" },
};

export function HealthStatusBadge({ status, score, showTooltip = true }: HealthStatusBadgeProps) {
  const config = HEALTH_STATUS_CONFIG[status] || HEALTH_STATUS_CONFIG.unknown;
  const label = score !== undefined ? `${config.label} (${score}分)` : config.label;

  return (
    <StatusBadge
      status={config.tone}
      label={label}
      tooltip={showTooltip ? config.tooltip : undefined}
    />
  );
}

export interface PlatformStatusBadgeProps {
  status: PlatformStatus;
  platform?: string;
  showTooltip?: boolean;
}

const PLATFORM_STATUS_CONFIG: Record<PlatformStatus, { label: string; tone: StatusType; tooltip: string }> = {
  active: { label: "已启用", tone: "success", tooltip: "平台连接正常，正在发送数据" },
  inactive: { label: "未启用", tone: "info", tooltip: "平台未启用服务端追踪" },
  error: { label: "错误", tone: "critical", tooltip: "平台连接异常，请检查配置" },
  pending: { label: "配置中", tone: "attention", tooltip: "正在配置平台连接" },
};

export function PlatformStatusBadge({ status, platform, showTooltip = true }: PlatformStatusBadgeProps) {
  const config = PLATFORM_STATUS_CONFIG[status] || PLATFORM_STATUS_CONFIG.inactive;
  const tooltip = platform
    ? `${platform}: ${config.tooltip}`
    : config.tooltip;

  return (
    <StatusBadge
      status={config.tone}
      label={config.label}
      tooltip={showTooltip ? tooltip : undefined}
    />
  );
}

export interface RiskScoreBadgeProps {
  score: number;
  showTooltip?: boolean;
}

export function RiskScoreBadge({ score, showTooltip = true }: RiskScoreBadgeProps) {
  let tone: StatusType;
  let tooltip: string;

  if (score >= 70) {
    tone = "critical";
    tooltip = "高风险：建议立即采取行动";
  } else if (score >= 40) {
    tone = "warning";
    tooltip = "中等风险：建议尽快处理";
  } else {
    tone = "success";
    tooltip = "低风险：状态良好";
  }

  return (
    <StatusBadge
      status={tone}
      label={`风险分 ${score}`}
      tooltip={showTooltip ? tooltip : undefined}
    />
  );
}

export interface PlanBadgeProps {
  plan: string;
}

const PLAN_CONFIG: Record<string, { label: string; tone: StatusType }> = {
  free: { label: "免费版", tone: "info" },
  starter: { label: "入门版", tone: "attention" },
  pro: { label: "专业版", tone: "success" },
  enterprise: { label: "企业版", tone: "new" },
};

export function PlanBadge({ plan }: PlanBadgeProps) {
  const config = PLAN_CONFIG[plan.toLowerCase()] || { label: plan, tone: "info" as StatusType };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export interface BooleanStatusProps {
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
}

export function BooleanStatus({
  value,
  trueLabel = "是",
  falseLabel = "否",
}: BooleanStatusProps) {
  return (
    <Badge tone={value ? "success" : "info"}>
      {value ? trueLabel : falseLabel}
    </Badge>
  );
}

export interface StatusWithCountProps {
  status: StatusType;
  label: string;
  count: number;
}

export function StatusWithCount({ status, label, count }: StatusWithCountProps) {
  return (
    <InlineStack gap="100" align="center">
      <Badge tone={status}>{label}</Badge>
      <Text as="span" variant="bodySm" fontWeight="semibold">
        {count}
      </Text>
    </InlineStack>
  );
}

