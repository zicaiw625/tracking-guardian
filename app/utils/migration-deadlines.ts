import {
  DEPRECATION_DATES as DEPRECATION_DATES_IMPORT,
  getDateDisplayLabel,
  type ShopTier,
} from "./deprecation-dates";

export const DEPRECATION_DATES = DEPRECATION_DATES_IMPORT;

export const PLUS_DEADLINES = {

  SCRIPT_TAG_OFF: DEPRECATION_DATES.plusScriptTagExecutionOff,

  AUTO_UPGRADE_START: DEPRECATION_DATES.plusAutoUpgradeStart,
} as const;

export const NON_PLUS_DEADLINES = {

  SCRIPT_TAG_OFF: DEPRECATION_DATES.nonPlusScriptTagExecutionOff,
} as const;

export const COMMON_DEADLINES = {

  SCRIPT_TAG_CREATION_BLOCKED: DEPRECATION_DATES.scriptTagCreationBlocked,
} as const;

export function getShopDeadline(shopTier: ShopTier): Date {
  switch (shopTier) {
    case "plus":

      return PLUS_DEADLINES.AUTO_UPGRADE_START;
    case "non_plus":
    case "unknown":

      return NON_PLUS_DEADLINES.SCRIPT_TAG_OFF;
    default:
      return NON_PLUS_DEADLINES.SCRIPT_TAG_OFF;
  }
}

export function formatDeadlineDate(date: Date, format: "exact" | "month" = "exact"): string {
  return getDateDisplayLabel(date, format);
}

export const SHOPIFY_HELP_LINKS = {
  UPGRADE_GUIDE: "https://help.shopify.com/en/manual/checkout-settings/upgrade-guide",
  CHECKOUT_EXTENSIBILITY: "https://help.shopify.com/en/manual/checkout-settings/checkout-extensibility",
} as const;
