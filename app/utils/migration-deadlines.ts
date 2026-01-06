/**
 * P0-1: 统一迁移截止日期 - 使用 Shopify 官方口径
 * 
 * 此文件重新导出 deprecation-dates.ts 中的常量，提供更简洁的 API。
 * 所有迁移相关的日期引用都应使用此文件或直接使用 deprecation-dates.ts。
 * 
 * 参考来源：
 * - Plus 商家：https://help.shopify.com/en/manual/checkout-settings/upgrade-guide
 * - Non-Plus 商家：https://help.shopify.com/en/manual/checkout-settings/upgrade-guide
 */

import {
  DEPRECATION_DATES as DEPRECATION_DATES_IMPORT,
  getDateDisplayLabel,
  type ShopTier,
} from "./deprecation-dates";

// 重新导出 DEPRECATION_DATES 以便统一使用
export const DEPRECATION_DATES = DEPRECATION_DATES_IMPORT;

/**
 * Plus 商家关键节点（重新导出）
 */
export const PLUS_DEADLINES = {
  /** 2025-08-28: Plus 商家 ScriptTag 和 Additional Scripts 停止执行，进入只读模式 */
  SCRIPT_TAG_OFF: DEPRECATION_DATES.plusScriptTagExecutionOff,
  /** 2026-01: Plus 商家自动升级开始（Shopify 开始自动升级 Plus 商家到新版 TYP/OSP 页面，通常带 30 天通知） */
  AUTO_UPGRADE_START: DEPRECATION_DATES.plusAutoUpgradeStart,
} as const;

/**
 * Non-Plus 商家关键节点（重新导出）
 */
export const NON_PLUS_DEADLINES = {
  /** 2026-08-26: 非 Plus 商家 ScriptTag 和 Additional Scripts 完全停止执行 */
  SCRIPT_TAG_OFF: DEPRECATION_DATES.nonPlusScriptTagExecutionOff,
} as const;

/**
 * 通用关键节点（所有商家）（重新导出）
 */
export const COMMON_DEADLINES = {
  /** 2025-02-01: ScriptTag 创建受限（无法在 Thank you / Order status 页面创建新的 ScriptTag） */
  SCRIPT_TAG_CREATION_BLOCKED: DEPRECATION_DATES.scriptTagCreationBlocked,
} as const;

/**
 * 获取商家对应的截止日期
 */
export function getShopDeadline(shopTier: ShopTier): Date {
  switch (shopTier) {
    case "plus":
      // Plus 商家：2025-08-28 开始限制，2026-01 起自动升级（Shopify 会提前通知）
      // 注意：自动升级开始时间以 Shopify 官方通知为准，此处为月份级别估算
      return PLUS_DEADLINES.AUTO_UPGRADE_START;
    case "non_plus":
    case "unknown":
      // 非 Plus 商家：最晚 2026-08-26 截止
      return NON_PLUS_DEADLINES.SCRIPT_TAG_OFF;
    default:
      return NON_PLUS_DEADLINES.SCRIPT_TAG_OFF;
  }
}

/**
 * 格式化日期显示（用于 UI）
 */
export function formatDeadlineDate(date: Date, format: "exact" | "month" = "exact"): string {
  return getDateDisplayLabel(date, format);
}

/**
 * 获取官方文档链接
 */
export const SHOPIFY_HELP_LINKS = {
  UPGRADE_GUIDE: "https://help.shopify.com/en/manual/checkout-settings/upgrade-guide",
  CHECKOUT_EXTENSIBILITY: "https://help.shopify.com/en/manual/checkout-settings/checkout-extensibility",
} as const;

