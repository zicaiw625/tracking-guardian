import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
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
  reasoningKeys: { key: string; params?: Record<string, any> }[];
}

export function calculatePriority(factors: PriorityFactors): PriorityResult {
  const reasoning: string[] = [];
  const reasoningKeys: { key: string; params?: Record<string, any> }[] = [];
  let priorityScore = 5;
  switch (factors.riskLevel) {
    case "high":
      priorityScore += 3.5;
      reasoning.push("High-risk item: likely to break or be restricted, must be prioritized.");
      reasoningKeys.push({ key: "scan.priority.reason.highRisk" });
      break;
    case "medium":
      priorityScore += 1.2;
      reasoning.push("Medium-risk item: can be replaced directly, recommended to handle soon.");
      reasoningKeys.push({ key: "scan.priority.reason.mediumRisk" });
      break;
    case "low":
      priorityScore -= 0.8;
      reasoning.push("Low-risk item: migration is not urgent and can be deferred.");
      reasoningKeys.push({ key: "scan.priority.reason.lowRisk" });
      break;
  }
  switch (factors.impactScope) {
    case "order_status":
      priorityScore += 2.5;
      reasoning.push("Affects order status page: primary target of Shopify deprecation, highest priority.");
      reasoningKeys.push({ key: "scan.priority.reason.orderStatus" });
      break;
    case "checkout":
      priorityScore += 1.5;
      reasoning.push("Affects checkout flow: critical conversion step, high priority.");
      reasoningKeys.push({ key: "scan.priority.reason.checkout" });
      break;
    case "all_pages":
      priorityScore += 0.8;
      reasoning.push("Affects site-wide behavior: broad impact, medium priority.");
      reasoningKeys.push({ key: "scan.priority.reason.allPages" });
      break;
    case "other":
      priorityScore += 0.2;
      reasoning.push("Affects other pages: lower priority.");
      reasoningKeys.push({ key: "scan.priority.reason.otherPages" });
      break;
  }
  switch (factors.migrationDifficulty) {
    case "easy":
      priorityScore += 0.8;
      reasoning.push("Easy migration: direct replacement possible, recommended to complete early.");
      reasoningKeys.push({ key: "scan.priority.reason.easyMigration" });
      break;
    case "medium":
      priorityScore += 0;
      reasoning.push("Medium migration complexity: requires moderate setup time.");
      reasoningKeys.push({ key: "scan.priority.reason.mediumMigration" });
      break;
    case "hard":
      priorityScore -= 0.5;
      reasoning.push("Hard migration: requires more evaluation and setup time.");
      reasoningKeys.push({ key: "scan.priority.reason.hardMigration" });
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
      reasoning.push("Plus merchant auto-upgrade has started: take action immediately.");
      reasoningKeys.push({ key: "scan.priority.reason.plusAutoUpgradeStarted" });
    } else if (daysUntilAutoUpgrade <= 30) {
      priorityScore += 2;
      reasoning.push(`Plus auto-upgrade countdown: ${daysUntilAutoUpgrade} days remaining.`);
      reasoningKeys.push({ key: "scan.priority.reason.plusAutoUpgradeCountdown", params: { days: daysUntilAutoUpgrade } });
    } else if (daysUntilAutoUpgrade <= 90) {
      priorityScore += 1;
      reasoning.push(`Plus auto-upgrade countdown: ${daysUntilAutoUpgrade} days remaining.`);
      reasoningKeys.push({ key: "scan.priority.reason.plusAutoUpgradeCountdown", params: { days: daysUntilAutoUpgrade } });
    }
  } else if (factors.shopTier === "non_plus") {
    const now = new Date();
    const nonPlusDeadline = DEPRECATION_DATES.scriptTagBlocked;
    const daysUntilDeadline = Math.ceil(
      (nonPlusDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntilDeadline <= 30) {
      priorityScore += 2;
      reasoning.push(`Non-Plus merchant deadline: ${daysUntilDeadline} days remaining.`);
      reasoningKeys.push({ key: "scan.priority.reason.nonPlusDeadline", params: { days: daysUntilDeadline } });
    } else if (daysUntilDeadline <= 90) {
      priorityScore += 1;
      reasoning.push(`Non-Plus merchant deadline: ${daysUntilDeadline} days remaining.`);
      reasoningKeys.push({ key: "scan.priority.reason.nonPlusDeadline", params: { days: daysUntilDeadline } });
    }
  }
  if (factors.hasDependencies) {
    if (factors.daysUntilDeadline && factors.daysUntilDeadline <= 30) {
      priorityScore += 1.5;
      reasoning.push(`Has dependencies and deadline is close (${factors.daysUntilDeadline} days): requires prompt action.`);
      reasoningKeys.push({ key: "scan.priority.reason.dependenciesUrgent", params: { days: factors.daysUntilDeadline } });
    } else {
      priorityScore += 0.3;
      reasoning.push("Has dependencies: dependent items should be handled first.");
      reasoningKeys.push({ key: "scan.priority.reason.dependencies" });
    }
  }
  if (factors.impactScope === "order_status" && factors.riskLevel === "high") {
    priorityScore += 1.2;
    reasoning.push("Combined factors: order status page + high risk = highest priority.");
    reasoningKeys.push({ key: "scan.priority.reason.comboOrderStatusHighRisk" });
  }
  if (factors.impactScope === "checkout" && factors.riskLevel === "high") {
    priorityScore += 0.8;
    reasoning.push("Combined factors: checkout flow + high risk = high priority.");
    reasoningKeys.push({ key: "scan.priority.reason.comboCheckoutHighRisk" });
  }
  if (factors.migrationDifficulty === "easy" && factors.riskLevel === "high") {
    priorityScore += 0.5;
    reasoning.push("Combined factors: easy migration + high risk = quick high-risk resolution.");
    reasoningKeys.push({ key: "scan.priority.reason.comboEasyHighRisk" });
  }
  priorityScore = Math.max(1, Math.min(10, Math.round(priorityScore * 10) / 10));
  let estimatedTime = 15;
  switch (factors.migrationDifficulty) {
    case "easy":
      estimatedTime = 8;
      break;
    case "medium":
      estimatedTime = 18;
      break;
    case "hard":
      estimatedTime = 32;
      break;
  }
  if (factors.riskLevel === "high") {
    estimatedTime += 10;
    reasoning.push("High-risk items need extra validation time: +10 minutes.");
    reasoningKeys.push({ key: "scan.priority.reason.extraTimeHighRisk" });
  } else if (factors.riskLevel === "low") {
    estimatedTime -= 2;
  }
  switch (factors.impactScope) {
    case "order_status":
      estimatedTime += 3;
      break;
    case "checkout":
      estimatedTime += 5;
      break;
    case "all_pages":
      estimatedTime += 8;
      break;
    case "other":
      estimatedTime += 1;
      break;
  }
  if (factors.hasDependencies) {
    estimatedTime += 3;
  }
  if (factors.shopTier === "plus") {
    estimatedTime += 2;
  }
  return {
    priority: priorityScore,
    estimatedTimeMinutes: Math.max(5, Math.round(estimatedTime)),
    dependencies: [],
    reasoning,
    reasoningKeys,
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
      select: { id: true, riskLevel: true, suggestedMigration: true },
      take: 5,
    });
    if (asset.suggestedMigration === "ui_extension") {
      const webPixelAssets = relatedAssets.filter(
        (a) => a.suggestedMigration === "web_pixel" || asset.category === "pixel"
      );
      if (webPixelAssets.length > 0) {
        dependencies.push(...webPixelAssets.map((a) => a.id));
      }
    }
    if (asset.suggestedMigration === "server_side") {
      const webPixelAssets = relatedAssets.filter(
        (a) => a.suggestedMigration === "web_pixel"
      );
      if (webPixelAssets.length > 0) {
        dependencies.push(...webPixelAssets.map((a) => a.id));
      }
    }
    const highRiskAssets = relatedAssets.filter((a) => a.riskLevel === "high");
    if (asset.riskLevel !== "high" && highRiskAssets.length > 0) {
      // no-op: reserved for future dep boost when high-risk deps exist
    }
  }
  const existingAsset = await prisma.auditAsset.findUnique({
    where: { id: asset.id },
    select: { dependencies: true },
  });
  if (existingAsset?.dependencies && Array.isArray(existingAsset.dependencies)) {
    const existingDeps = existingAsset.dependencies as string[];
    dependencies.push(...existingDeps.filter((id) => !dependencies.includes(id)));
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
    select: {
      id: true,
      category: true,
      riskLevel: true,
      migrationStatus: true,
      suggestedMigration: true,
      platform: true,
      dependencies: true,
      details: true,
    },
    orderBy: [
      { riskLevel: "desc" },
      { createdAt: "asc" },
    ],
  });
  const priorityResults = new Map<string, PriorityResult>();
  for (const asset of assets) {
    try {
      const priorityResult = await calculateAssetPriority(asset.id, shopTier, shopId);
      if (priorityResult) {
        priorityResults.set(asset.id, priorityResult);
      }
    } catch (error) {
      logger.error(`Failed to calculate priority for asset ${asset.id}:`, error);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [assetId, result] of priorityResults.entries()) {
    if (result.dependencies.length > 0) {
      const dependencyPriorities = result.dependencies
        .map((depId) => priorityResults.get(depId)?.priority || 0)
        .filter((p) => p > 0);
      if (dependencyPriorities.length > 0) {
        const maxDepPriority = Math.max(...dependencyPriorities);
        if (maxDepPriority >= 8 && result.priority < maxDepPriority) {
          result.priority = Math.min(10, result.priority + 1);
          result.reasoning.push(`Depends on a high-priority item (priority ${maxDepPriority}); priority increased.`);
        }
      }
    }
  }
  for (const [assetId, priorityResult] of priorityResults.entries()) {
    try {
      await prisma.auditAsset.update({
        where: { id: assetId },
        data: {
          priority: priorityResult.priority,
          estimatedTimeMinutes: priorityResult.estimatedTimeMinutes,
          dependencies: priorityResult.dependencies.length > 0
            ? priorityResult.dependencies
            : undefined,
        },
      });
    } catch (error) {
      logger.error(`Failed to update priority for asset ${assetId}:`, error);
    }
  }
}

export interface MigrationTimelineAsset {
  asset: {
    id: string;
    displayName: string | null;
    platform: string | null;
    category: string;
    riskLevel: string;
    migrationStatus: string;
    priority: number | null;
    estimatedTimeMinutes: number | null;
    dependencies: unknown;
  };
  priority: {
    priority: number;
    estimatedTime: number;
    reason: string;
    reasonKey?: string;
    reasonParams?: Record<string, any>;
  };
  canStart: boolean;
  blockingDependencies: string[];
}

export interface MigrationTimeline {
  shopId: string;
  assets: MigrationTimelineAsset[];
  totalEstimatedTime: number;
  criticalPath: string[];
  generatedAt: Date;
}

export async function generateMigrationTimeline(
  shopId: string
): Promise<MigrationTimeline> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopTier: true },
  });
  const shopTier = (shop?.shopTier as "plus" | "non_plus" | null) || null;
  await calculateAllAssetPriorities(shopId, shopTier);
  const assets = await prisma.auditAsset.findMany({
    where: {
      shopId,
      migrationStatus: { not: "completed" },
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
    },
    orderBy: [
      { priority: "desc" },
      { riskLevel: "desc" },
      { createdAt: "asc" },
    ],
  });
  const dependencyMap = new Map<string, string[]>();
  const dependentsMap = new Map<string, string[]>();
  assets.forEach((asset: any) => {
    if (asset.dependencies && Array.isArray(asset.dependencies)) {
      const deps = asset.dependencies as string[];
      dependencyMap.set(asset.id, deps);
      deps.forEach((depId: string) => {
        const dependents = dependentsMap.get(depId) || [];
        dependents.push(asset.id);
        dependentsMap.set(depId, dependents);
      });
    }
  });
  const completedAssetIds = new Set(
    (await prisma.auditAsset.findMany({
      where: {
        shopId,
        migrationStatus: "completed",
      },
      select: { id: true },
    })).map((a: { id: string }) => a.id)
  );
  const timelineAssets: MigrationTimelineAsset[] = assets.map((asset: any) => {
    const dependencies = (asset.dependencies as string[]) || [];
    const blockingDeps = dependencies.filter((depId: string) => !completedAssetIds.has(depId));
    const canStart = blockingDeps.length === 0;
    return {
      asset: {
        id: asset.id,
        displayName: asset.displayName,
        platform: asset.platform,
        category: asset.category,
        riskLevel: asset.riskLevel,
        migrationStatus: asset.migrationStatus,
        priority: asset.priority,
        estimatedTimeMinutes: asset.estimatedTimeMinutes,
        dependencies: asset.dependencies,
      },
      priority: {
        priority: asset.priority || 5,
        estimatedTime: asset.estimatedTimeMinutes || 15,
        reason: dependencies.length > 0
          ? `Blocked by ${blockingDeps.length} incomplete migration item(s).`
          : asset.riskLevel === "high"
            ? "High-risk item, prioritize first."
            : "Ready to start migration.",
        reasonKey: dependencies.length > 0
          ? "scan.priority.reason.blockingDependencies"
          : asset.riskLevel === "high"
            ? "scan.priority.reason.highRisk"
            : "scan.priority.reason.readyToStart",
        reasonParams: dependencies.length > 0 ? { count: blockingDeps.length } : undefined,
      },
      canStart,
      blockingDependencies: blockingDeps,
    };
  });
  const criticalPath: string[] = [];
  const visited = new Set<string>();
  function findLongestPath(assetId: string, path: string[]): string[] {
    if (visited.has(assetId)) return path;
    visited.add(assetId);
    const deps = dependencyMap.get(assetId) || [];
    if (deps.length === 0) {
      if (path.length > criticalPath.length) {
        criticalPath.length = 0;
        criticalPath.push(...path, assetId);
      }
      return path;
    }
    let longestPath = path;
    deps.forEach((depId) => {
      const depPath = findLongestPath(depId, [...path, assetId]);
      if (depPath.length > longestPath.length) {
        longestPath = depPath;
      }
    });
    return longestPath;
  }
  assets.forEach((asset) => {
    if (!visited.has(asset.id)) {
      findLongestPath(asset.id, []);
    }
  });
  const totalEstimatedTime = timelineAssets.reduce(
    (sum, item) => sum + item.priority.estimatedTime,
    0
  );
  return {
    shopId,
    assets: timelineAssets,
    totalEstimatedTime,
    criticalPath,
    generatedAt: new Date(),
  };
}

export interface MigrationProgress {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  completionRate: number;
  estimatedRemainingMinutes: number;
}

export async function getMigrationProgress(shopId: string): Promise<MigrationProgress> {
  const assets = await prisma.auditAsset.findMany({
    where: { shopId },
    select: {
      migrationStatus: true,
      estimatedTimeMinutes: true,
    },
  });
  const total = assets.length;
  const completed = assets.filter((a: any) => a.migrationStatus === "completed").length;
  const inProgress = assets.filter((a: any) => a.migrationStatus === "in_progress").length;
  const pending = assets.filter((a: any) => a.migrationStatus === "pending").length;
  const remainingAssets = assets.filter(
    (a: any) => a.migrationStatus !== "completed"
  );
  const estimatedRemainingMinutes = remainingAssets.reduce(
    (sum: number, a: any) => sum + (a.estimatedTimeMinutes || 15),
    0
  );
  return {
    total,
    completed,
    inProgress,
    pending,
    completionRate: total > 0 ? (completed / total) * 100 : 0,
    estimatedRemainingMinutes,
  };
}
