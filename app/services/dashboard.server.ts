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
  const { score, status, factors } = await calculateHealthScore(
    shop.id,
    [],
    enabledPixelConfigsCount
  );
  const planId = normalizePlan(shop.plan);
  const planDef = getPlanDefinition(planId);
  const latestScan = shop.ScanReports?.[0];
  const scriptTagAnalysis = latestScan ? analyzeScriptTags(latestScan.scriptTags) : { count: 0, hasOrderStatusScripts: false };
  let estimatedMigrationTimeMinutes = 30;
  try {
    const migrationTimeline = await generateMigrationTimeline(shop.id);
    if (migrationTimeline && migrationTimeline.totalEstimatedTime > 0) {
      estimatedMigrationTimeMinutes = migrationTimeline.totalEstimatedTime;
    } else if (latestScan) {
      estimatedMigrationTimeMinutes = Math.max(
        30,
        scriptTagAnalysis.count * 15 +
          ((latestScan.identifiedPlatforms as string[]) || []).length * 10
      );
    }
  } catch (error) {
    logger.error("Failed to calculate migration timeline", { shopId: shop.id, error });
    if (latestScan) {
      estimatedMigrationTimeMinutes = Math.max(
        30,
        scriptTagAnalysis.count * 15 +
          ((latestScan.identifiedPlatforms as string[]) || []).length * 10
      );
    }
  }
  const isNewInstall = shop.installedAt &&
    (Date.now() - shop.installedAt.getTime()) < 24 * 60 * 60 * 1000;
  const showOnboarding = isNewInstall && (
    !latestScan ||
    latestScan.status === "pending" ||
    latestScan.status === "scanning"
  );
  let migrationChecklist = null;
  let dependencyGraph = null;
  let riskDistribution = null;
  if (latestScan) {
    try {
      migrationChecklist = await getMigrationChecklist(shop.id, false);
    } catch (error) {
      logger.error("Failed to get migration checklist", { shopId: shop.id, error });
    }
    try {
      dependencyGraph = await analyzeDependencies(shop.id);
    } catch (error) {
      logger.error("Failed to analyze dependencies", { shopId: shop.id, error });
    }
    try {
      const assetSummary = await getAuditAssetSummary(shop.id);
      riskDistribution = {
        byRiskLevel: {
          high: assetSummary.byRiskLevel.high,
          medium: assetSummary.byRiskLevel.medium,
          low: assetSummary.byRiskLevel.low,
        },
        byCategory: assetSummary.byCategory,
        byPlatform: assetSummary.byPlatform || {},
      };
    } catch (error) {
      logger.error("Failed to get risk distribution", { shopId: shop.id, error });
    }
  }
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
  let migrationProgress;
  try {
    migrationProgress = await calculateMigrationProgress(shop.id);
  } catch (error) {
    logger.error("Failed to calculate migration progress", { shopId: shop.id, error });
  }
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
    let topRiskSources: Array<{ source: string; count: number; category: string }> = [];
  try {
    if (latestScan) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const assetSummary = await getAuditAssetSummary(shop.id);
      const categoryLabels: Record<string, string> = {
        pixel: "像素追踪",
        affiliate: "联盟营销",
        survey: "问卷调研",
        support: "客服支持",
        analytics: "分析工具",
        other: "其他",
      };
            const highRiskByCategory = await prisma.auditAsset.groupBy({
        by: ["category"],
        where: {
          shopId: shop.id,
          riskLevel: "high",
        },
        _count: true,
      });
            const highRiskByPlatform = await prisma.auditAsset.groupBy({
        by: ["platform"],
        where: {
          shopId: shop.id,
          riskLevel: "high",
          platform: { not: null },
        },
        _count: true,
      });
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
    }
  } catch (error) {
    logger.warn("Failed to get top risk sources", { shopId: shop.id, error });
  }
    let healthMetrics24h = null;
  let activeAlerts: Array<{
    id: string;
    type: string;
    severity: "critical" | "warning" | "info";
    message: string;
    triggeredAt: Date;
  }> = [];
  try {
    const monitoringStats = await getEventMonitoringStats(shop.id, 24);
    healthMetrics24h = {
      successRate: monitoringStats.successRate,
      failureRate: monitoringStats.failureRate,
      totalEvents: monitoringStats.totalEvents,
    };
  } catch (error) {
    logger.warn("Failed to get 24h health metrics", { shopId: shop.id, error });
  }
  activeAlerts = [];
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
  };
}
