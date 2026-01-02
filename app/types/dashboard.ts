

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
  hasServerSideConfig: boolean;
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
}

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  cta: string;
  url: string;
  done: boolean;
}

export function getSetupSteps(data: DashboardData): SetupStep[] {
  return [
    {
      id: "scan",
      label: "扫描脚本",
      description: "扫描现有的追踪脚本和像素",
      cta: "开始扫描",
      url: "/app/scan",

      done: data.latestScan !== null,
    },
    {
      id: "migrate",
      label: "迁移设置",
      description: "配置服务端转化追踪",
      cta: "配置迁移",
      url: "/app/migrate",

      done: data.hasServerSideConfig,
    },
    {
      id: "alerts",
      label: "设置警报",
      description: "配置健康监控警报",
      cta: "配置警报",
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
