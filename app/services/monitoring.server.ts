

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

    stats.byEventType[eventType] = {
      total: eventLogs.length,
      success,
      failed,
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

export async function getEventVolumeStats(
  shopId: string
): Promise<EventVolumeStats> {
  const now = new Date();

  const current24hStart = new Date(now);
  current24hStart.setHours(current24hStart.getHours() - 24);

  const previous24hStart = new Date(current24hStart);
  previous24hStart.setHours(previous24hStart.getHours() - 24);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setHours(sevenDaysAgo.getHours() - 7 * 24);

  const [current24h, previous24h, recent7DaysLogs] = await Promise.all([
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
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
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

  if (previous24h > 0) {

    isDrop = changePercent < -50;
  } else if (recent7DaysLogs.length > 0) {

    const avgDailyCount = recent7DaysLogs.length / 7;
    const expected24h = avgDailyCount;

    if (expected24h > 0 && current24h < expected24h * 0.5) {
      isDrop = true;
    }
  }

  if (recent7DaysLogs.length >= 24) {

    const hourlyCounts = new Map<number, number>();
    recent7DaysLogs.forEach((log) => {
      const hour = log.createdAt.getHours();
      hourlyCounts.set(hour, (hourlyCounts.get(hour) || 0) + 1);
    });

    const currentHour = now.getHours();
    const windowSize = 6;
    const currentWindowStart = Math.floor(currentHour / windowSize) * windowSize;

    const historicalWindowCounts: number[] = [];
    for (let day = 1; day <= 7; day++) {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - day);
      dayStart.setHours(currentWindowStart, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(dayStart.getHours() + windowSize);

      const windowCount = await prisma.conversionLog.count({
        where: {
          shopId,
          createdAt: {
            gte: dayStart,
            lt: dayEnd,
          },
        },
      });
      historicalWindowCounts.push(windowCount);
    }

    if (historicalWindowCounts.length > 0) {
      const avgHistoricalWindow = historicalWindowCounts.reduce((sum, c) => sum + c, 0) / historicalWindowCounts.length;
      const variance = historicalWindowCounts.reduce((sum, c) => sum + Math.pow(c - avgHistoricalWindow, 2), 0) / historicalWindowCounts.length;
      const stdDev = Math.sqrt(variance);

      const currentWindowStartTime = new Date(now);
      currentWindowStartTime.setHours(currentWindowStart, 0, 0, 0);
      const currentWindowCount = await prisma.conversionLog.count({
        where: {
          shopId,
          createdAt: { gte: currentWindowStartTime },
        },
      });

      const threshold = avgHistoricalWindow - 2 * stdDev;
      if (currentWindowCount < threshold && threshold > 0 && avgHistoricalWindow > 0) {
        isDrop = true;
      }
    }
  }

  if (recent7DaysLogs.length >= 24) {

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

      const threshold = mean - 2 * stdDev;
      if (current24h < threshold && threshold > 0) {
        isDrop = true;
      }
    }
  }

  let average7Days: number | undefined;
  let stdDev: number | undefined;
  let threshold: number | undefined;

  if (recent7DaysLogs.length >= 7) {

    const dailyCounts = new Map<string, number>();
    recent7DaysLogs.forEach((log) => {
      const day = log.createdAt.toISOString().split("T")[0];
      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
    });

    const counts = Array.from(dailyCounts.values());
    if (counts.length > 0) {
      average7Days = counts.reduce((sum, c) => sum + c, 0) / counts.length;
      const variance = counts.reduce((sum, c) => sum + Math.pow(c - average7Days, 2), 0) / counts.length;
      stdDev = Math.sqrt(variance);
      threshold = average7Days - 2 * stdDev;
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
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
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
    return {
      shouldAlert: true,
      reason: `事件量下降 ${Math.abs(volumeStats.changePercent).toFixed(2)}%，可能发生断档`,
      severity: Math.abs(volumeStats.changePercent) > 80 ? "critical" : "warning",
      stats: {
        volumeDrop: volumeStats.changePercent,
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

