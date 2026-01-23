import prisma from "../db.server";
import { getPlanOrDefault, type PlanId } from "./billing/plans";
import { logger } from "../utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { validateTarget } from "../utils/target-validator";
import type { Prisma } from "@prisma/client";

export {
  type ModuleKey,
  type ModuleInfo,
  type OrderTrackingSettings,
  type SurveySettings,
  type ReorderSettings,
  type HelpdeskSettings,
  type UpsellSettings,
  type ModuleSettings,
  type DisplayRules,
  type LocalizationSettings,
  type UiModuleConfig,
  UI_MODULES,
  MODULE_KEYS,
} from "../types/ui-extension";

import {
  type ModuleKey,
  type ModuleSettings,
  type DisplayRules,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type LocalizationSettings,
  type UiModuleConfig,
  type SurveySettings,
  type HelpdeskSettings,
  type OrderTrackingSettings,
  type ReorderSettings,
  type UpsellSettings,
  UI_MODULES,
  MODULE_KEYS,
} from "../types/ui-extension";

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
        faqUrl: "https://help.tracking-guardian.app",
        contactEmail: undefined,
        contactUrl: undefined,
        whatsappNumber: undefined,
        messengerUrl: undefined,
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

export function validateModuleTargets(moduleKey: ModuleKey, targets: string[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const moduleInfo = UI_MODULES[moduleKey];
  if (!moduleInfo) {
    errors.push(`未知的模块: ${moduleKey}`);
    return { valid: false, errors, warnings };
  }
  const validTargets = moduleInfo.targets;
  for (const target of targets) {
    const validation = validateTarget(target);
    if (!validation.valid) {
      errors.push(validation.error || `无效的 target: ${target}`);
      if (validation.suggestion) {
        warnings.push(validation.suggestion);
      }
    } else if (validation.isDeprecated) {
      warnings.push(`Target "${target}" 已被弃用，建议使用最新版本: ${validation.suggestion || ""}`);
    }
    const normalizedTarget = target.trim();
    if (normalizedTarget === "purchase.thank-you.block.render" && !validTargets.includes("thank_you")) {
      errors.push(`模块 ${moduleKey} 不支持 target "${target}"。支持的 targets: ${validTargets.join(", ")}`);
    } else if (normalizedTarget === "customer-account.order-status.block.render" && !validTargets.includes("order_status")) {
      errors.push(`模块 ${moduleKey} 不支持 target "${target}"。支持的 targets: ${validTargets.join(", ")}`);
    } else if (!normalizedTarget.includes("purchase.thank-you.block.render") && !normalizedTarget.includes("customer-account.order-status.block.render")) {
      if (!validTargets.includes(target as "thank_you" | "order_status")) {
        errors.push(`模块 ${moduleKey} 不支持 target "${target}"。支持的 targets: ${validTargets.join(", ")}`);
      }
    }
  }
  if (targets.length === 0) {
    errors.push("至少需要指定一个 target");
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function canUseModule(shopId: string, moduleKey: ModuleKey): Promise<{
  allowed: boolean;
  requiredPlan: PlanId;
  currentPlan: PlanId;
  reason?: string;
}> {
  const moduleInfo = UI_MODULES[moduleKey];
  if (moduleKey === "reorder") {
    const { PCD_CONFIG } = await import("../utils/config.server");
    if (!PCD_CONFIG.APPROVED) {
      return {
        allowed: false,
        requiredPlan: moduleInfo.requiredPlan,
        currentPlan: "free",
        reason: "Reorder 功能需要 Protected Customer Data 审核批准，当前默认禁用",
      };
    }
  }
  if (moduleKey !== "reorder" && moduleInfo.disabled) {
    return {
      allowed: false,
      requiredPlan: moduleInfo.requiredPlan,
      currentPlan: "free",
      reason: moduleInfo.disabledReason || `${moduleKey} 模块当前不可用`,
    };
  }
  const { isModuleAvailableInV1 } = await import("../utils/version-gate");
  if (!isModuleAvailableInV1(moduleKey)) {
    return {
      allowed: false,
      requiredPlan: moduleInfo.requiredPlan,
      currentPlan: "free",
      reason: `${moduleKey} 模块在 v1.0 版本中不可用，将在后续版本中提供`,
    };
  }
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
  const requiredPlanConfig = getPlanOrDefault(moduleInfo.requiredPlan);
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
  if (planConfig.uiModules !== -1) {
    const enabledCount = await getEnabledModulesCount(shopId);
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

export async function getUiModuleConfigs(shopId: string): Promise<UiModuleConfig[]> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  });
  const storedSettings = (shop?.settings as Record<string, unknown>) || {};
  const uiModules = (storedSettings.uiModules as Record<string, unknown>) || {};
  return MODULE_KEYS.map((moduleKey) => {
    const stored = uiModules[moduleKey] as Partial<UiModuleConfig> | undefined;
    return {
      moduleKey,
      isEnabled: stored?.isEnabled ?? false,
      settings: stored?.settings ?? getDefaultSettings(moduleKey),
      displayRules: stored?.displayRules ?? getDefaultDisplayRules(moduleKey),
      localization: stored?.localization,
    };
  });
}

export async function getUiModuleConfig(
  shopId: string,
  moduleKey: ModuleKey
): Promise<UiModuleConfig> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  });
  const storedSettings = (shop?.settings as Record<string, unknown>) || {};
  const uiModules = (storedSettings.uiModules as Record<string, unknown>) || {};
  const stored = uiModules[moduleKey] as Partial<UiModuleConfig> | undefined;
  return {
    moduleKey,
    isEnabled: stored?.isEnabled ?? false,
    settings: stored?.settings ?? getDefaultSettings(moduleKey),
    displayRules: stored?.displayRules ?? getDefaultDisplayRules(moduleKey),
    localization: stored?.localization,
  };
}

export async function updateUiModuleConfig(
  shopId: string,
  moduleKey: ModuleKey,
  config: Partial<UiModuleConfig>,
  options?: { syncToExtension?: boolean; admin?: AdminApiContext }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { validateModuleSettings, validateDisplayRules, validateLocalizationSettings } = await import("../schemas/ui-module-settings");
    if (config.settings) {
      const settingsValidation = validateModuleSettings(moduleKey, config.settings);
      if (!settingsValidation.valid) {
        return {
          success: false,
          error: `设置验证失败: ${settingsValidation.error || "未知错误"}`,
        };
      }
      config.settings = settingsValidation.normalized as ModuleSettings;
    }
    if (config.displayRules) {
      const displayRulesValidation = validateDisplayRules(config.displayRules);
      if (!displayRulesValidation.valid) {
        return {
          success: false,
          error: `显示规则验证失败: ${displayRulesValidation.errors?.join(", ") || "未知错误"}`,
        };
      }
      const { validateModuleTargets } = await import("../types/ui-extension");
      if (displayRulesValidation.normalized?.targets) {
        const targetValidation = validateModuleTargets(moduleKey, displayRulesValidation.normalized.targets);
        if (!targetValidation.valid) {
          return {
            success: false,
            error: `Target 兼容性验证失败: ${targetValidation.errors.join(", ")}`,
          };
        }
        if (targetValidation.warnings.length > 0) {
          logger.warn("Module target validation warnings", {
            moduleKey,
            warnings: targetValidation.warnings,
          });
        }
      }
      config.displayRules = displayRulesValidation.normalized;
    }
    if (config.localization) {
      const localizationValidation = validateLocalizationSettings(config.localization);
      if (!localizationValidation.valid) {
        return {
          success: false,
          error: `本地化设置验证失败: ${localizationValidation.errors?.join(", ") || "未知错误"}`,
        };
      }
      config.localization = localizationValidation.normalized;
    }
    if (config.isEnabled !== undefined) {
      if (moduleKey === "reorder" && config.isEnabled) {
        const { PCD_CONFIG } = await import("../utils/config.server");
        if (!PCD_CONFIG.APPROVED) {
          return {
            success: false,
            error: "Reorder 功能需要 Protected Customer Data 审核批准，当前默认禁用",
          };
        }
      } else if (moduleKey !== "reorder") {
        const moduleInfo = UI_MODULES[moduleKey];
        if (moduleInfo.disabled) {
          return {
            success: false,
            error: moduleInfo.disabledReason || `${moduleKey} 模块当前不可用`,
          };
        }
      }
      const canUse = await canUseModule(shopId, moduleKey);
      if (!canUse.allowed) {
        return {
          success: false,
          error: canUse.reason || "无权限使用该模块",
        };
      }
    }
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { settings: true },
    });
    const storedSettings = (shop?.settings as Record<string, unknown>) || {};
    const uiModules = (storedSettings.uiModules as Record<string, unknown>) || {};
    const existing = uiModules[moduleKey] as Partial<UiModuleConfig> | undefined;
    const updated: UiModuleConfig = {
      moduleKey,
      isEnabled: config.isEnabled !== undefined ? config.isEnabled : (existing?.isEnabled ?? false),
      settings: config.settings ?? existing?.settings ?? getDefaultSettings(moduleKey),
      displayRules: config.displayRules ?? existing?.displayRules ?? getDefaultDisplayRules(moduleKey),
      localization: config.localization ?? existing?.localization,
    };
    uiModules[moduleKey] = updated;
    storedSettings.uiModules = uiModules;
    await prisma.shop.update({
      where: { id: shopId },
      data: { settings: storedSettings as Prisma.InputJsonValue },
    });
    if (options?.syncToExtension && options?.admin) {
      const { syncSingleModule } = await import("./ui-extension-sync.server");
      const syncResult = await syncSingleModule(shopId, moduleKey, options.admin);
      if (!syncResult.success) {
        logger.warn("Failed to sync module to extension", {
          shopId,
          moduleKey,
          error: syncResult.error,
        });
      }
    }
    return { success: true };
  } catch (error) {
    logger.error(`Failed to update UI module config`, { shopId, moduleKey, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "更新失败",
    };
  }
}

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

export async function resetModuleToDefault(
  shopId: string,
  moduleKey: ModuleKey
): Promise<{ success: boolean; error?: string }> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { settings: true },
    });
    const storedSettings = (shop?.settings as Record<string, unknown>) || {};
    const uiModules = (storedSettings.uiModules as Record<string, unknown>) || {};
    uiModules[moduleKey] = {
      moduleKey,
      isEnabled: false,
      settings: getDefaultSettings(moduleKey),
      displayRules: getDefaultDisplayRules(moduleKey),
    };
    storedSettings.uiModules = uiModules;
    await prisma.shop.update({
      where: { id: shopId },
      data: { settings: storedSettings as Prisma.InputJsonValue },
    });
    return { success: true };
  } catch (error) {
    logger.error(`Failed to reset module to default`, { shopId, moduleKey, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "重置失败",
    };
  }
}

export async function getEnabledModulesCount(shopId: string): Promise<number> {
  const configs = await getUiModuleConfigs(shopId);
  return configs.filter((c) => c.isEnabled).length;
}

export async function getModuleStats(shopId: string): Promise<{
  total: number;
  enabled: number;
  byCategory: Record<string, number>;
}> {
  const configs = await getUiModuleConfigs(shopId);
  const enabled = configs.filter((c) => c.isEnabled).length;
  const byCategory: Record<string, number> = {};
  configs.forEach((config) => {
    const category = UI_MODULES[config.moduleKey]?.category || "other";
    if (!byCategory[category]) {
      byCategory[category] = 0;
    }
    if (config.isEnabled) {
      byCategory[category]++;
    }
  });
  return {
    total: MODULE_KEYS.length,
    enabled,
    byCategory,
  };
}
