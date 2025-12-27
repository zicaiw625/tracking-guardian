/**
 * 套餐配置 - 对齐设计方案 v1.0 第 11 节商业化定价
 * 
 * 套餐体系:
 * - Free: 免费版，Audit 扫描报告 + 迁移清单
 * - Starter ($29/月): 1个像素目的地 + 1个页面模块 + 基础验收
 * - Growth ($79/月): 3个像素目的地 + 全部页面模块 + 事件对账 + 告警
 * - Agency ($199/月): 多店 workspace + 批量交付 + 报告导出 + 团队协作
 */

export interface PlanFeatures {
  id: string;
  name: string;
  nameEn: string;
  price: number;
  monthlyOrderLimit: number;
  trialDays?: number;
  features: readonly string[];
  // v1.0 新增字段
  pixelDestinations: number; // 支持的像素目的地数量
  uiModules: number; // 支持的 UI 模块数量 (-1 表示无限)
  includesVerification: boolean; // 是否包含验收功能
  includesAlerts: boolean; // 是否包含告警功能
  includesReconciliation: boolean; // 是否包含事件对账
  includesAgency: boolean; // 是否包含 Agency 多店功能
  tagline?: string; // 套餐标语
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
    uiModules: -1, // 无限
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
    pixelDestinations: -1, // 无限
    uiModules: -1, // 无限
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

// 兼容旧代码：enterprise 别名指向 agency
export const BILLING_PLANS_COMPAT = {
  ...BILLING_PLANS,
  enterprise: BILLING_PLANS.agency,
  pro: BILLING_PLANS.growth, // 兼容旧 pro 套餐
} as const;

export type PlanId = keyof typeof BILLING_PLANS;

// v1.0 新套餐 ID 列表
export const PLAN_IDS: readonly PlanId[] = ["free", "starter", "growth", "agency"];

// 兼容旧套餐 ID
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
  
  // 处理兼容性：pro -> growth, enterprise -> agency
  const normalizedId = normalizePlanId(planId);
  if (isValidPlanId(normalizedId)) {
    return BILLING_PLANS[normalizedId];
  }
  return BILLING_PLANS.free;
}

/**
 * 标准化套餐 ID（处理旧版本兼容）
 */
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

/**
 * 获取套餐允许管理的最大店铺数量
 * 用于 Agency 多店功能
 */
export function getMaxShops(planId: PlanId): number {
  switch (planId) {
    case "agency":
      return 50; // Agency 版最多 50 个店铺
    case "growth":
      return 1; // 成长版仅限单店
    case "starter":
      return 1; // 入门版仅限单店
    case "free":
    default:
      return 1; // 免费版仅限单店
  }
}

/**
 * 检查套餐是否支持某功能
 */
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

/**
 * 获取套餐允许的像素目的地数量
 */
export function getPixelDestinationsLimit(planId: PlanId): number {
  return BILLING_PLANS[planId].pixelDestinations;
}

/**
 * 获取套餐允许的 UI 模块数量
 */
export function getUiModulesLimit(planId: PlanId): number {
  return BILLING_PLANS[planId].uiModules;
}

/**
 * 获取套餐标语
 */
export function getPlanTagline(planId: PlanId): string | undefined {
  return BILLING_PLANS[planId].tagline;
}

