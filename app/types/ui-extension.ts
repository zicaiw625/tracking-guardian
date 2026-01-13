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
    description: "一键再次购买相同商品",
    icon: "🔄",
    category: "conversion",
    requiredPlan: "growth",
    targets: ["order_status"],
    disabled: true,
    disabledReason: "v1.1+ 规划中",
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
