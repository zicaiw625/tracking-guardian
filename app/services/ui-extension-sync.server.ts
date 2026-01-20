import { logger } from "../utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { ModuleKey } from "../types/ui-extension";
import { getUiModuleConfig } from "./ui-extension.server";

export async function syncUiExtensionSettings(
  shopId: string,
  _admin: AdminApiContext
): Promise<{ success: boolean; synced: number; errors: string[] }> {
  const { getUiModuleConfigs, MODULE_KEYS } = await import("./ui-extension.server");
  const configs = await getUiModuleConfigs(shopId);
  const enabledCount = configs.filter((c) => c.isEnabled).length;
  logger.info("UI extension settings check completed", {
    shopId,
    enabledCount,
    totalModules: MODULE_KEYS.length,
  });
  return {
    success: true,
    synced: enabledCount,
    errors: [],
  };
}

export async function syncSingleModule(
  shopId: string,
  moduleKey: ModuleKey,
  _admin: AdminApiContext
): Promise<{ success: boolean; error?: string }> {
  const config = await getUiModuleConfig(shopId, moduleKey);
  logger.info("Single module config checked", { shopId, moduleKey, isEnabled: config.isEnabled });
  return { success: true };
}

export async function syncMultipleModules(
  shopId: string,
  moduleKeys: ModuleKey[],
  admin: AdminApiContext
): Promise<{ success: boolean; synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;
  for (const moduleKey of moduleKeys) {
    const result = await syncSingleModule(shopId, moduleKey, admin);
    if (result.success) {
      synced++;
    } else {
      errors.push(`${moduleKey}: ${result.error || "未知错误"}`);
    }
  }
  return {
    success: errors.length === 0,
    synced,
    errors,
  };
}
