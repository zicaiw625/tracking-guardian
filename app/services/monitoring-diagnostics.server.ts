
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats, reconcileChannels } from "./monitoring.server";
import { checkFailureRate, checkMissingParams, checkVolumeDrop, checkDedupConflicts, checkPixelHeartbeat } from "./alert-dispatcher.server";
import { analyzeDedupConflicts } from "./capi-dedup.server";
import { isValidPlatform, PLATFORM_NAMES } from "../types";

export interface DiagnosticIssue {
  id: string;
  type: DiagnosticIssueType;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  affectedPlatforms?: string[];
  affectedEventTypes?: string[];
  metrics: {
    current?: number;
    threshold?: number;
    trend?: "increasing" | "decreasing" | "stable";
  };
  recommendations: DiagnosticRecommendation[];
  autoFixable: boolean;
  estimatedFixTime?: string;
}

export type DiagnosticIssueType =
  | "high_failure_rate"
  | "missing_params"
  | "volume_drop"
  | "dedup_conflict"
  | "pixel_heartbeat_lost"
  | "channel_mismatch"
  | "config_error"
  | "network_issue"
  | "platform_specific_error";

export interface DiagnosticRecommendation {
  priority: "critical" | "high" | "medium" | "low";
  action: string;
  description: string;
  steps: string[];
  relatedUrl?: string;
  estimatedTime?: string;
}

export interface DiagnosticReport {
  shopId: string;
  timestamp: Date;
  overallHealth: "healthy" | "warning" | "critical";
  healthScore: number;
  issues: DiagnosticIssue[];
  summary: {
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  };
  recommendations: DiagnosticRecommendation[];
}

export async function runDiagnostics(
  shopId: string
): Promise<DiagnosticReport> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true, isActive: true },
      },
    },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }

  const issues: DiagnosticIssue[] = [];

  const failureRateIssue = await diagnoseFailureRate(shopId, shop.shopDomain);
  if (failureRateIssue) {
    issues.push(failureRateIssue);
  }

  const missingParamsIssue = await diagnoseMissingParams(shopId, shop.shopDomain);
  if (missingParamsIssue) {
    issues.push(missingParamsIssue);
  }

  const volumeDropIssue = await diagnoseVolumeDrop(shopId, shop.shopDomain);
  if (volumeDropIssue) {
    issues.push(volumeDropIssue);
  }

  const dedupIssue = await diagnoseDedupConflicts(shopId, shop.shopDomain);
  if (dedupIssue) {
    issues.push(dedupIssue);
  }

  const heartbeatIssue = await diagnosePixelHeartbeat(shopId, shop.shopDomain);
  if (heartbeatIssue) {
    issues.push(heartbeatIssue);
  }

  const channelIssues = await diagnoseChannelMismatch(shopId);
  issues.push(...channelIssues);

  const configIssues = await diagnoseConfigErrors(shopId, shop.pixelConfigs);
  issues.push(...configIssues);

  const healthScore = calculateHealthScore(issues);
  const overallHealth = healthScore >= 80 ? "healthy" : healthScore >= 60 ? "warning" : "critical";

  const allRecommendations = issues
    .flatMap((issue) => issue.recommendations)
    .sort((a, b) => {
      const priorityOrder: Record<"critical" | "high" | "medium" | "low", number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
    });

  return {
    shopId,
    timestamp: new Date(),
    overallHealth,
    healthScore,
    issues,
    summary: {
      totalIssues: issues.length,
      criticalIssues: issues.filter((i) => i.severity === "critical").length,
      highIssues: issues.filter((i) => i.severity === "high").length,
      mediumIssues: issues.filter((i) => i.severity === "medium").length,
      lowIssues: issues.filter((i) => i.severity === "low").length,
    },
    recommendations: allRecommendations,
  };
}

async function diagnoseFailureRate(
  shopId: string,
  shopDomain: string
): Promise<DiagnosticIssue | null> {
  const alertResult = await checkFailureRate(shopId, shopDomain);

  if (!alertResult.triggered) {
    return null;
  }

  const monitoringStats = await getEventMonitoringStats(shopId, 24);
  const failureRate = monitoringStats.failureRate;

  const failedLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      status: { in: ["failed", "dead_letter"] },
    },
    select: {
      platform: true,
      eventType: true,
      errorMessage: true,
    },
    take: 100,
  });

  const errorPatterns = new Map<string, number>();
  failedLogs.forEach((log) => {
    if (log.errorMessage) {
      const pattern = extractErrorPattern(log.errorMessage);
      errorPatterns.set(pattern, (errorPatterns.get(pattern) || 0) + 1);
    }
  });

  const topErrorPattern = Array.from(errorPatterns.entries())
    .sort(([, a], [, b]) => b - a)[0];

  const affectedPlatforms = Array.from(new Set(failedLogs.map((l) => l.platform)));
  const affectedEventTypes = Array.from(new Set(failedLogs.map((l) => l.eventType)));

  const recommendations: DiagnosticRecommendation[] = [];

  if (topErrorPattern && (topErrorPattern[0].includes("network") || topErrorPattern[0].includes("timeout"))) {
    recommendations.push({
      priority: "high",
      action: "检查网络连接和 API 端点",
      description: "检测到网络相关错误，可能是 API 端点不可达或网络不稳定",
      steps: [
        "检查应用后端 URL 是否正确配置",
        "验证网络连接是否正常",
        "检查防火墙或代理设置",
        "尝试手动发送测试事件",
      ],
      relatedUrl: "/app/migrate#pixel",
      estimatedTime: "10-15 分钟",
    });
  } else if (topErrorPattern && (topErrorPattern[0].includes("authentication") || topErrorPattern[0].includes("token"))) {
    recommendations.push({
      priority: "critical",
      action: "更新 API 凭证",
      description: "检测到认证错误，需要更新平台 API 凭证",
      steps: [
        "前往迁移页面检查平台配置",
        "验证 API Token 是否有效",
        "重新输入正确的 API 凭证",
        "保存配置并测试",
      ],
      relatedUrl: "/app/migrate",
      estimatedTime: "5-10 分钟",
    });
  } else if (topErrorPattern && topErrorPattern[0].includes("rate limit")) {
    recommendations.push({
      priority: "medium",
      action: "优化发送频率",
      description: "检测到速率限制错误，可能需要降低发送频率或升级 API 配额",
      steps: [
        "检查平台 API 速率限制",
        "考虑实现请求队列和重试机制",
        "联系平台支持升级配额",
      ],
      estimatedTime: "20-30 分钟",
    });
  } else {
    recommendations.push({
      priority: "high",
      action: "检查事件配置和平台状态",
      description: "事件发送失败，需要检查配置和平台状态",
      steps: [
        "查看失败事件的错误消息",
        "检查平台 API 状态页面",
        "验证事件参数格式是否正确",
        "联系技术支持",
      ],
      relatedUrl: "/app/monitor",
      estimatedTime: "15-20 分钟",
    });
  }

  return {
    id: `failure_rate_${shopId}`,
    type: "high_failure_rate",
    severity: alertResult.severity,
    title: "事件发送失败率过高",
    description: `过去 24 小时内事件发送失败率为 ${failureRate.toFixed(2)}%，超过正常阈值。${topErrorPattern ? `主要错误类型：${topErrorPattern[0]}（${topErrorPattern[1]} 次）` : ""}`,
    affectedPlatforms,
    affectedEventTypes,
    metrics: {
      current: failureRate,
      threshold: 2,
      trend: "increasing",
    },
    recommendations,
    autoFixable: false,
    estimatedFixTime: "15-30 分钟",
  };
}

async function diagnoseMissingParams(
  shopId: string,
  shopDomain: string
): Promise<DiagnosticIssue | null> {
  const alertResult = await checkMissingParams(shopId, shopDomain);

  if (!alertResult.triggered) {
    return null;
  }

  const missingParamsStats = await getMissingParamsStats(shopId, 24);
  const monitoringStats = await getEventMonitoringStats(shopId, 24);

  const totalMissing = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
  const missingRate = monitoringStats.totalEvents > 0
    ? (totalMissing / monitoringStats.totalEvents) * 100
    : 0;

  const paramCounts = new Map<string, number>();
  missingParamsStats.forEach((stat) => {
    stat.missingParams.forEach((param) => {
      paramCounts.set(param, (paramCounts.get(param) || 0) + stat.count);
    });
  });

  const topMissingParams = Array.from(paramCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  const affectedPlatforms = Array.from(new Set(missingParamsStats.map((s) => s.platform)));
  const affectedEventTypes = Array.from(new Set(missingParamsStats.map((s) => s.eventType)));

  const recommendations: DiagnosticRecommendation[] = [];

  if (topMissingParams.some(([param]) => param === "value")) {
    recommendations.push({
      priority: "critical",
      action: "修复订单金额参数缺失",
      description: "检测到订单金额 (value) 参数缺失，这会影响转化追踪的准确性",
      steps: [
        "检查事件映射配置",
        "验证 Shopify 订单数据是否包含金额信息",
        "检查参数规范化逻辑",
        "重新测试订单事件",
      ],
      relatedUrl: "/app/migrate#mapping",
      estimatedTime: "10-15 分钟",
    });
  }

  if (topMissingParams.some(([param]) => param === "currency")) {
    recommendations.push({
      priority: "high",
      action: "修复货币代码参数缺失",
      description: "检测到货币代码 (currency) 参数缺失",
      steps: [
        "检查 Shopify 商店货币设置",
        "验证事件参数映射",
        "确保货币代码正确传递",
      ],
      relatedUrl: "/app/migrate#mapping",
      estimatedTime: "5-10 分钟",
    });
  }

  if (topMissingParams.some(([param]) => param === "event_id")) {
    recommendations.push({
      priority: "medium",
      action: "修复事件 ID 参数缺失",
      description: "检测到事件 ID 参数缺失，可能影响去重功能",
      steps: [
        "检查事件 ID 生成逻辑",
        "确保每个事件都有唯一 ID",
        "验证去重配置",
      ],
      relatedUrl: "/app/migrate#dedup",
      estimatedTime: "10-15 分钟",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: "high",
      action: "检查事件参数配置",
      description: "检测到参数缺失，需要检查事件配置",
      steps: [
        "查看缺参率统计详情",
        "检查事件映射配置",
        "验证参数规范化设置",
        "测试事件发送",
      ],
      relatedUrl: "/app/monitor",
      estimatedTime: "15-20 分钟",
    });
  }

  return {
    id: `missing_params_${shopId}`,
    type: "missing_params",
    severity: alertResult.severity,
    title: "事件参数缺失率过高",
    description: `过去 24 小时内事件参数缺失率为 ${missingRate.toFixed(2)}%。${topMissingParams.length > 0 ? `最常缺失的参数：${topMissingParams.map(([p]) => p).join(", ")}` : ""}`,
    affectedPlatforms,
    affectedEventTypes,
    metrics: {
      current: missingRate,
      threshold: 5,
    },
    recommendations,
    autoFixable: false,
    estimatedFixTime: "15-30 分钟",
  };
}

async function diagnoseVolumeDrop(
  shopId: string,
  shopDomain: string
): Promise<DiagnosticIssue | null> {
  const alertResult = await checkVolumeDrop(shopId, shopDomain);

  if (!alertResult.triggered) {
    return null;
  }

  const volumeStats = await getEventVolumeStats(shopId);
  const changePercent = Math.abs(volumeStats.changePercent || 0);

  const recommendations: DiagnosticRecommendation[] = [
    {
      priority: "high",
      action: "检查追踪配置和网络连接",
      description: "事件量显著下降，可能是追踪配置问题或网络中断",
      steps: [
        "检查 Web Pixel 是否正常工作",
        "验证应用后端 URL 是否正确",
        "检查是否有网络中断",
        "查看 Shopify 订单量是否正常",
        "重新推送 App Pixel 配置",
      ],
      relatedUrl: "/app/migrate#pixel",
      estimatedTime: "15-20 分钟",
    },
  ];

  return {
    id: `volume_drop_${shopId}`,
    type: "volume_drop",
    severity: alertResult.severity,
    title: "事件量骤降",
    description: `过去 24 小时内事件量下降了 ${changePercent.toFixed(2)}%，可能存在追踪断档`,
    metrics: {
      current: changePercent,
      threshold: 50,
      trend: "decreasing",
    },
    recommendations,
    autoFixable: false,
    estimatedFixTime: "15-30 分钟",
  };
}

async function diagnoseDedupConflicts(
  shopId: string,
  shopDomain: string
): Promise<DiagnosticIssue | null> {
  const alertResult = await checkDedupConflicts(shopId, shopDomain);

  if (!alertResult.triggered) {
    return null;
  }

  const last24h = new Date();
  last24h.setHours(last24h.getHours() - 24);
  const dedupAnalysis = await analyzeDedupConflicts(shopId, last24h, new Date());

  const recommendations: DiagnosticRecommendation[] = [
    {
      priority: "medium",
      action: "修复事件 ID 生成逻辑",
      description: "检测到重复事件 ID，可能导致平台侧重复计算转化",
      steps: [
        "检查事件 ID 生成算法",
        "确保每个订单的每个事件类型只生成一个 ID",
        "验证去重配置是否正确",
        "检查是否有并发发送导致的问题",
      ],
      relatedUrl: "/app/migrate#dedup",
      estimatedTime: "20-30 分钟",
    },
  ];

  return {
    id: `dedup_conflict_${shopId}`,
    type: "dedup_conflict",
    severity: alertResult.severity,
    title: "去重冲突检测",
    description: `检测到 ${dedupAnalysis?.duplicateEvents || 0} 个重复事件 ID，冲突率为 ${dedupAnalysis?.duplicateRate.toFixed(2) || 0}%`,
    metrics: {
      current: dedupAnalysis?.duplicateRate || 0,
      threshold: 5,
    },
    recommendations,
    autoFixable: false,
    estimatedFixTime: "20-30 分钟",
  };
}

async function diagnosePixelHeartbeat(
  shopId: string,
  shopDomain: string
): Promise<DiagnosticIssue | null> {
  const alertResult = await checkPixelHeartbeat(shopId, shopDomain);

  if (!alertResult.triggered) {
    return null;
  }

  const recommendations: DiagnosticRecommendation[] = [
    {
      priority: "critical",
      action: "检查 Web Pixel 配置",
      description: "超过 24 小时未收到像素心跳，Web Pixel 可能未正常工作",
      steps: [
        "检查 Shopify 后台 Web Pixel 是否启用",
        "验证应用后端 URL 是否正确",
        "确认域名配置是否匹配",
        "执行测试订单验证",
        "重新推送 App Pixel 配置",
      ],
      relatedUrl: "/app/migrate#pixel",
      estimatedTime: "10-15 分钟",
    },
  ];

  return {
    id: `pixel_heartbeat_${shopId}`,
    type: "pixel_heartbeat_lost",
    severity: alertResult.severity,
    title: "像素心跳丢失",
    description: alertResult.message,
    metrics: {
      current: alertResult.severity === "critical" ? 0 : undefined,
      threshold: 24,
    },
    recommendations,
    autoFixable: false,
    estimatedFixTime: "10-15 分钟",
  };
}

async function diagnoseChannelMismatch(
  shopId: string
): Promise<DiagnosticIssue[]> {
  const issues: DiagnosticIssue[] = [];

  try {
    const reconciliation = await reconcileChannels(shopId, 24);

    reconciliation.forEach((recon) => {
      if (recon.discrepancyRate > 10) {
        const platformName = isValidPlatform(recon.platform)
          ? PLATFORM_NAMES[recon.platform]
          : recon.platform;

        issues.push({
          id: `channel_mismatch_${shopId}_${recon.platform}`,
          type: "channel_mismatch",
          severity: recon.discrepancyRate > 20 ? "high" : "medium",
          title: `${platformName} 渠道对账不一致`,
          description: `Shopify 订单与 ${platformName} 事件存在 ${recon.discrepancyRate.toFixed(2)}% 的差异（${recon.discrepancy} 个订单）`,
          affectedPlatforms: [recon.platform],
          metrics: {
            current: recon.discrepancyRate,
            threshold: 10,
          },
          recommendations: [
            {
              priority: "high",
              action: `检查 ${platformName} 事件发送`,
              description: `检测到 ${platformName} 平台事件缺失，需要检查事件发送配置`,
              steps: [
                `检查 ${platformName} 平台配置`,
                "验证 API 凭证是否有效",
                "查看失败事件日志",
                "测试事件发送",
                "联系平台技术支持",
              ],
              relatedUrl: "/app/migrate",
              estimatedTime: "15-20 分钟",
            },
          ],
          autoFixable: false,
          estimatedFixTime: "15-30 分钟",
        });
      }
    });
  } catch (error) {
    logger.error("Failed to diagnose channel mismatch", { shopId, error });
  }

  return issues;
}

async function diagnoseConfigErrors(
  shopId: string,
  pixelConfigs: Array<{ platform: string; isActive: boolean }>
): Promise<DiagnosticIssue[]> {
  const issues: DiagnosticIssue[] = [];

  if (pixelConfigs.length === 0) {
    issues.push({
      id: `no_pixel_config_${shopId}`,
      type: "config_error",
      severity: "high",
      title: "未配置像素追踪",
      description: "未检测到任何活动的像素配置，需要配置至少一个平台的追踪",
      metrics: {
        current: 0,
      },
      recommendations: [
        {
          priority: "high",
          action: "配置像素追踪",
          description: "需要配置至少一个平台的像素追踪才能开始追踪转化",
          steps: [
            "前往迁移页面",
            "选择要追踪的平台",
            "输入 API 凭证",
            "保存配置",
          ],
          relatedUrl: "/app/migrate",
          estimatedTime: "10-15 分钟",
        },
      ],
      autoFixable: false,
      estimatedFixTime: "10-15 分钟",
    });
  }

  return issues;
}

function extractErrorPattern(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();

  if (lower.includes("network") || lower.includes("timeout") || lower.includes("connection")) {
    return "network_error";
  }
  if (lower.includes("auth") || lower.includes("token") || lower.includes("credential")) {
    return "authentication_error";
  }
  if (lower.includes("rate limit") || lower.includes("quota")) {
    return "rate_limit_error";
  }
  if (lower.includes("invalid") || lower.includes("format")) {
    return "validation_error";
  }
  if (lower.includes("server") || lower.includes("500") || lower.includes("503")) {
    return "server_error";
  }

  return "unknown_error";
}

function calculateHealthScore(issues: DiagnosticIssue[]): number {
  if (issues.length === 0) {
    return 100;
  }

  let score = 100;

  issues.forEach((issue) => {
    switch (issue.severity) {
      case "critical":
        score -= 20;
        break;
      case "high":
        score -= 10;
        break;
      case "medium":
        score -= 5;
        break;
      case "low":
        score -= 2;
        break;
    }
  });

  return Math.max(0, Math.min(100, score));
}

