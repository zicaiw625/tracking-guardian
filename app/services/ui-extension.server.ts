/**
 * UI Extension 设置服务
 * 对应设计方案 4.4 Thank you / Order status UI 模块库
 * 
 * 管理 UiExtensionSetting 模型的 CRUD 操作
 */

import prisma from "../db.server";
import type { UiExtensionSetting } from "@prisma/client";
import { getPlanOrDefault, type PlanId } from "./billing/plans";
import { logger } from "../utils/logger.server";

// ============================================================
// 类型定义
// ============================================================

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

// ============================================================
// 模块元数据
// ============================================================

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
  },
  reorder: {
    key: "reorder",
    name: "再购按钮",
    nameEn: "Reorder",
    description: "一键再次购买相同商品",
    icon: "🔄",
    category: "conversion",
    requiredPlan: "growth",
    targets: ["thank_you", "order_status"],
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
  },
};

export const MODULE_KEYS = Object.keys(UI_MODULES) as ModuleKey[];

// ============================================================
// 默认设置
// ============================================================

export function getDefaultSettings(moduleKey: ModuleKey): ModuleSettings {
  switch (moduleKey) {
    case "survey":
      return {
        title: "我们想听听您的意见",
        question: "您是如何了解到我们的？",
        sources: [
          { id: "search", label: "搜索引擎" },
          { id: "social", label: "社交媒体" },
          { id: "friend", label: "朋友推荐" },
          { id: "ad", label: "广告" },
          { id: "other", label: "其他" },
        ],
        showRating: true,
        ratingLabel: "请为本次购物体验打分",
      } as SurveySettings;
    
    case "helpdesk":
      return {
        title: "订单帮助与售后",
        description: "如需修改收件信息、查看售后政策或联系人工客服，请使用下方入口。",
        faqUrl: "/pages/faq",
        continueShoppingUrl: "/",
      } as HelpdeskSettings;
    
    case "order_tracking":
      return {
        provider: "native",
        title: "物流追踪",
        showEstimatedDelivery: true,
      } as OrderTrackingSettings;
    
    case "reorder":
      return {
        title: "📦 再次购买",
        subtitle: "喜欢这次购物？一键再次订购相同商品",
        buttonText: "再次购买 →",
        showItems: true,
        maxItemsToShow: 3,
      } as ReorderSettings;
    
    case "upsell":
      return {
        title: "🎁 为您推荐",
        subtitle: "您可能还喜欢这些商品",
        products: [],
        discountPercent: 10,
      } as UpsellSettings;
    
    default:
      return {};
  }
}

export function getDefaultDisplayRules(moduleKey: ModuleKey): DisplayRules {
  return {
    enabled: false,
    targets: UI_MODULES[moduleKey]?.targets || ["thank_you"],
  };
}

// ============================================================
// 权限检查
// ============================================================

/**
 * 检查店铺套餐是否支持该模块
 */
export async function canUseModule(shopId: string, moduleKey: ModuleKey): Promise<{
  allowed: boolean;
  requiredPlan: PlanId;
  currentPlan: PlanId;
  reason?: string;
}> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });

  if (!shop) {
    return {
      allowed: false,
      requiredPlan: UI_MODULES[moduleKey].requiredPlan,
      currentPlan: "free",
      reason: "店铺不存在",
    };
  }

  const currentPlan = shop.plan as PlanId;
  const planConfig = getPlanOrDefault(currentPlan);
  const moduleInfo = UI_MODULES[moduleKey];
  const requiredPlanConfig = getPlanOrDefault(moduleInfo.requiredPlan);

  // 检查套餐等级
  const planOrder: PlanId[] = ["free", "starter", "growth", "agency"];
  const currentIndex = planOrder.indexOf(currentPlan);
  const requiredIndex = planOrder.indexOf(moduleInfo.requiredPlan);

  if (currentIndex < requiredIndex) {
    return {
      allowed: false,
      requiredPlan: moduleInfo.requiredPlan,
      currentPlan,
      reason: `需要 ${requiredPlanConfig.name} 或更高套餐`,
    };
  }

  // 检查模块数量限制
  if (planConfig.uiModules !== -1) {
    const enabledCount = await prisma.uiExtensionSetting.count({
      where: {
        shopId,
        isEnabled: true,
      },
    });

    if (enabledCount >= planConfig.uiModules) {
      return {
        allowed: false,
        requiredPlan: "growth",
        currentPlan,
        reason: `当前套餐最多启用 ${planConfig.uiModules} 个模块`,
      };
    }
  }

  return {
    allowed: true,
    requiredPlan: moduleInfo.requiredPlan,
    currentPlan,
  };
}

// ============================================================
// CRUD 操作
// ============================================================

/**
 * 获取店铺的所有 UI 模块配置
 */
export async function getUiModuleConfigs(shopId: string): Promise<UiModuleConfig[]> {
  const settings = await prisma.uiExtensionSetting.findMany({
    where: { shopId },
  });

  // 为每个模块生成配置，包括未配置的模块
  return MODULE_KEYS.map((moduleKey) => {
    const existing = settings.find((s) => s.moduleKey === moduleKey);
    
    if (existing) {
      return {
        moduleKey,
        isEnabled: existing.isEnabled,
        settings: (existing.settingsJson as ModuleSettings) || getDefaultSettings(moduleKey),
        displayRules: (existing.displayRules as DisplayRules) || getDefaultDisplayRules(moduleKey),
        localization: (existing.localization as LocalizationSettings) || undefined,
      };
    }

    return {
      moduleKey,
      isEnabled: false,
      settings: getDefaultSettings(moduleKey),
      displayRules: getDefaultDisplayRules(moduleKey),
    };
  });
}

/**
 * 获取单个模块配置
 */
export async function getUiModuleConfig(
  shopId: string,
  moduleKey: ModuleKey
): Promise<UiModuleConfig> {
  const setting = await prisma.uiExtensionSetting.findUnique({
    where: {
      shopId_moduleKey: { shopId, moduleKey },
    },
  });

  if (setting) {
    return {
      moduleKey,
      isEnabled: setting.isEnabled,
      settings: (setting.settingsJson as ModuleSettings) || getDefaultSettings(moduleKey),
      displayRules: (setting.displayRules as DisplayRules) || getDefaultDisplayRules(moduleKey),
      localization: (setting.localization as LocalizationSettings) || undefined,
    };
  }

  return {
    moduleKey,
    isEnabled: false,
    settings: getDefaultSettings(moduleKey),
    displayRules: getDefaultDisplayRules(moduleKey),
  };
}

/**
 * 更新模块配置
 */
export async function updateUiModuleConfig(
  shopId: string,
  moduleKey: ModuleKey,
  config: Partial<UiModuleConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    // 如果要启用模块，先检查权限
    if (config.isEnabled) {
      const canUse = await canUseModule(shopId, moduleKey);
      if (!canUse.allowed) {
        return {
          success: false,
          error: canUse.reason || "无权限使用该模块",
        };
      }
    }

    const data: Parameters<typeof prisma.uiExtensionSetting.upsert>[0]["update"] = {};
    
    if (config.isEnabled !== undefined) {
      data.isEnabled = config.isEnabled;
    }
    if (config.settings) {
      data.settingsJson = config.settings as object;
    }
    if (config.displayRules) {
      data.displayRules = config.displayRules as object;
    }
    if (config.localization) {
      data.localization = config.localization as object;
    }

    await prisma.uiExtensionSetting.upsert({
      where: {
        shopId_moduleKey: { shopId, moduleKey },
      },
      update: data,
      create: {
        shopId,
        moduleKey,
        isEnabled: config.isEnabled ?? false,
        settingsJson: (config.settings || getDefaultSettings(moduleKey)) as object,
        displayRules: (config.displayRules || getDefaultDisplayRules(moduleKey)) as object,
        localization: config.localization as object,
      },
    });

    logger.info(`UI module config updated`, { shopId, moduleKey, isEnabled: config.isEnabled });

    return { success: true };
  } catch (error) {
    logger.error(`Failed to update UI module config`, { shopId, moduleKey, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "更新失败",
    };
  }
}

/**
 * 批量更新模块启用状态
 */
export async function batchToggleModules(
  shopId: string,
  updates: Array<{ moduleKey: ModuleKey; isEnabled: boolean }>
): Promise<{ success: boolean; results: Array<{ moduleKey: ModuleKey; success: boolean; error?: string }> }> {
  const results: Array<{ moduleKey: ModuleKey; success: boolean; error?: string }> = [];

  for (const update of updates) {
    const result = await updateUiModuleConfig(shopId, update.moduleKey, {
      isEnabled: update.isEnabled,
    });
    results.push({
      moduleKey: update.moduleKey,
      ...result,
    });
  }

  return {
    success: results.every((r) => r.success),
    results,
  };
}

/**
 * 重置模块为默认设置
 */
export async function resetModuleToDefault(
  shopId: string,
  moduleKey: ModuleKey
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.uiExtensionSetting.upsert({
      where: {
        shopId_moduleKey: { shopId, moduleKey },
      },
      update: {
        settingsJson: getDefaultSettings(moduleKey) as object,
        displayRules: getDefaultDisplayRules(moduleKey) as object,
        localization: null,
      },
      create: {
        shopId,
        moduleKey,
        isEnabled: false,
        settingsJson: getDefaultSettings(moduleKey) as object,
        displayRules: getDefaultDisplayRules(moduleKey) as object,
      },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "重置失败",
    };
  }
}

/**
 * 获取已启用的模块数量
 */
export async function getEnabledModulesCount(shopId: string): Promise<number> {
  return prisma.uiExtensionSetting.count({
    where: {
      shopId,
      isEnabled: true,
    },
  });
}

/**
 * 获取模块使用统计
 */
export async function getModuleStats(shopId: string): Promise<{
  total: number;
  enabled: number;
  byCategory: Record<string, number>;
}> {
  const settings = await prisma.uiExtensionSetting.findMany({
    where: { shopId },
  });

  const enabled = settings.filter((s) => s.isEnabled).length;
  const byCategory: Record<string, number> = {};

  settings
    .filter((s) => s.isEnabled)
    .forEach((s) => {
      const module = UI_MODULES[s.moduleKey as ModuleKey];
      if (module) {
        byCategory[module.category] = (byCategory[module.category] || 0) + 1;
      }
    });

  return {
    total: MODULE_KEYS.length,
    enabled,
    byCategory,
  };
}

