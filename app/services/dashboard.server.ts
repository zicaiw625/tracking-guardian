import prisma from "../db.server";
import { getPlanDefinition, normalizePlan } from "../utils/plans";
import { generateMigrationTimeline } from "./migration-priority.server";
import { getMigrationChecklist } from "./migration-checklist.server";
import { analyzeDependencies } from "./dependency-analysis.server";
import { getAuditAssetSummary } from "./audit-asset.server";
import { getEventMonitoringStats, getEventVolumeStats } from "./monitoring.server";
import { logger } from "../utils/logger.server";
import { calculateMigrationProgress } from "../utils/migration-progress.server";
import { getTierDisplayInfo } from "./shop-tier.server";
import { isValidShopTier } from "../domain/shop/shop.entity";
import { rejectionTracker } from "../lib/pixel-events/rejection-tracker.server";

export type {
  DashboardData,
  SetupStep,
  HealthStatus,
  UpgradeStatus,
  MigrationProgress,
} from "../types/dashboard";

export {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
} from "../types/dashboard";

import type { DashboardData, HealthStatus, UpgradeStatus } from "../types/dashboard";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function calculateHealthScore(
  shopId: string,
  recentReports: Array<{ orderDiscrepancy: number }>,
  configuredPlatforms: number
): Promise<{ score: number | null; status: HealthStatus; factors: { label: string; value: number; weight: number }[] }> {
  if (recentReports.length === 0 || configuredPlatforms === 0) {
    return { score: null, status: "uninitialized", factors: [] };
  }
  const factors: { label: string; value: number; weight: number }[] = [];
  const avgDiscrepancy =
    recentReports.length > 0
      ? recentReports.reduce((sum, r) => sum + r.orderDiscrepancy, 0) / recentReports.length
      : 0;
  const discrepancyScore = Math.max(0, 100 - (avgDiscrepancy * 500));
  factors.push({ label: "对账一致性", value: discrepancyScore, weight: 0.45 });
  try {
    const stats = await getEventMonitoringStats(shopId, 24 * 7);
    const successRateScore = stats.successRate || 0;
    factors.push({ label: "事件成功率", value: successRateScore, weight: 0.35 });
  } catch (error) {
    logger.warn("Failed to get event monitoring stats for health score", { shopId, error });
    factors.push({ label: "事件成功率", value: 100, weight: 0.35 });
  }
  try {
    const volumeStats = await getEventVolumeStats(shopId);
    let volumeScore = 100;
    const isDrop = volumeStats.changePercent < 0;
    if (isDrop && Math.abs(volumeStats.changePercent || 0) > 50) {
      volumeScore = 50;
    } else if (isDrop && Math.abs(volumeStats.changePercent || 0) > 30) {
      volumeScore = 75;
    }
    factors.push({ label: "事件量稳定性", value: volumeScore, weight: 0.2 });
  } catch (error) {
    logger.warn("Failed to get event volume stats for health score", { shopId, error });
    factors.push({ label: "事件量稳定性", value: 100, weight: 0.2 });
  }
  const totalScore = factors.reduce((sum, factor) => sum + (factor.value * factor.weight), 0);
  const roundedScore = Math.round(totalScore);
  let status: HealthStatus;
  if (roundedScore >= 90) {
    status = "success";
  } else if (roundedScore >= 70) {
    status = "warning";
  } else if (roundedScore >= 50) {
    status = "warning";
  } else {
    status = "critical";
  }
  return { score: roundedScore, status, factors };
}

function analyzeScriptTags(
  scriptTags: unknown
): { count: number; hasOrderStatusScripts: boolean } {
  if (!scriptTags || !Array.isArray(scriptTags)) {
    return { count: 0, hasOrderStatusScripts: false };
  }
  const tags = scriptTags as Array<{ display_scope?: string }>;
  return {
    count: tags.length,
    hasOrderStatusScripts: tags.some((tag) => tag.display_scope === "order_status"),
  };
}

export async function getDashboardData(shopDomain: string): Promise<DashboardData> {
  let shop;
  try {
    shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
        shopDomain: true,
        plan: true,
        shopTier: true,
        typOspPagesEnabled: true,
        installedAt: true,
        settings: true,
        ScanReports: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            status: true,
            riskScore: true,
            createdAt: true,
            identifiedPlatforms: true,
            scriptTags: true,
          },
        },
        pixelConfigs: {
          where: { isActive: true },
          select: { id: true, serverSideEnabled: true, credentialsEncrypted: true },
        },
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("settings") && (error.message.includes("does not exist") || error.message.includes("P2022")))) {
      logger.error("Shop.settings column does not exist. Database migration required. Please run: ALTER TABLE \"Shop\" ADD COLUMN IF NOT EXISTS \"settings\" JSONB;", { shopDomain, error: error.message });
      shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          shopDomain: true,
          plan: true,
          shopTier: true,
          typOspPagesEnabled: true,
          installedAt: true,
          ScanReports: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
              riskScore: true,
              createdAt: true,
              identifiedPlatforms: true,
              scriptTags: true,
            },
          },
          pixelConfigs: {
            where: { isActive: true },
            select: { id: true, serverSideEnabled: true, credentialsEncrypted: true },
          },
        },
      });
      if (shop) {
        (shop as { settings?: unknown }).settings = null;
      }
    } else {
      throw error;
    }
  }
  if (!shop) {
    return {
      shopDomain,
      healthScore: null,
      healthStatus: "uninitialized",
      latestScan: null,
      configuredPlatforms: 0,
      weeklyConversions: 0,
      hasAlertConfig: false,
      hasEnabledPixelConfig: false,
      plan: "free",
      planId: "free",
      planLabel: getPlanDefinition("free").name,
      planTagline: getPlanDefinition("free").tagline,
      planFeatures: getPlanDefinition("free").features,
      scriptTagsCount: 0,
      hasOrderStatusScripts: false,
    };
  }
  const configuredPlatforms = shop.pixelConfigs?.length || 0;
  let weeklyConversions = 0;
  try {
    const { getAggregatedMetrics } = await import("./dashboard-aggregation.server");
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const aggregated = await getAggregatedMetrics(shop.id, sevenDaysAgo, new Date());
    weeklyConversions = aggregated.totalOrders;
  } catch (error) {
    logger.debug("Failed to get aggregated metrics, using default value", {
      shopId: shop.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const enabledPixelConfigsCount = shop.pixelConfigs?.length || 0;
  const hasEnabledPixelConfig = enabledPixelConfigsCount > 0;
  const settings = (shop as { settings?: unknown }).settings && typeof (shop as { settings?: unknown }).settings === 'object' ? (shop as { settings?: unknown }).settings as Record<string, unknown> : null;
  const alertConfigs = settings?.alertConfigs && Array.isArray(settings.alertConfigs) ? settings.alertConfigs : [];
  const hasAlertConfig = alertConfigs.length > 0;
  const planId = normalizePlan(shop.plan);
  const planDef = getPlanDefinition(planId);
  const latestScan = shop.ScanReports?.[0];
  const scriptTagAnalysis = latestScan ? analyzeScriptTags(latestScan.scriptTags) : { count: 0, hasOrderStatusScripts: false };

  // Parallelize independent data fetching
  const [
    healthScoreResult,
    migrationTimeline,
    migrationChecklist,
    dependencyGraph,
    assetSummary,
    healthMetrics24h,
    activeAlerts,
    rejectionStats,
    migrationProgress
  ] = await Promise.all([
    // 1. Health Score
    calculateHealthScore(shop.id, [], enabledPixelConfigsCount),
    
    // 2. Migration Timeline
    (async () => {
      try {
        return await generateMigrationTimeline(shop.id);
      } catch (error) {
        logger.error("Failed to calculate migration timeline", { shopId: shop.id, error });
        return null;
      }
    })(),

    // 3. Migration Checklist
    (async () => {
      if (!latestScan) return null;
      try {
        return await getMigrationChecklist(shop.id, false);
      } catch (error) {
        logger.error("Failed to get migration checklist", { shopId: shop.id, error });
        return null;
      }
    })(),

    // 4. Dependency Graph
    (async () => {
      if (!latestScan) return null;
      try {
        return await analyzeDependencies(shop.id);
      } catch (error) {
        logger.error("Failed to analyze dependencies", { shopId: shop.id, error });
        return null;
      }
    })(),

    // 5. Asset Summary (Risk Distribution & Top Sources)
    (async () => {
      if (!latestScan) return null;
      try {
        return await getAuditAssetSummary(shop.id);
      } catch (error) {
        logger.error("Failed to get risk distribution", { shopId: shop.id, error });
        return null;
      }
    })(),

    // 6. 24h Health Metrics
    (async () => {
      try {
        const monitoringStats = await getEventMonitoringStats(shop.id, 24);
        return {
          successRate: monitoringStats.successRate,
          failureRate: monitoringStats.failureRate,
          totalEvents: monitoringStats.totalEvents,
        };
      } catch (error) {
        logger.warn("Failed to get 24h health metrics", { shopId: shop.id, error });
        return null;
      }
    })(),

    // 7. Active Alerts
    (async () => {
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
        const alertEvents = await prisma.alertEvent.findMany({
          where: { shopId: shop.id, sentAt: { gte: sevenDaysAgo } },
          orderBy: { sentAt: "desc" },
          take: 20,
        });
        return alertEvents.map((e) => ({
          id: e.id,
          type: e.alertType,
          severity: e.severity as "critical" | "warning" | "info",
          message: e.message,
          triggeredAt: e.sentAt,
        }));
      } catch (error) {
        logger.warn("Failed to get active alerts", { shopId: shop.id, error });
        return [];
      }
    })(),

    // 8. Rejection Stats
    (async () => {
      try {
        return rejectionTracker.getRejectionStats(shopDomain, 1);
      } catch (error) {
        logger.warn("Failed to get rejection stats", { shopId: shop.id, error });
        return [];
      }
    })(),

    // 9. Migration Progress
    (async () => {
      try {
        return await calculateMigrationProgress(shop.id);
      } catch (error) {
        logger.error("Failed to calculate migration progress", { shopId: shop.id, error });
        return undefined;
      }
    })()
  ]);

  const { score, status, factors } = healthScoreResult;

  const shopTier = (shop.shopTier !== null && shop.shopTier !== undefined && isValidShopTier(shop.shopTier))
    ? shop.shopTier
    : "unknown";
  const tierInfo = getTierDisplayInfo(shopTier);
  const deadlineDate = new Date(tierInfo.deadlineDate);
  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  let urgency: UpgradeStatus["urgency"] = "low";
  if (daysRemaining <= 0) {
    urgency = "critical";
  } else if (daysRemaining <= 30) {
    urgency = "high";
  } else if (daysRemaining <= 90) {
    urgency = "medium";
  } else if (shop.typOspPagesEnabled) {
    urgency = "resolved";
  }
  const autoUpgradeStartDate = shopTier === "plus" ? "2026-01" : undefined;
  const upgradeStatus: UpgradeStatus = {
    isUpgraded: shop.typOspPagesEnabled ?? false,
    shopTier,
    deadlineDate: tierInfo.deadlineDate,
    autoUpgradeStartDate,
    daysRemaining,
    urgency,
  };

  const riskScore = latestScan?.riskScore ?? null;
  let riskLevel: "high" | "medium" | "low" | null = null;
  if (riskScore !== null) {
    if (riskScore >= 70) {
      riskLevel = "high";
    } else if (riskScore >= 40) {
      riskLevel = "medium";
    } else {
      riskLevel = "low";
    }
  }

  let estimatedMigrationTimeMinutes = 30;
  if (migrationTimeline && migrationTimeline.totalEstimatedTime > 0) {
    estimatedMigrationTimeMinutes = migrationTimeline.totalEstimatedTime;
  } else if (latestScan) {
    estimatedMigrationTimeMinutes = Math.max(
      30,
      scriptTagAnalysis.count * 15 +
        ((latestScan.identifiedPlatforms as string[]) || []).length * 10
    );
  }

  const isNewInstall = shop.installedAt &&
    (Date.now() - shop.installedAt.getTime()) < 24 * 60 * 60 * 1000;
  const showOnboarding = isNewInstall && (
    !latestScan ||
    latestScan.status === "pending" ||
    latestScan.status === "scanning"
  );

  let riskDistribution = null;
  let topRiskSources: Array<{ source: string; count: number; category: string }> = [];

  if (assetSummary) {
    riskDistribution = {
      byRiskLevel: {
        high: assetSummary.byRiskLevel.high,
        medium: assetSummary.byRiskLevel.medium,
        low: assetSummary.byRiskLevel.low,
      },
      byCategory: assetSummary.byCategory,
      byPlatform: assetSummary.byPlatform || {},
    };

    try {
        const categoryLabels: Record<string, string> = {
          pixel: "像素追踪",
          affiliate: "联盟营销",
          survey: "问卷调研",
          support: "客服支持",
          analytics: "分析工具",
          other: "其他",
        };
        
        // Note: We need to query Prisma for breakdown details as getAuditAssetSummary aggregates them
        // To avoid another query, we can rely on what we have or do a lightweight query if absolutely needed.
        // For now, let's keep the original logic but optimized.
        // Actually, the original code did separate queries for topRiskSources. 
        // Let's bring that logic inside the parallel block or keep it separate if it's complex.
        // The original code did: group by category and group by platform.
        // We can move this to a parallel block too, but let's keep it simple for now and do it here if assetSummary exists.
        
        const [highRiskByCategory, highRiskByPlatform] = await Promise.all([
           prisma.auditAsset.groupBy({
            by: ["category"],
            where: { shopId: shop.id, riskLevel: "high" },
            _count: true,
          }),
           prisma.auditAsset.groupBy({
            by: ["platform"],
            where: { shopId: shop.id, riskLevel: "high", platform: { not: null } },
            _count: true,
          })
        ]);

        const allSources: Array<{ source: string; count: number; category: string }> = [];
        highRiskByCategory.forEach((item) => {
          allSources.push({
            source: categoryLabels[item.category] || item.category,
            count: item._count,
            category: item.category,
          });
        });
        highRiskByPlatform.forEach((item) => {
          if (item.platform) {
            allSources.push({
              source: item.platform,
              count: item._count,
              category: "platform",
            });
          }
        });
        topRiskSources = allSources
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
    } catch (error) {
       logger.warn("Failed to get top risk sources", { shopId: shop.id, error });
    }
  }

  return {
    shopDomain,
    healthScore: score,
    healthStatus: status,
    healthScoreFactors: factors,
    latestScan: latestScan
      ? {
          status: latestScan.status,
          riskScore: latestScan.riskScore,
          createdAt: latestScan.createdAt,
          identifiedPlatforms: (latestScan.identifiedPlatforms as string[]) || [],
        }
      : null,
    configuredPlatforms,
    weeklyConversions,
    hasAlertConfig,
    hasEnabledPixelConfig,
    plan: shop.plan || "free",
    planId,
    planLabel: planDef.name,
    planTagline: planDef.tagline,
    planFeatures: planDef.features,
    scriptTagsCount: scriptTagAnalysis.count,
    hasOrderStatusScripts: scriptTagAnalysis.hasOrderStatusScripts,
    typOspPagesEnabled: shop.typOspPagesEnabled ?? false,
    estimatedMigrationTimeMinutes,
    showOnboarding,
    upgradeStatus,
    migrationProgress,
    riskScore,
    riskLevel,
    migrationChecklist: migrationChecklist
      ? {
          totalItems: migrationChecklist.totalItems,
          highPriorityItems: migrationChecklist.highPriorityItems,
          mediumPriorityItems: migrationChecklist.mediumPriorityItems,
          lowPriorityItems: migrationChecklist.lowPriorityItems,
          estimatedTotalTime: migrationChecklist.estimatedTotalTime,
          topItems: migrationChecklist.items.slice(0, 5),
        }
      : null,
    dependencyGraph: dependencyGraph,
    riskDistribution: riskDistribution,
    healthMetrics24h,
    activeAlerts,
    topRiskSources,
    rejectionStats,
  };
}
