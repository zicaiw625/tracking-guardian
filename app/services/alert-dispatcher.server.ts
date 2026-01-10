import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { sendAlert } from "./notification.server";
import { decryptAlertSettings } from "./alert-settings.server";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "./monitoring.server";
import { detectVolumeAnomaly } from "./monitoring/volume-anomaly.server";
import { getEventSuccessRate } from "./monitoring/event-success-rate.server";
import type { AlertData } from "../types/webhook";
import type { AlertSettings } from "../routes/settings/types";

export interface AlertCheckResult {
  triggered: boolean;
  severity: "low" | "medium" | "high";
  message: string;
  details?: Record<string, unknown>;
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
  const config = enabledConfigs[0];
  const thresholds = (config.thresholds as Record<string, number>) || {
    failureRate: 0.1,
    missingParams: 0.1,
    volumeDrop: 0.2,
  };
  const results: AlertCheckResult[] = [];
  const failureRateResult = await checkFailureRate(shopId, thresholds.failureRate || 0.1);
  if (failureRateResult.triggered) {
    results.push(failureRateResult);
  }
  const missingParamsResult = await checkMissingParams(shopId, thresholds.missingParams || 0.1);
  if (missingParamsResult.triggered) {
    results.push(missingParamsResult);
  }
  const volumeDropResult = await checkVolumeDrop(shopId, thresholds.volumeDrop || 0.2);
  if (volumeDropResult.triggered) {
    results.push(volumeDropResult);
  }
  const dedupResult = await checkDedupConflicts(shopId);
  if (dedupResult.triggered) {
    results.push(dedupResult);
  }
  const heartbeatResult = await checkPixelHeartbeat(shopId);
  if (heartbeatResult.triggered) {
    results.push(heartbeatResult);
  }
  return results;
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
  if (dropPercent > threshold) {
    return {
      triggered: true,
      severity: dropPercent > 0.5 ? "high" : dropPercent > 0.3 ? "medium" : "low",
      message: `事件量下降: ${(-anomaly.deviationPercent).toFixed(1)}%`,
      details: { dropPercent, threshold, anomaly },
    };
  }
  return { triggered: false, severity: "low", message: "" };
}

export async function checkDedupConflicts(shopId: string): Promise<AlertCheckResult> {
  return { triggered: false, severity: "low", message: "" };
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
    for (const config of alertConfigs) {
      if (!config.enabled) {
        continue;
      }
      const channel = config.channel as string;
      const thresholds = (config.thresholds as Record<string, number>) || {};
      const settingsEncrypted = config.settingsEncrypted as string;
      if (!settingsEncrypted) {
        continue;
      }
      const shouldTrigger = results.some(result => {
        if (!result.triggered) return false;
        if (result.message.includes("失败率") && thresholds.failureRate !== undefined) {
          return true;
        }
        if (result.message.includes("缺失参数") && thresholds.missingParams !== undefined) {
          return true;
        }
        if (result.message.includes("事件量下降") && thresholds.volumeDrop !== undefined) {
          return true;
        }
        return true;
      });
      if (!shouldTrigger) {
        continue;
      }
      try {
        const stats = await getEventMonitoringStats(shopId);
        const missingStats = await getMissingParamsStats(shopId);
        const volumeStats = await getEventVolumeStats(shopId);
        const primaryResult = results.find(r => r.triggered && r.severity === "high") || results[0];
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
          id: (config.id as string) || `alert_${Date.now()}`,
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
            resultsCount: results.length,
          });
        } else {
          logger.warn("Failed to dispatch alert", {
            shopId,
            channel,
            resultsCount: results.length,
          });
        }
      } catch (error) {
        logger.error("Error dispatching alert", {
          shopId,
          channel,
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

export async function getAlertHistory(shopId: string, limit: number = 50): Promise<AlertHistory[]> {
  return [];
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  logger.info("Alert acknowledged", { alertId });
}

export async function getThresholdRecommendations(shopId: string): Promise<Record<string, number>> {
  const stats = await getEventMonitoringStats(shopId);
  const volumeStats = await getEventVolumeStats(shopId);
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
