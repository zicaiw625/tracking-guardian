/**
 * P1-04: 统一 UI 模块设置 Schema
 * 
 * 定义 Thank you / Order status UI 模块的统一配置格式
 */

import { z } from "zod";

/**
 * 模块类型
 */
export const MODULE_KEYS = [
  "survey",
  "reorder",
  "support",
  "shipping_tracker",
  "upsell_offer",
] as const;

export type ModuleKey = typeof MODULE_KEYS[number];

/**
 * 显示规则
 */
export const DisplayRuleSchema = z.object({
  // 显示条件
  showOnThankYou: z.boolean().default(true),
  showOnOrderStatus: z.boolean().default(true),
  
  // 订单金额条件
  minOrderValue: z.number().optional(),
  maxOrderValue: z.number().optional(),
  
  // 订单状态条件
  orderStatuses: z.array(z.string()).optional(), // ["fulfilled", "partially_fulfilled"]
  
  // 商品条件
  productTags: z.array(z.string()).optional(),
  productTypes: z.array(z.string()).optional(),
  
  // 客户条件
  customerTags: z.array(z.string()).optional(),
  
  // 时间条件
  showAfterHours: z.number().optional(), // 订单创建后 N 小时显示
  showBeforeHours: z.number().optional(), // 订单创建后 N 小时内显示
  
  // 其他条件
  customConditions: z.record(z.unknown()).optional(),
});

export type DisplayRule = z.infer<typeof DisplayRuleSchema>;

/**
 * 本地化配置
 */
export const LocalizationSchema = z.object({
  // 语言代码（ISO 639-1）
  locale: z.string().default("en"),
  
  // 翻译文本
  translations: z.record(z.string()).optional(),
  
  // 日期格式
  dateFormat: z.string().default("YYYY-MM-DD"),
  
  // 货币格式
  currencyFormat: z.string().default("USD"),
});

export type Localization = z.infer<typeof LocalizationSchema>;

/**
 * Survey 模块设置
 */
export const SurveySettingsSchema = z.object({
  title: z.string().default("How was your experience?"),
  question: z.string().default("Rate your experience"),
  showRating: z.boolean().default(true),
  showFeedback: z.boolean().default(true),
  required: z.boolean().default(false),
  submitButtonText: z.string().default("Submit"),
  thankYouMessage: z.string().default("Thank you for your feedback!"),
  customFields: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(["text", "textarea", "select", "radio", "checkbox"]),
    required: z.boolean().default(false),
    options: z.array(z.string()).optional(),
  })).optional(),
});

export type SurveySettings = z.infer<typeof SurveySettingsSchema>;

/**
 * Reorder 模块设置
 */
export const ReorderSettingsSchema = z.object({
  buttonText: z.string().default("Reorder"),
  buttonStyle: z.enum(["primary", "secondary", "outline"]).default("primary"),
  showQuantitySelector: z.boolean().default(true),
  allowPartialReorder: z.boolean().default(false),
  redirectUrl: z.string().optional(),
});

export type ReorderSettings = z.infer<typeof ReorderSettingsSchema>;

/**
 * Support 模块设置
 */
export const SupportSettingsSchema = z.object({
  title: z.string().default("Need Help?"),
  description: z.string().default("Contact our support team"),
  contactUrl: z.string().optional(),
  contactEmail: z.string().optional(),
  faqItems: z.array(z.object({
    id: z.string(),
    question: z.string(),
    answer: z.string(),
  })).optional(),
  showChatWidget: z.boolean().default(false),
  chatWidgetUrl: z.string().optional(),
});

export type SupportSettings = z.infer<typeof SupportSettingsSchema>;

/**
 * Shipping Tracker 模块设置
 */
export const ShippingTrackerSettingsSchema = z.object({
  title: z.string().default("Order Status"),
  showProgressBar: z.boolean().default(true),
  showTrackingNumber: z.boolean().default(true),
  showEstimatedDelivery: z.boolean().default(true),
  tipText: z.string().optional(),
  customStatusLabels: z.record(z.string()).optional(),
});

export type ShippingTrackerSettings = z.infer<typeof ShippingTrackerSettingsSchema>;

/**
 * Upsell Offer 模块设置
 */
export const UpsellOfferSettingsSchema = z.object({
  discountCode: z.string().optional(),
  discountPercent: z.number().optional(),
  discountAmount: z.number().optional(),
  expiryHours: z.number().default(24),
  title: z.string().default("Special Offer"),
  description: z.string().default("Get an extra discount on your next order"),
  buttonText: z.string().default("Claim Offer"),
  continueShoppingUrl: z.string().optional(),
});

export type UpsellOfferSettings = z.infer<typeof UpsellOfferSettingsSchema>;

/**
 * 统一模块设置 Schema
 */
export const ModuleSettingsSchema = z.object({
  // 基础设置
  isEnabled: z.boolean().default(true),
  moduleKey: z.enum(MODULE_KEYS),
  
  // 模块特定设置
  survey: SurveySettingsSchema.optional(),
  reorder: ReorderSettingsSchema.optional(),
  support: SupportSettingsSchema.optional(),
  shipping_tracker: ShippingTrackerSettingsSchema.optional(),
  upsell_offer: UpsellOfferSettingsSchema.optional(),
  
  // 显示规则
  displayRules: DisplayRuleSchema.optional(),
  
  // 本地化
  localization: z.array(LocalizationSchema).optional(),
  
  // 元数据
  version: z.number().default(1),
  updatedAt: z.string().optional(),
});

export type ModuleSettings = z.infer<typeof ModuleSettingsSchema>;

/**
 * 验证模块设置
 */
export function validateModuleSettings(
  moduleKey: ModuleKey,
  settings: unknown
): { valid: boolean; error?: string; normalized?: ModuleSettings } {
  try {
    const baseSchema = ModuleSettingsSchema.pick({
      isEnabled: true,
      moduleKey: true,
      displayRules: true,
      localization: true,
      version: true,
      updatedAt: true,
    });
    
    // 根据模块类型添加特定设置
    let schema = baseSchema;
    switch (moduleKey) {
      case "survey":
        schema = baseSchema.extend({ survey: SurveySettingsSchema });
        break;
      case "reorder":
        schema = baseSchema.extend({ reorder: ReorderSettingsSchema });
        break;
      case "support":
        schema = baseSchema.extend({ support: SupportSettingsSchema });
        break;
      case "shipping_tracker":
        schema = baseSchema.extend({ shipping_tracker: ShippingTrackerSettingsSchema });
        break;
      case "upsell_offer":
        schema = baseSchema.extend({ upsell_offer: UpsellOfferSettingsSchema });
        break;
    }
    
    const normalized = schema.parse({
      ...settings,
      moduleKey,
    });
    
    return { valid: true, normalized };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        error: error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", "),
      };
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 获取模块默认设置
 */
export function getDefaultModuleSettings(moduleKey: ModuleKey): ModuleSettings {
  const base: ModuleSettings = {
    isEnabled: true,
    moduleKey,
    displayRules: {
      showOnThankYou: true,
      showOnOrderStatus: true,
    },
    version: 1,
  };
  
  switch (moduleKey) {
    case "survey":
      return {
        ...base,
        survey: SurveySettingsSchema.parse({}),
      };
    case "reorder":
      return {
        ...base,
        reorder: ReorderSettingsSchema.parse({}),
      };
    case "support":
      return {
        ...base,
        support: SupportSettingsSchema.parse({}),
      };
    case "shipping_tracker":
      return {
        ...base,
        shipping_tracker: ShippingTrackerSettingsSchema.parse({}),
      };
    case "upsell_offer":
      return {
        ...base,
        upsell_offer: UpsellOfferSettingsSchema.parse({}),
      };
    default:
      return base;
  }
}

/**
 * 合并模块设置（用于更新）
 */
export function mergeModuleSettings(
  existing: Partial<ModuleSettings>,
  updates: Partial<ModuleSettings>
): ModuleSettings {
  return {
    ...getDefaultModuleSettings(updates.moduleKey || existing.moduleKey || "survey"),
    ...existing,
    ...updates,
    displayRules: {
      ...getDefaultModuleSettings(updates.moduleKey || existing.moduleKey || "survey").displayRules,
      ...existing.displayRules,
      ...updates.displayRules,
    },
  };
}
