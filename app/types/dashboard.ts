export type HealthStatus = "success" | "warning" | "critical" | "uninitialized";

export type MigrationStage = "audit" | "pixel_test" | "verification" | "live" | "monitoring";

export interface UpgradeStatus {
  isUpgraded: boolean;
  shopTier: "plus" | "non_plus" | "unknown";
  deadlineDate: string;
  autoUpgradeStartDate?: string;
  daysRemaining: number;
  urgency: "critical" | "high" | "medium" | "low" | "resolved";
}

export interface MigrationProgress {
  currentStage: MigrationStage;
  stages: Array<{
    stage: MigrationStage;
    label: string;
    completed: boolean;
    inProgress: boolean;
  }>;
  progressPercentage: number;
    auditCompletion?: {
    completed: boolean;
    status: "completed" | "in_progress" | "pending";
  };
  pixelsStatus?: {
    test: number;
    live: number;
  };
  modulesEnabled?: number;
  verificationLatest?: {
    status: "completed" | "running" | "pending" | null;
    completedAt?: Date | string | null;
  };
}

export interface DashboardData {
  shopDomain: string;
  healthScore: number | null;
  healthStatus: HealthStatus;
  healthScoreFactors?: Array<{ label: string; value: number; weight: number }>;
  latestScan: {
    status: string;
    riskScore: number;
    createdAt: Date;
    identifiedPlatforms: string[];
  } | null;
  configuredPlatforms: number;
  weeklyConversions: number;
  hasAlertConfig: boolean;
  hasEnabledPixelConfig: boolean;
  plan: string;
  planId?: import("../utils/plans").PlanId;
  planLabel?: string;
  planTagline?: string;
  planFeatures?: string[];
  scriptTagsCount: number;
  hasOrderStatusScripts: boolean;
  typOspPagesEnabled?: boolean;
  estimatedMigrationTimeMinutes?: number;
  showOnboarding?: boolean;
  upgradeStatus?: UpgradeStatus;
  migrationProgress?: MigrationProgress;
  riskScore?: number | null;
  riskLevel?: "high" | "medium" | "low" | null;
    topRiskSources?: Array<{
    source: string;
    count: number;
    category: string;
  }>;
  migrationChecklist?: {
    totalItems: number;
    highPriorityItems: number;
    mediumPriorityItems: number;
    lowPriorityItems: number;
    estimatedTotalTime: number;
    topItems: Array<{
      id: string;
      title: string;
      riskLevel: "high" | "medium" | "low";
      priority: number;
      estimatedTime: number;
      status: "pending" | "in_progress" | "completed" | "skipped";
    }>;
  } | null;
  dependencyGraph?: import("../services/dependency-analysis.server").DependencyGraph | null;
  riskDistribution?: {
    byRiskLevel: {
      high: number;
      medium: number;
      low: number;
    };
    byCategory: Record<string, number>;
    byPlatform: Record<string, number>;
  } | null;
    healthMetrics24h?: {
    successRate: number;
    failureRate: number;
    totalEvents: number;
  } | null;
    activeAlerts?: Array<{
    id: string;
    type: string;
    severity: "critical" | "warning" | "info";
    message: string;
    triggeredAt: Date;
  }>;
  dataConnection?: {
    hasIngestionSecret: boolean;
    hasWebPixel: boolean;
    webPixelHasIngestionKey: boolean;
  };
}

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  cta: string;
  url: string;
  done: boolean;
}

export function getSetupSteps(
  data: DashboardData,
  t: (key: string) => string
): SetupStep[] {
  return [
    {
      id: "scan",
      label: t("dashboard.setup.scan.label"),
      description: t("dashboard.setup.scan.description"),
      cta: t("dashboard.setup.scan.cta"),
      url: "/app/scan",
      done: data.latestScan !== null,
    },
    {
      id: "migrate",
      label: t("dashboard.setup.migrate.label"),
      description: t("dashboard.setup.migrate.description"),
      cta: t("dashboard.setup.migrate.cta"),
      url: "/app/pixels",
      done: data.hasEnabledPixelConfig,
    },
    {
      id: "alerts",
      label: t("dashboard.setup.alerts.label"),
      description: t("dashboard.setup.alerts.description"),
      cta: t("dashboard.setup.alerts.cta"),
      url: "/app/settings?tab=alerts",
      done: data.hasAlertConfig,
    },
  ];
}

export function getNextSetupStep(steps: SetupStep[]): SetupStep | undefined {
  return steps.find((step) => !step.done);
}

export function getSetupProgress(steps: SetupStep[]): {
  completed: number;
  total: number;
  allComplete: boolean;
  percentage: number;
} {
  const completed = steps.filter((step) => step.done).length;
  const total = steps.length;
  return {
    completed,
    total,
    allComplete: completed === total,
    percentage: Math.round((completed / total) * 100),
  };
}
