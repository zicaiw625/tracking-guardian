

import type { AuditAsset } from "@prisma/client";
import prisma from "../../db.server";

export interface PriorityScore {
  assetId: string;
  priority: number;
  estimatedTimeMinutes: number;
  factors: {
    riskLevel: number;
    category: number;
    migrationStatus: number;
    dependency: number;
    complexity: number;
    impactScope: number;
  };
  reason: string;
}

const RISK_WEIGHTS: Record<string, number> = {
  high: 30,
  medium: 20,
  low: 10,
};

const CATEGORY_WEIGHTS: Record<string, number> = {
  pixel: 20,
  affiliate: 15,
  survey: 10,
  support: 8,
  analytics: 5,
  other: 3,
};

const MIGRATION_STATUS_WEIGHTS: Record<string, number> = {
  pending: 15,
  in_progress: 10,
  completed: 0,
  skipped: 0,
};

function calculateComplexity(asset: AuditAsset): number {
  let complexity = 10;

  switch (asset.category) {
    case "pixel":

      complexity = 8;
      break;
    case "affiliate":

      complexity = 15;
      break;
    case "survey":

      complexity = 12;
      break;
    case "support":

      complexity = 6;
      break;
    case "analytics":

      complexity = 18;
      break;
    default:
      complexity = 10;
  }

  switch (asset.suggestedMigration) {
    case "web_pixel":
      complexity -= 2;
      break;
    case "ui_extension":
      complexity += 3;
      break;
    case "server_side":
      complexity += 5;
      break;
    case "none":
      complexity = 0;
      break;
  }

  if (asset.platform) {
    const complexPlatforms = ["pinterest", "snapchat", "twitter"];
    if (complexPlatforms.includes(asset.platform)) {
      complexity += 3;
    }
  }

  return Math.max(0, Math.min(20, complexity));
}

async function calculateDependencyScore(
  asset: AuditAsset,
  allAssets: AuditAsset[]
): Promise<number> {
  let dependencyScore = 0;

  const dependentAssets = allAssets.filter((a) => {
    if (a.id === asset.id) return false;

    const aDetails = a.details as Record<string, unknown> | null;
    const assetDetails = asset.details as Record<string, unknown> | null;

    if (aDetails && assetDetails) {

      const aDependencies = aDetails.dependencies as string[] | undefined;
      if (aDependencies && aDependencies.includes(asset.id)) {
        return true;
      }
    }

    return false;
  });

  if (dependentAssets.length > 0) {
    dependencyScore = Math.min(15, dependentAssets.length * 3);
  }

  const assetDetails = asset.details as Record<string, unknown> | null;
  if (assetDetails) {
    const dependencies = assetDetails.dependencies as string[] | undefined;
    if (dependencies && dependencies.length > 0) {

      const completedDependencies = dependencies.filter((depId) => {
        const depAsset = allAssets.find((a) => a.id === depId);
        return depAsset?.migrationStatus === "completed";
      });

      if (completedDependencies.length === dependencies.length) {

        dependencyScore += 5;
      } else if (completedDependencies.length > 0) {

        dependencyScore += 2;
      } else {

        dependencyScore -= 5;
      }
    }
  }

  return Math.max(0, Math.min(15, dependencyScore));
}

function calculateImpactScope(asset: AuditAsset): number {
  let impactScore = 10; // 基础影响分数

  // 基于资产类别的影响范围
  const categoryImpact: Record<string, number> = {
    pixel: 20,      // 像素追踪影响转化归因，非常重要
    affiliate: 15,  // 联盟追踪影响分佣
    survey: 8,      // 问卷影响用户体验
    support: 10,    // 客服支持影响用户满意度
    analytics: 12,  // 分析工具影响数据收集
    other: 5,       // 其他脚本影响较小
  };
  impactScore = categoryImpact[asset.category] || 10;

  // 基于平台的影响范围
  if (asset.platform) {
    const criticalPlatforms = ["google", "meta", "tiktok"];
    if (criticalPlatforms.includes(asset.platform)) {
      impactScore += 5; // 关键广告平台加分
    }
  }

  // 基于显示范围的影响
  const details = asset.details as Record<string, unknown> | null;
  if (details) {
    const displayScope = details.displayScope as string | undefined;
    if (displayScope === "order_status") {
      impactScore += 10; // 订单状态页影响更大
    }
  }

  return Math.max(0, Math.min(30, impactScore));
}

function estimateMigrationTime(asset: AuditAsset, complexity: number): number {
  // 基础时间（分钟）
  let baseTime = 15;

  // 基于类别的基础时间
  const categoryBaseTime: Record<string, number> = {
    pixel: 15,
    affiliate: 30,
    survey: 20,
    support: 10,
    analytics: 25,
    other: 15,
  };
  baseTime = categoryBaseTime[asset.category] || 15;

  // 基于迁移类型的时间调整
  const migrationTypeMultiplier: Record<string, number> = {
    web_pixel: 1.0,
    ui_extension: 1.5,
    server_side: 2.0,
    none: 0.3,
  };
  const multiplier = migrationTypeMultiplier[asset.suggestedMigration] || 1.0;
  baseTime = Math.round(baseTime * multiplier);

  // 复杂度调整（复杂度越高，时间越长）
  const complexityMultiplier = 1 + (complexity / 20) * 0.5; // 最多增加 50%
  baseTime = Math.round(baseTime * complexityMultiplier);

  // 风险等级调整（高风险需要更多测试时间）
  if (asset.riskLevel === "high") {
    baseTime = Math.round(baseTime * 1.2);
  } else if (asset.riskLevel === "low") {
    baseTime = Math.round(baseTime * 0.9);
  }

  return Math.max(5, Math.min(120, baseTime)); // 最少 5 分钟，最多 120 分钟
}

export async function calculatePriority(
  asset: AuditAsset,
  allAssets: AuditAsset[] = []
): Promise<PriorityScore> {

  if (asset.migrationStatus === "completed" || asset.migrationStatus === "skipped") {
    return {
      assetId: asset.id,
      priority: 0,
      estimatedTimeMinutes: 0,
      factors: {
        riskLevel: 0,
        category: 0,
        migrationStatus: 0,
        dependency: 0,
        complexity: 0,
        impactScope: 0,
      },
      reason: "资产已迁移或已跳过",
    };
  }

  const riskLevel = RISK_WEIGHTS[asset.riskLevel] || 10;
  const category = CATEGORY_WEIGHTS[asset.category] || 5;
  const migrationStatus = MIGRATION_STATUS_WEIGHTS[asset.migrationStatus] || 0;
  const complexity = calculateComplexity(asset);
  const dependency = await calculateDependencyScore(asset, allAssets);
  const impactScope = calculateImpactScope(asset);

  // 优化后的优先级算法：priority = riskScore * 0.4 + impactScore * 0.3 + (category + migrationStatus) * 0.2 + dependency * 0.1
  // 复杂度作为负向因子（复杂度越高，优先级越低）
  const priority = Math.round(
    riskLevel * 0.4 +
    impactScope * 0.3 +
    (category + migrationStatus) * 0.2 +
    dependency * 0.1 +
    (20 - complexity) * 0.1
  );

  // 计算预计时间
  const estimatedTimeMinutes = estimateMigrationTime(asset, complexity);

  const reasons: string[] = [];
  if (riskLevel >= 25) reasons.push("高风险资产");
  if (impactScope >= 15) reasons.push("影响关键页面");
  if (category >= 15) reasons.push("重要资产类别");
  if (migrationStatus >= 10) reasons.push("待迁移状态");
  if (dependency >= 10) reasons.push("有依赖关系");
  if (complexity <= 8) reasons.push("迁移简单");

  const reason = reasons.length > 0
    ? reasons.join("、")
    : "标准优先级";

  return {
    assetId: asset.id,
    priority: Math.max(0, Math.min(100, priority)),
    estimatedTimeMinutes,
    factors: {
      riskLevel,
      category,
      migrationStatus,
      dependency,
      complexity,
      impactScope,
    },
    reason,
  };
}

export async function calculatePrioritiesForShop(
  shopId: string
): Promise<PriorityScore[]> {

  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: { not: "completed" },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const priorities = await Promise.all(
    assets.map((asset) => calculatePriority(asset, assets))
  );

  return priorities.sort((a, b) => b.priority - a.priority);
}

export async function updateAssetPriority(
  assetId: string,
  priority: PriorityScore
): Promise<void> {

  const asset = await prisma.auditAsset.findUnique({
    where: { id: assetId },
  });

  if (asset) {
    // 更新数据库中的优先级和时间估算字段
    await prisma.auditAsset.update({
      where: { id: assetId },
      data: {
        priority: priority.priority,
        estimatedTimeMinutes: priority.estimatedTimeMinutes,
        details: {
          ...((asset.details as Record<string, unknown>) || {}),
          priorityFactors: priority.factors,
          priorityReason: priority.reason,
          priorityCalculatedAt: new Date().toISOString(),
        },
      },
    });
  }
}

