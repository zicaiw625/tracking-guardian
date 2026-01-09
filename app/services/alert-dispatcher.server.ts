import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { sendAlert } from "./notification.server";
import { decryptAlertSettings } from "./alert-settings.server";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "./monitoring.server";
import { detectVolumeAnomaly } from "./monitoring/volume-anomaly.server";
import { getEventSuccessRate } from "./monitoring/event-success-rate.server";
import type { AlertConfig } from "@prisma/client";
import type { AlertSettings } from "../types";

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
  const results: AlertCheckResult[] = [];

  
  const failureRateResult = await checkFailureRate(shopId);
  if (failureRateResult.triggered) {
    results.push(failureRateResult);
  }

  
  const missingParamsResult = await checkMissingParams(shopId);
  if (missingParamsResult.triggered) {
    results.push(missingParamsResult);
  }

  
  const volumeDropResult = await checkVolumeDrop(shopId);
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
  const configs = await prisma.alertConfig.findMany({
    where: {
      shopId,
      isEnabled: true,
    },
  });

  for (const config of configs) {
    try {
      const settings = config.settingsEncrypted
        ? await decryptAlertSettings(config.settingsEncrypted)
        : (config.settings as AlertSettings | null);

      if (!settings) continue;

      for (const result of results) {
        await sendAlert({
          channel: config.channel as "email" | "slack" | "telegram",
          settings,
          subject: `告警: ${result.message}`,
          message: result.message,
          severity: result.severity,
        });
      }

      await prisma.alertConfig.update({
        where: { id: config.id },
        data: { lastAlertAt: new Date() },
      });
    } catch (error) {
      logger.error("Failed to dispatch alert", { configId: config.id, error });
    }
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
