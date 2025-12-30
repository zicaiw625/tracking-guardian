

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { AuditAsset } from "@prisma/client";

export interface MigrationChecklistItem {
  id: string;
  assetId: string;
  title: string;
  description: string;
  category: string;
  platform?: string;
  riskLevel: "high" | "medium" | "low";
  suggestedMigration: "web_pixel" | "ui_extension" | "server_side" | "none";
  priority: number;
  estimatedTime: number;
  status: "pending" | "in_progress" | "completed" | "skipped";
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

/**
 * 增强的优先级计算算法
 * 考虑风险等级、依赖关系、迁移难度、影响范围等因素
 */
function calculatePriority(
  asset: AuditAsset,
  category: string,
  allAssets: AuditAsset[] = []
): number {
  // 如果资产已有计算的优先级，直接使用
  if (asset.priority !== null && asset.priority !== undefined) {
    return asset.priority;
  }

  let priority = 5; // 基础优先级

  // 风险等级加权（最重要因素）
  const riskWeights: Record<string, number> = {
    high: 3.5,
    medium: 1.5,
    low: 0.5,
  };
  priority += riskWeights[asset.riskLevel] || 1.5;

  // 类别重要性加权
  const categoryWeights: Record<string, number> = {
    pixel: 2.0,      // 像素追踪最重要
    affiliate: 1.5,  // 联盟追踪重要
    survey: 0.8,     // 问卷中等重要
    support: 0.6,    // 客服支持中等重要
    analytics: 0.4,  // 分析工具较低
    other: 0.5,
  };
  priority += categoryWeights[category] || 0.5;

  // 平台重要性加权
  const criticalPlatforms = ["google", "meta", "tiktok"];
  const importantPlatforms = ["pinterest", "snapchat"];
  if (asset.platform) {
    if (criticalPlatforms.includes(asset.platform)) {
      priority += 1.5; // 关键平台
    } else if (importantPlatforms.includes(asset.platform)) {
      priority += 0.8; // 重要平台
    }
  }

  // 来源类型加权（商家确认的优先级更高）
  const sourceWeights: Record<string, number> = {
    merchant_confirmed: 1.5,
    api_scan: 0.8,
    manual_paste: 0.5,
  };
  priority += sourceWeights[asset.sourceType] || 0.5;

  // 迁移状态加权
  if (asset.migrationStatus === "pending") {
    priority += 0.5;
  } else if (asset.migrationStatus === "in_progress") {
    priority += 0.3; // 进行中的项优先级稍低（避免重复处理）
  }

  // 迁移难度加权（难度低的优先，因为可以快速完成）
  const migrationDifficultyWeights: Record<string, number> = {
    web_pixel: 0.5,      // 相对简单
    ui_extension: 0.3,   // 中等难度
    server_side: -0.2,   // 较复杂，优先级稍低
    none: -1.0,          // 无需迁移，优先级最低
  };
  priority += migrationDifficultyWeights[asset.suggestedMigration] || 0;

  // 依赖关系加权（有依赖的项优先级更高，因为阻塞其他项）
  const dependencies = (asset.dependencies as string[] | null) || [];
  if (dependencies.length > 0) {
    // 检查依赖项是否已完成
    const incompleteDeps = dependencies.filter(depId => {
      const depAsset = allAssets.find(a => a.id === depId);
      return depAsset && depAsset.migrationStatus !== "completed";
    });
    if (incompleteDeps.length > 0) {
      priority += 1.0; // 有未完成的依赖，优先级提高
    }
  }

  // 检查是否有其他资产依赖此资产（被依赖的项优先级更高）
  const isDependencyOf = allAssets.some(a => {
    const deps = (a.dependencies as string[] | null) || [];
    return deps.includes(asset.id) && a.migrationStatus !== "completed";
  });
  if (isDependencyOf) {
    priority += 1.2; // 被其他项依赖，优先级显著提高
  }

  // 影响范围加权
  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const displayScope = details.display_scope as string | undefined;
    if (displayScope === "order_status") {
      priority += 0.8; // 影响订单状态页
    } else if (displayScope === "checkout") {
      priority += 1.0; // 影响结账流程
    }
  }

  // 增强的风险评分（如果存在）
  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const enhancedRiskScore = details.enhancedRiskScore as number | undefined;
    if (enhancedRiskScore && enhancedRiskScore >= 70) {
      priority += 0.5; // 高风险评分额外加权
    }
  }

  return Math.min(10, Math.max(1, Math.round(priority * 10) / 10));
}

/**
 * 增强的时间估算算法
 * 基于类别、迁移类型、平台、复杂度、依赖关系等因素
 */
function estimateMigrationTime(
  category: string,
  suggestedMigration: string,
  platform?: string,
  riskLevel?: string,
  hasDependencies?: boolean,
  complexity?: number
): number {
  // 如果资产已有估算时间，直接使用
  // 这里作为 fallback 函数，实际应该从 asset.estimatedTimeMinutes 获取

  // 基础时间（分钟）- 基于历史数据
  const baseTimes: Record<string, Record<string, number>> = {
    pixel: {
      web_pixel: 12,      // 优化后通常 10-15 分钟
      server_side: 25,    // 需要配置 API，通常 20-30 分钟
      none: 0,
    },
    survey: {
      ui_extension: 15,   // 需要配置表单，通常 12-20 分钟
      none: 0,
    },
    support: {
      ui_extension: 8,    // 相对简单，通常 5-10 分钟
      none: 0,
    },
    affiliate: {
      web_pixel: 18,      // 需要配置追踪参数，通常 15-25 分钟
      server_side: 30,    // 需要服务端集成，通常 25-35 分钟
      none: 0,
    },
    analytics: {
      web_pixel: 10,      // 分析工具通常较简单
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

  // 平台复杂度调整
  if (platform) {
    const complexPlatforms = ["google", "meta"]; // 需要更多配置的平台
    if (complexPlatforms.includes(platform) && suggestedMigration === "server_side") {
      migrationTime += 8; // 需要配置 API 密钥等
    } else if (platform === "tiktok" && suggestedMigration === "server_side") {
      migrationTime += 5; // TikTok API 相对简单
    }
  }

  // 风险等级调整（高风险需要更多测试时间）
  if (riskLevel === "high") {
    migrationTime = Math.round(migrationTime * 1.25); // 增加 25% 测试时间
  } else if (riskLevel === "low") {
    migrationTime = Math.round(migrationTime * 0.9); // 减少 10%
  }

  // 复杂度调整
  if (complexity !== undefined) {
    const complexityMultiplier = 1 + (complexity / 20) * 0.4; // 最多增加 40%
    migrationTime = Math.round(migrationTime * complexityMultiplier);
  }

  // 依赖关系调整（有依赖的项可能需要等待，但不增加实际工作时间）
  // 这里只考虑依赖项可能带来的额外协调时间
  if (hasDependencies) {
    migrationTime += 3; // 依赖项可能带来额外协调时间
  }

  // 最少 5 分钟，最多 120 分钟
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
    orderBy: {
      createdAt: "desc",
    },
  });

  const items: MigrationChecklistItem[] = assets.map((asset) => {
    // 优先使用数据库中的priority和estimatedTimeMinutes字段
    // 如果没有，则使用增强的fallback计算
    const dependencies = (asset.dependencies as string[] | null) || [];
    const hasDependencies = dependencies.length > 0;
    
    // 计算复杂度（基于详情中的信息）
    let complexity = 5; // 默认中等复杂度
    if (asset.details && typeof asset.details === "object") {
      const details = asset.details as Record<string, unknown>;
      const matchedPatterns = details.matchedPatterns as string[] | undefined;
      if (matchedPatterns && matchedPatterns.length > 3) {
        complexity = 8; // 多个匹配模式表示复杂度高
      }
    }

    const priority = asset.priority ?? calculatePriority(asset, asset.category, assets);
    const estimatedTime = asset.estimatedTimeMinutes ?? estimateMigrationTime(
      asset.category,
      asset.suggestedMigration,
      asset.platform || undefined,
      asset.riskLevel,
      hasDependencies,
      complexity
    );

    return {
      id: `checklist-${asset.id}`,
      assetId: asset.id,
      title: asset.displayName || `${asset.category} - ${asset.platform || "未知"}`,
      description: getMigrationDescription(asset),
      category: asset.category,
      platform: asset.platform || undefined,
      riskLevel: asset.riskLevel as "high" | "medium" | "low",
      suggestedMigration: asset.suggestedMigration as
        | "web_pixel"
        | "ui_extension"
        | "server_side"
        | "none",
      priority,
      estimatedTime,
      status: asset.migrationStatus as
        | "pending"
        | "in_progress"
        | "completed"
        | "skipped",
    };
  });

  // 增强的排序算法：考虑优先级、依赖关系、风险等级、拓扑顺序
  // 首先构建依赖图，确定拓扑顺序
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
  
  // 拓扑排序：确定最优迁移顺序
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
    const assetId = queue.shift()!;
    topologicalOrder.push(assetId);
    
    const dependents = dependentsMap.get(assetId) || [];
    dependents.forEach(depId => {
      const current = inDegree.get(depId) || 0;
      inDegree.set(depId, Math.max(0, current - 1));
      if (inDegree.get(depId) === 0) {
        queue.push(depId);
      }
    });
  }
  
  // 构建拓扑顺序索引
  const topologicalIndex = new Map<string, number>();
  topologicalOrder.forEach((assetId, index) => {
    topologicalIndex.set(assetId, index);
  });
  
  // 增强的排序算法
  items.sort((a, b) => {
    // 首先按优先级排序（优先级高的在前）
    const priorityDiff = b.priority - a.priority;
    if (Math.abs(priorityDiff) > 0.5) {
      return priorityDiff;
    }
    
    // 如果优先级相近，按拓扑顺序排序（依赖项在前）
    const aTopoIndex = topologicalIndex.get(a.assetId) ?? 999;
    const bTopoIndex = topologicalIndex.get(b.assetId) ?? 999;
    if (aTopoIndex !== bTopoIndex) {
      return aTopoIndex - bTopoIndex;
    }
    
    // 如果拓扑顺序相同，检查是否被其他项依赖
    const aAsset = assets.find(asset => asset.id === a.assetId);
    const bAsset = assets.find(asset => asset.id === b.assetId);
    
    if (aAsset && bAsset) {
      const aIsDependencyOf = (dependentsMap.get(aAsset.id) || []).length > 0;
      const bIsDependencyOf = (dependentsMap.get(bAsset.id) || []).length > 0;
      
      if (aIsDependencyOf && !bIsDependencyOf) return -1;
      if (!aIsDependencyOf && bIsDependencyOf) return 1;
    }
    
    // 如果优先级、拓扑顺序和依赖关系都相同，按风险等级排序
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

