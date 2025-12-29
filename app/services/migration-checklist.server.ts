

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

function calculatePriority(
  asset: AuditAsset,
  category: string
): number {
  let priority = 5;

  if (asset.riskLevel === "high") {
    priority = 9;
  } else if (asset.riskLevel === "medium") {
    priority = 6;
  } else {
    priority = 3;
  }

  if (category === "pixel") {
    priority += 1;
  } else if (category === "affiliate") {
    priority += 0.5;
  } else if (category === "survey" || category === "support") {
    priority += 0.3;
  }

  const criticalPlatforms = ["google", "meta", "tiktok"];
  if (asset.platform && criticalPlatforms.includes(asset.platform)) {
    priority += 1;
  }

  if (asset.sourceType === "merchant_confirmed") {
    priority += 1.5;
  } else if (asset.sourceType === "api_scan") {
    priority += 0.5;
  }

  if (asset.migrationStatus === "pending") {
    priority += 0.3;
  } else if (asset.migrationStatus === "in_progress") {
    priority += 0.1;
  }

  if (asset.suggestedMigration === "web_pixel") {
    priority += 0.3;
  } else if (asset.suggestedMigration === "server_side") {
    priority -= 0.2;
  }

  if (asset.details && typeof asset.details === "object") {
    const details = asset.details as Record<string, unknown>;
    const displayScope = details.display_scope as string | undefined;
    if (displayScope === "order_status") {
      priority += 1;
    }
  }

  return Math.min(10, Math.max(1, Math.round(priority * 10) / 10));
}

function estimateMigrationTime(
  category: string,
  suggestedMigration: string,
  platform?: string
): number {

  const baseTimes: Record<string, Record<string, number>> = {
    pixel: {
      web_pixel: 15,
      server_side: 20,
      none: 0,
    },
    survey: {
      ui_extension: 10,
      none: 0,
    },
    support: {
      ui_extension: 5,
      none: 0,
    },
    affiliate: {
      web_pixel: 20,
      none: 0,
    },
    other: {
      web_pixel: 15,
      ui_extension: 10,
      server_side: 20,
      none: 0,
    },
  };

  const categoryTimes = baseTimes[category] || baseTimes.other;
  const migrationTime = categoryTimes[suggestedMigration] || 15;

  if (platform === "google" && suggestedMigration === "server_side") {
    return migrationTime + 5;
  }

  return migrationTime;
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
    const priority = calculatePriority(asset, asset.category);
    const estimatedTime = estimateMigrationTime(
      asset.category,
      asset.suggestedMigration,
      asset.platform || undefined
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

  items.sort((a, b) => b.priority - a.priority);

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

