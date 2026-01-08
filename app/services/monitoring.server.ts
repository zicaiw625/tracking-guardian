import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getDeliveryAttemptStats } from "./event-log.server";

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
        latencyP50?: number;
    latencyP95?: number;
  }>;
  byEventType: Record<string, {
    total: number;
    success: number;
    failed: number;
    successRate: number;
    failureRate: number;
  }>;
    latencyP50?: number;
  latencyP95?: number;
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

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    select: {
      destinationType: true,
      status: true,
      latencyMs: true,
      EventLog: {
        select: {
          eventName: true,
        },
      },
    },
    take: 10000,
  });

  const stats: EventMonitoringStats = {
    totalEvents: attempts.length,
    successfulEvents: attempts.filter((a) => a.status === "ok").length,
    failedEvents: attempts.filter((a) => a.status === "fail").length,
    successRate: 0,
    failureRate: 0,
    byPlatform: {},
    byEventType: {},
  };

  if (stats.totalEvents > 0) {
    stats.successRate = (stats.successfulEvents / stats.totalEvents) * 100;
    stats.failureRate = (stats.failedEvents / stats.totalEvents) * 100;
  }

    const allLatencies = attempts
    .filter((a) => a.latencyMs !== null && a.latencyMs !== undefined)
    .map((a) => a.latencyMs!)
    .sort((a, b) => a - b);

  if (allLatencies.length > 0) {
    stats.latencyP50 = allLatencies[Math.floor(allLatencies.length * 0.5)] || 0;
    stats.latencyP95 = allLatencies[Math.floor(allLatencies.length * 0.95)] || 0;
  }

  const platforms = new Set(attempts.map((a) => a.destinationType));
  platforms.forEach((platform) => {
    const platformAttempts = attempts.filter((a) => a.destinationType === platform);
    const success = platformAttempts.filter((a) => a.status === "ok").length;
    const failed = platformAttempts.filter((a) => a.status === "fail").length;
    const total = platformAttempts.length;

        const platformLatencies = platformAttempts
      .filter((a) => a.latencyMs !== null && a.latencyMs !== undefined)
      .map((a) => a.latencyMs!)
      .sort((a, b) => a - b);

    let latencyP50: number | undefined;
    let latencyP95: number | undefined;
    if (platformLatencies.length > 0) {
      latencyP50 = platformLatencies[Math.floor(platformLatencies.length * 0.5)] || 0;
      latencyP95 = platformLatencies[Math.floor(platformLatencies.length * 0.95)] || 0;
    }

    stats.byPlatform[platform] = {
      total,
      success,
      failed,
      successRate: total > 0 ? (success / total) * 100 : 0,
      latencyP50,
      latencyP95,
    };
  });

  const eventTypes = new Set(attempts.map((a) => a.EventLog.eventName));
  eventTypes.forEach((eventType) => {
    const eventAttempts = attempts.filter((a) => a.EventLog.eventName === eventType);
    const success = eventAttempts.filter((a) => a.status === "ok").length;
    const failed = eventAttempts.filter((a) => a.status === "fail").length;
    const total = eventAttempts.length;

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

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      status: { in: ["ok", "fail"] },
    },
    select: {
      destinationType: true,
      requestPayloadJson: true,
      EventLog: {
        select: {
          eventName: true,
          eventId: true,
        },
      },
    },
  });

  const missingParamsMap = new Map<string, MissingParamsStats>();

  attempts.forEach((attempt) => {
    const key = `${attempt.destinationType}:${attempt.EventLog.eventName}`;
    const missingParams: string[] = [];

    const requestPayload = attempt.requestPayloadJson as Record<string, unknown>;
    let hasValue = false;
    let hasCurrency = false;
    const hasEventId = !!attempt.EventLog.eventId;

    if (attempt.destinationType === "google") {
      const body = requestPayload.body as Record<string, unknown>;
      const events = body?.events as Array<Record<string, unknown>> | undefined;
      if (events && events.length > 0) {
        const params = events[0].params as Record<string, unknown> | undefined;
        hasValue = params?.value !== undefined && params?.value !== null;
        hasCurrency = !!params?.currency;
      }
    } else if (attempt.destinationType === "meta" || attempt.destinationType === "facebook") {
      const body = requestPayload.body as Record<string, unknown>;
      const data = body?.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const customData = data[0].custom_data as Record<string, unknown> | undefined;
        hasValue = customData?.value !== undefined && customData?.value !== null;
        hasCurrency = !!customData?.currency;
      }
    } else if (attempt.destinationType === "tiktok") {
      const body = requestPayload.body as Record<string, unknown>;
      const data = body?.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const properties = data[0].properties as Record<string, unknown> | undefined;
        hasValue = properties?.value !== undefined && properties?.value !== null;
        hasCurrency = !!properties?.currency;
      }
    }

                if (!hasValue) {
      missingParams.push("value");
    }
    if (!hasCurrency) {
      missingParams.push("currency");
    }
    if (!hasEventId) {
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
          eventType: attempt.EventLog.eventName,
          platform: attempt.destinationType,
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

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      status: { in: ["ok", "fail"] },
    },
    select: {
      destinationType: true,
      requestPayloadJson: true,
      createdAt: true,
      EventLog: {
        select: {
          eventName: true,
          eventId: true,
        },
      },
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

  attempts.forEach((attempt) => {
    total++;
    const missingParams: string[] = [];

    const requestPayload = attempt.requestPayloadJson as Record<string, unknown>;
    let hasValue = false;
    let hasCurrency = false;
    const hasEventId = !!attempt.EventLog.eventId;

    if (attempt.destinationType === "google") {
      const body = requestPayload.body as Record<string, unknown>;
      const events = body?.events as Array<Record<string, unknown>> | undefined;
      if (events && events.length > 0) {
        const params = events[0].params as Record<string, unknown> | undefined;
        hasValue = params?.value !== undefined && params?.value !== null;
        hasCurrency = !!params?.currency;
      }
    } else if (attempt.destinationType === "meta" || attempt.destinationType === "facebook") {
      const body = requestPayload.body as Record<string, unknown>;
      const data = body?.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const customData = data[0].custom_data as Record<string, unknown> | undefined;
        hasValue = customData?.value !== undefined && customData?.value !== null;
        hasCurrency = !!customData?.currency;
      }
    } else if (attempt.destinationType === "tiktok") {
      const body = requestPayload.body as Record<string, unknown>;
      const data = body?.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const properties = data[0].properties as Record<string, unknown> | undefined;
        hasValue = properties?.value !== undefined && properties?.value !== null;
        hasCurrency = !!properties?.currency;
      }
    }

                            if (!hasValue) {
      missingParams.push("value");
    }
    if (!hasCurrency) {
      missingParams.push("currency");
    }
    if (!hasEventId) {
      missingParams.push("event_id");
    }

    const hasMissing = missingParams.length > 0;
    if (hasMissing) {
      missing++;
    }

    const eventType = attempt.EventLog.eventName;
    if (!byEventType[eventType]) {
      byEventType[eventType] = {
        total: 0,
        missing: 0,
        rate: 0,
        missingParams: {},
      };
    }
    byEventType[eventType].total++;
    if (hasMissing) {
      byEventType[eventType].missing++;
      missingParams.forEach((param) => {
        byEventType[eventType].missingParams[param] =
          (byEventType[eventType].missingParams[param] || 0) + 1;
      });
    }
    byEventType[eventType].rate =
      byEventType[eventType].total > 0
        ? (byEventType[eventType].missing / byEventType[eventType].total) * 100
        : 0;

    const platform = attempt.destinationType;
    if (!byPlatform[platform]) {
      byPlatform[platform] = {
        total: 0,
        missing: 0,
        rate: 0,
      };
    }
    byPlatform[platform].total++;
    if (hasMissing) {
      byPlatform[platform].missing++;
    }
    byPlatform[platform].rate =
      byPlatform[platform].total > 0
        ? (byPlatform[platform].missing / byPlatform[platform].total) * 100
        : 0;

    if (hasMissing && recent.length < 50) {
      recent.push({
        timestamp: attempt.createdAt,
        eventType,
        platform,
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

  const [current24h, previous24h, recent14DaysAttempts] = await Promise.all([
    prisma.deliveryAttempt.count({
      where: {
        shopId,
        createdAt: { gte: current24hStart },
      },
    }),
    prisma.deliveryAttempt.count({
      where: {
        shopId,
        createdAt: {
          gte: previous24hStart,
          lt: current24hStart,
        },
      },
    }),
    prisma.deliveryAttempt.findMany({
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

  if (recent14DaysAttempts.length >= 7) {
    const dailyCounts = new Map<string, { count: number; isWeekend: boolean }>();
    recent14DaysAttempts.forEach((attempt) => {
      const day = attempt.createdAt.toISOString().split("T")[0];
      const existing = dailyCounts.get(day);
      if (existing) {
        existing.count++;
      } else {
        dailyCounts.set(day, {
          count: 1,
          isWeekend: isWeekend(attempt.createdAt),
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

  const attempts = await prisma.deliveryAttempt.findMany({
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
  attempts.forEach((attempt) => {
    const day = attempt.createdAt.toISOString().split("T")[0];
    dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
  });

  const counts = Array.from(dailyCounts.values());
  let mean = 0;
  let stdDev = 0;
  if (counts.length > 0) {
    mean = counts.reduce((sum, c) => sum + c, 0) / counts.length;

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

    const checkoutCompletedStats = monitoringStats.byEventType["checkout_completed"];
    const hasCheckoutCompletedDrop = checkoutCompletedStats &&
      checkoutCompletedStats.total > 0 &&
      (checkoutCompletedStats.failed / checkoutCompletedStats.total) * 100 > volumeDropThreshold;

    let reason = `事件量下降 ${Math.abs(volumeStats.changePercent).toFixed(2)}%，可能发生断档`;
    if (hasCheckoutCompletedDrop || checkoutCompletedStats) {
      reason += `。注意：checkout_completed 事件量下降可能是 Shopify 平台行为导致的：`;
      reason += `（1）存在 upsell/post-purchase 时，事件在第一个 upsell 页触发，Thank you 页不再触发；`;
      reason += `（2）触发页加载失败时，事件完全不触发；`;
      reason += `（3）用户未同意 analytics consent 时，事件不会触发。`;

      reason += `v1.0 版本仅依赖 Web Pixels 标准事件，请确保 checkout_completed 事件能够正常触发。`;
    }

    return {
      shouldAlert: true,
      reason,
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

    const attempts = await prisma.deliveryAttempt.findMany({
      where: {
        shopId,
        destinationType: platform,
        createdAt: { gte: since },
        status: "ok",
        EventLog: {
          eventName: {
            in: ["purchase", "checkout_completed"],
          },
        },
      },
      select: {
        EventLog: {
          select: {
            normalizedEventJson: true,
          },
        },
      },
      take: 10000,
    });

    const platformEvents: Array<{ orderId: string; value: number }> = [];
    for (const attempt of attempts) {
      const normalizedEvent = attempt.EventLog.normalizedEventJson as Record<string, unknown>;
      const orderId = typeof normalizedEvent.order_id === "string" ? normalizedEvent.order_id :
                     typeof normalizedEvent.orderId === "string" ? normalizedEvent.orderId : "";
      const value = typeof normalizedEvent.value === "number" ? normalizedEvent.value : 0;

      if (orderId) {
        platformEvents.push({ orderId, value });
      }
    }

    const platformEventCount = new Set(platformEvents.map(e => e.orderId)).size;
    const platformTotalValue = platformEvents.reduce((sum, e) => sum + e.value, 0);

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

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      status: { in: ["ok", "fail"] },
    },
    select: {
      createdAt: true,
      destinationType: true,
      requestPayloadJson: true,
      EventLog: {
        select: {
          eventName: true,
          eventId: true,
        },
      },
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

  attempts.forEach((attempt) => {
    const date = attempt.createdAt.toISOString().split("T")[0];

    const requestPayload = attempt.requestPayloadJson as Record<string, unknown>;
    let hasValue = false;
    let hasCurrency = false;
    const hasEventId = !!attempt.EventLog.eventId;

    if (attempt.destinationType === "google") {
      const body = requestPayload.body as Record<string, unknown>;
      const events = body?.events as Array<Record<string, unknown>> | undefined;
      if (events && events.length > 0) {
        const params = events[0].params as Record<string, unknown> | undefined;
        hasValue = params?.value !== undefined && params?.value !== null;
        hasCurrency = !!params?.currency;
      }
    } else if (attempt.destinationType === "meta" || attempt.destinationType === "facebook") {
      const body = requestPayload.body as Record<string, unknown>;
      const data = body?.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const customData = data[0].custom_data as Record<string, unknown> | undefined;
        hasValue = customData?.value !== undefined && customData?.value !== null;
        hasCurrency = !!customData?.currency;
      }
    } else if (attempt.destinationType === "tiktok") {
      const body = requestPayload.body as Record<string, unknown>;
      const data = body?.data as Array<Record<string, unknown>> | undefined;
      if (data && data.length > 0) {
        const properties = data[0].properties as Record<string, unknown> | undefined;
        hasValue = properties?.value !== undefined && properties?.value !== null;
        hasCurrency = !!properties?.currency;
      }
    }

    const hasMissingParams = !hasValue || !hasCurrency || !hasEventId;

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

    const platform = attempt.destinationType;
    if (!dayData.byPlatform.has(platform)) {
      dayData.byPlatform.set(platform, { total: 0, missing: 0 });
    }
    const platformData = dayData.byPlatform.get(platform)!;
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
