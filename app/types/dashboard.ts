

export type HealthStatus = "success" | "warning" | "critical" | "uninitialized";

export interface DashboardData {
  shopDomain: string;
  healthScore: number | null;
  healthStatus: HealthStatus;
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
