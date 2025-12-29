

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { PlanId } from "./billing/plans";
import { getPixelDestinationsLimit } from "./billing/plans";
import { createBatchJob, updateBatchJobProgress, getBatchJobStatus } from "./batch-job-queue.server";

export interface PixelTemplateConfig {
  platform: string;
  eventMappings?: Record<string, string>;
  clientSideEnabled?: boolean;
  serverSideEnabled?: boolean;
}

export interface BatchApplyOptions {
  templateId: string;
  targetShopIds: string[];
  overwriteExisting?: boolean;
  skipIfExists?: boolean;
}

export interface BatchApplyResult {
  success: boolean;
  totalShops: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed" | "skipped";
    message: string;
    platformsApplied?: string[];
  }>;
}

export interface TemplateCreateOptions {
  ownerId: string;
  name: string;
  description?: string;
  platforms: PixelTemplateConfig[];
  isPublic?: boolean;
}

export async function createPixelTemplate(
  options: TemplateCreateOptions
): Promise<{ success: boolean; templateId?: string; error?: string }> {
  try {
    const template = await prisma.pixelTemplate.create({
      data: {
        ownerId: options.ownerId,
        name: options.name,
        description: options.description,
        platforms: options.platforms as unknown as Parameters<typeof prisma.pixelTemplate.create>[0]["data"]["platforms"],
        isPublic: options.isPublic ?? false,
      },
    });

    logger.info("Pixel template created", { templateId: template.id, name: options.name });
    return { success: true, templateId: template.id };
  } catch (error) {
    logger.error("Failed to create pixel template", { error });
    return { success: false, error: "创建模板失败" };
  }
}

export async function getPixelTemplates(
  ownerId: string,
  includePublic: boolean = true
): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  platforms: PixelTemplateConfig[];
  isPublic: boolean;
  usageCount: number;
  createdAt: Date;
}>> {
  const templates = await prisma.pixelTemplate.findMany({
    where: includePublic
      ? {
          OR: [
            { ownerId },
            { isPublic: true },
          ],
        }
      : { ownerId },
    orderBy: { createdAt: "desc" },
  });

  return templates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    platforms: (t.platforms as unknown) as PixelTemplateConfig[],
    isPublic: t.isPublic,
    usageCount: t.usageCount,
    createdAt: t.createdAt,
  }));
}

export async function getPixelTemplate(
  templateId: string
): Promise<{
  id: string;
  name: string;
  description: string | null;
  platforms: PixelTemplateConfig[];
  isPublic: boolean;
  usageCount: number;
} | null> {
  const template = await prisma.pixelTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) return null;

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    platforms: (template.platforms as unknown) as PixelTemplateConfig[],
    isPublic: template.isPublic,
    usageCount: template.usageCount,
  };
}

export async function updatePixelTemplate(
  templateId: string,
  ownerId: string,
  updates: Partial<TemplateCreateOptions>
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.pixelTemplate.findUnique({
      where: { id: templateId },
    });

    if (!existing || existing.ownerId !== ownerId) {
      return { success: false, error: "模板不存在或无权限" };
    }

    await prisma.pixelTemplate.update({
      where: { id: templateId },
      data: {
        name: updates.name,
        description: updates.description,
        platforms: updates.platforms as unknown as Parameters<typeof prisma.pixelTemplate.update>[0]["data"]["platforms"],
        isPublic: updates.isPublic,
      },
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to update pixel template", { templateId, error });
    return { success: false, error: "更新失败" };
  }
}

export async function deletePixelTemplate(
  templateId: string,
  ownerId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.pixelTemplate.findUnique({
      where: { id: templateId },
    });

    if (!existing || existing.ownerId !== ownerId) {
      return { success: false, error: "模板不存在或无权限" };
    }

    await prisma.pixelTemplate.delete({
      where: { id: templateId },
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to delete pixel template", { templateId, error });
    return { success: false, error: "删除失败" };
  }
}

export async function batchApplyPixelTemplate(
  options: BatchApplyOptions & { jobId?: string }
): Promise<BatchApplyResult & { jobId?: string }> {
  const { templateId, targetShopIds, overwriteExisting = false, skipIfExists = true, jobId } = options;

  logger.info("Starting batch apply", { templateId, shopCount: targetShopIds.length, jobId });

  const currentJobId = jobId || createBatchJob("pixel_apply", targetShopIds[0] || "", targetShopIds.length);
  updateBatchJobProgress(currentJobId, { status: "running" });

  const template = await getPixelTemplate(templateId);
  if (!template) {
    updateBatchJobProgress(currentJobId, {
      status: "failed",
      error: "模板不存在",
    });
    return {
      success: false,
      totalShops: targetShopIds.length,
      successCount: 0,
      failedCount: targetShopIds.length,
      skippedCount: 0,
      results: targetShopIds.map(shopId => ({
        shopId,
        shopDomain: "",
        status: "failed" as const,
        message: "模板不存在",
      })),
      jobId: currentJobId,
    };
  }

  const results: BatchApplyResult["results"] = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < targetShopIds.length; i++) {
    const shopId = targetShopIds[i];
    try {
      const result = await applyTemplateToShop(
        shopId,
        template.platforms,
        overwriteExisting,
        skipIfExists
      );

      if (result.status === "success") {
        successCount++;
      } else if (result.status === "skipped") {
        skippedCount++;
      } else {
        failedCount++;
      }

      results.push(result);

      updateBatchJobProgress(currentJobId, {
        completedItems: successCount + skippedCount,
        failedItems: failedCount,
        skippedItems: skippedCount,
      });
    } catch (error) {
      failedCount++;
      results.push({
        shopId,
        shopDomain: "",
        status: "failed",
        message: error instanceof Error ? error.message : "未知错误",
      });
      updateBatchJobProgress(currentJobId, {
        failedItems: failedCount,
      });
    }
  }

  await prisma.pixelTemplate.update({
    where: { id: templateId },
    data: { usageCount: { increment: successCount } },
  });

  updateBatchJobProgress(currentJobId, {
    status: failedCount === 0 ? "completed" : "completed",
    result: {
      success: failedCount === 0,
      totalShops: targetShopIds.length,
      successCount,
      failedCount,
      skippedCount,
      results,
    },
  });

  logger.info("Batch apply completed", {
    templateId,
    totalShops: targetShopIds.length,
    successCount,
    failedCount,
    skippedCount,
    jobId: currentJobId,
  });

  return {
    success: failedCount === 0,
    totalShops: targetShopIds.length,
    successCount,
    failedCount,
    skippedCount,
    results,
    jobId: currentJobId,
  };
}

export function getBatchApplyJobStatus(jobId: string) {
  return getBatchJobStatus(jobId);
}

async function applyTemplateToShop(
  shopId: string,
  platforms: PixelTemplateConfig[],
  overwriteExisting: boolean,
  skipIfExists: boolean
): Promise<{
  shopId: string;
  shopDomain: string;
  status: "success" | "failed" | "skipped";
  message: string;
  platformsApplied?: string[];
}> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      pixelConfigs: {
        select: { platform: true },
      },
    },
  });

  if (!shop) {
    return {
      shopId,
      shopDomain: "",
      status: "failed",
      message: "店铺不存在",
    };
  }

  const planLimit = getPixelDestinationsLimit(shop.plan as PlanId);
  const existingPlatforms = shop.pixelConfigs.map(c => c.platform);
  const newPlatforms = platforms.filter(p => !existingPlatforms.includes(p.platform));

  if (planLimit !== -1 && existingPlatforms.length + newPlatforms.length > planLimit) {
    return {
      shopId,
      shopDomain: shop.shopDomain,
      status: "failed",
      message: `超出套餐限制 (最多 ${planLimit} 个平台)`,
    };
  }

  const appliedPlatforms: string[] = [];

  for (const platformConfig of platforms) {
    const existingConfig = existingPlatforms.includes(platformConfig.platform);

    if (existingConfig) {
      if (skipIfExists && !overwriteExisting) {

        continue;
      }

      if (overwriteExisting) {

        await prisma.pixelConfig.update({
          where: {
            shopId_platform: {
              shopId,
              platform: platformConfig.platform,
            },
          },
          data: {
            eventMappings: platformConfig.eventMappings,
            clientSideEnabled: platformConfig.clientSideEnabled ?? true,
            serverSideEnabled: platformConfig.serverSideEnabled ?? false,
            migrationStatus: "not_started",
          },
        });
        appliedPlatforms.push(platformConfig.platform);
      }
    } else {

      await prisma.pixelConfig.create({
        data: {
          shopId,
          platform: platformConfig.platform,
          eventMappings: platformConfig.eventMappings,
          clientSideEnabled: platformConfig.clientSideEnabled ?? true,
          serverSideEnabled: platformConfig.serverSideEnabled ?? false,
          isActive: false,
          migrationStatus: "not_started",
        },
      });
      appliedPlatforms.push(platformConfig.platform);
    }
  }

  if (appliedPlatforms.length === 0 && skipIfExists) {
    return {
      shopId,
      shopDomain: shop.shopDomain,
      status: "skipped",
      message: "所有平台配置已存在",
    };
  }

  return {
    shopId,
    shopDomain: shop.shopDomain,
    status: "success",
    message: `成功应用 ${appliedPlatforms.length} 个平台配置`,
    platformsApplied: appliedPlatforms,
  };
}

export const PRESET_TEMPLATES: Array<{
  id: string;
  name: string;
  nameEn: string;
  description: string;
  platforms: PixelTemplateConfig[];
}> = [
  {
    id: "basic-tracking",
    name: "基础追踪套件",
    nameEn: "Basic Tracking Suite",
    description: "GA4 + Meta Pixel 的基础配置，适合刚开始追踪的店铺",
    platforms: [
      {
        platform: "google",
        clientSideEnabled: true,
        serverSideEnabled: true,
        eventMappings: {
          checkout_completed: "purchase",
          checkout_started: "begin_checkout",
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
          checkout_started: "InitiateCheckout",
          product_added_to_cart: "AddToCart",
          product_viewed: "ViewContent",
        },
      },
    ],
  },
  {
    id: "full-channel",
    name: "全渠道追踪套件",
    nameEn: "Full Channel Suite",
    description: "GA4 + Meta + TikTok + Pinterest，覆盖主流广告平台",
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
        serverSideEnabled: false,
      },
    ],
  },
  {
    id: "capi-only",
    name: "仅服务端追踪",
    nameEn: "Server-side Only",
    description: "仅 CAPI，最大化隐私保护，适合对隐私要求高的店铺",
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
  },
  {
    id: "social-focus",
    name: "社交媒体专注",
    nameEn: "Social Media Focus",
    description: "Meta + TikTok + Snapchat，适合社交流量为主的店铺",
    platforms: [
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
        platform: "snapchat",
        clientSideEnabled: true,
        serverSideEnabled: true,
      },
    ],
  },
];

export async function applyPresetTemplate(
  presetId: string,
  shopId: string,
  overwriteExisting: boolean = false
): Promise<{
  success: boolean;
  message: string;
  platformsApplied?: string[];
}> {
  const preset = PRESET_TEMPLATES.find(t => t.id === presetId);
  if (!preset) {
    return { success: false, message: "预设模板不存在" };
  }

  const result = await applyTemplateToShop(
    shopId,
    preset.platforms,
    overwriteExisting,
    true
  );

  return {
    success: result.status === "success",
    message: result.message,
    platformsApplied: result.platformsApplied,
  };
}

