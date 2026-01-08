import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import {
  collectEventSuccessRate,
  collectMissingParamsMetrics,
  collectDeduplicationMetrics,
  collectEventVolumeAnomaly,
} from "./collector.server";

export interface AlertCheckResult {
  triggered: boolean;
  alertId?: string;
  metricValue?: number;
  threshold?: number;
  message?: string;
}

export async function checkFailureRateAlert(
  shopId: string,
  alertId: string
): Promise<AlertCheckResult> {
  try {
    const alert = await prisma.alertConfig.findUnique({
      where: { id: alertId },
    });

    if (!alert || !alert.isEnabled || alert.shopId !== shopId) {
      return { triggered: false };
    }

    const threshold = (alert.settings as { threshold?: number })?.threshold || 2.0;

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const metrics = await collectEventSuccessRate(shopId, startDate, endDate);

    const failureRate = 100 - metrics.successRate;

    if (failureRate > threshold) {

      await prisma.alertConfig.update({
        where: { id: alert.id },
        data: {
          lastAlertAt: new Date(),
        },
      });

      return {
        triggered: true,
        alertId: alert.id,
        metricValue: failureRate,
        threshold,
        message: `事件失败率 ${failureRate.toFixed(2)}% 超过阈值 ${threshold}%`,
      };
    }

    return { triggered: false };
  } catch (error) {
    logger.error("Failed to check failure rate alert", {
      shopId,
      alertId,
      error,
    });
    return { triggered: false };
  }
}

export async function checkMissingParamsAlert(
  shopId: string,
  alertId: string
): Promise<AlertCheckResult> {
  try {
    const alert = await prisma.alertConfig.findUnique({
      where: { id: alertId },
    });

    if (!alert || !alert.isEnabled || alert.shopId !== shopId) {
      return { triggered: false };
    }

    const threshold = (alert.settings as { threshold?: number })?.threshold || 5.0;

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const metrics = await collectMissingParamsMetrics(shopId, startDate, endDate);

    if (metrics.missingRate.value > threshold) {

      await prisma.alertConfig.update({
        where: { id: alert.id },
        data: {
          lastAlertAt: new Date(),
        },
      });

      return {
        triggered: true,
        alertId: alert.id,
        metricValue: metrics.missingRate.value,
        threshold,
        message: `Purchase 事件缺参率 ${metrics.missingRate.value.toFixed(2)}% 超过阈值 ${threshold}%`,
      };
    }

    return { triggered: false };
  } catch (error) {
    logger.error("Failed to check missing params alert", {
      shopId,
      alertId,
      error,
    });
    return { triggered: false };
  }
}

export async function checkVolumeDropAlert(
  shopId: string,
  alertId: string
): Promise<AlertCheckResult> {
  try {
    const alert = await prisma.alertConfig.findUnique({
      where: { id: alertId },
    });

    if (!alert || !alert.isEnabled || alert.shopId !== shopId) {
      return { triggered: false };
    }

    const endDate = new Date();
    const currentStart = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    const previousEnd = currentStart;
    const previousStart = new Date(previousEnd.getTime() - 24 * 60 * 60 * 1000);

    const volumeMetrics = await collectEventVolumeAnomaly(
      shopId,
      { start: currentStart, end: endDate },
      { start: previousStart, end: previousEnd }
    );

    if (volumeMetrics.isAnomaly) {

      await prisma.alertConfig.update({
        where: { id: alert.id },
        data: {
          lastAlertAt: new Date(),
        },
      });

      return {
        triggered: true,
        alertId: alert.id,
        metricValue: volumeMetrics.changeRate,
        threshold: -50,
        message: `最近 24 小时事件量下降 ${Math.abs(volumeMetrics.changeRate).toFixed(2)}%`,
      };
    }

    return { triggered: false };
  } catch (error) {
    logger.error("Failed to check volume drop alert", {
      shopId,
      alertId,
      error,
    });
    return { triggered: false };
  }
}

export async function checkAllAlerts(shopId: string): Promise<AlertCheckResult[]> {
  try {
    const alerts = await prisma.alertConfig.findMany({
      where: {
        shopId,
        isEnabled: true,
      },
    });

    const results: AlertCheckResult[] = [];

    for (const alert of alerts) {
      let result: AlertCheckResult;

      const alertType = (alert.settings as { alertType?: string })?.alertType || alert.channel;
      switch (alertType) {
        case "failure_rate":
          result = await checkFailureRateAlert(shopId, alert.id);
          break;
        case "missing_params":
          result = await checkMissingParamsAlert(shopId, alert.id);
          break;
        case "volume_drop":
          result = await checkVolumeDropAlert(shopId, alert.id);
          break;
        default:
          logger.warn("Unknown alert type", { alertType });
          continue;
      }

      if (result.triggered) {
        results.push(result);
      }
    }

    return results;
  } catch (error) {
    logger.error("Failed to check all alerts", {
      shopId,
      error,
    });
    return [];
  }
}

export async function createAlert(
  shopId: string,
  alertType: "failure_rate" | "missing_params" | "volume_drop",
  threshold?: number,
  condition?: Record<string, unknown>
): Promise<{ success: boolean; alertId?: string; error?: string }> {
  try {
    const alert = await prisma.alertConfig.create({
      data: {
        id: randomUUID(),
        shopId,
        channel: alertType,
        settings: {
          alertType,
          threshold: threshold || (alertType === "failure_rate" ? 2.0 : 5.0),
          condition: condition || {},
        } as Prisma.InputJsonValue,
        isEnabled: true,
        updatedAt: new Date(),
      },
    });

    return { success: true, alertId: alert.id };
  } catch (error) {
    logger.error("Failed to create alert", {
      shopId,
      alertType,
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function resolveAlert(
  alertHistoryId: string
): Promise<{ success: boolean; error?: string }> {
  try {

    return { success: true };
  } catch (error) {
    logger.error("Failed to resolve alert", {
      alertHistoryId,
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
