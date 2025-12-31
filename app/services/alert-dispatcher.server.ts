

import prisma from "../db.server";
import { sendAlert } from "./notification.server";
import { getEventMonitoringStats, getMissingParamsStats, getEventVolumeStats } from "./monitoring.server";
import { logger } from "../utils/logger.server";
import type { AlertData } from "../types";

export interface AlertCheckResult {
  shopId: string;
  shopDomain: string;
  triggered: boolean;
  alertType: AlertType;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  data?: Record<string, unknown>;
}

export type AlertType =
  | "failure_rate"
  | "missing_params"
  | "volume_drop"
  | "dedup_conflict"
  | "reconciliation"
  | "pixel_heartbeat";

interface AlertThresholds {
  failureRateThreshold: number;
  missingParamsThreshold: number;
  volumeDropThreshold: number;
  dedupConflictThreshold: number;
  heartbeatStaleHours: number;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  failureRateThreshold: 0.02,
  missingParamsThreshold: 0.1,
  volumeDropThreshold: 0.5,
  dedupConflictThreshold: 5,
  heartbeatStaleHours: 24,
};

export interface ThresholdRecommendation {
  failureRate: number;
  missingParams: number;
  volumeDrop: number;
  dedupConflict: number;
}

export async function getThresholdRecommendations(
  shopId: string
): Promise<ThresholdRecommendation> {
  const [monitoringStats, missingParamsStats, volumeStats] = await Promise.all([
    getEventMonitoringStats(shopId, 24 * 7),
    getMissingParamsStats(shopId, 24 * 7),
    getEventVolumeStats(shopId),
  ]);

  const failureRateRecommendation = Math.max(
    1,
    Math.min(
      10,
      monitoringStats.failureRate + (monitoringStats.failureRate * 0.5)
    )
  );

  const totalWithMissingParams = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
  const missingParamsRate = monitoringStats.totalEvents > 0
    ? (totalWithMissingParams / monitoringStats.totalEvents) * 100
    : 0;
  const missingParamsRecommendation = Math.max(
    2,
    Math.min(
      20,
      missingParamsRate + (missingParamsRate * 0.5)
    )
  );

  const volumeDropRecommendation = volumeStats.stdDev
    ? Math.max(30, Math.min(70, 50 + (volumeStats.stdDev / (volumeStats.average7Days || 1)) * 100))
    : 50;

  return {
    failureRate: failureRateRecommendation,
    missingParams: missingParamsRecommendation,
    volumeDrop: volumeDropRecommendation,
    dedupConflict: 5,
  };
}

export interface ThresholdTestResult {
  failureRate: {
    wouldTrigger: boolean;
    currentValue: number;
    threshold: number;
    triggerCount: number;
  };
  missingParams: {
    wouldTrigger: boolean;
    currentValue: number;
    threshold: number;
    triggerCount: number;
  };
  volumeDrop: {
    wouldTrigger: boolean;
    currentValue: number;
    threshold: number;
  };
}

export async function testThresholds(
  shopId: string,
  thresholds: {
    failureRate?: number;
    missingParams?: number;
    volumeDrop?: number;
  }
): Promise<ThresholdTestResult> {
  const [monitoringStats, missingParamsStats, volumeStats] = await Promise.all([
    getEventMonitoringStats(shopId, 24),
    getMissingParamsStats(shopId, 24),
    getEventVolumeStats(shopId),
  ]);

  const totalWithMissingParams = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
  const missingParamsRate = monitoringStats.totalEvents > 0
    ? (totalWithMissingParams / monitoringStats.totalEvents) * 100
    : 0;

  const failureRateThreshold = thresholds.failureRate ?? DEFAULT_THRESHOLDS.failureRateThreshold * 100;
  const missingParamsThreshold = thresholds.missingParams ?? DEFAULT_THRESHOLDS.missingParamsThreshold * 100;
  const volumeDropThreshold = thresholds.volumeDrop ?? DEFAULT_THRESHOLDS.volumeDropThreshold * 100;

  return {
    failureRate: {
      wouldTrigger: monitoringStats.failureRate > failureRateThreshold,
      currentValue: monitoringStats.failureRate,
      threshold: failureRateThreshold,
      triggerCount: monitoringStats.failureRate > failureRateThreshold ? 1 : 0,
    },
    missingParams: {
      wouldTrigger: missingParamsRate > missingParamsThreshold,
      currentValue: missingParamsRate,
      threshold: missingParamsThreshold,
      triggerCount: missingParamsRate > missingParamsThreshold ? 1 : 0,
    },
    volumeDrop: {
      wouldTrigger: volumeStats.isDrop && Math.abs(volumeStats.changePercent) > volumeDropThreshold,
      currentValue: Math.abs(volumeStats.changePercent),
      threshold: volumeDropThreshold,
    },
  };
}

export async function checkFailureRate(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.failureRateThreshold ?? DEFAULT_THRESHOLDS.failureRateThreshold;

  const last24h = new Date();
  last24h.setHours(last24h.getHours() - 24);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: last24h },
    },
    select: {
      platform: true,
      eventType: true,
      status: true,
    },
  });

  const stats = await prisma.conversionLog.groupBy({
    by: ["status"],
    where: {
      shopId,
      createdAt: { gte: last24h },
    },
    _count: true,
  });

  const total = stats.reduce((sum, s) => sum + s._count, 0);
  const failed = stats.find(s => s.status === "failed" || s.status === "dead_letter")?._count || 0;
  const failureRate = total > 0 ? failed / total : 0;

  const failureRateByPlatform: Record<string, number> = {};
  const platforms = new Set(logs.map(l => l.platform));
  platforms.forEach(platform => {
    const platformLogs = logs.filter(l => l.platform === platform);
    const platformTotal = platformLogs.length;
    const platformFailed = platformLogs.filter(l => l.status === "failed" || l.status === "dead_letter").length;
    if (platformTotal > 0) {
      failureRateByPlatform[platform] = (platformFailed / platformTotal) * 100;
    }
  });

  const failureRateByEventType: Record<string, number> = {};
  const eventTypes = new Set(logs.map(l => l.eventType));
  eventTypes.forEach(eventType => {
    const eventLogs = logs.filter(l => l.eventType === eventType);
    const eventTotal = eventLogs.length;
    const eventFailed = eventLogs.filter(l => l.status === "failed" || l.status === "dead_letter").length;
    if (eventTotal > 0) {
      failureRateByEventType[eventType] = (eventFailed / eventTotal) * 100;
    }
  });

  const triggered = failureRate > threshold && total >= 10;

  const topFailingPlatform = Object.entries(failureRateByPlatform)
    .sort(([, a], [, b]) => b - a)[0];
  const topFailingEventType = Object.entries(failureRateByEventType)
    .sort(([, a], [, b]) => b - a)[0];

  let message = `事件发送失败率 ${(failureRate * 100).toFixed(1)}% 超过阈值 ${(threshold * 100).toFixed(1)}%`;
  if (topFailingPlatform && topFailingPlatform[1] > threshold * 100) {
    message += `（${topFailingPlatform[0]} 平台失败率: ${topFailingPlatform[1].toFixed(1)}%）`;
  }
  if (topFailingEventType && topFailingEventType[1] > threshold * 100) {
    message += `（${topFailingEventType[0]} 事件失败率: ${topFailingEventType[1].toFixed(1)}%）`;
  }

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "failure_rate",
    severity: failureRate > 0.1 ? "critical" : failureRate > 0.05 ? "high" : "medium",
    message,
    data: {
      total,
      failed,
      failureRate,
      threshold,
      failureRateByPlatform,
      failureRateByEventType,
      topFailingPlatform: topFailingPlatform ? { platform: topFailingPlatform[0], rate: topFailingPlatform[1] } : undefined,
      topFailingEventType: topFailingEventType ? { eventType: topFailingEventType[0], rate: topFailingEventType[1] } : undefined,
    },
  };
}

export async function checkMissingParams(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.missingParamsThreshold ?? DEFAULT_THRESHOLDS.missingParamsThreshold;

  const last24h = new Date();
  last24h.setHours(last24h.getHours() - 24);

  const allLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: last24h },
      status: { in: ["sent", "failed"] },
    },
    select: {
      platform: true,
      eventType: true,
      orderValue: true,
      currency: true,
      eventId: true,
    },
  });

  const allEvents = await prisma.conversionLog.groupBy({
    by: ["eventType"],
    where: {
      shopId,
      createdAt: { gte: last24h },
    },
    _count: true,
  });

  const eventsWithMissingParams = allLogs.filter(log => {
    const hasValue = log.orderValue !== null && log.orderValue !== undefined && Number(log.orderValue) > 0;
    const hasCurrency = log.currency && log.currency.trim() !== "";
    const hasEventId = log.eventId && log.eventId.trim() !== "";

    if (log.eventType === "purchase" || log.eventType === "checkout_completed") {
      return !hasValue || !hasCurrency;
    }

    return !hasValue && !hasCurrency;
  });

  const totalEvents = allEvents.reduce((sum, e) => sum + e._count, 0);
  const totalMissing = eventsWithMissingParams.length;
  const overallMissingRate = totalEvents > 0 ? totalMissing / totalEvents : 0;

  const missingRateByEventType: Record<string, number> = {};
  allEvents.forEach((event) => {
    const eventLogs = allLogs.filter(l => l.eventType === event.eventType);
    const eventMissing = eventsWithMissingParams.filter(l => l.eventType === event.eventType).length;
    if (event._count > 0) {
      missingRateByEventType[event.eventType] = (eventMissing / event._count) * 100;
    }
  });

  const missingRateByPlatform: Record<string, number> = {};
  const platforms = new Set(allLogs.map(l => l.platform));
  platforms.forEach(platform => {
    const platformLogs = allLogs.filter(l => l.platform === platform);
    const platformMissing = eventsWithMissingParams.filter(l => l.platform === platform).length;
    if (platformLogs.length > 0) {
      missingRateByPlatform[platform] = (platformMissing / platformLogs.length) * 100;
    }
  });

  if (overallMissingRate > threshold && totalEvents >= 10) {

    const topMissingEventType = Object.entries(missingRateByEventType)
      .sort(([, a], [, b]) => b - a)[0];
    const topMissingPlatform = Object.entries(missingRateByPlatform)
      .sort(([, a], [, b]) => b - a)[0];

    let message = `事件参数缺失率 ${(overallMissingRate * 100).toFixed(1)}% 超过阈值 ${(threshold * 100).toFixed(1)}%`;
    if (topMissingEventType) {
      message += `（${topMissingEventType[0]} 事件缺参率: ${topMissingEventType[1].toFixed(1)}%）`;
    }
    if (topMissingPlatform && topMissingPlatform[1] > threshold * 100) {
      message += `（${topMissingPlatform[0]} 平台缺参率: ${topMissingPlatform[1].toFixed(1)}%）`;
    }

    return {
      shopId,
      shopDomain,
      triggered: true,
      alertType: "missing_params",
      severity: overallMissingRate > 0.2 ? "high" : overallMissingRate > 0.1 ? "medium" : "low",
      message,
      data: {
        totalEvents,
        totalMissing,
        overallMissingRate,
        missingRateByEventType,
        missingRateByPlatform,
        threshold,
        topMissingEventType: topMissingEventType ? { eventType: topMissingEventType[0], rate: topMissingEventType[1] } : undefined,
        topMissingPlatform: topMissingPlatform ? { platform: topMissingPlatform[0], rate: topMissingPlatform[1] } : undefined,
      },
    };
  }

  const criticalEventTypes = ["purchase", "checkout_completed"];
  for (const eventType of criticalEventTypes) {
    const eventMissingRate = missingRateByEventType[eventType];
    if (eventMissingRate && eventMissingRate > threshold * 1.5) {
      const eventTotal = allEvents.find((e) => e.eventType === eventType)?._count || 0;
      if (eventTotal >= 5) {
        const eventMissing = eventsWithMissingParams.filter(l => l.eventType === eventType).length;
        return {
          shopId,
          shopDomain,
          triggered: true,
          alertType: "missing_params",
          severity: eventMissingRate > 30 ? "high" : "medium",
          message: `${eventType} 事件参数缺失率 ${eventMissingRate.toFixed(1)}% 超过阈值 ${(threshold * 1.5 * 100).toFixed(1)}%`,
          data: {
            eventType,
            eventTotal,
            eventMissing,
            eventMissingRate,
            threshold: threshold * 1.5,
            missingRateByEventType,
            missingRateByPlatform,
          },
        };
      }
    }
  }

  return {
    shopId,
    shopDomain,
    triggered: false,
    alertType: "missing_params",
    severity: "low",
    message: `事件参数缺失率正常 (${(overallMissingRate * 100).toFixed(1)}%)`,
    data: {
      totalEvents,
      totalMissing,
      overallMissingRate,
      missingRateByEventType,
      missingRateByPlatform,
      threshold,
    },
  };
}

export async function checkVolumeDrop(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.volumeDropThreshold ?? DEFAULT_THRESHOLDS.volumeDropThreshold;

  const { detectEventVolumeDrop } = await import("./anomaly-detection.server");
  const anomalyResult = await detectEventVolumeDrop(shopId, 24);

  if (anomalyResult.isAnomaly) {
    const severityMap: Record<"low" | "medium" | "high", "critical" | "high" | "medium" | "low"> = {
      low: "low",
      medium: "medium",
      high: "critical",
    };

    return {
      shopId,
      shopDomain,
      triggered: true,
      alertType: "volume_drop",
      severity: severityMap[anomalyResult.severity],
      message: anomalyResult.message,
      data: {
        current24h: anomalyResult.current24h,
        previous24h: anomalyResult.previous24h,
        average7Days: anomalyResult.average7Days,
        changePercent: anomalyResult.changePercent,
        threshold: anomalyResult.threshold,
        severity: anomalyResult.severity,
      },
    };
  }

  const now = new Date();
  const last24h = new Date(now);
  last24h.setHours(last24h.getHours() - 24);
  const prev24h = new Date(last24h);
  prev24h.setHours(prev24h.getHours() - 24);
  const prev48h = new Date(prev24h);
  prev48h.setHours(prev48h.getHours() - 24);

  const [currentLogs, previousLogs] = await Promise.all([
    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: last24h },
      },
      select: {
        platform: true,
        eventType: true,
      },
    }),
    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: prev24h, lt: last24h },
      },
      select: {
        platform: true,
        eventType: true,
      },
    }),
  ]);

  const currentVolume = currentLogs.length;
  const previousVolume = previousLogs.length;

  const volumeChangeByPlatform: Record<string, { current: number; previous: number; changePercent: number }> = {};
  const platforms = new Set([...currentLogs.map(l => l.platform), ...previousLogs.map(l => l.platform)]);
  platforms.forEach(platform => {
    const currentCount = currentLogs.filter(l => l.platform === platform).length;
    const previousCount = previousLogs.filter(l => l.platform === platform).length;
    const changePercent = previousCount > 0 ? ((previousCount - currentCount) / previousCount) * 100 : 0;
    volumeChangeByPlatform[platform] = {
      current: currentCount,
      previous: previousCount,
      changePercent,
    };
  });

  const volumeChangeByEventType: Record<string, { current: number; previous: number; changePercent: number }> = {};
  const eventTypes = new Set([...currentLogs.map(l => l.eventType), ...previousLogs.map(l => l.eventType)]);
  eventTypes.forEach(eventType => {
    const currentCount = currentLogs.filter(l => l.eventType === eventType).length;
    const previousCount = previousLogs.filter(l => l.eventType === eventType).length;
    const changePercent = previousCount > 0 ? ((previousCount - currentCount) / previousCount) * 100 : 0;
    volumeChangeByEventType[eventType] = {
      current: currentCount,
      previous: previousCount,
      changePercent,
    };
  });

  const previous2Volume = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: { gte: prev48h, lt: prev24h },
    },
  });

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recent7DaysLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const dropRate = previousVolume > 0 ? (previousVolume - currentVolume) / previousVolume : 0;
  const simpleDrop = dropRate > threshold && previousVolume >= 10;

  let avgDrop = false;
  let avgDropRate = 0;
  if (recent7DaysLogs.length > 0) {

    const dailyCounts = new Map<string, number>();
    recent7DaysLogs.forEach((log) => {
      const day = log.createdAt.toISOString().split("T")[0];
      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
    });

    const counts = Array.from(dailyCounts.values());
    if (counts.length > 0) {
      const mean = counts.reduce((sum, c) => sum + c, 0) / counts.length;
      const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
      const stdDev = Math.sqrt(variance);

      const thresholdValue = mean - 2 * stdDev;
      if (currentVolume < thresholdValue && thresholdValue > 0 && mean > 0) {
        avgDrop = true;
        avgDropRate = (mean - currentVolume) / mean;
      }
    }
  }

  let recent3DaysAvg = 0;
  let recent3DaysDrop = false;
  if (previousVolume > 0 && previous2Volume > 0) {
    recent3DaysAvg = (previousVolume + previous2Volume + currentVolume) / 3;
    const expectedMin = recent3DaysAvg * (1 - threshold);
    if (currentVolume < expectedMin && recent3DaysAvg > 0) {
      recent3DaysDrop = true;
    }
  }

  const triggered = simpleDrop || avgDrop || recent3DaysDrop;

  let severity: "critical" | "high" | "medium" | "low" = "low";
  if (dropRate > 0.8 || avgDropRate > 0.8) {
    severity = "critical";
  } else if (dropRate > 0.6 || avgDropRate > 0.6) {
    severity = "high";
  } else if (dropRate > threshold || avgDrop || recent3DaysDrop) {
    severity = "medium";
  }

  const topDroppingPlatform = Object.entries(volumeChangeByPlatform)
    .filter(([, stats]) => stats.changePercent > threshold * 100)
    .sort(([, a], [, b]) => b.changePercent - a.changePercent)[0];
  const topDroppingEventType = Object.entries(volumeChangeByEventType)
    .filter(([, stats]) => stats.changePercent > threshold * 100)
    .sort(([, a], [, b]) => b.changePercent - a.changePercent)[0];

  let message = "";
  if (simpleDrop) {
    message = `事件量骤降 ${(dropRate * 100).toFixed(1)}%（前24h: ${previousVolume}，当前24h: ${currentVolume}）`;
  } else if (avgDrop) {
    message = `事件量低于历史平均值 ${(avgDropRate * 100).toFixed(1)}%（当前24h: ${currentVolume}）`;
  } else if (recent3DaysDrop) {
    message = `事件量低于最近3天平均值（当前24h: ${currentVolume}，平均值: ${recent3DaysAvg.toFixed(0)}）`;
  }

  if (topDroppingPlatform) {
    message += `（${topDroppingPlatform[0]} 平台下降: ${topDroppingPlatform[1].changePercent.toFixed(1)}%）`;
  }
  if (topDroppingEventType) {
    message += `（${topDroppingEventType[0]} 事件下降: ${topDroppingEventType[1].changePercent.toFixed(1)}%）`;
  }

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "volume_drop",
    severity,
    message,
    data: {
      currentVolume,
      previousVolume,
      previous2Volume,
      dropRate,
      avgDropRate,
      recent3DaysAvg,
      threshold,
      volumeChangeByPlatform,
      volumeChangeByEventType,
      topDroppingPlatform: topDroppingPlatform ? { platform: topDroppingPlatform[0], changePercent: topDroppingPlatform[1].changePercent } : undefined,
      topDroppingEventType: topDroppingEventType ? { eventType: topDroppingEventType[0], changePercent: topDroppingEventType[1].changePercent } : undefined,
      detectionMethods: {
        simple: simpleDrop,
        average: avgDrop,
        recent3Days: recent3DaysDrop,
      },
    },
  };
}

export async function checkDedupConflicts(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const threshold = thresholds.dedupConflictThreshold ?? DEFAULT_THRESHOLDS.dedupConflictThreshold;

  const last24h = new Date();
  last24h.setHours(last24h.getHours() - 24);

  const duplicates = await prisma.$queryRaw<Array<{ eventId: string; count: bigint }>>`
    SELECT "eventId", COUNT(*) as count
    FROM "ConversionLog"
    WHERE "shopId" = ${shopId}
      AND "createdAt" >= ${last24h}
      AND "eventId" IS NOT NULL
    GROUP BY "eventId"
    HAVING COUNT(*) > 1
  `;

  const conflictCount = duplicates.length;
  const totalDuplicates = duplicates.reduce((sum, d) => sum + Number(d.count) - 1, 0);
  const triggered = conflictCount >= threshold;

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "dedup_conflict",
    severity: conflictCount > 20 ? "high" : "medium",
    message: `检测到 ${conflictCount} 个事件 ID 存在重复发送（共 ${totalDuplicates} 次重复）`,
    data: { conflictCount, totalDuplicates, threshold },
  };
}

export async function checkPixelHeartbeat(
  shopId: string,
  shopDomain: string,
  thresholds: Partial<AlertThresholds> = {}
): Promise<AlertCheckResult> {
  const staleHours = thresholds.heartbeatStaleHours ?? DEFAULT_THRESHOLDS.heartbeatStaleHours;

  const lastReceipt = await prisma.pixelEventReceipt.findFirst({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const now = new Date();
  const lastReceiptTime = lastReceipt?.createdAt;
  const hoursSinceLastReceipt = lastReceiptTime
    ? (now.getTime() - lastReceiptTime.getTime()) / (1000 * 60 * 60)
    : Infinity;

  const triggered = hoursSinceLastReceipt > staleHours;

  return {
    shopId,
    shopDomain,
    triggered,
    alertType: "pixel_heartbeat",
    severity: hoursSinceLastReceipt > 48 ? "critical" : "high",
    message: lastReceiptTime
      ? `超过 ${Math.round(hoursSinceLastReceipt)} 小时未收到像素心跳`
      : "从未收到像素心跳事件",
    data: { lastReceiptTime: lastReceiptTime?.toISOString(), hoursSinceLastReceipt, staleHours },
  };
}

export async function runAlertChecks(shopId: string): Promise<{
  checked: number;
  triggered: number;
  sent: number;
  results: AlertCheckResult[];
}> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      alertConfigs: {
        where: { isEnabled: true },
        select: {
          id: true,
          settings: true,
          discrepancyThreshold: true,
          frequency: true,
        },
      },
    },
  });

  if (!shop) {
    logger.warn(`Shop not found for alert checks: ${shopId}`);
    return { checked: 0, triggered: 0, sent: 0, results: [] };
  }

  const firstConfig = shop.alertConfigs[0];
  const settings = firstConfig?.settings as { thresholds?: { failureRate?: number; missingParams?: number; volumeDrop?: number } } | undefined;

  const thresholds: Partial<AlertThresholds> = {
    failureRateThreshold: settings?.thresholds?.failureRate ?? (firstConfig?.discrepancyThreshold ?? DEFAULT_THRESHOLDS.failureRateThreshold),
    missingParamsThreshold: settings?.thresholds?.missingParams ?? (firstConfig?.discrepancyThreshold ? firstConfig.discrepancyThreshold * 2.5 : DEFAULT_THRESHOLDS.missingParamsThreshold),
    volumeDropThreshold: settings?.thresholds?.volumeDrop ?? DEFAULT_THRESHOLDS.volumeDropThreshold,
  };

  const results: AlertCheckResult[] = [];

  results.push(await checkFailureRate(shopId, shop.shopDomain, thresholds));
  results.push(await checkMissingParams(shopId, shop.shopDomain, thresholds));
  results.push(await checkVolumeDrop(shopId, shop.shopDomain, thresholds));
  results.push(await checkDedupConflicts(shopId, shop.shopDomain));
  results.push(await checkPixelHeartbeat(shopId, shop.shopDomain));

  const triggeredAlerts = results.filter(r => r.triggered);
  let sent = 0;

  for (const alertResult of triggeredAlerts) {
    for (const config of shop.alertConfigs) {

      const canSend = await canSendAlert(config.id, config.frequency);
      if (!canSend) {
        logger.debug(`Skipping alert due to frequency limit`, { configId: config.id });
        continue;
      }

      const alertData: AlertData = {
        platform: alertResult.alertType,
        reportDate: new Date(),
        shopifyOrders: (alertResult.data?.total as number) || 0,
        platformConversions: (alertResult.data?.sent as number) || 0,
        orderDiscrepancy: (alertResult.data?.failureRate as number) || 0,
        revenueDiscrepancy: 0,
        shopDomain: shop.shopDomain,

        customMessage: alertResult.message,
        alertType: alertResult.alertType,
        severity: alertResult.severity,
      } as AlertData;

      try {
        const success = await sendAlert(config as unknown as Parameters<typeof sendAlert>[0], alertData);
        if (success) {
          sent++;
          await prisma.alertConfig.update({
            where: { id: config.id },
            data: { lastAlertAt: new Date() },
          });
        }
      } catch (error) {
        logger.error(`Failed to send alert`, { configId: config.id, error });
      }
    }
  }

  logger.info(`Alert checks completed`, {
    shopId,
    checked: results.length,
    triggered: triggeredAlerts.length,
    sent,
  });

  return {
    checked: results.length,
    triggered: triggeredAlerts.length,
    sent,
    results,
  };
}

async function canSendAlert(configId: string, frequency: string): Promise<boolean> {
  const config = await prisma.alertConfig.findUnique({
    where: { id: configId },
    select: { lastAlertAt: true },
  });

  if (!config?.lastAlertAt) return true;

  const now = new Date();
  const lastAlert = config.lastAlertAt;
  const hoursSinceLastAlert = (now.getTime() - lastAlert.getTime()) / (1000 * 60 * 60);

  switch (frequency) {
    case "instant":
      return hoursSinceLastAlert >= 1;
    case "hourly":
      return hoursSinceLastAlert >= 1;
    case "daily":
      return hoursSinceLastAlert >= 24;
    case "weekly":
      return hoursSinceLastAlert >= 168;
    default:
      return hoursSinceLastAlert >= 24;
  }
}

export async function runAllShopAlertChecks(): Promise<{
  shopsChecked: number;
  totalTriggered: number;
  totalSent: number;
}> {
  const shops = await prisma.shop.findMany({
    where: {
      isActive: true,
      alertConfigs: {
        some: { isEnabled: true },
      },
    },
    select: { id: true },
  });

  let totalTriggered = 0;
  let totalSent = 0;

  for (const shop of shops) {
    try {
      const result = await runAlertChecks(shop.id);
      totalTriggered += result.triggered;
      totalSent += result.sent;
    } catch (error) {
      logger.error(`Alert check failed for shop`, { shopId: shop.id, error });
    }
  }

  logger.info(`All shop alert checks completed`, {
    shopsChecked: shops.length,
    totalTriggered,
    totalSent,
  });

  return {
    shopsChecked: shops.length,
    totalTriggered,
    totalSent,
  };
}

export async function getAlertHistory(
  shopId: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  alertType: AlertType;
  severity: string;
  message: string;
  createdAt: Date;
  acknowledged: boolean;
}>> {

  const logs = await prisma.auditLog.findMany({
    where: {
      shopId,
      action: "alert_triggered",
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      metadata: true,
      createdAt: true,
    },
  });

  return logs.map(log => {
    const metadata = log.metadata as Record<string, unknown> || {};
    return {
      id: log.id,
      alertType: (metadata.alertType as AlertType) || "failure_rate",
      severity: (metadata.severity as string) || "medium",
      message: (metadata.message as string) || "告警",
      createdAt: log.createdAt,
      acknowledged: (metadata.acknowledged as boolean) || false,
    };
  });
}

export async function acknowledgeAlert(
  alertId: string,
  shopId: string
): Promise<boolean> {
  try {
    await prisma.auditLog.updateMany({
      where: {
        id: alertId,
        shopId,
        action: "alert_triggered",
      },
      data: {
        metadata: {
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

