import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { PixelTemplateConfig } from "../utils/type-guards";

export interface PixelTemplate {
  id: string;
  name: string;
  description?: string;
  platforms: PixelTemplateConfig[];
  shopId?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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
  
  
  return [];
}

export async function getPixelTemplate(templateId: string): Promise<PixelTemplate | null> {
  
  return null;
}

export async function updatePixelTemplate(
  templateId: string,
  data: Partial<PixelTemplate>
): Promise<PixelTemplate | null> {
  
  return null;
}

export async function deletePixelTemplate(templateId: string): Promise<boolean> {
  
  return true;
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

  for (const shopId of shopIds) {
    try {
      
      for (const platformConfig of template.platforms) {
        await prisma.pixelConfig.upsert({
          where: {
            shopId_platform_environment_platformId: {
              shopId,
              platform: platformConfig.platform,
              environment: "live",
              platformId: null,
            },
          },
          update: {
            eventMappings: platformConfig.eventMappings as any,
            clientSideEnabled: platformConfig.clientSideEnabled ?? true,
            serverSideEnabled: platformConfig.serverSideEnabled ?? false,
            updatedAt: new Date(),
          },
          create: {
            id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            shopId,
            platform: platformConfig.platform,
            eventMappings: platformConfig.eventMappings as any,
            clientSideEnabled: platformConfig.clientSideEnabled ?? true,
            serverSideEnabled: platformConfig.serverSideEnabled ?? false,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      result.succeeded++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        shopId,
        error: error instanceof Error ? error.message : String(error),
      });
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
