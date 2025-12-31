

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
  let impactScore = 10;

  const categoryImpact: Record<string, number> = {
    pixel: 20,
    affiliate: 15,
    survey: 8,
    support: 10,
    analytics: 12,
    other: 5,
  };
  impactScore = categoryImpact[asset.category] || 10;

  if (asset.platform) {
    const criticalPlatforms = ["google", "meta", "tiktok"];
    if (criticalPlatforms.includes(asset.platform)) {
      impactScore += 5;
    }
  }

  const details = asset.details as Record<string, unknown> | null;
  if (details) {
    const displayScope = details.displayScope as string | undefined;
    if (displayScope === "order_status") {
      impactScore += 10;
    }
  }

  return Math.max(0, Math.min(30, impactScore));
}

function estimateMigrationTime(asset: AuditAsset, complexity: number): number {

  let baseTime = 15;

  const categoryBaseTime: Record<string, number> = {
    pixel: 15,
    affiliate: 30,
    survey: 20,
    support: 10,
    analytics: 25,
    other: 15,
  };
  baseTime = categoryBaseTime[asset.category] || 15;

  const migrationTypeMultiplier: Record<string, number> = {
    web_pixel: 1.0,
    ui_extension: 1.5,
    server_side: 2.0,
    none: 0.3,
  };
  const multiplier = migrationTypeMultiplier[asset.suggestedMigration] || 1.0;
  baseTime = Math.round(baseTime * multiplier);

  const complexityMultiplier = 1 + (complexity / 20) * 0.5;
  baseTime = Math.round(baseTime * complexityMultiplier);

  if (asset.riskLevel === "high") {
    baseTime = Math.round(baseTime * 1.2);
  } else if (asset.riskLevel === "low") {
    baseTime = Math.round(baseTime * 0.9);
  }

  return Math.max(5, Math.min(120, baseTime));
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

  const rawPriority =
    riskLevel * 0.4 +
    impactScope * 0.3 +
    (category + migrationStatus) * 0.2 +
    dependency * 0.1 +
    (20 - complexity) * 0.1;

  const normalizedPriority = Math.round(1 + (rawPriority / 100) * 9);
  const priority = Math.max(1, Math.min(10, normalizedPriority));

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
    priority,
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

