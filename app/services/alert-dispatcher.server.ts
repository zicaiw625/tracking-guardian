import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { sendAlert } from "./notification.server";
import { decryptAlertSettings } from "./alert-settings.server";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "./monitoring.server";
import { detectVolumeAnomaly } from "./monitoring/volume-anomaly.server";
import type { AlertData } from "../types/webhook";

export interface AlertCheckResult {
  triggered: boolean;
  severity: "low" | "medium" | "high";
  message: string;
  details?: Record<string, unknown>;
}

export interface AlertMetrics {
  failureRate: number;
  missingParamsRate: number;
  volumeDropPercent: number;
  heartbeatTriggered: boolean;
  dedupConflictsTriggered: boolean;
  stats: {
    failureStats: Awaited<ReturnType<typeof getEventMonitoringStats>>;
    missingStats: Awaited<ReturnType<typeof getMissingParamsStats>>;
    volumeStats: Awaited<ReturnType<typeof getEventVolumeStats>>;
  };
}

export interface AlertHistory {
  id: string;
  alertType: string;
  severity: string;
  message: string;
  acknowledged: boolean;
  createdAt: Date;
}

export async function runAlertChecks(shopId: string): Promise<AlertCheckResult[]> {
  let shop;
  try {
    shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, settings: true },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("settings") && error.message.includes("does not exist")) {
      logger.warn("Shop.settings column does not exist, skipping alert checks", { shopId });
      return [];
    }
    throw error;
  }
  if (!shop || !shop.settings) {
    return [];
  }
  const settings = shop.settings as Record<string, unknown>;
  const alertConfigs = (settings.alertConfigs as Array<Record<string, unknown>>) || [];
  const enabledConfigs = alertConfigs.filter(c => c.enabled === true);
  if (enabledConfigs.length === 0) {
    return [];
  }
  
  // Get raw metrics (without threshold checks)
  const metrics = await getAlertMetrics(shopId);
  
  // For each enabled config, check if it should trigger based on its own thresholds
  const allResults: AlertCheckResult[] = [];
  for (const config of enabledConfigs) {
    const thresholds = (config.thresholds as Record<string, number>) || {
      failureRate: 0.1,
      missingParams: 0.1,
      volumeDrop: 0.2,
    };
    
    const configResults: AlertCheckResult[] = [];
    
    // Check failure rate with this config's threshold
    if (metrics.failureRate > (thresholds.failureRate || 0.1)) {
      const severity = metrics.failureRate > 0.3 ? "high" : metrics.failureRate > 0.2 ? "medium" : "low";
      configResults.push({
        triggered: true,
        severity,
        message: `事件失败率过高: ${(metrics.failureRate * 100).toFixed(1)}%`,
        details: { 
          failureRate: metrics.failureRate, 
          threshold: thresholds.failureRate || 0.1,
          configId: config.id,
        },
      });
    }
    
    // Check missing params with this config's threshold
    if (metrics.missingParamsRate > (thresholds.missingParams || 0.1)) {
      const severity = metrics.missingParamsRate > 0.3 ? "high" : metrics.missingParamsRate > 0.2 ? "medium" : "low";
      configResults.push({
        triggered: true,
        severity,
        message: `缺失参数率过高: ${(metrics.missingParamsRate * 100).toFixed(1)}%`,
        details: { 
          missingRate: metrics.missingParamsRate, 
          threshold: thresholds.missingParams || 0.1,
          configId: config.id,
        },
      });
    }
    
    // Check volume drop with this config's threshold
    if (metrics.volumeDropPercent > (thresholds.volumeDrop || 0.2)) {
      const severity = metrics.volumeDropPercent > 0.5 ? "high" : metrics.volumeDropPercent > 0.3 ? "medium" : "low";
      configResults.push({
        triggered: true,
        severity,
        message: `事件量下降: ${(metrics.volumeDropPercent * 100).toFixed(1)}%`,
        details: { 
          dropPercent: metrics.volumeDropPercent, 
          threshold: thresholds.volumeDrop || 0.2,
          configId: config.id,
        },
      });
    }
    
    // Check dedup conflicts (no threshold, always check)
    if (metrics.dedupConflictsTriggered) {
      configResults.push({
        triggered: true,
        severity: "medium",
        message: "检测到去重冲突",
        details: { configId: config.id },
      });
    }
    
    // Check heartbeat (no threshold, always check)
    if (metrics.heartbeatTriggered) {
      configResults.push({
        triggered: true,
        severity: "medium",
        message: "像素事件心跳异常：过去1小时内无事件",
        details: { configId: config.id },
      });
    }
    
    allResults.push(...configResults);
  }
  
  return allResults;
}

async function getAlertMetrics(shopId: string): Promise<AlertMetrics> {
  const [failureStats, missingStats, volumeStats, dedupResult, heartbeatResult] = await Promise.all([
    getEventMonitoringStats(shopId),
    getMissingParamsStats(shopId),
    getEventVolumeStats(shopId),
    checkDedupConflicts(shopId),
    checkPixelHeartbeat(shopId),
  ]);
  
  const failureRate = failureStats.failureRate / 100;
  const missingParamsRate = missingStats.missingParamsRate / 100;
  
  // Get volume drop from anomaly detection
  const anomaly = await detectVolumeAnomaly(shopId);
  const volumeDropPercent = anomaly.knownBehavior && !anomaly.isAnomaly ? 0 : Math.max(0, -anomaly.deviationPercent / 100);
  
  return {
    failureRate,
    missingParamsRate,
    volumeDropPercent,
    heartbeatTriggered: heartbeatResult.triggered,
    dedupConflictsTriggered: dedupResult.triggered,
    stats: {
      failureStats,
      missingStats,
      volumeStats,
    },
  };
}

export async function runAllShopAlertChecks(): Promise<void> {
  const shops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  for (const shop of shops) {
    try {
      const results = await runAlertChecks(shop.id);
      if (results.length > 0) {
        await dispatchAlerts(shop.id, results);
      }
    } catch (error) {
      logger.error("Error running alert checks for shop", { shopId: shop.id, error });
    }
  }
}

export async function checkFailureRate(shopId: string, threshold: number = 0.1): Promise<AlertCheckResult> {
  const stats = await getEventMonitoringStats(shopId);
  const failureRate = stats.failureRate / 100;
  if (failureRate > threshold) {
    return {
      triggered: true,
      severity: failureRate > 0.3 ? "high" : failureRate > 0.2 ? "medium" : "low",
      message: `事件失败率过高: ${(failureRate * 100).toFixed(1)}%`,
      details: { failureRate, threshold, stats },
    };
  }
  return { triggered: false, severity: "low", message: "" };
}

export async function checkMissingParams(shopId: string, threshold: number = 0.1): Promise<AlertCheckResult> {
  const stats = await getMissingParamsStats(shopId);
  const missingRate = stats.missingParamsRate / 100;
  if (missingRate > threshold) {
    return {
      triggered: true,
      severity: missingRate > 0.3 ? "high" : missingRate > 0.2 ? "medium" : "low",
      message: `缺失参数率过高: ${(missingRate * 100).toFixed(1)}%`,
      details: { missingRate, threshold, stats },
    };
  }
  return { triggered: false, severity: "low", message: "" };
}

export async function checkVolumeDrop(shopId: string, threshold: number = 0.2): Promise<AlertCheckResult> {
  const anomaly = await detectVolumeAnomaly(shopId);
  const dropPercent = -anomaly.deviationPercent / 100;
  
  if (anomaly.knownBehavior && !anomaly.isAnomaly) {
    return {
      triggered: false,
      severity: "low",
      message: "",
      details: { 
        dropPercent, 
        threshold, 
        anomaly,
        knownBehavior: anomaly.knownBehavior,
        suppressed: true,
      },
    };
  }
  
  if (dropPercent > threshold) {
    let message = `事件量下降: ${(-anomaly.deviationPercent).toFixed(1)}%`;
    if (anomaly.knownBehavior) {
      message += `。注意：${anomaly.knownBehavior}`;
    }
    return {
      triggered: true,
      severity: dropPercent > 0.5 ? "high" : dropPercent > 0.3 ? "medium" : "low",
      message,
      details: { 
        dropPercent, 
        threshold, 
        anomaly,
        knownBehavior: anomaly.knownBehavior,
        hasAlternativeEvents: anomaly.hasAlternativeEvents,
      },
    };
  }
  return { triggered: false, severity: "low", message: "" };
}

export async function checkDedupConflicts(shopId: string): Promise<AlertCheckResult> {
  try {
    const { checkDeduplicationAlerts } = await import("./deduplication-conflict-detection.server");
    const result = await checkDeduplicationAlerts(shopId);
    
    if (!result.shouldAlert) {
      return { triggered: false, severity: "low", message: "" };
    }
    
    // Map severity: "critical" -> "high", "warning" -> "medium", "info" -> "low"
    const severityMap: Record<"critical" | "warning" | "info", "low" | "medium" | "high"> = {
      critical: "high",
      warning: "medium",
      info: "low",
    };
    
    return {
      triggered: true,
      severity: severityMap[result.severity] || "medium",
      message: result.reason,
      details: {
        totalConflicts: result.stats.totalConflicts,
        highSeverityConflicts: result.stats.highSeverityConflicts,
        purchaseConflicts: result.stats.purchaseConflicts,
      },
    };
  } catch (error) {
    logger.error("Error checking dedup conflicts", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { triggered: false, severity: "low", message: "" };
  }
}

export async function checkPixelHeartbeat(shopId: string): Promise<AlertCheckResult> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentEvents = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      pixelTimestamp: { gte: oneHourAgo },
    },
  });
  if (recentEvents === 0) {
    return {
      triggered: true,
      severity: "medium",
      message: "像素事件心跳异常：过去1小时内无事件",
      details: { recentEvents },
    };
  }
  return { triggered: false, severity: "low", message: "" };
}

async function dispatchAlerts(shopId: string, results: AlertCheckResult[]): Promise<void> {
  try {
    let shop;
    try {
      shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { id: true, shopDomain: true, settings: true },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("settings") && error.message.includes("does not exist")) {
        logger.warn("Shop.settings column does not exist, skipping alert dispatch", { shopId });
        return;
      }
      throw error;
    }
    if (!shop || !shop.settings) {
      return;
    }
    const settings = shop.settings as Record<string, unknown>;
    const alertConfigs = (settings.alertConfigs as Array<Record<string, unknown>>) || [];
    if (alertConfigs.length === 0) {
      return;
    }
    
    // Group results by configId
    const resultsByConfig = new Map<string, AlertCheckResult[]>();
    for (const result of results) {
      const configId = (result.details?.configId as string) || "unknown";
      const existing = resultsByConfig.get(configId) || [];
      existing.push(result);
      resultsByConfig.set(configId, existing);
    }
    
    for (const config of alertConfigs) {
      if (!config.enabled) {
        continue;
      }
      const configId = (config.id as string) || "unknown";
      const channel = config.channel as string;
      const thresholds = (config.thresholds as Record<string, number>) || {};
      const settingsEncrypted = config.settingsEncrypted as string;
      if (!settingsEncrypted) {
        continue;
      }
      
      // Get results for this specific config
      const configResults = resultsByConfig.get(configId) || [];
      if (configResults.length === 0) {
        continue;
      }
      
      try {
        const stats = await getEventMonitoringStats(shopId);
        const missingStats = await getMissingParamsStats(shopId);
        const volumeStats = await getEventVolumeStats(shopId);
        
        // Find the primary result (highest severity)
        const primaryResult = configResults.find(r => r.severity === "high") || 
                             configResults.find(r => r.severity === "medium") || 
                             configResults[0];
        
        const failureRate = (primaryResult?.details?.failureRate as number) || (stats.failureRate / 100) || 0;
        const missingRate = (primaryResult?.details?.missingRate as number) || (missingStats.missingParamsRate / 100) || 0;
        const dropPercent = (primaryResult?.details?.dropPercent as number) || (Math.abs(volumeStats.changePercent) / 100) || 0;
        const maxDiscrepancy = Math.max(failureRate, missingRate, dropPercent, 0.1);
        const totalEvents = stats.totalEvents || 0;
        const successRate = stats.successRate / 100 || 0;
        const successfulEvents = Math.round(totalEvents * successRate);
        
        const alertData: AlertData = {
          platform: primaryResult?.message?.includes("失败率") ? "失败率告警" : primaryResult?.message?.includes("缺失参数") ? "缺失参数告警" : primaryResult?.message?.includes("事件量下降") ? "事件量下降告警" : "监控告警",
          reportDate: new Date(),
          shopifyOrders: totalEvents,
          platformConversions: successfulEvents,
          orderDiscrepancy: maxDiscrepancy,
          revenueDiscrepancy: maxDiscrepancy,
          shopDomain: shop.shopDomain || "",
        };
        const alertSettings = await decryptAlertSettings(settingsEncrypted);
        const configWithEncryption = {
          id: configId,
          channel: channel as "email" | "slack" | "telegram",
          settings: alertSettings,
          discrepancyThreshold: (thresholds.failureRate || 0.1) * 100,
          minOrdersForAlert: 1,
          isEnabled: true,
          settingsEncrypted,
        };
        const success = await sendAlert(configWithEncryption, alertData);
        if (success) {
          logger.info("Alert dispatched successfully", {
            shopId,
            channel,
            configId,
            resultsCount: configResults.length,
          });
        } else {
          logger.warn("Failed to dispatch alert", {
            shopId,
            channel,
            configId,
            resultsCount: configResults.length,
          });
        }
      } catch (error) {
        logger.error("Error dispatching alert", {
          shopId,
          channel,
          configId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error("Error in dispatchAlerts", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getAlertHistory(shopId: string, _limit: number = 50): Promise<AlertHistory[]> {
  return [];
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  logger.info("Alert acknowledged", { alertId });
}

export async function getThresholdRecommendations(shopId: string): Promise<Record<string, number>> {
  const stats = await getEventMonitoringStats(shopId);
  await getEventVolumeStats(shopId);
  return {
    failureRate: Math.max(0.05, stats.failureRate / 100 * 1.5),
    missingParams: 0.1,
    volumeDrop: 0.2,
  };
}

export async function testThresholds(
  shopId: string,
  thresholds: { failureRate?: number; missingParams?: number; volumeDrop?: number }
): Promise<{ triggered: boolean; results: AlertCheckResult[] }> {
  const results: AlertCheckResult[] = [];
  if (thresholds.failureRate !== undefined) {
    const result = await checkFailureRate(shopId, thresholds.failureRate);
    results.push(result);
  }
  if (thresholds.missingParams !== undefined) {
    const result = await checkMissingParams(shopId, thresholds.missingParams);
    results.push(result);
  }
  if (thresholds.volumeDrop !== undefined) {
    const result = await checkVolumeDrop(shopId, thresholds.volumeDrop);
    results.push(result);
  }
  return {
    triggered: results.some((r) => r.triggered),
    results,
  };
}
