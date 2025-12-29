

export interface PlanFeatures {
  id: string;
  name: string;
  nameEn: string;
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
  tagline?: string;
}

export const BILLING_PLANS = {
  free: {
    id: "free",
    name: "免费版",
    nameEn: "Free",
    price: 0,
    monthlyOrderLimit: 100,
    pixelDestinations: 0,
    uiModules: 0,
    includesVerification: false,
    includesAlerts: false,
    includesReconciliation: false,
    includesAgency: false,
    tagline: "快速评估迁移风险",
    features: [
      "Audit 扫描报告",
      "迁移清单与建议",
      "风险可视化",
      "基础文档支持",
    ],
  },
  starter: {
    id: "starter",
    name: "入门版",
    nameEn: "Starter",
    price: 29,
    monthlyOrderLimit: 1000,
    trialDays: 7,
    pixelDestinations: 1,
    uiModules: 1,
    includesVerification: true,
    includesAlerts: false,
    includesReconciliation: false,
    includesAgency: false,
    tagline: "快速开始像素迁移",
    features: [
      "1 个像素目的地 (Test/Live)",
      "1 个 Thank you 页面模块",
      "基础验收向导",
      "每月 1,000 笔订单追踪",
      "30 天数据保留",
      "邮件支持",
    ],
  },
  growth: {
    id: "growth",
    name: "成长版",
    nameEn: "Growth",
    price: 79,
    monthlyOrderLimit: 10000,
    trialDays: 7,
    pixelDestinations: 3,
    uiModules: -1,
    includesVerification: true,
    includesAlerts: true,
    includesReconciliation: true,
    includesAgency: false,
    tagline: "全面追踪与对账保障",
    features: [
      "3 个像素目的地 (GA4/Meta/TikTok)",
      "全部 Thank you 页面模块",
      "事件对账与验收",
      "实时告警 (邮件/Slack/Telegram)",
      "每月 10,000 笔订单追踪",
      "90 天数据保留",
      "优先技术支持",
    ],
  },
  agency: {
    id: "agency",
    name: "Agency 版",
    nameEn: "Agency",
    price: 199,
    monthlyOrderLimit: 100000,
    trialDays: 14,
    pixelDestinations: -1,
    uiModules: -1,
    includesVerification: true,
    includesAlerts: true,
    includesReconciliation: true,
    includesAgency: true,
    tagline: "多店管理与团队协作",
    features: [
      "无限像素目的地",
      "全部 Thank you 页面模块",
      "多店 Workspace 管理",
      "批量 Audit 与配置",
      "迁移验收报告导出 (PDF/CSV)",
      "团队协作 (Owner/Admin/Viewer)",
      "每月 100,000 笔订单追踪",
      "无限数据保留",
      "专属客户成功经理",
      "SLA 保障",
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
  if (price >= 199) return "agency";
  if (price >= 79) return "growth";
  if (price >= 29) return "starter";
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
  const tierOrder: Record<PlanId, number> = {
    free: 0,
    starter: 1,
    growth: 2,
    agency: 3,
  };
  return tierOrder[planA] > tierOrder[planB];
}

export function getUpgradeOptions(currentPlan: PlanId): PlanId[] {
  const tierOrder: PlanId[] = ["free", "starter", "growth", "agency"];
  const currentIndex = tierOrder.indexOf(currentPlan);
  return tierOrder.slice(currentIndex + 1);
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
  feature: "verification" | "alerts" | "reconciliation" | "agency"
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

