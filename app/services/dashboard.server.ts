

import prisma from "../db.server";
import { getPlanDefinition, normalizePlan } from "../utils/plans";

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
    include: {
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
        select: { id: true },
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
  const { score, status } = calculateHealthScore(
    shop.reconciliationReports || [],
    configuredPlatforms
  );
  const planId = normalizePlan(shop.plan);
  const planDef = getPlanDefinition(planId);

  const latestScan = shop.scanReports[0];
  const scriptTagAnalysis = latestScan ? analyzeScriptTags(latestScan.scriptTags) : { count: 0, hasOrderStatusScripts: false };

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
    plan: shop.plan || "free",
    planId,
    planLabel: planDef.name,
    planTagline: planDef.tagline,
    planFeatures: planDef.features,
    scriptTagsCount: scriptTagAnalysis.count,
    hasOrderStatusScripts: scriptTagAnalysis.hasOrderStatusScripts,
  };
}

