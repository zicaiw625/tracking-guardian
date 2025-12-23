/**
 * Billing Plans Configuration
 *
 * Defines all available subscription plans and their features.
 * This is a pure configuration module with no side effects.
 */

// =============================================================================
// Plan Definitions
// =============================================================================

/**
 * Plan feature list type
 */
export interface PlanFeatures {
  id: string;
  name: string;
  price: number;
  monthlyOrderLimit: number;
  trialDays?: number;
  features: readonly string[];
}

/**
 * All billing plans configuration
 */
export const BILLING_PLANS = {
  free: {
    id: "free",
    name: "免费版",
    price: 0,
    monthlyOrderLimit: 100,
    features: [
      "每月100笔订单追踪",
      "3个广告平台集成",
      "基础邮件警报",
      "7天数据保留",
    ],
  },
  starter: {
    id: "starter",
    name: "入门版",
    price: 9.99,
    monthlyOrderLimit: 1000,
    trialDays: 7,
    features: [
      "每月1,000笔订单追踪",
      "全部广告平台集成",
      "Slack + Telegram 警报",
      "30天数据保留",
      "基础对账报告",
    ],
  },
  pro: {
    id: "pro",
    name: "专业版",
    price: 29.99,
    monthlyOrderLimit: 10000,
    trialDays: 7,
    features: [
      "每月10,000笔订单追踪",
      "全部广告平台集成",
      "所有警报渠道",
      "90天数据保留",
      "高级对账报告",
      "优先技术支持",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "企业版",
    price: 99.99,
    monthlyOrderLimit: 100000,
    trialDays: 14,
    features: [
      "每月100,000笔订单追踪",
      "全部广告平台集成",
      "所有警报渠道",
      "无限数据保留",
      "专属客户成功经理",
      "自定义集成支持",
      "SLA保障",
    ],
  },
} as const;

/**
 * Plan ID type - derived from BILLING_PLANS keys
 */
export type PlanId = keyof typeof BILLING_PLANS;

/**
 * All valid plan IDs
 */
export const PLAN_IDS: readonly PlanId[] = ["free", "starter", "pro", "enterprise"];

// =============================================================================
// Plan Utilities
// =============================================================================

/**
 * Check if a string is a valid plan ID
 */
export function isValidPlanId(planId: string): planId is PlanId {
  return planId in BILLING_PLANS;
}

/**
 * Get plan configuration by ID
 */
export function getPlanConfig(planId: PlanId): typeof BILLING_PLANS[PlanId] {
  return BILLING_PLANS[planId];
}

/**
 * Get plan by ID with fallback to free
 */
export function getPlanOrDefault(planId: string | null | undefined): typeof BILLING_PLANS[PlanId] {
  if (planId && isValidPlanId(planId)) {
    return BILLING_PLANS[planId];
  }
  return BILLING_PLANS.free;
}

/**
 * Get monthly order limit for a plan
 */
export function getPlanLimit(planId: PlanId): number {
  return BILLING_PLANS[planId].monthlyOrderLimit;
}

/**
 * Detect plan from price
 */
export function detectPlanFromPrice(price: number): PlanId {
  if (price >= 99) return "enterprise";
  if (price >= 29) return "pro";
  if (price >= 9) return "starter";
  return "free";
}

/**
 * Check if plan has trial
 */
export function hasTrial(planId: PlanId): boolean {
  const plan = BILLING_PLANS[planId];
  return "trialDays" in plan && (plan.trialDays ?? 0) > 0;
}

/**
 * Get trial days for a plan
 */
export function getTrialDays(planId: PlanId): number {
  const plan = BILLING_PLANS[planId];
  return "trialDays" in plan ? (plan.trialDays ?? 0) : 0;
}

/**
 * Check if planA is higher tier than planB
 */
export function isHigherTier(planA: PlanId, planB: PlanId): boolean {
  const tierOrder: Record<PlanId, number> = {
    free: 0,
    starter: 1,
    pro: 2,
    enterprise: 3,
  };
  return tierOrder[planA] > tierOrder[planB];
}

/**
 * Get upgrade options for a plan
 */
export function getUpgradeOptions(currentPlan: PlanId): PlanId[] {
  const tierOrder: PlanId[] = ["free", "starter", "pro", "enterprise"];
  const currentIndex = tierOrder.indexOf(currentPlan);
  return tierOrder.slice(currentIndex + 1);
}

