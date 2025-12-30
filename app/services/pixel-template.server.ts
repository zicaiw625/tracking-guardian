

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
      description: "专为社交电商优化的配置，包含 TikTok 和 Pinterest，适合依赖社交媒体流量的店铺",
      platforms: ["meta", "tiktok", "pinterest"],
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
        pinterest: {
          checkout_completed: "checkout",
          add_to_cart: "add_to_cart",
          view_item: "page_visit",
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

/**
 * 生成模板分享链接
 * 分享链接格式：/app/templates/import?templateId=xxx&shareToken=yyy
 */
export async function generateTemplateShareLink(
  templateId: string,
  ownerId: string
): Promise<{ success: boolean; shareLink?: string; error?: string }> {
  try {
    const template = await prisma.pixelTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template || template.ownerId !== ownerId) {
      return { success: false, error: "模板不存在或无权限" };
    }

    // 生成分享 token（使用模板 ID + 时间戳的简单哈希）
    const { createHash } = await import("crypto");
    const shareToken = createHash("sha256")
      .update(`${templateId}-${template.updatedAt.getTime()}`)
      .digest("hex")
      .substring(0, 16);

    // 分享链接（在实际应用中，应该使用环境变量中的域名）
    const shareLink = `/app/templates/import?templateId=${templateId}&token=${shareToken}`;

    return { success: true, shareLink };
  } catch (error) {
    logger.error("Failed to generate template share link", { templateId, error });
    return { success: false, error: "生成分享链接失败" };
  }
}

/**
 * 通过分享链接导入模板
 */
export async function importTemplateFromShare(
  templateId: string,
  token: string,
  targetShopId: string
): Promise<{ success: boolean; templateId?: string; error?: string }> {
  try {
    const template = await prisma.pixelTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return { success: false, error: "模板不存在" };
    }

    // 验证 token（简化验证，实际应该更严格）
    const { createHash } = await import("crypto");
    const expectedToken = createHash("sha256")
      .update(`${templateId}-${template.updatedAt.getTime()}`)
      .digest("hex")
      .substring(0, 16);

    if (token !== expectedToken) {
      return { success: false, error: "无效的分享链接" };
    }

    // 如果模板是公开的，或者目标店铺是模板所有者，可以直接使用
    // 否则创建副本
    if (template.isPublic || template.ownerId === targetShopId) {
      // 直接使用原模板，增加使用次数
      await incrementTemplateUsage(templateId);
      return { success: true, templateId };
    }

    // 创建模板副本
    const { createPixelTemplate } = await import("./batch-pixel-apply.server");
    const platforms = template.platforms as unknown as Array<{
      platform: string;
      eventMappings?: Record<string, string>;
      clientSideEnabled?: boolean;
      serverSideEnabled?: boolean;
    }>;

    const result = await createPixelTemplate({
      ownerId: targetShopId,
      name: `${template.name} (导入)`,
      description: template.description || `从 ${templateId} 导入`,
      platforms,
      isPublic: false,
    });

    if (result.success) {
      // 增加原模板的使用次数
      await incrementTemplateUsage(templateId);
    }

    return result;
  } catch (error) {
    logger.error("Failed to import template from share", { templateId, targetShopId, error });
    return { success: false, error: "导入模板失败" };
  }
}

