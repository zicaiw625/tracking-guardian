import prisma from "~/db.server";
import { type PlanId, getPixelDestinationsLimit, getPlanOrDefault, getPlanDisplayName, planSupportsFeature } from "./plans";

export interface FeatureGateResult {
  allowed: boolean;
  reason?: string;
  reasonKey?: string;
  reasonParams?: Record<string, string | number>;
  current?: number;
  limit?: number;
}

export async function checkPixelDestinationsLimit(
  shopId: string,
  shopPlan: PlanId
): Promise<FeatureGateResult> {
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
      reason: `Current plan supports up to ${limit} pixel destinations, you have configured ${currentCount}. Please upgrade or deactivate some configurations.`,
      reasonKey: "featureGate.pixelDestinationsLimit",
      reasonParams: { limit, current: currentCount },
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
  _shopId: string,
  _shopPlan: PlanId
): Promise<FeatureGateResult> {
  const hasAccess = isPlanAtLeast(_shopPlan, "starter");
  if (!hasAccess) {
    const currentPlan = getPlanDisplayName(_shopPlan);
    return {
      allowed: false,
      reason: `UI Modules requires Starter plan or above. Current plan: ${currentPlan}`,
      reasonKey: "featureGate.requiresPlan",
      reasonParams: { feature: "UI Modules", plan: "Starter", currentPlan },
      current: 0,
      limit: 0,
    };
  }
  return {
    allowed: true,
    current: 0,
    limit: -1,
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
      const featureName = feature === "pixel_migration" ? "Pixel Migration" : "UI Modules";
      const currentPlan = getPlanDisplayName(shopPlan);
      return {
        allowed: false,
        reason: `${featureName} requires Starter plan or above. Current plan: ${currentPlan}`,
        reasonKey: "featureGate.requiresPlan",
        reasonParams: {
          feature: featureName,
          plan: "Starter",
          currentPlan,
        },
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
    const featureName = getFeatureDisplayName(feature);
    const requiredPlan = getRequiredPlanName(feature);
    const currentPlan = getPlanDisplayName(shopPlan);
    return {
      allowed: false,
      reason: `${featureName} requires ${requiredPlan} plan or above. Current plan: ${currentPlan}`,
      reasonKey: "featureGate.requiresPlan",
      reasonParams: {
        feature: featureName,
        plan: requiredPlan,
        currentPlan,
      },
    };
  }
  return { allowed: true };
}

function getRequiredPlanName(feature: string): string {
  switch (feature) {
    case "audit":
      return "Free";
    case "pixel_migration":
    case "ui_modules":
    case "verification":
      return "Starter";
    case "alerts":
    case "report_export":
    case "reconciliation":
      return "Growth";
    case "agency":
      return "Agency";
    default:
      return "Starter";
  }
}

function getFeatureDisplayName(feature: string): string {
  const names: Record<string, string> = {
    verification: "Verification",
    alerts: "Alerts",
    reconciliation: "Reconciliation",
    agency: "Agency Multi-shop",
    pixel_migration: "Pixel Migration",
    ui_modules: "UI Modules",
    audit: "Audit Scan",
    report_export: "Report Export",
  };
  return names[feature] || feature;
}

function isPlanAtLeast(current: PlanId, target: PlanId): boolean {
  const tierOrder: Record<PlanId, number> = {
    free: 0,
    starter: 1,
    growth: 2,
    agency: 3,
  };
  return tierOrder[current] >= tierOrder[target];
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
    const currentPlan = getPlanDisplayName(shopPlan);
    return {
      allowed: false,
      reason: `Pixel Config requires Starter plan or above. Current plan: ${currentPlan}`,
      reasonKey: "featureGate.requiresPlan",
      reasonParams: { feature: "Pixel Config", plan: "Starter", currentPlan },
    };
  }
  return { allowed: true };
}

export async function canCreateUiModule(
  _shopId: string,
  _shopPlan: PlanId
): Promise<FeatureGateResult> {
  const hasAccess = isPlanAtLeast(_shopPlan, "starter");
  if (!hasAccess) {
    const currentPlan = getPlanDisplayName(_shopPlan);
    return {
      allowed: false,
      reason: `UI Modules requires Starter plan or above. Current plan: ${currentPlan}`,
      reasonKey: "featureGate.requiresPlan",
      reasonParams: { feature: "UI Modules", plan: "Starter", currentPlan },
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
