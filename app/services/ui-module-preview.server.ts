

import { logger } from "../utils/logger.server";
import prisma from "../db.server";
import type { ModuleKey } from "../types/ui-extension";

/**
 * UI 模块预览服务
 * 用于在 dev store 中预览模块效果
 */

export interface ModulePreviewConfig {
  moduleKey: ModuleKey;
  settings: Record<string, unknown>;
  displayRules: {
    enabled: boolean;
    targets: ("thank_you" | "order_status")[];
  };
}

/**
 * 生成模块预览 URL
 * 在 dev store 的 Thank you / Order status 页面预览模块
 */
export function generatePreviewUrl(
  shopDomain: string,
  moduleKey: ModuleKey,
  target: "thank_you" | "order_status",
  testOrderId?: string
): string {
  const baseUrl = `https://${shopDomain}`;
  
  if (target === "thank_you") {
    // Thank you 页面预览需要测试订单
    if (testOrderId) {
      return `${baseUrl}/orders/${testOrderId}/thank_you?preview_module=${moduleKey}`;
    }
    return `${baseUrl}?preview=thank_you&module=${moduleKey}`;
  } else {
    // Order status 页面（客户账户）
    if (testOrderId) {
      return `${baseUrl}/account/orders/${testOrderId}?preview_module=${moduleKey}`;
    }
    return `${baseUrl}/account/orders?preview_module=${moduleKey}`;
  }
}

/**
 * 验证模块配置是否有效
 */
export function validateModuleConfig(
  moduleKey: ModuleKey,
  settings: Record<string, unknown>,
  displayRules: { enabled: boolean; targets: string[] }
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!displayRules.targets || displayRules.targets.length === 0) {
    errors.push("必须至少选择一个显示目标（Thank You 或 Order Status）");
  }
  
  // 模块特定的验证
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

/**
 * 获取模块预览配置（用于前端预览）
 */
export async function getModulePreviewConfig(
  shopId: string,
  moduleKey: ModuleKey
): Promise<ModulePreviewConfig | null> {
  const setting = await prisma.uiExtensionSetting.findUnique({
    where: {
      shopId_moduleKey: { shopId, moduleKey },
    },
  });
  
  if (!setting) {
    return null;
  }
  
  return {
    moduleKey: setting.moduleKey as ModuleKey,
    settings: (setting.settingsJson as Record<string, unknown>) || {},
    displayRules: (setting.displayRules as {
      enabled: boolean;
      targets: ("thank_you" | "order_status")[];
    }) || {
      enabled: false,
      targets: [],
    },
  };
}

/**
 * 批量获取所有模块的预览配置
 */
export async function getAllModulePreviewConfigs(
  shopId: string
): Promise<Record<ModuleKey, ModulePreviewConfig | null>> {
  const settings = await prisma.uiExtensionSetting.findMany({
    where: { shopId },
  });
  
  const result: Record<string, ModulePreviewConfig | null> = {};
  
  for (const setting of settings) {
    result[setting.moduleKey] = {
      moduleKey: setting.moduleKey as ModuleKey,
      settings: (setting.settingsJson as Record<string, unknown>) || {},
      displayRules: (setting.displayRules as {
        enabled: boolean;
        targets: ("thank_you" | "order_status")[];
      }) || {
        enabled: false,
        targets: [],
      },
    };
  }
  
  return result as Record<ModuleKey, ModulePreviewConfig | null>;
}

/**
 * 创建测试订单用于预览
 * 注意：这需要 Shopify Admin API 权限
 */
export interface TestOrderPreview {
  orderId: string;
  orderNumber: string;
  thankYouUrl: string;
  orderStatusUrl: string;
}

export async function createTestOrderForPreview(
  shopDomain: string,
  admin: any // AdminApiContext from Shopify
): Promise<TestOrderPreview | null> {
  try {
    // 这里应该调用 Shopify Admin API 创建测试订单
    // 由于需要实际的 API 调用，这里只提供接口定义
    // 实际实现需要根据 Shopify API 文档
    
    logger.info("Creating test order for preview", { shopDomain });
    
    // TODO: 实现实际的测试订单创建逻辑
    // const order = await admin.graphql(...);
    
    return null;
  } catch (error) {
    logger.error("Failed to create test order for preview", {
      shopDomain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

