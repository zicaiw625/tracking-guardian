

export type PlanId = "free" | "growth" | "pro" | "agency";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceLabel: string;
  tagline: string;
  features: string[];
}

export const PLAN_ORDER: PlanId[] = ["free", "growth", "pro", "agency"];

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "免费版",
    priceLabel: "$0",
    tagline: "扫描报告 + 基础建议",
    features: ["扫描检测 ScriptTag / Additional Scripts", "迁移截止期倒计时", "本地脚本内容分析"],
  },
  growth: {
    id: "growth",
    name: "Growth ($29/月)",
    priceLabel: "$29",
    tagline: "像素迁移（1-2 个渠道）+ 基础 TY/OS 模块",
    features: [
      "App Pixel 启用 + 服务端 CAPI",
      "GA4 / Meta / TikTok 三选二配置向导",
      "基础 Thank You / Order Status 组件",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro ($79/月)",
    priceLabel: "$79",
    tagline: "多渠道像素 + 事件对账 + 高级 TY/OS 模块",
    features: ["多渠道像素同步", "事件送达对账面板", "高级 TY/OS 组件 (FAQ/Upsell/Survey)", "告警 & 重试"],
  },
  agency: {
    id: "agency",
    name: "Agency ($199/月)",
    priceLabel: "$199",
    tagline: "多店铺 + 团队协作 + 白标报告",
    features: ["多店铺切换", "团队协作/审计", "白标扫描报告", "优先支持与迁移托管"],
  },
};

export function normalizePlan(plan: string | null | undefined): PlanId {
  if (plan && (PLAN_ORDER as string[]).includes(plan)) {
    return plan as PlanId;
  }
  return "free";
}

export function getPlanDefinition(plan: string | null | undefined): PlanDefinition {
  return PLAN_DEFINITIONS[normalizePlan(plan)];
}

export function isPlanAtLeast(current: string | null | undefined, target: PlanId): boolean {
  const currentIndex = PLAN_ORDER.indexOf(normalizePlan(current));
  const targetIndex = PLAN_ORDER.indexOf(target);
  return currentIndex >= targetIndex;
}

