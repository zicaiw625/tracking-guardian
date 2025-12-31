/**
 * 告警服务 - 检查告警条件并触发告警
 * 
 * 这个服务负责：
 * 1. 检查告警条件（失败率、缺参率、事件量骤降等）
 * 2. 触发告警（记录到 MonitoringAlertHistory）
 * 3. 发送通知（邮件、应用内等）
 */

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

/**
 * 检查事件失败率告警
 */
export async function checkFailureRateAlert(
  shopId: string,
  alertId: string
): Promise<AlertCheckResult> {
  try {
    const alert = await prisma.monitoringAlert.findUnique({
      where: { id: alertId },
    });

    if (!alert || !alert.isEnabled || alert.shopId !== shopId) {
      return { triggered: false };
    }

    // 获取阈值（默认 2%）
    const threshold = alert.threshold || 2.0;

    // 收集最近 24 小时的数据
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const metrics = await collectEventSuccessRate(shopId, startDate, endDate);

    const failureRate = 100 - metrics.successRate;

    if (failureRate > threshold) {
      // 记录告警历史
      await prisma.monitoringAlertHistory.create({
        data: {
          alertId: alert.id,
          metricValue: failureRate,
          threshold,
          details: {
            total: metrics.total,
            success: metrics.success,
            failed: metrics.failed,
            byDestination: metrics.byDestination,
          },
        },
      });

      // 更新告警统计
      await prisma.monitoringAlert.update({
        where: { id: alert.id },
        data: {
          lastTriggeredAt: new Date(),
          triggerCount: { increment: 1 },
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

/**
 * 检查缺参率告警
 */
export async function checkMissingParamsAlert(
  shopId: string,
  alertId: string
): Promise<AlertCheckResult> {
  try {
    const alert = await prisma.monitoringAlert.findUnique({
      where: { id: alertId },
    });

    if (!alert || !alert.isEnabled || alert.shopId !== shopId) {
      return { triggered: false };
    }

    const threshold = alert.threshold || 5.0;

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const metrics = await collectMissingParamsMetrics(shopId, startDate, endDate);

    // 检查 value 缺参率
    if (metrics.missingRate.value > threshold) {
      await prisma.monitoringAlertHistory.create({
        data: {
          alertId: alert.id,
          metricValue: metrics.missingRate.value,
          threshold,
          details: {
            missingValue: metrics.missingValue,
            missingCurrency: metrics.missingCurrency,
            missingItems: metrics.missingItems,
            total: metrics.total,
          },
        },
      });

      await prisma.monitoringAlert.update({
        where: { id: alert.id },
        data: {
          lastTriggeredAt: new Date(),
          triggerCount: { increment: 1 },
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

/**
 * 检查事件量骤降告警
 */
export async function checkVolumeDropAlert(
  shopId: string,
  alertId: string
): Promise<AlertCheckResult> {
  try {
    const alert = await prisma.monitoringAlert.findUnique({
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
      await prisma.monitoringAlertHistory.create({
        data: {
          alertId: alert.id,
          metricValue: volumeMetrics.changeRate,
          threshold: -50,
          details: {
            currentCount: volumeMetrics.currentCount,
            previousCount: volumeMetrics.previousCount,
            changeRate: volumeMetrics.changeRate,
          },
        },
      });

      await prisma.monitoringAlert.update({
        where: { id: alert.id },
        data: {
          lastTriggeredAt: new Date(),
          triggerCount: { increment: 1 },
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

/**
 * 检查所有启用的告警
 */
export async function checkAllAlerts(shopId: string): Promise<AlertCheckResult[]> {
  try {
    const alerts = await prisma.monitoringAlert.findMany({
      where: {
        shopId,
        isEnabled: true,
      },
    });

    const results: AlertCheckResult[] = [];

    for (const alert of alerts) {
      let result: AlertCheckResult;

      switch (alert.alertType) {
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
          logger.warn("Unknown alert type", { alertType: alert.alertType });
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

/**
 * 创建告警配置
 */
export async function createAlert(
  shopId: string,
  alertType: "failure_rate" | "missing_params" | "volume_drop",
  threshold?: number,
  condition?: Record<string, unknown>
): Promise<{ success: boolean; alertId?: string; error?: string }> {
  try {
    const alert = await prisma.monitoringAlert.create({
      data: {
        shopId,
        alertType,
        threshold: threshold || (alertType === "failure_rate" ? 2.0 : 5.0),
        condition: condition || {},
        isEnabled: true,
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

/**
 * 解析告警（标记为已解决）
 */
export async function resolveAlert(
  alertHistoryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.monitoringAlertHistory.update({
      where: { id: alertHistoryId },
      data: {
        resolvedAt: new Date(),
      },
    });

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

