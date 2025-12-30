

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getPixelTemplates } from "./batch-pixel-apply.server";
import type { PixelTemplateConfig } from "./batch-pixel-apply.server";

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
      description: "适用于大多数电商店铺的标准事件映射",
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
      description: "包含更多事件类型的完整映射",
      platforms: ["google", "meta", "tiktok", "pinterest"],
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
        pinterest: {
          checkout_completed: "checkout",
        },
      },
      isPublic: true,
      usageCount: 0,
    },
    {
      id: "ecommerce-optimized",
      name: "电商优化配置",
      description: "专为电商店铺优化的完整转化漏斗追踪，包含商品浏览、加购、结账、购买全流程",
      platforms: ["google", "meta", "tiktok", "pinterest"],
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
        pinterest: {
          checkout_completed: "checkout",
          add_to_cart: "add_to_cart",
          view_item: "page_visit",
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
        usageCount: t.usageCount,
      };
    });
  } catch (error) {
    logger.error("Failed to load custom templates for wizard", { shopId, error });
  }

  return { presets, custom };
}

export function applyTemplateToConfigs(
  template: WizardTemplate,
  currentConfigs: Record<string, any>
): Record<string, any> {
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

    const { createPixelTemplate } = await import("./batch-pixel-apply.server");
    const result = await createPixelTemplate({
      ownerId: shopId,
      name,
      description,
      platforms: platformConfigs,
      isPublic,
    });

    if (result.success) {
      logger.info("Wizard config saved as template", { templateId: result.templateId, shopId, name });
    }

    return result;
  } catch (error) {
    logger.error("Failed to save wizard config as template", { shopId, error });
    return { success: false, error: "保存模板失败" };
  }
}

export async function incrementTemplateUsage(templateId: string): Promise<void> {
  try {
    await prisma.pixelTemplate.update({
      where: { id: templateId },
      data: {
        usageCount: {
          increment: 1,
        },
      },
    });
  } catch (error) {
    logger.error("Failed to increment template usage", { templateId, error });
  }
}

