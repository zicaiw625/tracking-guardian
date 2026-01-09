import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface EventMonitoringStats {
  totalEvents: number;
  successRate: number;
  failureRate: number;
  pendingCount: number;
  retryingCount: number;
  deadLetterCount: number;
  byPlatform: Record<string, {
    total: number;
    success: number;
    failure: number;
  }>;
}

export interface EventVolumeStats {
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

export interface MissingParamsStats {
  total: number;
  missingParams: number;
  missingParamsRate: number;
  byPlatform: Record<string, {
    total: number;
    missing: number;
    rate: number;
  }>;
}

export async function getEventMonitoringStats(shopId: string): Promise<EventMonitoringStats> {
  const stats = await prisma.conversionLog.groupBy({
    by: ["platform", "status"],
    where: {
      shopId,
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), 
      },
    },
    _count: {
      id: true,
    },
  });

  const totalEvents = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
  });

  const byPlatform: Record<string, { total: number; success: number; failure: number }> = {};
  let successCount = 0;
  let failureCount = 0;
  let pendingCount = 0;
  let retryingCount = 0;
  let deadLetterCount = 0;

  for (const stat of stats) {
    const platform = stat.platform;
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, success: 0, failure: 0 };
    }

    const count = stat._count.id;
    byPlatform[platform].total += count;

    if (stat.status === "sent") {
      successCount += count;
      byPlatform[platform].success += count;
    } else if (stat.status === "failed" || stat.status === "dead_letter") {
      failureCount += count;
      byPlatform[platform].failure += count;
      if (stat.status === "dead_letter") {
        deadLetterCount += count;
      }
    } else if (stat.status === "pending") {
      pendingCount += count;
    } else if (stat.status === "retrying") {
      retryingCount += count;
    }
  }

  const successRate = totalEvents > 0 ? (successCount / totalEvents) * 100 : 0;
  const failureRate = totalEvents > 0 ? (failureCount / totalEvents) * 100 : 0;

  return {
    totalEvents,
    successRate,
    failureRate,
    pendingCount,
    retryingCount,
    deadLetterCount,
    byPlatform,
  };
}

export async function getEventVolumeStats(shopId: string): Promise<EventVolumeStats> {
  const now = new Date();
  const currentPeriodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const previousPeriodStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const previousPeriodEnd = currentPeriodStart;

  const [current, previous] = await Promise.all([
    prisma.conversionLog.count({
      where: {
        shopId,
        createdAt: { gte: currentPeriodStart },
      },
    }),
    prisma.conversionLog.count({
      where: {
        shopId,
        createdAt: {
          gte: previousPeriodStart,
          lt: previousPeriodEnd,
        },
      },
    }),
  ]);

  const change = current - previous;
  const changePercent = previous > 0 ? (change / previous) * 100 : 0;

  return {
    current,
    previous,
    change,
    changePercent,
  };
}

export async function getMissingParamsStats(shopId: string): Promise<MissingParamsStats> {
  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
    select: {
      platform: true,
      platformResponse: true,
    },
  });

  const byPlatform: Record<string, { total: number; missing: number; rate: number }> = {};
  let totalMissing = 0;

  for (const log of logs) {
    const platform = log.platform;
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, missing: 0, rate: 0 };
    }

    byPlatform[platform].total++;

    const response = log.platformResponse as { missingParams?: string[] } | null;
    if (response?.missingParams && response.missingParams.length > 0) {
      byPlatform[platform].missing++;
      totalMissing++;
    }
  }

  
  for (const platform in byPlatform) {
    const stats = byPlatform[platform];
    stats.rate = stats.total > 0 ? (stats.missing / stats.total) * 100 : 0;
  }

  const total = logs.length;
  const missingParamsRate = total > 0 ? (totalMissing / total) * 100 : 0;

  return {
    total,
    missingParams: totalMissing,
    missingParamsRate,
    byPlatform,
  };
}
