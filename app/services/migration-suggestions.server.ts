import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { AuditAsset } from "@prisma/client";
import { getMigrationChecklist } from "./migration-checklist.server";
import { generateMigrationTimeline } from "./migration-priority.server";

export interface MigrationSuggestion {
  assetId: string;
  title: string;
  description: string;
  priority: number;
  estimatedTimeMinutes: number;
  steps: string[];
  migrationType: "web_pixel" | "ui_extension" | "server_side" | "none";
  platform?: string;
  dependencies: string[];
  canStart: boolean;
}

export interface MigrationSuggestions {
  shopId: string;
  suggestions: MigrationSuggestion[];
  totalEstimatedTime: number;
  highPriorityCount: number;
  canStartCount: number;
  generatedAt: Date;
}

function generateMigrationSteps(
  asset: AuditAsset,
  migrationType: string,
  platform?: string | null
): string[] {
  const steps: string[] = [];
  switch (migrationType) {
    case "web_pixel":
      steps.push("1. 前往「像素迁移」页面");
      steps.push("2. 选择对应的广告平台（" + (platform || "未知平台") + "）");
      steps.push("3. 填写像素 ID 和 API 凭证");
      steps.push("4. 配置事件映射");
      steps.push("5. 在测试环境验证");
      steps.push("6. 切换到生产模式");
      break;
    case "ui_extension":
      steps.push("1. 前往「UI 模块」页面");
      if (asset.category === "survey") {
        steps.push("2. 选择「售后问卷」模块");
        steps.push("3. 配置问卷问题和选项");
      } else if (asset.category === "support") {
        steps.push("2. 选择「帮助中心」模块");
        steps.push("3. 配置客服链接和 FAQ");
      }
      steps.push("4. 设置显示规则和本地化");
      steps.push("5. 预览并发布");
      break;
    case "server_side":
      steps.push("1. 前往「像素迁移」页面");
      steps.push("2. 选择对应的广告平台");
      steps.push("3. 配置服务端 CAPI 凭证");
      steps.push("4. 测试服务端事件发送");
      steps.push("5. 验证事件去重");
      break;
    case "none":
      steps.push("1. 确认该资产无需迁移");
      steps.push("2. 标记为「已跳过」");
      break;
    default:
      steps.push("1. 评估迁移方案");
      steps.push("2. 根据建议选择迁移方式");
  }
  return steps;
}

export async function generateMigrationSuggestions(
  shopId: string
): Promise<MigrationSuggestions> {
  const checklist = await getMigrationChecklist(shopId, false);
  const timeline = await generateMigrationTimeline(shopId);
  const completedAssetIds = new Set(
    (await prisma.auditAsset.findMany({
      where: {
        shopId,
        migrationStatus: "completed",
      },
      select: { id: true },
    })).map((a) => a.id)
  );
  const suggestions: MigrationSuggestion[] = checklist.items.map((item) => {
    const timelineAsset = timeline.assets.find((a) => a.asset.id === item.assetId);
    const dependencies = timelineAsset?.blockingDependencies || [];
    const canStart = dependencies.length === 0 && !completedAssetIds.has(item.assetId);
    return {
      assetId: item.assetId,
      title: item.title,
      description: item.description,
      priority: item.priority,
      estimatedTimeMinutes: item.estimatedTime,
      steps: generateMigrationSteps(
        {
          id: item.assetId,
          category: item.category,
          suggestedMigration: item.suggestedMigration,
          platform: item.platform || null,
        } as AuditAsset,
        item.suggestedMigration,
        item.platform
      ),
      migrationType: item.suggestedMigration,
      platform: item.platform,
      dependencies,
      canStart,
    };
  });
  const highPriorityCount = suggestions.filter((s) => s.priority >= 8).length;
  const canStartCount = suggestions.filter((s) => s.canStart).length;
  const totalEstimatedTime = suggestions.reduce(
    (sum, s) => sum + s.estimatedTimeMinutes,
    0
  );
  return {
    shopId,
    suggestions,
    totalEstimatedTime,
    highPriorityCount,
    canStartCount,
    generatedAt: new Date(),
  };
}

export async function getMigrationSuggestionForAsset(
  assetId: string
): Promise<MigrationSuggestion | null> {
  const asset = await prisma.auditAsset.findUnique({
    where: { id: assetId },
    include: {
      Shop: {
        select: { id: true },
      },
    },
  });
  if (!asset) {
    return null;
  }
  const timeline = await generateMigrationTimeline(asset.shopId);
  const timelineAsset = timeline.assets.find((a) => a.asset.id === assetId);
  if (!timelineAsset) {
    return null;
  }
  const dependencies = timelineAsset.blockingDependencies || [];
  const completedAssetIds = new Set(
    (await prisma.auditAsset.findMany({
      where: {
        shopId: asset.shopId,
        migrationStatus: "completed",
      },
      select: { id: true },
    })).map((a) => a.id)
  );
  const canStart = dependencies.length === 0 && !completedAssetIds.has(assetId);
  return {
    assetId: asset.id,
    title: asset.displayName || `${asset.category} - ${asset.platform || "未知"}`,
    description: getMigrationDescription(asset),
    priority: asset.priority || 5,
    estimatedTimeMinutes: asset.estimatedTimeMinutes || 15,
    steps: generateMigrationSteps(asset, asset.suggestedMigration, asset.platform),
    migrationType: asset.suggestedMigration as "none" | "web_pixel" | "ui_extension" | "server_side",
    platform: asset.platform || undefined,
    dependencies,
    canStart,
  };
}

function getMigrationDescription(asset: AuditAsset): string {
  const categoryNames: Record<string, string> = {
    pixel: "追踪像素",
    affiliate: "联盟追踪",
    survey: "售后问卷",
    support: "客服入口",
    analytics: "站内分析",
    other: "其他",
  };
  const migrationNames: Record<string, string> = {
    web_pixel: "迁移到 Web Pixel",
    ui_extension: "迁移到 UI Extension",
    server_side: "迁移到服务端 CAPI",
    none: "无需迁移",
  };
  const categoryName = categoryNames[asset.category] || "其他";
  const migrationName = migrationNames[asset.suggestedMigration] || "未知";
  if (asset.platform) {
    const platformNames: Record<string, string> = {
      google: "Google Analytics",
      meta: "Meta (Facebook)",
      tiktok: "TikTok",
      pinterest: "Pinterest",
    };
    const platformName = platformNames[asset.platform] || asset.platform;
    return `${categoryName} (${platformName}) - ${migrationName}`;
  }
  return `${categoryName} - ${migrationName}`;
}
