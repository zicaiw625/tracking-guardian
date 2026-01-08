import type { AuditAsset , Prisma } from "@prisma/client";
import prisma from "../../db.server";

export interface TimeEstimate {
  assetId: string;
  minMinutes: number;
  maxMinutes: number;
  estimatedMinutes: number;
  factors: {
    baseTime: number;
    categoryMultiplier: number;
    complexityMultiplier: number;
    migrationTypeMultiplier: number;
  };
  reason: string;
}

const BASE_TIME_BY_CATEGORY: Record<string, number> = {
  pixel: 15,
  affiliate: 30,
  survey: 20,
  support: 10,
  analytics: 25,
  other: 15,
};

const BASE_TIME_BY_MIGRATION_TYPE: Record<string, number> = {
  web_pixel: 10,
  ui_extension: 20,
  server_side: 30,
  none: 0,
};

function getComplexityMultiplier(asset: AuditAsset): number {
  let multiplier = 1.0;

  switch (asset.riskLevel) {
    case "high":
      multiplier *= 1.5;
      break;
    case "medium":
      multiplier *= 1.2;
      break;
    case "low":
      multiplier *= 1.0;
      break;
  }

  if (asset.platform) {
    const complexPlatforms = ["pinterest", "snapchat", "twitter", "linkedin"];
    if (complexPlatforms.includes(asset.platform)) {
      multiplier *= 1.3;
    }
  }

  const details = asset.details as Record<string, unknown> | null;
  if (details) {

    const scriptTagCount = (details.scriptTagCount as number) || 1;
    if (scriptTagCount > 1) {
      multiplier *= 1.2;
    }

    if (details.hasCustomConfig) {
      multiplier *= 1.3;
    }

    const eventMappingsCount = (details.eventMappingsCount as number) || 0;
    if (eventMappingsCount > 5) {
      multiplier *= 1.1;
    }
  }

  const dependencies = asset.dependencies as string[] | null;
  if (dependencies && Array.isArray(dependencies) && dependencies.length > 0) {
    multiplier *= 1.1;
  }

  return multiplier;
}

export async function estimateMigrationTime(
  asset: AuditAsset
): Promise<TimeEstimate> {

  if (asset.migrationStatus === "completed" || asset.migrationStatus === "skipped") {
    return {
      assetId: asset.id,
      minMinutes: 0,
      maxMinutes: 0,
      estimatedMinutes: 0,
      factors: {
        baseTime: 0,
        categoryMultiplier: 1,
        complexityMultiplier: 1,
        migrationTypeMultiplier: 1,
      },
      reason: "资产已迁移或已跳过",
    };
  }

  const baseTime = BASE_TIME_BY_CATEGORY[asset.category] || 15;

  const categoryMultiplier = asset.category === "pixel" ? 1.0 : 1.2;

  const complexityMultiplier = getComplexityMultiplier(asset);

  const migrationTypeMultiplier = BASE_TIME_BY_MIGRATION_TYPE[asset.suggestedMigration]
    ? BASE_TIME_BY_MIGRATION_TYPE[asset.suggestedMigration] / baseTime
    : 1.0;

  const estimatedMinutes = Math.round(
    baseTime * categoryMultiplier * complexityMultiplier * migrationTypeMultiplier
  );

  const minMinutes = Math.max(5, Math.round(estimatedMinutes * 0.7));
  const maxMinutes = Math.round(estimatedMinutes * 1.3);

  const reasons: string[] = [];
  if (baseTime >= 25) reasons.push("复杂资产类型");
  if (complexityMultiplier >= 1.3) reasons.push("高复杂度");
  if (asset.riskLevel === "high") reasons.push("高风险需更多测试");
  if (asset.suggestedMigration === "server_side") reasons.push("需要服务端集成");

  const reason = reasons.length > 0
    ? reasons.join("、")
    : "标准迁移时间";

  return {
    assetId: asset.id,
    minMinutes,
    maxMinutes,
    estimatedMinutes,
    factors: {
      baseTime,
      categoryMultiplier,
      complexityMultiplier,
      migrationTypeMultiplier,
    },
    reason,
  };
}

export async function estimateMigrationTimesForShop(
  shopId: string
): Promise<TimeEstimate[]> {

  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: { not: "completed" },
    },
  });

  const estimates = await Promise.all(
    assets.map((asset) => estimateMigrationTime(asset))
  );

  return estimates;
}

export function calculateTotalMigrationTime(
  estimates: TimeEstimate[]
): {
  totalMin: number;
  totalMax: number;
  totalEstimated: number;
  formatted: string;
} {
  const totalMin = estimates.reduce((sum, e) => sum + e.minMinutes, 0);
  const totalMax = estimates.reduce((sum, e) => sum + e.maxMinutes, 0);
  const totalEstimated = estimates.reduce((sum, e) => sum + e.estimatedMinutes, 0);

  const formatTime = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} 小时`;
    }
    return `${hours} 小时 ${mins} 分钟`;
  };

  return {
    totalMin,
    totalMax,
    totalEstimated,
    formatted: `${formatTime(totalMin)} - ${formatTime(totalMax)}（预计 ${formatTime(totalEstimated)}）`,
  };
}

export async function updateAssetTimeEstimate(
  assetId: string,
  estimate: TimeEstimate
): Promise<void> {
  const asset = await prisma.auditAsset.findUnique({
    where: { id: assetId },
  });

  if (asset) {
    const details = (asset.details as Record<string, unknown>) || {};
    details.timeEstimate = {
      minMinutes: estimate.minMinutes,
      maxMinutes: estimate.maxMinutes,
      estimatedMinutes: estimate.estimatedMinutes,
    };
    details.timeEstimateFactors = estimate.factors;
    details.timeEstimateReason = estimate.reason;
    details.timeEstimateCalculatedAt = new Date().toISOString();

    await prisma.auditAsset.update({
      where: { id: assetId },
      data: {
        estimatedTimeMinutes: estimate.estimatedMinutes,
        details: details as Prisma.InputJsonValue,
      },
    });
  }
}
