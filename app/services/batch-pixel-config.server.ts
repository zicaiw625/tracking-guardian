

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { canManageMultipleShops, getShopGroupDetails } from "./multi-shop.server";

export interface PlatformConfig {
  platform: "google" | "meta" | "tiktok" | "pinterest" | "snapchat" | "twitter";
  eventMappings?: Record<string, string>;
  clientSideEnabled?: boolean;
  serverSideEnabled?: boolean;
}

export interface PixelTemplate {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  platforms: PlatformConfig[];
  isPublic: boolean;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  platforms: PlatformConfig[];
  isPublic?: boolean;
}

export interface BatchApplyOptions {
  groupId: string;
  requesterId: string;
  templateId: string;
  targetShopIds?: string[];
  overwriteExisting?: boolean;
}

export interface BatchApplyResult {
  templateId: string;
  templateName: string;
  totalShops: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  details: Array<{
    shopId: string;
    shopDomain: string;
    status: "applied" | "failed" | "skipped";
    reason?: string;
    appliedPlatforms?: string[];
  }>;
}

export async function createPixelTemplate(
  ownerId: string,
  input: CreateTemplateInput
): Promise<PixelTemplate | null> {

  const canManage = await canManageMultipleShops(ownerId);
  if (!canManage) {
    logger.warn(`Shop ${ownerId} cannot create pixel templates (plan limitation)`);
    return null;
  }

  const validPlatforms = ["google", "meta", "tiktok", "pinterest", "snapchat", "twitter"];
  const invalidPlatforms = input.platforms.filter(
    (p) => !validPlatforms.includes(p.platform)
  );
  if (invalidPlatforms.length > 0) {
    logger.warn(`Invalid platforms in template: ${invalidPlatforms.map((p) => p.platform).join(", ")}`);
    return null;
  }

  try {
    const template = await prisma.pixelTemplate.create({
      data: {
        ownerId,
        name: input.name,
        description: input.description,
        platforms: input.platforms as unknown as object,
        isPublic: input.isPublic ?? false,
      },
    });

    logger.info(`Pixel template created: ${template.id} by ${ownerId}`);

    return {
      id: template.id,
      ownerId: template.ownerId,
      name: template.name,
      description: template.description ?? undefined,
      platforms: template.platforms as unknown as PlatformConfig[],
      isPublic: template.isPublic,
      usageCount: template.usageCount,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  } catch (error) {
    logger.error("Failed to create pixel template:", error);
    return null;
  }
}

export async function listPixelTemplates(ownerId: string): Promise<PixelTemplate[]> {
  const templates = await prisma.pixelTemplate.findMany({
    where: {
      OR: [
        { ownerId },
        { isPublic: true },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return templates.map((t) => ({
    id: t.id,
    ownerId: t.ownerId,
    name: t.name,
    description: t.description ?? undefined,
    platforms: t.platforms as unknown as PlatformConfig[],
    isPublic: t.isPublic,
    usageCount: t.usageCount,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

export async function getPixelTemplate(
  templateId: string,
  requesterId: string
): Promise<PixelTemplate | null> {
  const template = await prisma.pixelTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) return null;

  if (template.ownerId !== requesterId && !template.isPublic) {
    return null;
  }

  return {
    id: template.id,
    ownerId: template.ownerId,
    name: template.name,
    description: template.description ?? undefined,
    platforms: template.platforms as unknown as PlatformConfig[],
    isPublic: template.isPublic,
    usageCount: template.usageCount,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export async function updatePixelTemplate(
  templateId: string,
  ownerId: string,
  input: Partial<CreateTemplateInput>
): Promise<PixelTemplate | null> {
  const template = await prisma.pixelTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template || template.ownerId !== ownerId) {
    return null;
  }

  try {
    const updated = await prisma.pixelTemplate.update({
      where: { id: templateId },
      data: {
        name: input.name,
        description: input.description,
        platforms: input.platforms as unknown as object,
        isPublic: input.isPublic,
      },
    });

    return {
      id: updated.id,
      ownerId: updated.ownerId,
      name: updated.name,
      description: updated.description ?? undefined,
      platforms: updated.platforms as unknown as PlatformConfig[],
      isPublic: updated.isPublic,
      usageCount: updated.usageCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  } catch (error) {
    logger.error("Failed to update pixel template:", error);
    return null;
  }
}

export async function deletePixelTemplate(
  templateId: string,
  ownerId: string
): Promise<boolean> {
  const template = await prisma.pixelTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template || template.ownerId !== ownerId) {
    return false;
  }

  try {
    await prisma.pixelTemplate.delete({
      where: { id: templateId },
    });
    logger.info(`Pixel template deleted: ${templateId} by ${ownerId}`);
    return true;
  } catch (error) {
    logger.error("Failed to delete pixel template:", error);
    return false;
  }
}

export async function batchApplyTemplate(
  options: BatchApplyOptions
): Promise<BatchApplyResult | { error: string }> {
  const { groupId, requesterId, templateId, targetShopIds, overwriteExisting = false } = options;

  const canManage = await canManageMultipleShops(requesterId);
  if (!canManage) {
    return { error: "当前套餐不支持批量操作，请升级到 Agency 版" };
  }

  const template = await getPixelTemplate(templateId, requesterId);
  if (!template) {
    return { error: "模板不存在或无权访问" };
  }

  const groupDetails = await getShopGroupDetails(groupId, requesterId);
  if (!groupDetails) {
    return { error: "分组不存在或无权访问" };
  }

  let targetShops = groupDetails.members;
  if (targetShopIds && targetShopIds.length > 0) {
    const targetSet = new Set(targetShopIds);
    targetShops = targetShops.filter((m) => targetSet.has(m.shopId));
  }

  if (targetShops.length === 0) {
    return { error: "没有可应用的目标店铺" };
  }

  const details: BatchApplyResult["details"] = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const member of targetShops) {
    try {

      if (member.shopId !== requesterId && !member.canEditSettings) {
        details.push({
          shopId: member.shopId,
          shopDomain: member.shopDomain,
          status: "skipped",
          reason: "无编辑权限",
        });
        skippedCount++;
        continue;
      }

      const existingConfigs = await prisma.pixelConfig.findMany({
        where: { shopId: member.shopId, isActive: true },
        select: { platform: true },
      });
      const existingPlatforms = new Set(existingConfigs.map((c) => c.platform));

      const appliedPlatforms: string[] = [];

      for (const platformConfig of template.platforms) {

        if (existingPlatforms.has(platformConfig.platform) && !overwriteExisting) {
          continue;
        }

        await prisma.pixelConfig.upsert({
          where: {
            shopId_platform: {
              shopId: member.shopId,
              platform: platformConfig.platform,
            },
          },
          create: {
            shopId: member.shopId,
            platform: platformConfig.platform,
            clientSideEnabled: platformConfig.clientSideEnabled ?? true,
            serverSideEnabled: platformConfig.serverSideEnabled ?? false,
            eventMappings: platformConfig.eventMappings as object ?? null,
            isActive: true,
          },
          update: {
            clientSideEnabled: platformConfig.clientSideEnabled ?? true,
            serverSideEnabled: platformConfig.serverSideEnabled ?? false,
            eventMappings: platformConfig.eventMappings as object ?? null,
            isActive: true,
          },
        });

        appliedPlatforms.push(platformConfig.platform);
      }

      if (appliedPlatforms.length > 0) {
        details.push({
          shopId: member.shopId,
          shopDomain: member.shopDomain,
          status: "applied",
          appliedPlatforms,
        });
        successCount++;
      } else {
        details.push({
          shopId: member.shopId,
          shopDomain: member.shopDomain,
          status: "skipped",
          reason: "所有平台已配置且未启用覆盖",
        });
        skippedCount++;
      }
    } catch (error) {
      logger.error(`Failed to apply template to shop ${member.shopDomain}:`, error);
      details.push({
        shopId: member.shopId,
        shopDomain: member.shopDomain,
        status: "failed",
        reason: error instanceof Error ? error.message : "未知错误",
      });
      failedCount++;
    }
  }

  await prisma.pixelTemplate.update({
    where: { id: templateId },
    data: { usageCount: { increment: successCount } },
  });

  logger.info(`Batch apply template completed: ${templateId}`, {
    totalShops: targetShops.length,
    successCount,
    failedCount,
    skippedCount,
  });

  return {
    templateId,
    templateName: template.name,
    totalShops: targetShops.length,
    successCount,
    failedCount,
    skippedCount,
    details,
  };
}

export function getPresetTemplates(): Array<Omit<PixelTemplate, "id" | "ownerId" | "createdAt" | "updatedAt">> {
  return [
    {
      name: "基础追踪套件",
      description: "包含 GA4 和 Meta Pixel 的基础配置，适合大多数电商店铺",
      platforms: [
        {
          platform: "google",
          clientSideEnabled: true,
          serverSideEnabled: true,
          eventMappings: {
            checkout_completed: "purchase",
            product_added_to_cart: "add_to_cart",
            product_viewed: "view_item",
          },
        },
        {
          platform: "meta",
          clientSideEnabled: true,
          serverSideEnabled: true,
          eventMappings: {
            checkout_completed: "Purchase",
            product_added_to_cart: "AddToCart",
            product_viewed: "ViewContent",
          },
        },
      ],
      isPublic: true,
      usageCount: 0,
    },
    {
      name: "全渠道追踪套件",
      description: "包含 GA4、Meta、TikTok、Pinterest、Snapchat 和 Twitter 的完整配置",
      platforms: [
        {
          platform: "google",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
        {
          platform: "meta",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
        {
          platform: "tiktok",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
        {
          platform: "pinterest",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
        {
          platform: "snapchat",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
        {
          platform: "twitter",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
      ],
      isPublic: true,
      usageCount: 0,
    },
    {
      name: "社交媒体追踪套件",
      description: "TikTok、Snapchat 和 Twitter 社交平台追踪",
      platforms: [
        {
          platform: "tiktok",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
        {
          platform: "snapchat",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
        {
          platform: "twitter",
          clientSideEnabled: true,
          serverSideEnabled: true,
        },
      ],
      isPublic: true,
      usageCount: 0,
    },
    {
      name: "仅服务端追踪",
      description: "仅启用服务端 CAPI，适合注重隐私的店铺",
      platforms: [
        {
          platform: "google",
          clientSideEnabled: false,
          serverSideEnabled: true,
        },
        {
          platform: "meta",
          clientSideEnabled: false,
          serverSideEnabled: true,
        },
      ],
      isPublic: true,
      usageCount: 0,
    },
  ];
}

