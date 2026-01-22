import { getPixelTemplates, createPixelTemplate } from "./batch-pixel-apply.server";
import type { PixelTemplateConfig } from "../utils/type-guards";
import { logger } from "../utils/logger.server";

export interface WizardTemplate {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  eventMappings: Record<string, Record<string, string>>;
  isPublic: boolean;
  usageCount: number;
}

export async function getWizardTemplates(shopId: string): Promise<{
  presets: WizardTemplate[];
  custom: WizardTemplate[];
}> {
  const presets: WizardTemplate[] = [
    {
      id: "standard",
      name: "标准配置",
      description: "适用于大多数电商店铺的标准事件映射，仅包含最重要的购买事件",
      platforms: ["google", "meta", "tiktok"],
      eventMappings: {
        google: {
          checkout_completed: "purchase",
        },
        meta: {
          checkout_completed: "Purchase",
        },
        tiktok: {
          checkout_completed: "CompletePayment",
        },
      },
      isPublic: true,
      usageCount: 0,
    },
    {
      id: "advanced",
      name: "高级配置",
      description: "包含更多事件类型的完整映射，适合需要详细转化漏斗分析的店铺",
      platforms: ["google", "meta", "tiktok"],
      eventMappings: {
        google: {
          checkout_completed: "purchase",
          checkout_started: "begin_checkout",
          add_to_cart: "add_to_cart",
        },
        meta: {
          checkout_completed: "Purchase",
          checkout_started: "InitiateCheckout",
          add_to_cart: "AddToCart",
        },
        tiktok: {
          checkout_completed: "CompletePayment",
          checkout_started: "InitiateCheckout",
          add_to_cart: "AddToCart",
        },
      },
      isPublic: true,
      usageCount: 0,
    },
    {
      id: "ecommerce-optimized",
      name: "电商优化配置",
      description: "专为电商店铺优化的完整转化漏斗追踪，包含商品浏览、加购、结账、购买全流程",
      platforms: ["google", "meta", "tiktok"],
      eventMappings: {
        google: {
          checkout_completed: "purchase",
          checkout_started: "begin_checkout",
          add_to_cart: "add_to_cart",
          view_item: "view_item",
        },
        meta: {
          checkout_completed: "Purchase",
          checkout_started: "InitiateCheckout",
          add_to_cart: "AddToCart",
          view_item: "ViewContent",
        },
        tiktok: {
          checkout_completed: "CompletePayment",
          checkout_started: "InitiateCheckout",
          add_to_cart: "AddToCart",
          view_item: "ViewContent",
        },
      },
      isPublic: true,
      usageCount: 0,
    },
    {
      id: "google-meta-only",
      name: "Google + Meta 双平台",
      description: "仅配置 Google Analytics 4 和 Meta Pixel，适合专注于这两个平台的店铺",
      platforms: ["google", "meta"],
      eventMappings: {
        google: {
          checkout_completed: "purchase",
          checkout_started: "begin_checkout",
          add_to_cart: "add_to_cart",
          view_item: "view_item",
        },
        meta: {
          checkout_completed: "Purchase",
          checkout_started: "InitiateCheckout",
          add_to_cart: "AddToCart",
          view_item: "ViewContent",
        },
      },
      isPublic: true,
      usageCount: 0,
    },
    {
      id: "social-commerce",
      name: "社交电商配置",
      description: "专为社交电商优化的配置，包含 Meta 和 TikTok，适合依赖社交媒体流量的店铺",
      platforms: ["meta", "tiktok"],
      eventMappings: {
        meta: {
          checkout_completed: "Purchase",
          checkout_started: "InitiateCheckout",
          add_to_cart: "AddToCart",
          view_item: "ViewContent",
        },
        tiktok: {
          checkout_completed: "CompletePayment",
          checkout_started: "InitiateCheckout",
          add_to_cart: "AddToCart",
          view_item: "ViewContent",
        },
      },
      isPublic: true,
      usageCount: 0,
    },
    {
      id: "minimal",
      name: "极简配置",
      description: "仅包含购买事件的最小配置，适合只需要基础转化追踪的店铺",
      platforms: ["google", "meta"],
      eventMappings: {
        google: {
          checkout_completed: "purchase",
        },
        meta: {
          checkout_completed: "Purchase",
        },
      },
      isPublic: true,
      usageCount: 0,
    },
  ];
  let custom: WizardTemplate[] = [];
  try {
    const dbTemplates = await getPixelTemplates(shopId, true);
    custom = dbTemplates.map((t) => {
      const platforms: string[] = [];
      const eventMappings: Record<string, Record<string, string>> = {};
      t.platforms.forEach((p: PixelTemplateConfig) => {
        platforms.push(p.platform);
        if (p.eventMappings) {
          eventMappings[p.platform] = p.eventMappings;
        }
      });
      return {
        id: t.id,
        name: t.name,
        description: t.description || "",
        platforms,
        eventMappings,
        isPublic: t.isPublic,
        usageCount: t.usageCount ?? 0,
      };
    });
  } catch (error) {
    logger.error("Failed to load custom templates for wizard", { shopId, error });
  }
  return { presets, custom };
}

export interface PixelPlatformConfig {
  platform: string;
  enabled: boolean;
  platformId: string;
  credentials: Record<string, unknown>;
  eventMappings: Record<string, string>;
  environment: string;
}

export function applyTemplateToConfigs(
  template: WizardTemplate,
  currentConfigs: Record<string, PixelPlatformConfig>
): Record<string, PixelPlatformConfig> {
  const newConfigs = { ...currentConfigs };
  template.platforms.forEach((platform) => {
    if (!newConfigs[platform]) {
      newConfigs[platform] = {
        platform,
        enabled: false,
        platformId: "",
        credentials: {},
        eventMappings: {},
        environment: "test",
      };
    }
    if (template.eventMappings[platform]) {
      newConfigs[platform] = {
        ...newConfigs[platform],
        enabled: true,
        eventMappings: template.eventMappings[platform],
      };
    }
  });
  return newConfigs;
}

export async function saveWizardConfigAsTemplate(
  shopId: string,
  name: string,
  description: string | undefined,
  platforms: string[],
  eventMappings: Record<string, Record<string, string>>,
  isPublic: boolean = false
): Promise<{ success: boolean; templateId?: string; error?: string }> {
  try {
    const platformConfigs: Array<{
      platform: string;
      eventMappings?: Record<string, string>;
      clientSideEnabled?: boolean;
      serverSideEnabled?: boolean;
    }> = platforms.map((platform) => ({
      platform,
      eventMappings: eventMappings[platform],
      clientSideEnabled: true,
      serverSideEnabled: false,
    }));
    const template = await createPixelTemplate({
      shopId,
      name,
      description,
      platforms: platformConfigs,
      isPublic,
    });
    logger.info("Wizard config saved as template", { templateId: template.id, shopId, name });
    return { success: true, templateId: template.id };
  } catch (error) {
    logger.error("Failed to save wizard config as template", { shopId, error });
    return { success: false, error: "保存模板失败" };
  }
}

export async function incrementTemplateUsage(templateId: string): Promise<void> {
  logger.debug(`incrementTemplateUsage called but pixelTemplate table no longer exists`, { templateId });
}

export async function generateTemplateShareLink(
  templateId: string,
  ownerId: string
): Promise<{ success: boolean; shareLink?: string; error?: string }> {
  logger.debug(`generateTemplateShareLink called but pixelTemplate table no longer exists`, { templateId, ownerId });
  return { success: false, error: "模板功能已移除" };
}

export async function importTemplateFromShare(
  templateId: string,
  token: string,
  targetShopId: string
): Promise<{ success: boolean; templateId?: string; error?: string }> {
  logger.debug(`importTemplateFromShare called but pixelTemplate table no longer exists`, { templateId, targetShopId });
  return { success: false, error: "模板功能已移除" };
}
