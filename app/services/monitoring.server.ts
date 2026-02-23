import prisma from "../db.server";

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
      platform: true,
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

  let transactionTotalCount = 0;
  let transactionSuccessCount = 0;

  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = receipt.platform || "unknown";
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, success: 0, failure: 0 };
    }
    byPlatform[platform].total++;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    const eventName = payload?.eventName as string | undefined;
    const isTransactionEvent = eventName === 'checkout_completed' || eventName === 'purchase';

    // Per user requirement (P0-1): Success rate only counts "transaction link events"
    // We treat non-transaction events as "successful" by default in terms of general stats,
    // OR we track transaction stats separately for the top-level successRate.
    
    // For platform-level breakdown, we keep using the strict check for now, 
    // or we should align it too? Let's align platform stats too to avoid confusion.
    
    // Actually, let's stick to the "Success Rate" definition for the health score first.
    // The user said: "Success rate only counts 'transaction link events'"
    
    if (isTransactionEvent) {
      transactionTotalCount++;
      if (hasValue && hasCurrency) {
        transactionSuccessCount++;
        byPlatform[platform].success++;
      } else {
        byPlatform[platform].failure++;
      }
    } else {
      // For non-transaction events, we consider them "valid" if they reached here (ingest passed)
      // So we don't count them as failures.
      byPlatform[platform].success++;
    }
  }
  
  const totalEvents = receipts.length;

  // P0-1: Success rate only counts transaction events
  // If no transaction events, default to 100% to avoid "false alarm" if only page views exist.
  const successRate = transactionTotalCount > 0 
    ? (transactionSuccessCount / transactionTotalCount) * 100 
    : 100;
    
  // Failure rate is inverse of success rate for transactions? 
  // Or global failure rate? 
  // The user says "health score will be dragged down by massive 'false failures'".
  // So failureRate should also reflect transactions.
  const failureRate = transactionTotalCount > 0
    ? ((transactionTotalCount - transactionSuccessCount) / transactionTotalCount) * 100
    : 0;

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
