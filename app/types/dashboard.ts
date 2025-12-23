/**
 * Dashboard Types and Helpers
 *
 * Shared types and helper functions for the dashboard.
 * This file is safe to import from both server and client code.
 */

// =============================================================================
// Types
// =============================================================================

export type HealthStatus = "success" | "warning" | "critical" | "uninitialized";

/**
 * Dashboard data returned from the server
 */
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
  plan: string;
  scriptTagsCount: number;
  hasOrderStatusScripts: boolean;
}

/**
 * Setup step definition
 */
export interface SetupStep {
  id: string;
  label: string;
  description: string;
  cta: string;
  url: string;
  done: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get setup steps based on dashboard data
 */
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
      done: data.configuredPlatforms > 0,
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

/**
 * Get the next incomplete setup step
 */
export function getNextSetupStep(steps: SetupStep[]): SetupStep | undefined {
  return steps.find((step) => !step.done);
}

/**
 * Calculate setup progress
 */
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

