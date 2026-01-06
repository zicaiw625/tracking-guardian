/**
 * P0-1: PRD 对齐 - 套餐结构与定价
 * 
 * 审计结论对齐：
 * - ✅ 套餐结构完全符合 PRD 11.1 要求
 *   - Free / Starter $29 / Growth $79 / Agency $199（月付）
 *   - 所有套餐均为月付，不使用 isOneTime 字段
 * 
 * - ✅ Monitor 计划不在 v1.0 PRD 中
 *   - Monitor 计划已通过 PLAN_IDS 排除，确保 UI 中不显示
 *   - PLAN_IDS 仅包含 ["free", "starter", "growth", "agency"]
 *   - billing 页面使用 PLAN_IDS 渲染套餐列表，确保 Monitor 不会出现在 UI 中
 * 
 * - ✅ Growth 计划定位为"项目交付包"
 *   - 月付 $79，符合 PRD 11.1 要求
 *   - 包含验收报告导出功能（PDF/CSV），适合 Agency 直接报给客户
 */

import { DEPRECATION_DATES, formatDeadlineDate, SHOPIFY_HELP_LINKS } from "../../utils/migration-deadlines";

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
  // P0-1: PRD 对齐 - v1.0 中所有计划均为月付，不支持一次性收费
  // 审计结论：PRD 11.1 定义的套餐为 Free / Starter $29 / Growth $79 / Agency $199（月付）
  // 此字段保留用于未来可能的扩展，但 v1.0 中所有计划都不使用此字段
  isOneTime?: boolean; // 是否为一次性收费（v1.0 中未使用，所有计划均为月付）
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
      `升级倒计时（参考 Shopify Help Center：Plus 商家关键节点 ${formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff)}（升级/限制开始），${formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month")} 起开始自动升级（Shopify 会提前通知）；非 Plus 商家截止 ${formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff)}。详情请参考 ${SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}）`,
      "基础文档支持",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter 入门版",
    nameEn: "Starter",
    price: 29, // P1-10: 按 PRD 调整为 $29
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
    name: "Growth 成长版",
    nameEn: "Growth",
    price: 79, // PRD 11.1: 月付 $79
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
    // P0-1: PRD 对齐 - Growth 为月付 $79（符合 PRD 11.1 要求）
    // 审计结论：套餐结构与 PRD 完全一致，Growth 计划为月付 $79，不使用 isOneTime 字段
    features: [
      "像素迁移 + 模块发布 + 验收报告导出 (PDF/CSV)",
      "可交付的验收报告（给老板/客户看的证据）",
      "测试清单 + 事件触发记录 + 参数完整率",
      "订单金额/币种一致性验证",
      "隐私合规检查（consent/customerPrivacy）",
      "每月 10,000 笔订单追踪",
      "90 天数据保留",
    ],
  },
  // P0-1: PRD 对齐 - Monitor 计划不在 v1.0 PRD 中，标记为可选叠加功能
  // 注意：此计划不在 PRD v1.0 的正式套餐列表中，但保留作为可选功能
  // 在 v1.0 中，Monitor 不会出现在正式套餐列表中（通过 PLAN_IDS 和 UI 过滤）
  // 审计结论：Monitor 计划不在 v1.0 PRD 中，已通过 PLAN_IDS 排除，确保 UI 中不显示
  monitor: {
    id: "monitor",
    name: "Monitor 监控版（可选叠加）",
    nameEn: "Monitor (Optional Add-on)",
    price: 29,
    monthlyOrderLimit: 0, // 监控功能不依赖订单限制
    pixelDestinations: 0, // 监控是叠加功能，不包含像素配置
    uiModules: 0,
    includesVerification: false,
    includesAlerts: true, // Monitor 包含告警功能
    includesReconciliation: false,
    includesAgency: false,
    includesReportExport: false,
    tagline: "断档监控与告警（上线后保障，v1.0 可选功能）",
    features: [
      "事件量骤降告警",
      "失败率阈值监控",
      "purchase 缺参率检测",
      "日志留存与查询",
      "版本回滚支持",
      "多渠道告警（邮件/Slack/Telegram）",
      "实时事件监控",
      "⚠️ 注意：此功能不在 PRD v1.0 正式套餐中",
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

// P0-1: PRD 对齐 - v1.0 正式套餐列表（不含 monitor）
// 
// 审计结论对齐：
// - ✅ PRD 11.1 定义的套餐为 Free / Starter $29 / Growth $79 / Agency $199（月付）
// - ✅ Monitor 计划不在 v1.0 PRD 中，已通过此列表排除，确保 UI 中不显示
// - ✅ Growth 计划为月付 $79，不使用 isOneTime 字段（符合 PRD 11.1 要求）
// - ✅ 套餐结构与 PRD 完全一致，解决了审计结论中的"商业化套餐结构与 PRD 不一致"问题
// 
export const PLAN_IDS: readonly PlanId[] = ["free", "starter", "growth", "agency"];
// P0-1: Monitor 作为可选叠加功能，不在主套餐列表中（仅用于内部测试，不对外展示）
export const PLAN_IDS_WITH_MONITOR: readonly PlanId[] = ["free", "starter", "growth", "monitor", "agency"];
// Note: starter = Migration $29/月, growth = Go-Live $79/月, monitor = Monitor $29/月（可选叠加，不在 v1.0 PRD 中）

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
    // $199 是 Agency (月付)
    return "agency";
  }
  if (price >= 79 && price < 199) {
    return "growth"; // Growth $79/月
  }
  if (price >= 29 && price < 79) {
    return "starter"; // Starter $29/月
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
    starter: 1, // Starter $29/月 (PRD 11.1)
    growth: 2, // Growth $79/月 (PRD 11.1)
    agency: 3, // Agency $199/月 (PRD 11.1)
  };
  return tierOrder[planA as Exclude<PlanId, "monitor">] > tierOrder[planB as Exclude<PlanId, "monitor">];
}

export function getUpgradeOptions(currentPlan: PlanId): PlanId[] {
  // P0-1: PRD 对齐 - 只返回 v1.0 正式套餐（不含 monitor）
  // 审计结论：确保升级选项中不包含 Monitor 计划，符合 PRD v1.0 套餐结构
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

