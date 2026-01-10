import prisma from "../db.server";
import { logger } from "../utils/logger.server";

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (payload.platform && typeof payload.platform === "string") {
    return payload.platform;
  }
  if (payload.destination && typeof payload.destination === "string") {
    return payload.destination;
  }
  return null;
}

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

export async function getEventMonitoringStats(shopId: string, hours: number = 24): Promise<EventMonitoringStats> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: since,
      },
    },
    select: {
      payloadJson: true,
    },
  });
  const byPlatform: Record<string, { total: number; success: number; failure: number }> = {};
  let successCount = 0;
  let failureCount = 0;
  let pendingCount = 0;
  let retryingCount = 0;
  let deadLetterCount = 0;
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, success: 0, failure: 0 };
    }
    byPlatform[platform].total++;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    if (hasValue && hasCurrency) {
      successCount++;
      byPlatform[platform].success++;
    } else {
      failureCount++;
      byPlatform[platform].failure++;
    }
  }
  const totalEvents = receipts.length;
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
    prisma.pixelEventReceipt.count({
      where: {
        shopId,
        createdAt: { gte: currentPeriodStart },
      },
    }),
    prisma.pixelEventReceipt.count({
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

export async function getMissingParamsStats(shopId: string, hours: number = 24): Promise<MissingParamsStats> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: since,
      },
    },
    select: {
      payloadJson: true,
    },
  });
  const byPlatform: Record<string, { total: number; missing: number; rate: number }> = {};
  let totalMissing = 0;
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, missing: 0, rate: 0 };
    }
    byPlatform[platform].total++;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    const hasItems = Array.isArray(data?.items) && data.items.length > 0;
    if (!hasValue || !hasCurrency || !hasItems) {
      byPlatform[platform].missing++;
      totalMissing++;
    }
  }
  for (const platform in byPlatform) {
    const stats = byPlatform[platform];
    stats.rate = stats.total > 0 ? (stats.missing / stats.total) * 100 : 0;
  }
  const total = receipts.length;
  const missingParamsRate = total > 0 ? (totalMissing / total) * 100 : 0;
  return {
    total,
    missingParams: totalMissing,
    missingParamsRate,
    byPlatform,
  };
}
