import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { extractRequiredInfo, getRiskReason } from "./report-generator.server";
import type { AuditAsset } from "@prisma/client";

export interface MigrationChecklistItem {
  id: string;
  assetId: string;
  title: string;
  description: string;
  category: string;
  platform?: string;
  riskLevel: "high" | "medium" | "low";
  riskReason: string;
  suggestedMigration: "web_pixel" | "ui_extension" | "server_side" | "none";
  priority: number;
  estimatedTime: number;
  requiredInfo: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  fingerprint?: string | null;
}

export interface MigrationChecklist {
  shopId: string;
  totalItems: number;
  highPriorityItems: number;
  mediumPriorityItems: number;
  lowPriorityItems: number;
  estimatedTotalTime: number;
  items: MigrationChecklistItem[];
  generatedAt: Date;
}

function calculatePriority(
  asset: AuditAsset,
  category: string,
  allAssets: AuditAsset[] = []
): number {

  if (asset.priority !== null && asset.priority !== undefined) {
    return asset.priority;
  }

  let priority = 5;

  const riskWeights: Record<string, number> = {
    high: 3.5,
    medium: 1.5,
    low: 0.5,
  };
  priority += riskWeights[asset.riskLevel] || 1.5;

  const categoryWeights: Record<string, number> = {
    pixel: 2.0,
    affiliate: 1.5,
    survey: 0.8,
    support: 0.6,
    analytics: 0.4,
    other: 0.5,
  };
  priority += categoryWeights[category] || 0.5;

  const criticalPlatforms = ["google", "meta", "tiktok"];
  const importantPlatforms = ["pinterest", "snapchat"];
  if (asset.platform) {
    if (criticalPlatforms.includes(asset.platform)) {
      priority += 1.5;
    } else if (importantPlatforms.includes(asset.platform)) {
      priority += 0.8;
    }
  }

  const sourceWeights: Record<string, number> = {
    merchant_confirmed: 1.5,
    api_scan: 0.8,
    manual_paste: 0.5,
  };
  priority += sourceWeights[asset.sourceType] || 0.5;

  if (asset.migrationStatus === "pending") {
    priority += 0.5;
  } else if (asset.migrationStatus === "in_progress") {
    priority += 0.3;
  }

  const dependencies = (asset.dependencies as string[] | null) || [];
  if (dependencies.length > 0) {

    const incompleteDeps = dependencies.filter(depId => {
      const depAsset = allAssets.find(a => a.id === depId);
      return depAsset && depAsset.migrationStatus !== "completed";
    });
    if (incompleteDeps.length > 0) {
      priority += 1.0;
    }
  }

  const isDependencyOf = allAssets.some(a => {
    const deps = (a.dependencies as string[] | null) || [];
    return deps.includes(asset.id) && a.migrationStatus !== "completed";
  });
  if (isDependencyOf) {
    priority += 1.2;
  }

  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const displayScope = details.display_scope as string | undefined;
    if (displayScope === "order_status") {
      priority += 0.8;
    } else if (displayScope === "checkout") {
      priority += 1.0;
    } else if (displayScope === "all") {
      priority += 1.2;
    }

    const orderImpact = details.orderImpact as number | undefined;
    const revenueImpact = details.revenueImpact as number | undefined;
    if (orderImpact && orderImpact > 100) {
      priority += 0.3;
    }
    if (revenueImpact && revenueImpact > 10000) {
      priority += 0.5;
    }

    const hasCriticalEvents = details.hasCriticalEvents as boolean | undefined;
    if (hasCriticalEvents) {
      priority += 0.4;
    }

    const platformCount = details.platformCount as number | undefined;
    if (platformCount && platformCount > 1) {
      priority += 0.2 * Math.min(platformCount, 3);
    }
  }

  const migrationDifficultyWeights: Record<string, number> = {
    web_pixel: 0.5,
    ui_extension: 0.3,
    server_side: -0.2,
    none: -1.0,
  };

  const baseMigrationWeight = migrationDifficultyWeights[asset.suggestedMigration] || 0;
  const migrationWeight = asset.riskLevel === "high"
    ? Math.max(0, baseMigrationWeight)
    : baseMigrationWeight;
  priority += migrationWeight;

  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const enhancedRiskScore = details.enhancedRiskScore as number | undefined;
    if (enhancedRiskScore && enhancedRiskScore >= 70) {
      priority += 0.5;
    }
  }

  return Math.min(10, Math.max(1, Math.round(priority * 10) / 10));
}

function estimateMigrationTime(
  category: string,
  suggestedMigration: string,
  platform?: string,
  riskLevel?: string,
  hasDependencies?: boolean,
  complexity?: number
): number {

  const baseTimes: Record<string, Record<string, number>> = {
    pixel: {
      web_pixel: 12,
      server_side: 25,
      none: 0,
    },
    survey: {
      ui_extension: 15,
      none: 0,
    },
    support: {
      ui_extension: 8,
      none: 0,
    },
    affiliate: {
      web_pixel: 18,
      server_side: 30,
      none: 0,
    },
    analytics: {
      web_pixel: 10,
      none: 0,
    },
    other: {
      web_pixel: 15,
      ui_extension: 12,
      server_side: 25,
      none: 0,
    },
  };

  const categoryTimes = baseTimes[category] || baseTimes.other;
  let migrationTime = categoryTimes[suggestedMigration] || 15;

  if (platform) {
    const complexPlatforms = ["google", "meta"];
    if (complexPlatforms.includes(platform) && suggestedMigration === "server_side") {
      migrationTime += 8;
    } else if (platform === "tiktok" && suggestedMigration === "server_side") {
      migrationTime += 5;
    }
  }

  if (riskLevel === "high") {
    migrationTime = Math.round(migrationTime * 1.25);
  } else if (riskLevel === "low") {
    migrationTime = Math.round(migrationTime * 0.9);
  }

  if (complexity !== undefined) {
    const complexityMultiplier = 1 + (complexity / 20) * 0.4;
    migrationTime = Math.round(migrationTime * complexityMultiplier);
  }

  if (hasDependencies) {
    migrationTime += 3;
  }

  return Math.max(5, Math.min(120, migrationTime));
}

export async function generateMigrationChecklist(
  shopId: string
): Promise<MigrationChecklist> {

  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: {
        in: ["pending", "in_progress"],
      },
    },
    select: {
      id: true,
      displayName: true,
      platform: true,
      category: true,
      riskLevel: true,
      migrationStatus: true,
      priority: true,
      estimatedTimeMinutes: true,
      dependencies: true,
      details: true,
      suggestedMigration: true,
      fingerprint: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const items: MigrationChecklistItem[] = await Promise.all(assets.map(async (asset) => {

    const dependencies = (asset.dependencies as string[] | null) || [];
    const hasDependencies = dependencies.length > 0;

    let complexity = 5;
    if (asset.details && typeof asset.details === "object") {
      const details = asset.details as Record<string, unknown>;
      const matchedPatterns = details.matchedPatterns as string[] | undefined;
      if (matchedPatterns && matchedPatterns.length > 3) {
        complexity = 8;
      }
    }

    const priority = asset.priority ?? (
      asset.riskLevel === "high" ? 9 :
      asset.riskLevel === "medium" ? 6 :
      asset.category === "pixel" ? 8 :
      asset.category === "script" ? 7 :
      5
    );
    const estimatedTime = asset.estimatedTimeMinutes ?? estimateMigrationTime(
      asset.category,
      asset.suggestedMigration,
      asset.platform || undefined,
      asset.riskLevel,
      hasDependencies,
      complexity
    );

    const riskReason = getRiskReason({
      category: asset.category,
      platform: asset.platform,
      riskLevel: asset.riskLevel,
      details: asset.details as Record<string, unknown> | null,
    });
    const requiredInfo = extractRequiredInfo({
      category: asset.category,
      platform: asset.platform,
      suggestedMigration: asset.suggestedMigration,
      details: asset.details as Record<string, unknown> | null,
    });

    return {
      id: `checklist-${asset.id}`,
      assetId: asset.id,
      title: asset.displayName || `${asset.category} - ${asset.platform || "未知"}`,
      description: getMigrationDescription(asset as AuditAsset),
      category: asset.category,
      platform: asset.platform || undefined,
      riskLevel: asset.riskLevel as "high" | "medium" | "low",
      riskReason,
      suggestedMigration: asset.suggestedMigration as
        | "web_pixel"
        | "ui_extension"
        | "server_side"
        | "none",
      priority,
      estimatedTime,
      requiredInfo,
      status: asset.migrationStatus as
        | "pending"
        | "in_progress"
        | "completed"
        | "skipped",
      fingerprint: asset.fingerprint || null,
    };
  }));

  const dependencyMap = new Map<string, string[]>();
  const dependentsMap = new Map<string, string[]>();

  assets.forEach(asset => {
    const deps = (asset.dependencies as string[] | null) || [];
    dependencyMap.set(asset.id, deps);
    deps.forEach(depId => {
      if (!dependentsMap.has(depId)) {
        dependentsMap.set(depId, []);
      }
      dependentsMap.get(depId)!.push(asset.id);
    });
  });

  const inDegree = new Map<string, number>();
  items.forEach(item => {
    const deps = dependencyMap.get(item.assetId) || [];
    inDegree.set(item.assetId, deps.filter(depId =>
      items.some(i => i.assetId === depId)
    ).length);
  });

  const topologicalOrder: string[] = [];
  const queue: string[] = [];

  inDegree.forEach((degree, assetId) => {
    if (degree === 0) {
      queue.push(assetId);
    }
  });

  while (queue.length > 0) {
    const assetId = queue.shift();

    if (assetId === undefined) {
      break;
    }
    topologicalOrder.push(assetId);

    const dependents = dependentsMap.get(assetId) || [];
    dependents.forEach(depId => {
      const current = inDegree.get(depId) ?? 0;
      inDegree.set(depId, Math.max(0, current - 1));
      if (inDegree.get(depId) === 0) {
        queue.push(depId);
      }
    });
  }

  const topologicalIndex = new Map<string, number>();
  topologicalOrder.forEach((assetId, index) => {
    topologicalIndex.set(assetId, index);
  });

  items.sort((a, b) => {

    const priorityDiff = b.priority - a.priority;
    if (Math.abs(priorityDiff) > 0.5) {
      return priorityDiff;
    }

    const aTopoIndex = topologicalIndex.get(a.assetId) ?? 999;
    const bTopoIndex = topologicalIndex.get(b.assetId) ?? 999;
    if (aTopoIndex !== bTopoIndex) {
      return aTopoIndex - bTopoIndex;
    }

    const aAsset = assets.find(asset => asset.id === a.assetId);
    const bAsset = assets.find(asset => asset.id === b.assetId);

    if (aAsset && bAsset) {
      const aIsDependencyOf = (dependentsMap.get(aAsset.id) || []).length > 0;
      const bIsDependencyOf = (dependentsMap.get(bAsset.id) || []).length > 0;

      if (aIsDependencyOf && !bIsDependencyOf) return -1;
      if (!aIsDependencyOf && bIsDependencyOf) return 1;
    }

    const riskOrder = { high: 3, medium: 2, low: 1 };
    return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
  });

  const highPriorityItems = items.filter((i) => i.riskLevel === "high").length;
  const mediumPriorityItems = items.filter((i) => i.riskLevel === "medium").length;
  const lowPriorityItems = items.filter((i) => i.riskLevel === "low").length;
  const estimatedTotalTime = items.reduce((sum, item) => sum + item.estimatedTime, 0);

  return {
    shopId,
    totalItems: items.length,
    highPriorityItems,
    mediumPriorityItems,
    lowPriorityItems,
    estimatedTotalTime,
    items,
    generatedAt: new Date(),
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

export async function getMigrationChecklist(
  shopId: string,
  forceRefresh = false
): Promise<MigrationChecklist> {

  if (forceRefresh) {
    return generateMigrationChecklist(shopId);
  }

  const recentScan = await prisma.scanReport.findFirst({
    where: {
      shopId,
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      status: "completed",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (recentScan) {
    return generateMigrationChecklist(shopId);
  }

  return {
    shopId,
    totalItems: 0,
    highPriorityItems: 0,
    mediumPriorityItems: 0,
    lowPriorityItems: 0,
    estimatedTotalTime: 0,
    items: [],
    generatedAt: new Date(),
  };
}

export async function updateChecklistItemStatus(
  assetId: string,
  status: "pending" | "in_progress" | "completed" | "skipped"
): Promise<void> {
  await prisma.auditAsset.update({
    where: { id: assetId },
    data: {
      migrationStatus: status,
      migratedAt: status === "completed" ? new Date() : undefined,
    },
  });
}
