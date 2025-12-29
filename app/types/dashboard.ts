

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
}

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  cta: string;
  url: string;
  done: boolean;
}

/**
 * 获取设置步骤列表
 * 
 * 步骤完成判断逻辑：
 * - Step 1 (扫描): 只要有扫描记录就算完成（表示用户已经尝试过扫描，即使扫描失败也算完成）
 * - Step 2 (迁移): 需要有效的服务端配置（serverSideEnabled && credentialsEncrypted），因为描述明确说明需要配置服务端转化追踪
 * - Step 3 (警报): 需要启用的警报配置（isEnabled: true），禁用的警报不算完成
 */
export function getSetupSteps(data: DashboardData): SetupStep[] {
  return [
    {
      id: "scan",
      label: "扫描脚本",
      description: "扫描现有的追踪脚本和像素",
      cta: "开始扫描",
      url: "/app/scan",
      // 只要有扫描记录就算完成，表示用户已经尝试过扫描
      done: data.latestScan !== null,
    },
    {
      id: "migrate",
      label: "迁移设置",
      description: "配置服务端转化追踪",
      cta: "配置迁移",
      url: "/app/migrate",
      // 需要有效的服务端配置：同时满足 serverSideEnabled && credentialsEncrypted
      done: data.hasServerSideConfig,
    },
    {
      id: "alerts",
      label: "设置警报",
      description: "配置健康监控警报",
      cta: "配置警报",
      url: "/app/settings?tab=alerts",
      // 需要启用的警报配置，禁用的警报不算完成（因为不起作用）
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
