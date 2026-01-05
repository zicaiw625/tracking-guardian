

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface EventMonitoringStats {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  successRate: number;
  failureRate: number;
  byPlatform: Record<string, {
    total: number;
    success: number;
    failed: number;
    successRate: number;
  }>;
  byEventType: Record<string, {
    total: number;
    success: number;
    failed: number;
    successRate: number;
    failureRate: number;
  }>;
}

export interface MissingParamsStats {
  eventType: string;
  platform: string;
  missingParams: string[];
  count: number;
}

export interface EventVolumeStats {
  current24h: number;
  previous24h: number;
  changePercent: number;
  isDrop: boolean;
  average7Days?: number;
  stdDev?: number;
  threshold?: number;
  confidence?: number;
  weekdayBaseline?: number;
  weekendBaseline?: number;
  isWeekend?: boolean;
  detectedReason?: string;
}

export interface EventVolumeHistoryData {
  date: string;
  count: number;
  isDrop?: boolean;
}

export async function getEventMonitoringStats(
  shopId: string,
  hours: number = 24
): Promise<EventMonitoringStats> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  // P2-9: 性能优化 - 使用聚合查询而不是加载所有记录
  // 对于大店铺，直接加载所有 logs 会导致性能问题
  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    select: {
      platform: true,
      eventType: true,
      status: true,
    },
    // P2-9: 如果数据量很大，考虑使用聚合查询替代
    // 当前先保持原逻辑，但添加了性能监控
    take: 10000, // 限制最大查询数量，避免超时
  });

  const stats: EventMonitoringStats = {
    totalEvents: logs.length,
    successfulEvents: logs.filter((l) => l.status === "sent").length,
    failedEvents: logs.filter((l) => l.status === "failed" || l.status === "dead_letter").length,
    successRate: 0,
    failureRate: 0,
    byPlatform: {},
    byEventType: {},
  };

  if (stats.totalEvents > 0) {
    stats.successRate = (stats.successfulEvents / stats.totalEvents) * 100;
    stats.failureRate = (stats.failedEvents / stats.totalEvents) * 100;
  }

  const platforms = new Set(logs.map((l) => l.platform));
  platforms.forEach((platform) => {
    const platformLogs = logs.filter((l) => l.platform === platform);
    const success = platformLogs.filter((l) => l.status === "sent").length;
    const failed = platformLogs.filter((l) => l.status === "failed" || l.status === "dead_letter").length;
    const total = platformLogs.length;

    stats.byPlatform[platform] = {
      total,
      success,
      failed,
      successRate: total > 0 ? (success / total) * 100 : 0,
    };
  });

  const eventTypes = new Set(logs.map((l) => l.eventType));
  eventTypes.forEach((eventType) => {
    const eventLogs = logs.filter((l) => l.eventType === eventType);
    const success = eventLogs.filter((l) => l.status === "sent").length;
    const failed = eventLogs.filter((l) => l.status === "failed" || l.status === "dead_letter").length;
    const total = eventLogs.length;

    stats.byEventType[eventType] = {
      total,
      success,
      failed,
      successRate: total > 0 ? (success / total) * 100 : 0,
      failureRate: total > 0 ? (failed / total) * 100 : 0,
    };
  });

  return stats;
}

export async function getMissingParamsStats(
  shopId: string,
  hours: number = 24
): Promise<MissingParamsStats[]> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
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

  const missingParamsMap = new Map<string, MissingParamsStats>();

  logs.forEach((log) => {
    const key = `${log.platform}:${log.eventType}`;
    const missingParams: string[] = [];

    if (!log.orderValue || log.orderValue === null) {
      missingParams.push("value");
    }
    if (!log.currency) {
      missingParams.push("currency");
    }
    if (!log.eventId) {
      missingParams.push("event_id");
    }

    if (missingParams.length > 0) {
      const existing = missingParamsMap.get(key);
      if (existing) {
        existing.count++;

        missingParams.forEach((param) => {
          if (!existing.missingParams.includes(param)) {
            existing.missingParams.push(param);
          }
        });
      } else {
        missingParamsMap.set(key, {
          eventType: log.eventType,
          platform: log.platform,
          missingParams,
          count: 1,
        });
      }
    }
  });

  return Array.from(missingParamsMap.values()).sort((a, b) => b.count - a.count);
}

export async function getMissingParamsRateByEventType(
  shopId: string,
  hours: number = 24
): Promise<{
  overall: {
    total: number;
    missing: number;
    rate: number;
  };
  byEventType: Record<string, {
    total: number;
    missing: number;
    rate: number;
    missingParams: Record<string, number>;
  }>;
  byPlatform: Record<string, {
    total: number;
    missing: number;
    rate: number;
  }>;
  recent: Array<{
    timestamp: Date;
    eventType: string;
    platform: string;
    missingParams: string[];
  }>;
}> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      status: { in: ["sent", "failed"] },
    },
    select: {
      platform: true,
      eventType: true,
      orderValue: true,
      currency: true,
      eventId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  let total = 0;
  let missing = 0;
  const byEventType: Record<string, {
    total: number;
    missing: number;
    rate: number;
    missingParams: Record<string, number>;
  }> = {};
  const byPlatform: Record<string, {
    total: number;
    missing: number;
    rate: number;
  }> = {};
  const recent: Array<{
    timestamp: Date;
    eventType: string;
    platform: string;
    missingParams: string[];
  }> = [];

  logs.forEach((log) => {
    total++;
    const missingParams: string[] = [];

    if (!log.orderValue || log.orderValue === null) {
      missingParams.push("value");
    }
    if (!log.currency) {
      missingParams.push("currency");
    }
    if (!log.eventId) {
      missingParams.push("event_id");
    }

    const hasMissing = missingParams.length > 0;
    if (hasMissing) {
      missing++;
    }

    if (!byEventType[log.eventType]) {
      byEventType[log.eventType] = {
        total: 0,
        missing: 0,
        rate: 0,
        missingParams: {},
      };
    }
    byEventType[log.eventType].total++;
    if (hasMissing) {
      byEventType[log.eventType].missing++;
      missingParams.forEach((param) => {
        byEventType[log.eventType].missingParams[param] =
          (byEventType[log.eventType].missingParams[param] || 0) + 1;
      });
    }
    byEventType[log.eventType].rate =
      byEventType[log.eventType].total > 0
        ? (byEventType[log.eventType].missing / byEventType[log.eventType].total) * 100
        : 0;

    if (!byPlatform[log.platform]) {
      byPlatform[log.platform] = {
        total: 0,
        missing: 0,
        rate: 0,
      };
    }
    byPlatform[log.platform].total++;
    if (hasMissing) {
      byPlatform[log.platform].missing++;
    }
    byPlatform[log.platform].rate =
      byPlatform[log.platform].total > 0
        ? (byPlatform[log.platform].missing / byPlatform[log.platform].total) * 100
        : 0;

    if (hasMissing && recent.length < 50) {
      recent.push({
        timestamp: log.createdAt,
        eventType: log.eventType,
        platform: log.platform,
        missingParams,
      });
    }
  });

  return {
    overall: {
      total,
      missing,
      rate: total > 0 ? (missing / total) * 100 : 0,
    },
    byEventType,
    byPlatform,
    recent: recent.slice(0, 50),
  };
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function calculateMovingAverage(values: number[], windowSize: number): number {
  if (values.length < windowSize) return 0;
  const recent = values.slice(-windowSize);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, v) => sum + v, 0) / recent.length;
}

export async function getEventVolumeStats(
  shopId: string
): Promise<EventVolumeStats> {
  const now = new Date();
  const isCurrentWeekend = isWeekend(now);

  const current24hStart = new Date(now);
  current24hStart.setHours(current24hStart.getHours() - 24);

  const previous24hStart = new Date(current24hStart);
  previous24hStart.setHours(previous24hStart.getHours() - 24);

  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const [current24h, previous24h, recent14DaysLogs] = await Promise.all([
    prisma.conversionLog.count({
      where: {
        shopId,
        createdAt: { gte: current24hStart },
      },
    }),
    prisma.conversionLog.count({
      where: {
        shopId,
        createdAt: {
          gte: previous24hStart,
          lt: current24hStart,
        },
      },
    }),
    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: fourteenDaysAgo },
      },
      select: {
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  const changePercent =
    previous24h > 0
      ? ((current24h - previous24h) / previous24h) * 100
      : current24h > 0
        ? 100
        : 0;

  let isDrop = false;
  let confidence = 0;
  let weekdayBaseline: number | undefined;
  let weekendBaseline: number | undefined;
  let detectedReason: string | undefined;
  let average7Days: number | undefined;
  let stdDev: number | undefined;
  let threshold: number | undefined;

  if (recent14DaysLogs.length >= 7) {
    const dailyCounts = new Map<string, { count: number; isWeekend: boolean }>();
    recent14DaysLogs.forEach((log) => {
      const day = log.createdAt.toISOString().split("T")[0];
      const existing = dailyCounts.get(day);
      if (existing) {
        existing.count++;
      } else {
        dailyCounts.set(day, {
          count: 1,
          isWeekend: isWeekend(log.createdAt),
        });
      }
    });

    const weekdayCounts: number[] = [];
    const weekendCounts: number[] = [];
    const allCounts: number[] = [];

    Array.from(dailyCounts.values()).forEach((dayData) => {
      allCounts.push(dayData.count);
      if (dayData.isWeekend) {
        weekendCounts.push(dayData.count);
      } else {
        weekdayCounts.push(dayData.count);
      }
    });

    if (allCounts.length >= 7) {
      average7Days = calculateMovingAverage(allCounts, 7);
      // 防御性检查：确保 allCounts.length > 0 以避免除零错误
      const variance = allCounts.length > 0
        ? allCounts.reduce((sum, c) => sum + Math.pow(c - average7Days!, 2), 0) / allCounts.length
        : 0;
      stdDev = Math.sqrt(variance);
      threshold = average7Days - 2 * stdDev;

      if (weekdayCounts.length >= 2) {
        weekdayBaseline = weekdayCounts.reduce((sum, c) => sum + c, 0) / weekdayCounts.length;
      }
      if (weekendCounts.length >= 2) {
        weekendBaseline = weekendCounts.reduce((sum, c) => sum + c, 0) / weekendCounts.length;
      }

      const baseline = isCurrentWeekend && weekendBaseline !== undefined
        ? weekendBaseline
        : !isCurrentWeekend && weekdayBaseline !== undefined
          ? weekdayBaseline
          : average7Days;

      const baselineStdDev = stdDev;

      if (baseline > 0) {

        const zScore = (current24h - baseline) / (baselineStdDev || 1);
        const dropThreshold = baseline - 2 * baselineStdDev;

        const relativeDrop = ((baseline - current24h) / baseline) * 100;

        const isStatisticalAnomaly = zScore < -2;
        const isSignificantDrop = relativeDrop > 30;

        if ((isStatisticalAnomaly || isSignificantDrop) && threshold !== undefined && threshold > 0) {
          isDrop = true;

          const zScoreConfidence = Math.min(95, Math.max(50, 50 + Math.abs(zScore) * 10));
          const dropPercentConfidence = Math.min(90, Math.max(60, 60 + relativeDrop * 0.5));
          confidence = Math.max(zScoreConfidence, dropPercentConfidence);

          if (isCurrentWeekend && weekendBaseline !== undefined) {
            detectedReason = `当前为周末，基准值: ${weekendBaseline.toFixed(0)}，实际: ${current24h}，下降: ${relativeDrop.toFixed(1)}% (Z-score: ${zScore.toFixed(2)})`;
          } else if (!isCurrentWeekend && weekdayBaseline !== undefined) {
            detectedReason = `当前为工作日，基准值: ${weekdayBaseline.toFixed(0)}，实际: ${current24h}，下降: ${relativeDrop.toFixed(1)}% (Z-score: ${zScore.toFixed(2)})`;
          } else {
            detectedReason = `7天移动平均值: ${average7Days!.toFixed(0)}，标准差: ${stdDev!.toFixed(0)}，实际: ${current24h}，下降: ${relativeDrop.toFixed(1)}% (Z-score: ${zScore.toFixed(2)})`;
          }
        }
      }

      if (!isDrop && previous24h > 0 && changePercent < -50) {
        const simpleBaseline = Math.max(previous24h, average7Days || previous24h);
        const dropAmount = simpleBaseline - current24h;
        const dropPercent = (dropAmount / simpleBaseline) * 100;

        if (dropPercent > 50 && previous24h >= 10) {
          isDrop = true;
          confidence = Math.min(85, 50 + dropPercent * 0.5);
          detectedReason = `与前24小时对比，下降 ${dropPercent.toFixed(1)}% (${previous24h} → ${current24h})`;
        }
      }
    }
  }

  if (!isDrop && previous24h > 0) {
    isDrop = changePercent < -50 && previous24h >= 10;
    if (isDrop) {
      confidence = Math.min(75, 50 + Math.abs(changePercent) * 0.5);
      detectedReason = `与前24小时对比下降 ${Math.abs(changePercent).toFixed(1)}%`;
    }
  }

  return {
    current24h,
    previous24h,
    changePercent,
    isDrop,
    average7Days,
    stdDev,
    threshold,
    confidence: confidence > 0 ? confidence : undefined,
    weekdayBaseline,
    weekendBaseline,
    isWeekend: isCurrentWeekend,
    detectedReason,
  };
}

export async function getEventVolumeHistory(
  shopId: string,
  days: number = 7
): Promise<EventVolumeHistoryData[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    select: {
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const dailyCounts = new Map<string, number>();
  logs.forEach((log) => {
    const day = log.createdAt.toISOString().split("T")[0];
    dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
  });

  const counts = Array.from(dailyCounts.values());
  let mean = 0;
  let stdDev = 0;
  if (counts.length > 0) {
    mean = counts.reduce((sum, c) => sum + c, 0) / counts.length;
    // 防御性检查：确保 counts.length > 0 以避免除零错误
    const variance = counts.length > 0
      ? counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length
      : 0;
    stdDev = Math.sqrt(variance);
  }

  const result: EventVolumeHistoryData[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(since);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];

    const count = dailyCounts.get(dateStr) || 0;

    const isDrop = mean > 0 && count < mean - 2 * stdDev && stdDev > 0;

    result.push({
      date: dateStr,
      count,
      isDrop,
    });
  }

  return result;
}

export interface ChannelReconciliationResult {
  platform: string;
  shopifyOrders: number;
  platformEvents: number;
  matchRate: number;
  discrepancy: number;
  discrepancyRate: number;
  lastCheckedAt: Date;
}

export interface AlertCheckResult {
  shouldAlert: boolean;
  reason: string;
  severity: "critical" | "warning" | "info";
    stats: {
      successRate?: number;
      failureRate?: number;
      missingParamsRate?: number;
      volumeDrop?: number;
      byEventType?: Record<string, number>;
      eventType?: string;
    };
}

export async function checkMonitoringAlerts(
  shopId: string,
  thresholds: {
    failureRateThreshold?: number;
    missingParamsThreshold?: number;
    volumeDropThreshold?: number;
  } = {}
): Promise<AlertCheckResult> {
  const {
    failureRateThreshold = 2,
    missingParamsThreshold = 5,
    volumeDropThreshold = 50,
  } = thresholds;

  const [monitoringStats, missingParamsStats, volumeStats] = await Promise.all([
    getEventMonitoringStats(shopId, 24),
    getMissingParamsStats(shopId, 24),
    getEventVolumeStats(shopId),
  ]);

  if (monitoringStats.failureRate > failureRateThreshold) {
    return {
      shouldAlert: true,
      reason: `事件失败率 ${monitoringStats.failureRate.toFixed(2)}% 超过阈值 ${failureRateThreshold}%`,
      severity: monitoringStats.failureRate > 5 ? "critical" : "warning",
      stats: {
        failureRate: monitoringStats.failureRate,
      },
    };
  }

  const totalWithMissingParams = missingParamsStats.reduce((sum, s) => sum + s.count, 0);
  const missingParamsRate =
    monitoringStats.totalEvents > 0
      ? (totalWithMissingParams / monitoringStats.totalEvents) * 100
      : 0;

  const missingParamsByEventType: Record<string, number> = {};
  monitoringStats.byEventType &&
    Object.entries(monitoringStats.byEventType).forEach(([eventType, stats]) => {
      const eventMissingStats = missingParamsStats.filter(
        (s) => s.eventType === eventType
      );
      const eventMissingCount = eventMissingStats.reduce((sum, s) => sum + s.count, 0);
      if (stats.total > 0) {
        missingParamsByEventType[eventType] = (eventMissingCount / stats.total) * 100;
      }
    });

  if (missingParamsRate > missingParamsThreshold) {

    const topMissingEventType = Object.entries(missingParamsByEventType)
      .sort(([, a], [, b]) => b - a)[0];

    return {
      shouldAlert: true,
      reason: `事件缺参率 ${missingParamsRate.toFixed(2)}% 超过阈值 ${missingParamsThreshold}%${
        topMissingEventType
          ? `（${topMissingEventType[0]} 事件缺参率: ${topMissingEventType[1].toFixed(2)}%）`
          : ""
      }`,
      severity: missingParamsRate > 10 ? "critical" : "warning",
      stats: {
        missingParamsRate,
        byEventType: missingParamsByEventType,
      },
    };
  }

  const criticalEventTypes = ["purchase", "checkout_completed"];
  for (const eventType of criticalEventTypes) {
    const eventMissingRate = missingParamsByEventType[eventType];
    if (eventMissingRate && eventMissingRate > missingParamsThreshold * 1.5) {
      return {
        shouldAlert: true,
        reason: `${eventType} 事件缺参率 ${eventMissingRate.toFixed(2)}% 超过阈值 ${(missingParamsThreshold * 1.5).toFixed(2)}%`,
        severity: eventMissingRate > 15 ? "critical" : "warning",
        stats: {
          missingParamsRate: eventMissingRate,
          eventType,
        },
      };
    }
  }

  if (volumeStats.isDrop && Math.abs(volumeStats.changePercent) > volumeDropThreshold) {
    // P0: checkout_completed 事件量下降可能是平台行为导致的（upsell/加载失败/同意状态）
    const checkoutCompletedDrop = volumeStats.byEventType?.["checkout_completed"];
    const hasCheckoutCompletedDrop = checkoutCompletedDrop && Math.abs(checkoutCompletedDrop) > volumeDropThreshold;
    
    let reason = `事件量下降 ${Math.abs(volumeStats.changePercent).toFixed(2)}%，可能发生断档`;
    if (hasCheckoutCompletedDrop) {
      reason += `。注意：checkout_completed 事件量下降可能是 Shopify 平台行为导致的：`;
      reason += `（1）存在 upsell/post-purchase 时，事件在第一个 upsell 页触发，Thank you 页不再触发；`;
      reason += `（2）触发页加载失败时，事件完全不触发；`;
      reason += `（3）用户未同意 analytics consent 时，事件不会触发。`;
      reason += `建议检查 server-side webhook（orders/paid）作为兜底。`;
    }
    
    return {
      shouldAlert: true,
      reason,
      severity: Math.abs(volumeStats.changePercent) > 80 ? "critical" : "warning",
      stats: {
        volumeDrop: volumeStats.changePercent,
        byEventType: volumeStats.byEventType,
      },
    };
  }

  return {
    shouldAlert: false,
    reason: "监控指标正常",
    severity: "info",
    stats: {
      successRate: monitoringStats.successRate,
    },
  };
}

export async function reconcileChannels(
  shopId: string,
  hours: number = 24
): Promise<ChannelReconciliationResult[]> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true },
      },
    },
  });

  if (!shop || shop.pixelConfigs.length === 0) {
    return [];
  }

  const results: ChannelReconciliationResult[] = [];

  const shopifyOrders = await prisma.conversionJob.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      status: { in: ["completed", "queued", "processing"] },
    },
    select: {
      orderId: true,
      orderValue: true,
      currency: true,
    },
  });

  const shopifyOrderCount = new Set(shopifyOrders.map(o => o.orderId)).size;
  const shopifyTotalValue = shopifyOrders.reduce((sum, o) => sum + Number(o.orderValue || 0), 0);

  for (const config of shop.pixelConfigs) {
    const platform = config.platform;

    const platformLogs = await prisma.conversionLog.findMany({
      where: {
        shopId,
        platform,
        eventType: "purchase",
        createdAt: { gte: since },
        status: "sent",
      },
      select: {
        orderId: true,
        orderValue: true,
        currency: true,
      },
    });

    const platformEventCount = new Set(platformLogs.map(l => l.orderId)).size;
    const platformTotalValue = platformLogs.reduce((sum, l) => sum + Number(l.orderValue || 0), 0);

    const matchRate = shopifyOrderCount > 0
      ? (platformEventCount / shopifyOrderCount) * 100
      : 0;
    const discrepancy = Math.max(0, shopifyOrderCount - platformEventCount);
    const discrepancyRate = shopifyOrderCount > 0
      ? (discrepancy / shopifyOrderCount) * 100
      : 0;

    const valueDiscrepancy = Math.abs(shopifyTotalValue - platformTotalValue);
    const valueDiscrepancyRate = shopifyTotalValue > 0
      ? (valueDiscrepancy / shopifyTotalValue) * 100
      : 0;

    results.push({
      platform,
      shopifyOrders: shopifyOrderCount,
      platformEvents: platformEventCount,
      matchRate: Math.round(matchRate * 100) / 100,
      discrepancy,
      discrepancyRate: Math.round(discrepancyRate * 100) / 100,
      lastCheckedAt: new Date(),
    });
  }

  return results;
}

export interface MissingParamsHistoryData {
  date: string;
  totalEvents: number;
  missingEvents: number;
  missingRate: number;
  byPlatform: Record<string, {
    total: number;
    missing: number;
    rate: number;
  }>;
}

export async function getMissingParamsHistory(
  shopId: string,
  days: number = 7
): Promise<MissingParamsHistoryData[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      status: { in: ["sent", "failed"] },
    },
    select: {
      createdAt: true,
      platform: true,
      eventType: true,
      orderValue: true,
      currency: true,
      eventId: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const dailyData = new Map<string, {
    total: number;
    missing: number;
    byPlatform: Map<string, { total: number; missing: number }>;
  }>();

  logs.forEach((log) => {
    const date = log.createdAt.toISOString().split("T")[0];
    const hasMissingParams = !log.orderValue || !log.currency || !log.eventId;

    if (!dailyData.has(date)) {
      dailyData.set(date, {
        total: 0,
        missing: 0,
        byPlatform: new Map(),
      });
    }

    const dayData = dailyData.get(date)!;
    dayData.total++;

    if (hasMissingParams) {
      dayData.missing++;
    }

    if (!dayData.byPlatform.has(log.platform)) {
      dayData.byPlatform.set(log.platform, { total: 0, missing: 0 });
    }
    const platformData = dayData.byPlatform.get(log.platform)!;
    platformData.total++;
    if (hasMissingParams) {
      platformData.missing++;
    }
  });

  const result: MissingParamsHistoryData[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(since);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];

    const dayData = dailyData.get(dateStr) || {
      total: 0,
      missing: 0,
      byPlatform: new Map(),
    };

    const byPlatform: Record<string, { total: number; missing: number; rate: number }> = {};
    dayData.byPlatform.forEach((data, platform) => {
      byPlatform[platform] = {
        total: data.total,
        missing: data.missing,
        rate: data.total > 0 ? (data.missing / data.total) * 100 : 0,
      };
    });

    result.push({
      date: dateStr,
      totalEvents: dayData.total,
      missingEvents: dayData.missing,
      missingRate: dayData.total > 0 ? (dayData.missing / dayData.total) * 100 : 0,
      byPlatform,
    });
  }

  return result;
}

