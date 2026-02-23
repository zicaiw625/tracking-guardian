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
  const tone = JOB_STATUS_TONE[status] || JOB_STATUS_TONE.pending;
  const label = t(`statusBadge.job.${status}.label`);
  const tooltip = t(`statusBadge.job.${status}.tooltip`);
  return (
    <StatusBadge
      status={tone}
      label={label}
      tooltip={showTooltip ? tooltip : undefined}
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
  const tone = HEALTH_STATUS_TONE[status] || HEALTH_STATUS_TONE.unknown;
  const baseLabel = t(`statusBadge.health.${status}.label`);
  const label = score !== undefined ? `${baseLabel} (${score})` : baseLabel;
  const tooltip = t(`statusBadge.health.${status}.tooltip`);
  return (
    <StatusBadge
      status={tone}
      label={label}
      tooltip={showTooltip ? tooltip : undefined}
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
  const tone = PLATFORM_STATUS_TONE[status] || PLATFORM_STATUS_TONE.inactive;
  const label = t(`statusBadge.platform.${status}.label`);
  const baseTooltip = t(`statusBadge.platform.${status}.tooltip`);
  const tooltip = platform ? `${platform}: ${baseTooltip}` : baseTooltip;
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
    tooltipKey = "statusBadge.risk.high";
  } else if (score >= 40) {
    tone = "warning";
    tooltipKey = "statusBadge.risk.medium";
  } else {
    tone = "success";
    tooltipKey = "statusBadge.risk.low";
  }
  return (
    <StatusBadge
      status={tone}
      label={t("statusBadge.risk.score", { score })}
      tooltip={showTooltip ? t(tooltipKey) : undefined}
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
  const tone = PLAN_TONE[plan.toLowerCase()] || ("info" as StatusType);
  const label = t(`statusBadge.plan.${plan.toLowerCase()}`);
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
  const resolvedTrue = trueLabel ?? t("statusBadge.boolean.true");
  const resolvedFalse = falseLabel ?? t("statusBadge.boolean.false");
  return (
    <Badge tone={value ? "success" : "info"}>
      {value ? resolvedTrue : resolvedFalse}
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
