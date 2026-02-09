import prisma from "../db.server";

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
  const jobStats = await prisma.eventDispatchJob.groupBy({
    by: ['status'],
    where: {
      InternalEvent: {
        shopId,
      },
      createdAt: {
        gte: since,
      },
    },
    _count: {
      _all: true
    }
  });

  const pendingCount = jobStats.filter(s => s.status === 'pending' || s.status === 'queued').reduce((acc, s) => acc + s._count._all, 0);
  const retryingCount = jobStats.filter(s => s.status === 'retrying').reduce((acc, s) => acc + s._count._all, 0);
  const deadLetterCount = jobStats.filter(s => s.status === 'failed' || s.status === 'dead_letter').reduce((acc, s) => acc + s._count._all, 0);

  let successCount = 0;
  let failureCount = 0;
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
