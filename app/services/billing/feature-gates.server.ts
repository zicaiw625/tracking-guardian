import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { BILLING_PLANS, type PlanId, getPlanOrDefault, getPixelDestinationsLimit, getUiModulesLimit, planSupportsFeature } from "./plans";

export interface FeatureGateResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
}

export async function checkPixelDestinationsLimit(
  shopId: string,
  shopPlan: PlanId
): Promise<FeatureGateResult> {
  const planConfig = getPlanOrDefault(shopPlan);
  const limit = getPixelDestinationsLimit(shopPlan);
  if (limit === -1) {
    return { allowed: true };
  }
  const currentCount = await prisma.pixelConfig.count({
    where: {
      shopId,
      isActive: true,
      serverSideEnabled: true,
    },
  });
  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `当前套餐最多支持 ${limit} 个像素目的地，您已配置 ${currentCount} 个。请升级套餐或停用部分配置。`,
      current: currentCount,
      limit,
    };
  }
  return {
    allowed: true,
    current: currentCount,
    limit,
  };
}

export async function checkUiModulesLimit(
  shopId: string,
  shopPlan: PlanId
): Promise<FeatureGateResult> {
  const planConfig = getPlanOrDefault(shopPlan);
  const limit = getUiModulesLimit(shopPlan);
  if (limit === -1) {
    return { allowed: true };
  }
  const currentCount = 0;
  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `当前套餐最多支持 ${limit} 个 UI 模块，您已启用 ${currentCount} 个。请升级套餐或停用部分模块。`,
      current: currentCount,
      limit,
    };
  }
  return {
    allowed: true,
    current: currentCount,
    limit,
  };
}

export function checkFeatureAccess(
  shopPlan: PlanId,
  feature: "verification" | "alerts" | "reconciliation" | "agency" | "pixel_migration" | "ui_modules" | "audit" | "report_export"
): FeatureGateResult {
  if (feature === "audit") {
    return { allowed: true };
  }
  if (feature === "pixel_migration" || feature === "ui_modules") {
    const hasAccess = isPlanAtLeast(shopPlan, "starter");
    if (!hasAccess) {
      const planConfig = getPlanOrDefault(shopPlan);
      return {
        allowed: false,
        reason: `${feature === "pixel_migration" ? "像素迁移" : "UI 模块"}功能需要 Starter 及以上套餐。当前套餐：${planConfig.name}`,
      };
    }
    return { allowed: true };
  }
  let hasAccess = false;
  const standardFeatures: readonly ("verification" | "alerts" | "reconciliation" | "agency" | "report_export")[] = ["verification", "alerts", "reconciliation", "agency", "report_export"] as const;
  const alwaysAvailableFeatures: readonly ("pixel_migration" | "ui_modules" | "audit")[] = ["pixel_migration", "ui_modules", "audit"] as const;
  if (alwaysAvailableFeatures.includes(feature as "pixel_migration" | "ui_modules" | "audit")) {
    hasAccess = true;
  } else if (standardFeatures.includes(feature as "verification" | "alerts" | "reconciliation" | "agency" | "report_export")) {
    hasAccess = planSupportsFeature(shopPlan, feature as "verification" | "alerts" | "reconciliation" | "agency" | "report_export");
  }
  if (!hasAccess) {
    const planConfig = getPlanOrDefault(shopPlan);
    const featureNames: Record<string, string> = {
      verification: "验收功能",
      alerts: "告警功能",
      reconciliation: "事件对账",
      agency: "Agency 多店功能",
      pixel_migration: "像素迁移",
      ui_modules: "UI 模块",
      audit: "Audit 扫描",
      report_export: "报告导出",
    };
    return {
      allowed: false,
      reason: `${featureNames[feature]}需要 ${getRequiredPlanName(feature)} 及以上套餐。当前套餐：${planConfig.name}`,
    };
  }
  return { allowed: true };
}

function getRequiredPlanName(feature: "verification" | "alerts" | "reconciliation" | "agency" | "pixel_migration" | "ui_modules" | "audit" | "report_export"): string {
  switch (feature) {
    case "audit":
      return "Free";
    case "pixel_migration":
    case "ui_modules":
    case "verification":
      return "Starter";
    case "alerts":
      return "Growth";
    case "report_export":
      return "Growth";
    case "reconciliation":
      return "Growth";
    case "agency":
      return "Agency";
  }
}

function isPlanAtLeast(current: PlanId, target: PlanId): boolean {
  if (current === "monitor" || target === "monitor") {
    return false;
  }
  const tierOrder: Record<Exclude<PlanId, "monitor">, number> = {
    free: 0,
    starter: 1,
    growth: 2,
    agency: 3,
  };
  return tierOrder[current as Exclude<PlanId, "monitor">] >= tierOrder[target as Exclude<PlanId, "monitor">];
}

export async function canCreatePixelConfig(
  shopId: string,
  shopPlan: PlanId
): Promise<FeatureGateResult> {
  const pixelLimitCheck = await checkPixelDestinationsLimit(shopId, shopPlan);
  if (!pixelLimitCheck.allowed) {
    return pixelLimitCheck;
  }
  const planConfig = getPlanOrDefault(shopPlan);
  if (planConfig.pixelDestinations === 0) {
    return {
      allowed: false,
      reason: `像素配置功能需要 Starter 及以上套餐。当前套餐：${planConfig.name}`,
    };
  }
  return { allowed: true };
}

export async function canCreateUiModule(
  shopId: string,
  shopPlan: PlanId
): Promise<FeatureGateResult> {
  const uiLimitCheck = await checkUiModulesLimit(shopId, shopPlan);
  if (!uiLimitCheck.allowed) {
    return uiLimitCheck;
  }
  const planConfig = getPlanOrDefault(shopPlan);
  if (planConfig.uiModules === 0) {
    return {
      allowed: false,
      reason: `UI 模块功能需要 Starter 及以上套餐。当前套餐：${planConfig.name}`,
    };
  }
  return { allowed: true };
}

export async function getFeatureLimitsSummary(
  shopId: string,
  shopPlan: PlanId
): Promise<{
  pixelDestinations: { current: number; limit: number; unlimited: boolean };
  uiModules: { current: number; limit: number; unlimited: boolean };
  features: {
    verification: boolean;
    alerts: boolean;
    reconciliation: boolean;
    agency: boolean;
    reportExport: boolean;
  };
}> {
  const [pixelLimit, uiLimit] = await Promise.all([
    checkPixelDestinationsLimit(shopId, shopPlan),
    checkUiModulesLimit(shopId, shopPlan),
  ]);
  return {
    pixelDestinations: {
      current: pixelLimit.current || 0,
      limit: pixelLimit.limit || 0,
      unlimited: pixelLimit.limit === -1,
    },
    uiModules: {
      current: uiLimit.current || 0,
      limit: uiLimit.limit || 0,
      unlimited: uiLimit.limit === -1,
    },
    features: {
      verification: planSupportsFeature(shopPlan, "verification"),
      alerts: planSupportsFeature(shopPlan, "alerts"),
      reconciliation: planSupportsFeature(shopPlan, "reconciliation"),
      agency: planSupportsFeature(shopPlan, "agency"),
      reportExport: planSupportsFeature(shopPlan, "report_export"),
    },
  };
}
