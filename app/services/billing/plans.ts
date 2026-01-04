

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
  includesReportExport: boolean; // 验收报告导出 (PDF/CSV)
  tagline?: string;
  isOneTime?: boolean; // 是否为一次性收费（如 Go-Live）
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
    includesReportExport: false,
    tagline: "升级不丢功能/不丢数据（在 Shopify 允许范围内）",
    features: [
      "Audit 风险报告（可分享链接，但不导出）",
      "迁移清单 + 风险分级 + 替代路径",
      "明确提示 checkout.liquid/additional scripts 弃用限制",
      "升级倒计时（Plus: 2026-01 自动升级，非 Plus: 2026-08-26 最晚）",
      "基础文档支持",
    ],
  },
  starter: {
    id: "starter",
    name: "Migration 迁移版",
    nameEn: "Migration",
    price: 49,
    monthlyOrderLimit: 1000,
    trialDays: 7,
    pixelDestinations: 1,
    uiModules: 1,
    includesVerification: true,
    includesAlerts: false,
    includesReconciliation: false,
    includesAgency: false,
    includesReportExport: false, // Migration 版本不含报告导出（这是 Go-Live 的核心付费点）
    tagline: "像素最小可用迁移（标准事件映射 + 参数完整率）",
    features: [
      "1 个像素目的地 (GA4/Meta/TikTok 三选一)",
      "Survey 或 Helpdesk 模块二选一",
      "标准事件映射 + 参数完整率检查",
      "可下载 payload 证据（验证和存档用）",
      "验收向导（不含报告导出）",
      "Test/Live 环境切换",
      "每月 1,000 笔订单追踪",
      "30 天数据保留",
      "⚠️ Web Pixel 限制说明（strict sandbox）",
    ],
  },
  growth: {
    id: "growth",
    name: "Go-Live 交付版",
    nameEn: "Go-Live",
    price: 199,
    monthlyOrderLimit: 10000,
    trialDays: 7,
    pixelDestinations: 3,
    uiModules: -1,
    includesVerification: true,
    includesAlerts: false,
    includesReconciliation: false,
    includesAgency: false,
    includesReportExport: true, // Go-Live 包含报告导出
    tagline: "项目交付包（Agency 直接报给客户的交付包）",
    isOneTime: true, // 支持一次性收费 ($199 一次性/店)，也可月付
    features: [
      "像素迁移 + 模块发布 + 验收报告导出 (PDF/CSV)",
      "可交付的验收报告（给老板/客户看的证据）",
      "测试清单 + 事件触发记录 + 参数完整率",
      "订单金额/币种一致性验证",
      "隐私合规检查（consent/customerPrivacy）",
      "每月 10,000 笔订单追踪",
      "90 天数据保留",
    ],
    // 注意：一次性收费需要使用 Shopify AppCharge API (appPurchaseOneTimeCreate)
    // 月付使用 AppSubscription API (appSubscriptionCreate)
  },
  monitor: {
    id: "monitor",
    name: "Monitor 监控版",
    nameEn: "Monitor",
    price: 29,
    monthlyOrderLimit: 0, // 监控功能不依赖订单限制
    pixelDestinations: 0, // 监控是叠加功能，不包含像素配置
    uiModules: 0,
    includesVerification: false,
    includesAlerts: true, // Monitor 包含告警功能
    includesReconciliation: false,
    includesAgency: false,
    includesReportExport: false,
    tagline: "断档监控与告警（上线后保障）",
    features: [
      "事件量骤降告警",
      "失败率阈值监控",
      "purchase 缺参率检测",
      "日志留存与查询",
      "版本回滚支持",
      "多渠道告警（邮件/Slack/Telegram）",
      "实时事件监控",
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
    includesReportExport: true,
    tagline: "多店管理与团队协作（批量交付）",
    features: [
      "多店铺 Workspace 管理（最多 50 店）",
      "批量 Audit 扫描",
      "批量应用像素模板",
      "批量导出迁移验收报告 (PDF/CSV)",
      "白标报告支持（Agency 品牌）",
      "团队协作 (Owner/Admin/Viewer)",
      "无限像素目的地",
      "全部 Thank you 页面模块",
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

export const PLAN_IDS: readonly PlanId[] = ["free", "starter", "growth", "monitor", "agency"];
// Note: starter = Migration, growth = Go-Live, monitor = Monitor (保持兼容性,使用现有ID)

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
    // $199 可能是 Go-Live (一次性) 或 Agency (月付)
    // 默认返回 agency，实际应通过订阅类型判断
    return "agency";
  }
  if (price >= 49 && price < 199) {
    return "starter"; // Migration $49/月
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
  // Monitor 是叠加功能，不参与主层级比较
  if (planA === "monitor" || planB === "monitor") {
    return false;
  }
  const tierOrder: Record<Exclude<PlanId, "monitor">, number> = {
    free: 0,
    starter: 1, // Migration $49/月
    growth: 2, // Go-Live $199
    agency: 3, // Agency $199/月
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

