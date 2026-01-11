import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { ModuleKey, UiModuleConfig } from "../types/ui-extension";
import { getUiModuleConfig } from "./ui-extension.server";

export async function syncUiExtensionSettings(
  shopId: string,
  admin: AdminApiContext
): Promise<{ success: boolean; synced: number; errors: string[] }> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, webPixelId: true },
    });
    if (!shop || !shop.webPixelId) {
      return {
        success: false,
        synced: 0,
        errors: ["Web Pixel 未安装或未找到"],
      };
    }
    const { getUiModuleConfigs, MODULE_KEYS } = await import("./ui-extension.server");
    const configs = await getUiModuleConfigs(shopId);
    const getPixelQuery = `
      query GetWebPixel($id: ID!) {
        webPixel(id: $id) {
          id
          settings
        }
      }
    `;
    const getResponse = await admin.graphql(getPixelQuery, {
      variables: { id: shop.webPixelId },
    });
    const getData = await getResponse.json();
    const existingSettings = getData.data?.webPixel?.settings
      ? JSON.parse(getData.data.webPixel.settings)
      : {};
    const updatedSettings: Record<string, unknown> = { ...existingSettings };
    let synced = 0;
    const errors: string[] = [];
    for (const moduleKey of MODULE_KEYS) {
      const config = configs.find((c) => c.moduleKey === moduleKey);
      if (!config) continue;
      const settingsKey = `ui_module_${moduleKey}`;
      const localizedSettings: Record<string, unknown> = { ...config.settings };
      if (config.localization) {
        Object.entries(config.localization).forEach(([locale, localeData]) => {
          if (localeData && typeof localeData === 'object') {
            Object.entries(localeData).forEach(([field, value]) => {
              if (value && typeof value === 'string') {
                localizedSettings[`${field}_${locale}`] = value;
              }
            });
          }
        });
      }
      updatedSettings[settingsKey] = {
        enabled: config.isEnabled,
        settings: localizedSettings,
        displayRules: config.displayRules,
        localization: config.localization,
      };
      synced++;
    }
    const mutation = `
      mutation UpdateWebPixelSettings($id: ID!, $settings: JSON!) {
        webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
          webPixel {
            id
            settings
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const response = await admin.graphql(mutation, {
      variables: {
        id: shop.webPixelId,
        settings: JSON.stringify(updatedSettings),
      },
    });
    const data = await response.json();
    const result = data.data?.webPixelUpdate;
    if (result?.userErrors?.length > 0) {
      const errorMessages = result.userErrors.map((e: { message: string }) => e.message);
      logger.error("Failed to sync UI extension settings", {
        shopId,
        errors: errorMessages,
      });
      return {
        success: false,
        synced: 0,
        errors: errorMessages,
      };
    }
    logger.info("UI extension settings synced", {
      shopId,
      syncedCount: synced,
    });
    return {
      success: true,
      synced,
      errors: [],
    };
  } catch (error) {
    logger.error("Failed to sync UI extension settings", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      synced: 0,
      errors: [error instanceof Error ? error.message : "同步失败"],
    };
  }
}

export async function syncSingleModule(
  shopId: string,
  moduleKey: ModuleKey,
  admin: AdminApiContext
): Promise<{ success: boolean; error?: string }> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, webPixelId: true },
    });
    if (!shop || !shop.webPixelId) {
      return {
        success: false,
        error: "Web Pixel 未安装",
      };
    }
    const config = await getUiModuleConfig(shopId, moduleKey);
    const settingsKey = `ui_module_${moduleKey}`;
    const localizedSettings: Record<string, unknown> = { ...config.settings };
    if (config.localization) {
      Object.entries(config.localization).forEach(([locale, localeData]) => {
        if (localeData && typeof localeData === 'object') {
          Object.entries(localeData).forEach(([field, value]) => {
            if (value && typeof value === 'string') {
              localizedSettings[`${field}_${locale}`] = value;
            }
          });
        }
      });
    }
    const settings = {
      [settingsKey]: {
        enabled: config.isEnabled,
        settings: localizedSettings,
        displayRules: config.displayRules,
        localization: config.localization,
      },
    };
    const getPixelQuery = `
      query GetWebPixel($id: ID!) {
        webPixel(id: $id) {
          id
          settings
        }
      }
    `;
    const getResponse = await admin.graphql(getPixelQuery, {
      variables: { id: shop.webPixelId },
    });
    const getData = await getResponse.json();
    const existingSettings = getData.data?.webPixel?.settings
      ? JSON.parse(getData.data.webPixel.settings)
      : {};
    const mergedSettings = {
      ...existingSettings,
      ...settings,
    };
    const mutation = `
      mutation UpdateWebPixelSettings($id: ID!, $settings: JSON!) {
        webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
          webPixel {
            id
            settings
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const updateResponse = await admin.graphql(mutation, {
      variables: {
        id: shop.webPixelId,
        settings: JSON.stringify(mergedSettings),
      },
    });
    const updateData = await updateResponse.json();
    const result = updateData.data?.webPixelUpdate;
    if (result?.userErrors?.length > 0) {
      const error = result.userErrors.map((e: { message: string }) => e.message).join(", ");
      return {
        success: false,
        error,
      };
    }
    logger.info("Single module synced", { shopId, moduleKey });
    return { success: true };
  } catch (error) {
    logger.error("Failed to sync single module", {
      shopId,
      moduleKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "同步失败",
    };
  }
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
