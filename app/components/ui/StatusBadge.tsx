import { Badge, InlineStack, Text, Tooltip } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

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

const JOB_STATUS_TONE: Record<JobStatus, StatusType> = {
  queued: "info",
  processing: "attention",
  completed: "success",
  failed: "critical",
  limit_exceeded: "warning",
  dead_letter: "critical",
  pending: "info",
  sent: "success",
  retrying: "attention",
};

export function JobStatusBadge({ status, showTooltip = true }: JobStatusBadgeProps) {
  const { t } = useTranslation();
  const tone = JOB_STATUS_TONE[status] || "info";
  // Fallback to pending if status is unknown? 
  // The original code did `JOB_STATUS_CONFIG[status] || JOB_STATUS_CONFIG.pending`
  const effectiveStatus = JOB_STATUS_TONE[status] ? status : 'pending';
  
  const label = t(`ui.badge.job.${effectiveStatus}.label`);
  const tooltipText = t(`ui.badge.job.${effectiveStatus}.tooltip`);

  return (
    <StatusBadge
      status={tone}
      label={label}
      tooltip={showTooltip ? tooltipText : undefined}
    />
  );
}

export interface HealthStatusBadgeProps {
  status: HealthStatus;
  score?: number;
  showTooltip?: boolean;
}

const HEALTH_STATUS_TONE: Record<HealthStatus, StatusType> = {
  healthy: "success",
  degraded: "warning",
  unhealthy: "critical",
  unknown: "info",
};

export function HealthStatusBadge({ status, score, showTooltip = true }: HealthStatusBadgeProps) {
  const { t } = useTranslation();
  const effectiveStatus = HEALTH_STATUS_TONE[status] ? status : 'unknown';
  const tone = HEALTH_STATUS_TONE[effectiveStatus];
  
  const baseLabel = t(`ui.badge.health.${effectiveStatus}.label`);
  const label = score !== undefined 
    ? t("ui.badge.health.labelWithScore", { label: baseLabel, score })
    : baseLabel;
  
  const tooltipText = t(`ui.badge.health.${effectiveStatus}.tooltip`);

  return (
    <StatusBadge
      status={tone}
      label={label}
      tooltip={showTooltip ? tooltipText : undefined}
    />
  );
}

export interface PlatformStatusBadgeProps {
  status: PlatformStatus;
  platform?: string;
  showTooltip?: boolean;
}

const PLATFORM_STATUS_TONE: Record<PlatformStatus, StatusType> = {
  active: "success",
  inactive: "info",
  error: "critical",
  pending: "attention",
};

export function PlatformStatusBadge({ status, platform, showTooltip = true }: PlatformStatusBadgeProps) {
  const { t } = useTranslation();
  const effectiveStatus = PLATFORM_STATUS_TONE[status] ? status : 'inactive';
  const tone = PLATFORM_STATUS_TONE[effectiveStatus];
  
  const label = t(`ui.badge.platform.${effectiveStatus}.label`);
  const baseTooltip = t(`ui.badge.platform.${effectiveStatus}.tooltip`);
  const tooltip = platform
    ? `${platform}: ${baseTooltip}`
    : baseTooltip;

  return (
    <StatusBadge
      status={tone}
      label={label}
      tooltip={showTooltip ? tooltip : undefined}
    />
  );
}

export interface RiskScoreBadgeProps {
  score: number;
  showTooltip?: boolean;
}

export function RiskScoreBadge({ score, showTooltip = true }: RiskScoreBadgeProps) {
  const { t } = useTranslation();
  let tone: StatusType;
  let tooltipKey: string;
  
  if (score >= 70) {
    tone = "critical";
    tooltipKey = "high";
  } else if (score >= 40) {
    tone = "warning";
    tooltipKey = "medium";
  } else {
    tone = "success";
    tooltipKey = "low";
  }
  
  const tooltip = t(`ui.badge.risk.${tooltipKey}`);
  const label = t("ui.badge.risk.label", { score });

  return (
    <StatusBadge
      status={tone}
      label={label}
      tooltip={showTooltip ? tooltip : undefined}
    />
  );
}

export interface PlanBadgeProps {
  plan: string;
}

const PLAN_TONE: Record<string, StatusType> = {
  free: "info",
  starter: "attention",
  pro: "success",
  enterprise: "new",
};

export function PlanBadge({ plan }: PlanBadgeProps) {
  const { t } = useTranslation();
  const lowerPlan = plan.toLowerCase();
  const tone = PLAN_TONE[lowerPlan] || "info";
  // Try to translate if key exists, else show plan name
  const exists = ["free", "starter", "pro", "enterprise"].includes(lowerPlan);
  const label = exists ? t(`ui.badge.plan.${lowerPlan}`) : plan;

  return <Badge tone={tone}>{label}</Badge>;
}

export interface BooleanStatusProps {
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
}

export function BooleanStatus({
  value,
  trueLabel,
  falseLabel,
}: BooleanStatusProps) {
  const { t } = useTranslation();
  const displayTrue = trueLabel || t("ui.badge.boolean.yes");
  const displayFalse = falseLabel || t("ui.badge.boolean.no");
  
  return (
    <Badge tone={value ? "success" : "info"}>
      {value ? displayTrue : displayFalse}
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
