import type { PlanId } from "../services/billing/plans";

export type ModuleKey =
  | "order_tracking"
  | "survey"
  | "reorder"
  | "helpdesk"
  | "upsell";

export interface ModuleInfo {
  key: ModuleKey;
  name: string;
  nameEn: string;
  description: string;
  icon: string;
  category: "engagement" | "support" | "conversion";
  requiredPlan: PlanId;
  targets: ("thank_you" | "order_status")[];
  disabled?: boolean;
  disabledReason?: string;
}

export interface OrderTrackingSettings {
  provider?: "aftership" | "17track" | "native";
  apiKey?: string;
  title?: string;
  showEstimatedDelivery?: boolean;
}

export interface SurveySettings {
  title?: string;
  question?: string;
  sources?: Array<{ id: string; label: string }>;
  showRating?: boolean;
  ratingLabel?: string;
}

export interface ReorderSettings {
  title?: string;
  subtitle?: string;
  buttonText?: string;
  showItems?: boolean;
  maxItemsToShow?: number;
}

export interface HelpdeskSettings {
  title?: string;
  description?: string;
  faqUrl?: string;
  contactEmail?: string;
  contactUrl?: string;
  whatsappNumber?: string;
  messengerUrl?: string;
  continueShoppingUrl?: string;
}

export interface UpsellSettings {
  title?: string;
  subtitle?: string;
  products?: Array<{
    id: string;
    title: string;
    price: string;
    imageUrl?: string;
  }>;
  discountCode?: string;
  discountPercent?: number;
}

export type ModuleSettings =
  | OrderTrackingSettings
  | SurveySettings
  | ReorderSettings
  | HelpdeskSettings
  | UpsellSettings;

export interface DisplayRules {
  enabled: boolean;
  targets: ("thank_you" | "order_status")[];
  conditions?: {
    minOrderValue?: number;
    customerTags?: string[];
    countries?: string[];
  };
}

export interface LocalizationSettings {
  [locale: string]: {
    title?: string;
    subtitle?: string;
    buttonText?: string;
    question?: string;
    description?: string;
  };
}

export interface UiModuleConfig {
  moduleKey: ModuleKey;
  isEnabled: boolean;
  settings: ModuleSettings;
  displayRules: DisplayRules;
  localization?: LocalizationSettings;
}

export const UI_MODULES: Record<ModuleKey, ModuleInfo> = {
  survey: {
    key: "survey",
    name: "购后问卷",
    nameEn: "Post-purchase Survey",
    description: "收集客户反馈，了解获客渠道",
    icon: "📋",
    category: "engagement",
    requiredPlan: "starter",
    targets: ["thank_you", "order_status"],
  },
  helpdesk: {
    key: "helpdesk",
    name: "帮助中心",
    nameEn: "Help & Support",
    description: "FAQ、联系客服、售后支持入口",
    icon: "💬",
    category: "support",
    requiredPlan: "starter",
    targets: ["thank_you", "order_status"],
  },
  order_tracking: {
    key: "order_tracking",
    name: "物流追踪",
    nameEn: "Order Tracking",
    description: "实时展示物流状态和预计送达时间",
    icon: "📦",
    category: "support",
    requiredPlan: "growth",
    targets: ["thank_you", "order_status"],
    disabled: true,
    disabledReason: "v1.1+ 规划中",
  },
  reorder: {
    key: "reorder",
    name: "再购按钮",
    nameEn: "Reorder",
    description: "一键再次购买相同商品（仅支持 Customer Accounts 的 Order Status 页面）",
    icon: "🔄",
    category: "conversion",
    requiredPlan: "growth",
    targets: ["order_status"],
  },
  upsell: {
    key: "upsell",
    name: "追加销售",
    nameEn: "Upsell Offer",
    description: "推荐相关产品，提升客单价",
    icon: "🎁",
    category: "conversion",
    requiredPlan: "growth",
    targets: ["thank_you", "order_status"],
    disabled: true,
    disabledReason: "v1.1+ 规划中",
  },
};

export const MODULE_KEYS = Object.keys(UI_MODULES) as ModuleKey[];

const VALID_TARGETS = ["thank_you", "order_status"] as const;

export function validateModuleTargets(moduleKey: ModuleKey, targets: string[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const moduleInfo = UI_MODULES[moduleKey];
  if (!moduleInfo) {
    errors.push(`模块 ${moduleKey} 不存在`);
    return { valid: false, errors, warnings };
  }
  if (targets.length === 0) {
    errors.push("必须至少选择一个 target");
    return { valid: false, errors, warnings };
  }
  /* eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional dynamic import */
  const { validateTarget } = require("../utils/target-validator");
  const targetMapping: Record<string, string> = {
    "thank_you": "purchase.thank-you.block.render",
    "order_status": "customer-account.order-status.block.render",
  };
  for (const target of targets) {
    if (!VALID_TARGETS.includes(target as typeof VALID_TARGETS[number])) {
      errors.push(`无效的 target: ${target}。有效的 targets 为: ${VALID_TARGETS.join(", ")}`);
      continue;
    }
    const fullTarget = targetMapping[target];
    if (fullTarget) {
      const validation = validateTarget(fullTarget);
      if (!validation.valid) {
        errors.push(validation.error || `无效的 target: ${fullTarget}`);
        if (validation.suggestion) {
          warnings.push(validation.suggestion);
        }
      }
      if (validation.isDeprecated) {
        warnings.push(`Target "${fullTarget}" 已被弃用，建议使用最新版本`);
        if (validation.suggestion) {
          warnings.push(validation.suggestion);
        }
      }
    }
    if (!moduleInfo.targets.includes(target as "thank_you" | "order_status")) {
      errors.push(`模块 ${moduleKey} 不支持 target ${target}。支持的 targets 为: ${moduleInfo.targets.join(", ")}`);
    }
  }
  if (targets.includes("order_status") && moduleKey === "reorder") {
    const hasThankYou = targets.includes("thank_you");
    if (hasThankYou) {
      warnings.push("Reorder 模块仅支持 order_status target，不支持 thank_you target");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function getValidTargetsForModule(moduleKey: ModuleKey): ("thank_you" | "order_status")[] {
  const moduleInfo = UI_MODULES[moduleKey];
  if (!moduleInfo) {
    return [];
  }
  return moduleInfo.targets.filter((target): target is "thank_you" | "order_status" => 
    VALID_TARGETS.includes(target as typeof VALID_TARGETS[number])
  );
}
