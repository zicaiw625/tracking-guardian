import { logger } from "../utils/logger.server";
import prisma from "../db.server";
import type { ModuleKey } from "../types/ui-extension";
import { decryptJson } from "../utils/crypto.server";

export interface ModulePreviewConfig {
  moduleKey: ModuleKey;
  settings: Record<string, unknown>;
  displayRules: {
    enabled: boolean;
    targets: ("thank_you" | "order_status")[];
  };
}

export function generatePreviewUrl(
  shopDomain: string,
  moduleKey: ModuleKey,
  target: "thank_you" | "order_status",
  testOrderId?: string
): string {
  const baseUrl = `https://${shopDomain}`;
  if (target === "thank_you") {
    if (testOrderId) {
      return `${baseUrl}/orders/${testOrderId}/thank_you?preview_module=${moduleKey}`;
    }
    return `${baseUrl}?preview=thank_you&module=${moduleKey}`;
  } else {
    if (testOrderId) {
      return `${baseUrl}/account/orders/${testOrderId}?preview_module=${moduleKey}`;
    }
    return `${baseUrl}/account/orders?preview_module=${moduleKey}`;
  }
}

export function validateModuleConfig(
  moduleKey: ModuleKey,
  settings: Record<string, unknown>,
  displayRules: { enabled: boolean; targets: string[] }
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!displayRules.targets || displayRules.targets.length === 0) {
    errors.push("必须至少选择一个显示目标（Thank You 或 Order Status）");
  }
  switch (moduleKey) {
    case "survey":
      if (!settings.title || typeof settings.title !== "string") {
        errors.push("问卷标题不能为空");
      }
      if (!settings.question || typeof settings.question !== "string") {
        errors.push("问卷问题不能为空");
      }
      break;
    case "helpdesk":
      if (!settings.faqUrl && !settings.contactEmail && !settings.contactUrl) {
        errors.push("必须至少配置一个联系方式（FAQ 链接、邮箱或联系链接）");
      }
      break;
    case "order_tracking":
      if (settings.provider && settings.provider !== "native") {
        if (!settings.apiKey || typeof settings.apiKey !== "string") {
          errors.push(`${settings.provider} 需要配置 API Key`);
        }
      }
      break;
    case "reorder":
      if (!settings.buttonText || typeof settings.buttonText !== "string") {
        errors.push("再购按钮文案不能为空");
      }
      break;
    case "upsell":
      if (!settings.products || !Array.isArray(settings.products)) {
        errors.push("必须至少添加一个推荐商品");
      }
      break;
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function getModulePreviewConfig(
  shopId: string,
  moduleKey: ModuleKey
): Promise<ModulePreviewConfig | null> {
  return null;
}

export async function getAllModulePreviewConfigs(
  shopId: string
): Promise<Record<ModuleKey, ModulePreviewConfig | null>> {
  const result: Record<string, ModulePreviewConfig | null> = {};
  const moduleKeys: ModuleKey[] = ["survey", "helpdesk", "order_tracking", "reorder", "upsell"];
  for (const moduleKey of moduleKeys) {
    result[moduleKey] = null;
  }
  return result as Record<ModuleKey, ModulePreviewConfig | null>;
}

export interface TestOrderPreview {
  orderId: string;
  orderNumber: string;
  thankYouUrl: string;
  orderStatusUrl: string;
}

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export async function createTestOrderForPreview(
  shopDomain: string,
  admin: AdminApiContext
): Promise<TestOrderPreview | null> {
  try {
    logger.info("Creating test order for preview", { shopDomain });
    return null;
  } catch (error) {
    logger.error("Failed to create test order for preview", {
      shopDomain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
