

import prisma from "../db.server";
import { getPlanDefinition, normalizePlan } from "../utils/plans";
import { generateMigrationTimeline } from "./migration-priority.server";
import { getMigrationChecklist } from "./migration-checklist.server";
import { analyzeDependencies } from "./dependency-analysis.server";
import { getAuditAssetSummary } from "./audit-asset.server";
import { logger } from "../utils/logger.server";

export type {
  DashboardData,
  SetupStep,
  HealthStatus,
} from "../types/dashboard";

export {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
} from "../types/dashboard";

import type { DashboardData, HealthStatus } from "../types/dashboard";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function calculateHealthScore(
  recentReports: Array<{ orderDiscrepancy: number }>,
  configuredPlatforms: number
): { score: number | null; status: HealthStatus } {
  if (recentReports.length === 0 || configuredPlatforms === 0) {
    return { score: null, status: "uninitialized" };
  }

  const avgDiscrepancy =
    recentReports.reduce((sum, r) => sum + r.orderDiscrepancy, 0) / recentReports.length;

  if (avgDiscrepancy > 0.2) {
    return { score: 40, status: "critical" };
  }
  if (avgDiscrepancy > 0.1) {
    return { score: 70, status: "warning" };
  }
  if (avgDiscrepancy > 0.05) {
    return { score: 85, status: "success" };
  }
  return { score: 95, status: "success" };
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

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      typOspPagesEnabled: true,
      installedAt: true,
      scanReports: {
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
      reconciliationReports: {
        orderBy: { reportDate: "desc" },
        take: 7,
        select: { orderDiscrepancy: true },
      },
      alertConfigs: {
        where: { isEnabled: true },
        select: { id: true },
      },
      _count: {
        select: {
          conversionLogs: {
            where: {
              createdAt: {
                gte: new Date(Date.now() - SEVEN_DAYS_MS),
              },
            },
          },
        },
      },
    },
  });

  if (!shop) {
    return {
      shopDomain,
      healthScore: null,
      healthStatus: "uninitialized",
      latestScan: null,
      configuredPlatforms: 0,
      weeklyConversions: 0,
      hasAlertConfig: false,
      hasServerSideConfig: false,
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

  const serverSideConfigsCount = shop.pixelConfigs?.filter(
    (config) =>
      config.serverSideEnabled &&
      config.credentialsEncrypted &&
      config.credentialsEncrypted.trim().length > 0
  ).length || 0;
  const hasServerSideConfig = serverSideConfigsCount > 0;
  const { score, status } = calculateHealthScore(
    shop.reconciliationReports || [],
    serverSideConfigsCount
  );
  const planId = normalizePlan(shop.plan);
  const planDef = getPlanDefinition(planId);

  const latestScan = shop.scanReports?.[0];
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

  return {
    shopDomain,
    healthScore: score,
    healthStatus: status,
    latestScan: latestScan
      ? {
          status: latestScan.status,
          riskScore: latestScan.riskScore,
          createdAt: latestScan.createdAt,
          identifiedPlatforms: (latestScan.identifiedPlatforms as string[]) || [],
        }
      : null,
    configuredPlatforms,
    weeklyConversions: shop._count?.conversionLogs || 0,
    hasAlertConfig: (shop.alertConfigs?.length || 0) > 0,
    hasServerSideConfig,
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
  };
}

