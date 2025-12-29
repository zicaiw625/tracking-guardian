

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

  // 计算已配置的平台数量（包括客户端和服务端配置）
  // 注意：此值用于 UI 显示，与 hasServerSideConfig 不同
  // hasServerSideConfig 只检查有效的服务端配置（需要 serverSideEnabled 和有效凭证）
  const configuredPlatforms = shop.pixelConfigs?.length || 0;
  
  // 计算服务端配置数量（用于健康度评分，因为只有服务端追踪才产生对账数据）
  // 注意：必须同时满足 serverSideEnabled === true 和 credentialsEncrypted !== null
  // 这是因为仅启用服务端追踪但没有凭证的情况下，追踪实际上无法工作
  // 防御性检查：确保 credentialsEncrypted 是非空字符串（避免空字符串加密值被误判为有效）
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

  // 使用可选链安全访问数组第一个元素
  const latestScan = shop.scanReports?.[0];
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
    hasServerSideConfig,
    plan: shop.plan || "free",
    planId,
    planLabel: planDef.name,
    planTagline: planDef.tagline,
    planFeatures: planDef.features,
    scriptTagsCount: scriptTagAnalysis.count,
    hasOrderStatusScripts: scriptTagAnalysis.hasOrderStatusScripts,
  };
}

