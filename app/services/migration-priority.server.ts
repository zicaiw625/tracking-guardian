

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  getScriptTagCreationStatus,
  getScriptTagExecutionStatus,
  DEPRECATION_DATES,
} from "../utils/deprecation-dates";

export interface PriorityFactors {
  riskLevel: "high" | "medium" | "low";
  impactScope: "order_status" | "checkout" | "all_pages" | "other";
  migrationDifficulty: "easy" | "medium" | "hard";
  shopTier: "plus" | "non_plus" | null;
  daysUntilDeadline?: number;
  hasDependencies?: boolean;
}

export interface PriorityResult {
  priority: number;
  estimatedTimeMinutes: number;
  dependencies: string[];
  reasoning: string[];
}

export function calculatePriority(factors: PriorityFactors): PriorityResult {
  const reasoning: string[] = [];
  let priorityScore = 5;

  switch (factors.riskLevel) {
    case "high":
      priorityScore += 3;
      reasoning.push("高风险项：会失效/受限");
      break;
    case "medium":
      priorityScore += 1;
      reasoning.push("中风险项：可直接替换");
      break;
    case "low":
      priorityScore -= 1;
      reasoning.push("低风险项：无需立即迁移");
      break;
  }

  switch (factors.impactScope) {
    case "order_status":
      priorityScore += 2;
      reasoning.push("影响订单状态页：Shopify 废弃公告的主要目标");
      break;
    case "checkout":
      priorityScore += 1;
      reasoning.push("影响结账流程：关键转化环节");
      break;
    case "all_pages":
      priorityScore += 0.5;
      reasoning.push("影响全站：范围较广");
      break;
    case "other":
      priorityScore += 0;
      break;
  }

  switch (factors.migrationDifficulty) {
    case "easy":
      priorityScore += 0.5;
      reasoning.push("迁移简单：可直接替换");
      break;
    case "medium":
      priorityScore += 0;
      break;
    case "hard":
      priorityScore -= 1;
      reasoning.push("迁移困难：需要更多评估时间");
      break;
  }

  if (factors.shopTier === "plus") {
    const now = new Date();
    const autoUpgradeStart = DEPRECATION_DATES.plusAutoUpgradeStart;
    const daysUntilAutoUpgrade = Math.ceil(
      (autoUpgradeStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (now >= autoUpgradeStart) {
      priorityScore += 2;
      reasoning.push("Plus 商家自动升级已开始：立即处理");
    } else if (daysUntilAutoUpgrade <= 30) {
      priorityScore += 2;
      reasoning.push(`Plus 自动升级倒计时：剩余 ${daysUntilAutoUpgrade} 天`);
    } else if (daysUntilAutoUpgrade <= 90) {
      priorityScore += 1;
      reasoning.push(`Plus 自动升级倒计时：剩余 ${daysUntilAutoUpgrade} 天`);
    }
  } else if (factors.shopTier === "non_plus") {
    const now = new Date();
    const nonPlusDeadline = DEPRECATION_DATES.nonPlusOrderStatusDeadline;
    const daysUntilDeadline = Math.ceil(
      (nonPlusDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilDeadline <= 30) {
      priorityScore += 2;
      reasoning.push(`非 Plus 商家截止日期：剩余 ${daysUntilDeadline} 天`);
    } else if (daysUntilDeadline <= 90) {
      priorityScore += 1;
      reasoning.push(`非 Plus 商家截止日期：剩余 ${daysUntilDeadline} 天`);
    }
  }

  if (factors.hasDependencies) {
    priorityScore += 0.5;
    reasoning.push("存在依赖关系：需要先处理依赖项");
  }

  priorityScore = Math.max(1, Math.min(10, Math.round(priorityScore)));

  let estimatedTime = 15;
  if (factors.riskLevel === "high") {
    estimatedTime += 10;
  }
  if (factors.migrationDifficulty === "hard") {
    estimatedTime += 15;
  }
  if (factors.migrationDifficulty === "easy") {
    estimatedTime -= 5;
  }

  return {
    priority: priorityScore,
    estimatedTimeMinutes: Math.max(5, estimatedTime),
    dependencies: [],
    reasoning,
  };
}

export async function calculateAssetPriority(
  assetId: string,
  shopTier: "plus" | "non_plus" | null,
  shopId?: string
): Promise<PriorityResult | null> {
  const asset = await prisma.auditAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      shopId: true,
      riskLevel: true,
      category: true,
      platform: true,
      suggestedMigration: true,
      details: true,
    },
  });

  if (!asset) {
    logger.warn(`Asset not found: ${assetId}`);
    return null;
  }

  let impactScope: PriorityFactors["impactScope"] = "other";
  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    if (details.display_scope === "order_status") {
      impactScope = "order_status";
    } else if (details.display_scope === "checkout") {
      impactScope = "checkout";
    } else if (details.display_scope === "all") {
      impactScope = "all_pages";
    }
  }

  let migrationDifficulty: PriorityFactors["migrationDifficulty"] = "medium";
  if (asset.suggestedMigration === "web_pixel") {
    migrationDifficulty = "easy";
  } else if (asset.suggestedMigration === "ui_extension") {
    migrationDifficulty = "medium";
  } else if (asset.suggestedMigration === "server_side") {
    migrationDifficulty = "hard";
  }

  const dependencies: string[] = [];
  if (asset.platform && (shopId || asset.shopId)) {
    const targetShopId = shopId || asset.shopId;
    const relatedAssets = await prisma.auditAsset.findMany({
      where: {
        shopId: targetShopId,
        platform: asset.platform,
        id: { not: asset.id },
        migrationStatus: { not: "completed" },
      },
      select: { id: true },
      take: 2,
    });

    if (relatedAssets.length > 0) {
      dependencies.push(...relatedAssets.map((a) => a.id));
    }
  }

  const factors: PriorityFactors = {
    riskLevel: asset.riskLevel as "high" | "medium" | "low",
    impactScope,
    migrationDifficulty,
    shopTier,
    hasDependencies: dependencies.length > 0,
  };

  const result = calculatePriority(factors);
  result.dependencies = dependencies;

  return result;
}

export async function calculateAllAssetPriorities(
  shopId: string,
  shopTier: "plus" | "non_plus" | null
): Promise<void> {
  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: { not: "completed" },
    },
  });

  for (const asset of assets) {
    try {
      const priorityResult = await calculateAssetPriority(asset.id, shopTier, shopId);
      if (priorityResult) {
        await prisma.auditAsset.update({
          where: { id: asset.id },
          data: {
            priority: priorityResult.priority,
            estimatedTimeMinutes: priorityResult.estimatedTimeMinutes,
            dependencies: priorityResult.dependencies.length > 0
              ? priorityResult.dependencies
              : undefined,
          },
        });
      }
    } catch (error) {
      logger.error(`Failed to calculate priority for asset ${asset.id}:`, error);
    }
  }
}
