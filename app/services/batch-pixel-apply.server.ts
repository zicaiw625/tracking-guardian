import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { parallelLimit } from "../utils/helpers";
import type { PixelTemplateConfig } from "../utils/type-guards";
import type { Prisma } from "@prisma/client";

export interface PixelTemplate {
  id: string;
  name: string;
  description?: string;
  platforms: PixelTemplateConfig[];
  shopId?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  usageCount?: number;
}

const V1_SUPPORTED_PLATFORMS = ["google", "meta", "tiktok"] as const;
const BATCH_CONCURRENCY = 5;

export async function createPixelTemplate(data: {
  name: string;
  description?: string;
  platforms: PixelTemplateConfig[];
  shopId?: string;
  isPublic?: boolean;
}): Promise<PixelTemplate> {
  const template: PixelTemplate = {
    id: `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: data.name,
    description: data.description,
    platforms: data.platforms,
    shopId: data.shopId,
    isPublic: data.isPublic ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  logger.info("Pixel template created", { templateId: template.id });
  return template;
}

export async function getPixelTemplates(shopId?: string, includePublic: boolean = true): Promise<PixelTemplate[]> {
  const templates: PixelTemplate[] = [];
  if (includePublic) {
    templates.push(...PRESET_TEMPLATES.map(t => ({ ...t, usageCount: 0 })));
  }
  return templates;
}

export async function getPixelTemplate(templateId: string): Promise<PixelTemplate | null> {
  const preset = PRESET_TEMPLATES.find((t) => t.id === templateId);
  return preset || null;
}

export async function updatePixelTemplate(
  templateId: string,
  shopId: string,
  data: Partial<PixelTemplate>
): Promise<{ success: boolean; template?: PixelTemplate; error?: string }> {
  const template = await getPixelTemplate(templateId);
  if (!template) {
    return { success: false, error: "Template not found" };
  }
  const updated = {
    ...template,
    ...data,
    updatedAt: new Date(),
  };
  return { success: true, template: updated };
}

export async function deletePixelTemplate(templateId: string, shopId: string): Promise<{ success: boolean; error?: string }> {
  const template = await getPixelTemplate(templateId);
  if (!template) {
    return { success: false, error: "Template not found" };
  }
  return { success: true };
}

function validatePlatformSupport(platform: string): boolean {
  return V1_SUPPORTED_PLATFORMS.includes(platform as typeof V1_SUPPORTED_PLATFORMS[number]);
}

function validateAllPlatforms(platforms: PixelTemplateConfig[]): { valid: boolean; error?: string } {
  for (const platformConfig of platforms) {
    if (!validatePlatformSupport(platformConfig.platform)) {
      return {
        valid: false,
        error: `平台 ${platformConfig.platform} 在 v1.0 版本中不支持。v1.0 仅支持: ${V1_SUPPORTED_PLATFORMS.join(", ")}。`,
      };
    }
  }
  return { valid: true };
}

async function applyTemplateToShop(
  shopId: string,
  template: PixelTemplate
): Promise<{ success: boolean; error?: string }> {
  const validation = validateAllPlatforms(template.platforms);
  if (!validation.valid) {
    logger.warn("Unsupported platform in template", {
      shopId,
      templateId: template.id,
    });
    return { success: false, error: validation.error };
  }
  if (template.platforms.length === 0) {
    return { success: true };
  }
  const upserts = template.platforms.map(platformConfig => 
    prisma.pixelConfig.upsert({
      where: {
        shopId_platform_environment_platformId: {
          shopId,
          platform: platformConfig.platform,
          environment: "live",
          platformId: null,
        },
      },
      update: {
        eventMappings: platformConfig.eventMappings as Prisma.JsonValue,
        clientSideEnabled: platformConfig.clientSideEnabled ?? true,
        serverSideEnabled: platformConfig.serverSideEnabled ?? false,
        updatedAt: new Date(),
      },
      create: {
        id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        shopId,
        platform: platformConfig.platform,
        eventMappings: platformConfig.eventMappings as Prisma.JsonValue,
        clientSideEnabled: platformConfig.clientSideEnabled ?? true,
        serverSideEnabled: platformConfig.serverSideEnabled ?? false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
  );
  try {
    await prisma.$transaction(upserts, {
      maxWait: 5000,
      timeout: 10000,
    });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to apply template to shop", {
      shopId,
      templateId: template.id,
      platformsCount: template.platforms.length,
      error: errorMessage,
    });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function batchApplyPixelTemplate(
  templateId: string,
  shopIds: string[]
): Promise<{ succeeded: number; failed: number; errors: Array<{ shopId: string; error: string }> }> {
  const result = {
    succeeded: 0,
    failed: 0,
    errors: [] as Array<{ shopId: string; error: string }>,
  };
  const template = await getPixelTemplate(templateId);
  if (!template) {
    throw new Error("Template not found");
  }
  const results = await parallelLimit(shopIds, BATCH_CONCURRENCY, async (shopId) => {
    try {
      const applyResult = await applyTemplateToShop(shopId, template);
      if (!applyResult.success) {
        logger.warn("Failed to apply template to shop", {
          shopId,
          templateId,
          error: applyResult.error,
        });
        return { shopId, success: false, error: applyResult.error || "Unknown error" };
      }
      return { shopId, success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Error applying template to shop", {
        shopId,
        templateId,
        error: errorMessage,
      });
      return {
        shopId,
        success: false,
        error: errorMessage,
      };
    }
  });
  for (const item of results) {
    if (item?.success) {
      result.succeeded++;
    } else {
      result.failed++;
      if (item) {
        result.errors.push({ 
          shopId: item.shopId, 
          error: item.error || "Unknown error" 
        });
      }
    }
  }
  return result;
}

export const PRESET_TEMPLATES: PixelTemplate[] = [
  {
    id: "preset-ga4-meta",
    name: "GA4 + Meta 标准配置",
    description: "适用于大多数电商的标准追踪配置",
    platforms: [
      { platform: "google", eventMappings: {}, clientSideEnabled: true },
      { platform: "meta", eventMappings: {}, clientSideEnabled: true },
    ],
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    usageCount: 0,
  },
];

export async function applyPresetTemplate(
  templateId: string,
  shopId: string
): Promise<{ success: boolean; error?: string }> {
  const template = PRESET_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return { success: false, error: "Preset template not found" };
  }
  try {
    const result = await batchApplyPixelTemplate(templateId, [shopId]);
    return {
      success: result.succeeded > 0,
      error: result.errors[0]?.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
