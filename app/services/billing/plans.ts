
export interface PlanFeatures {
  id: string;
  name: string;
  price: number;
  monthlyOrderLimit: number;
  trialDays?: number;
  features: readonly string[];
  pixelDestinations: number;
  uiModules: number;
  includesVerification: boolean;
  includesAlerts: boolean;
  includesReconciliation: boolean;
  includesAgency: boolean;
  includesReportExport: boolean;
  tagline?: string;
  isOneTime?: boolean;
}

export const BILLING_PLANS = {
  free: {
    id: "free",
    name: "subscriptionPlans.free.name",
    price: 0,
    monthlyOrderLimit: 100,
    pixelDestinations: 0,
    uiModules: 0,
    includesVerification: false,
    includesAlerts: false,
    includesReconciliation: false,
    includesAgency: false,
    includesReportExport: false,
    tagline: "subscriptionPlans.free.tagline",
    features: [
      "subscriptionPlans.free.features.audit",
      "subscriptionPlans.free.features.checklist",
      "subscriptionPlans.free.features.deprecation",
      "subscriptionPlans.free.features.countdown",
      "subscriptionPlans.free.features.docs",
    ],
  },
  starter: {
    id: "starter",
    name: "subscriptionPlans.starter.name",
    price: 29,
    monthlyOrderLimit: 1000,
    trialDays: 7,
    pixelDestinations: 1,
    uiModules: 1,
    includesVerification: true,
    includesAlerts: false,
    includesReconciliation: false,
    includesAgency: false,
    includesReportExport: false,
    tagline: "subscriptionPlans.starter.tagline",
    features: [
      "subscriptionPlans.starter.features.pixel",
      "subscriptionPlans.starter.features.mapping",
      "subscriptionPlans.starter.features.payload",
      "subscriptionPlans.starter.features.wizard",
      "subscriptionPlans.starter.features.env",
      "subscriptionPlans.starter.features.limit",
      "subscriptionPlans.starter.features.retention",
      "subscriptionPlans.starter.features.sandbox",
    ],
  },
  growth: {
    id: "growth",
    name: "subscriptionPlans.growth.name",
    price: 79,
    monthlyOrderLimit: 10000,
    trialDays: 7,
    pixelDestinations: 3,
    uiModules: -1,
    includesVerification: true,
    includesAlerts: true,
    includesReconciliation: true,
    includesAgency: false,
    includesReportExport: true,
    tagline: "subscriptionPlans.growth.tagline",
    features: [
      "subscriptionPlans.growth.features.migration",
      "subscriptionPlans.growth.features.report",
      "subscriptionPlans.growth.features.checklist",
      "subscriptionPlans.growth.features.consistency",
      "subscriptionPlans.growth.features.compliance",
      "subscriptionPlans.growth.features.reconciliation",
      "subscriptionPlans.growth.features.alerts",
      "subscriptionPlans.growth.features.limit",
      "subscriptionPlans.growth.features.retention",
    ],
  },
  monitor: {
    id: "monitor",
    name: "subscriptionPlans.monitor.name",
    price: 29,
    monthlyOrderLimit: 0,
    pixelDestinations: 0,
    uiModules: 0,
    includesVerification: false,
    includesAlerts: true,
    includesReconciliation: false,
    includesAgency: false,
    includesReportExport: false,
    tagline: "subscriptionPlans.monitor.tagline",
    features: [
      "subscriptionPlans.monitor.features.drop",
      "subscriptionPlans.monitor.features.threshold",
      "subscriptionPlans.monitor.features.missing",
      "subscriptionPlans.monitor.features.logs",
      "subscriptionPlans.monitor.features.rollback",
      "subscriptionPlans.monitor.features.channels",
      "subscriptionPlans.monitor.features.realtime",
      "subscriptionPlans.monitor.features.note",
    ],
  },
  agency: {
    id: "agency",
    name: "subscriptionPlans.agency.name",
    price: 199,
    monthlyOrderLimit: 100000,
    trialDays: 14,
    pixelDestinations: -1,
    uiModules: -1,
    includesVerification: true,
    includesAlerts: true,
    includesReconciliation: true,
    includesAgency: true,
    includesReportExport: true,
    tagline: "subscriptionPlans.agency.tagline",
    features: [
      "subscriptionPlans.agency.features.unlimited",
      "subscriptionPlans.agency.features.support",
      "subscriptionPlans.agency.features.limit",
      "subscriptionPlans.agency.features.retention",
      "subscriptionPlans.agency.features.manager",
      "subscriptionPlans.agency.features.sla",
    ],
  },
} as const;

export const BILLING_PLANS_COMPAT = {
  ...BILLING_PLANS,
  enterprise: BILLING_PLANS.agency,
  pro: BILLING_PLANS.growth,
} as const;

export type PlanId = keyof typeof BILLING_PLANS;

export const PLAN_IDS: readonly PlanId[] = ["free", "starter", "growth", "agency"];

export const PLAN_IDS_WITH_MONITOR: readonly PlanId[] = ["free", "starter", "growth", "monitor", "agency"];

export const PLAN_IDS_COMPAT: readonly string[] = ["free", "starter", "pro", "growth", "enterprise", "agency"];

export function isValidPlanId(planId: string): planId is PlanId {
  return planId in BILLING_PLANS;
}

export function isValidPlanIdCompat(planId: string): boolean {
  return planId in BILLING_PLANS_COMPAT;
}

export function getPlanConfig(planId: PlanId): typeof BILLING_PLANS[PlanId] {
  return BILLING_PLANS[planId];
}

export function getPlanOrDefault(planId: string | null | undefined): typeof BILLING_PLANS[PlanId] {
  if (!planId) return BILLING_PLANS.free;
  const normalizedId = normalizePlanId(planId);
  if (isValidPlanId(normalizedId)) {
    return BILLING_PLANS[normalizedId];
  }
  return BILLING_PLANS.free;
}

export function normalizePlanId(planId: string): PlanId {
  switch (planId) {
    case "pro":
      return "growth";
    case "enterprise":
      return "agency";
    default:
      return isValidPlanId(planId) ? planId : "free";
  }
}

export function getPlanLimit(planId: PlanId): number {
  return BILLING_PLANS[planId].monthlyOrderLimit;
}

export function detectPlanFromPrice(price: number): PlanId {
  if (price >= 199) {
    return "agency";
  }
  if (price >= 79 && price < 199) {
    return "growth";
  }
  if (price >= 29 && price < 79) {
    return "starter";
  }
  return "free";
}

export function hasTrial(planId: PlanId): boolean {
  const plan = BILLING_PLANS[planId];
  return "trialDays" in plan && (plan.trialDays ?? 0) > 0;
}

export function getTrialDays(planId: PlanId): number {
  const plan = BILLING_PLANS[planId];
  return "trialDays" in plan ? (plan.trialDays ?? 0) : 0;
}

export function isHigherTier(planA: PlanId, planB: PlanId): boolean {
  if (planA === "monitor" || planB === "monitor") {
    return false;
  }
  const tierOrder: Record<Exclude<PlanId, "monitor">, number> = {
    free: 0,
    starter: 1,
    growth: 2,
    agency: 3,
  };
  return tierOrder[planA as Exclude<PlanId, "monitor">] > tierOrder[planB as Exclude<PlanId, "monitor">];
}

export function getUpgradeOptions(currentPlan: PlanId): PlanId[] {
  const tierOrder: PlanId[] = ["free", "starter", "growth", "agency"];
  const currentIndex = tierOrder.indexOf(currentPlan);
  return tierOrder.slice(currentIndex + 1);
}

export function planSupportsReportExport(planId: PlanId): boolean {
  return BILLING_PLANS[planId].includesReportExport;
}

export function getMaxShops(planId: PlanId): number {
  switch (planId) {
    case "agency":
      return 50;
    case "growth":
      return 1;
      case "starter":
      return 1;
    case "free":
    default:
      return 1;
  }
}

export function planSupportsFeature(
  planId: PlanId,
  feature: "verification" | "alerts" | "reconciliation" | "agency" | "report_export"
): boolean {
  const plan = BILLING_PLANS[planId];
  switch (feature) {
    case "verification":
      return plan.includesVerification;
    case "alerts":
      return plan.includesAlerts;
    case "reconciliation":
      return plan.includesReconciliation;
    case "agency":
      return plan.includesAgency;
    case "report_export":
      return plan.includesReportExport;
    default:
      return false;
  }
}

export function getPixelDestinationsLimit(planId: PlanId): number {
  return BILLING_PLANS[planId].pixelDestinations;
}

export function getUiModulesLimit(planId: PlanId): number {
  return BILLING_PLANS[planId].uiModules;
}

export function getPlanTagline(planId: PlanId): string | undefined {
  return BILLING_PLANS[planId].tagline;
}
