import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface DailyAggregatedMetrics {
  shopId: string;
  date: Date;
  totalOrders: number;
  totalValue: number;
  successRate: number;
  platformBreakdown: Record<string, { count: number; value: number }>;
  eventVolume: number;
  missingParamsRate: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function aggregateDailyMetrics(
  shopId: string,
  date: Date
): Promise<DailyAggregatedMetrics> {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      EventLog: {
        eventName: {
          in: ["purchase", "checkout_completed"],
        },
      },
    },
    select: {
      destinationType: true,
      status: true,
      EventLog: {
        select: {
          normalizedEventJson: true,
        },
      },
    },
    take: 10000,
  });

  const orders: Array<{ platform: string; status: string; value: number }> = [];
  for (const attempt of attempts) {
    const normalizedEvent = attempt.EventLog.normalizedEventJson as Record<string, unknown>;
    const value = typeof normalizedEvent.value === "number" ? normalizedEvent.value : 0;

    orders.push({
      platform: attempt.destinationType,
      status: attempt.status,
      value,
    });
  }

  const totalOrders = orders.length;
  const successfulOrders = orders.filter((o) => o.status === "ok").length;
  const totalValue = orders.reduce((sum, o) => sum + o.value, 0);
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;

  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const order of orders) {
    if (!platformBreakdown[order.platform]) {
      platformBreakdown[order.platform] = { count: 0, value: 0 };
    }
    platformBreakdown[order.platform].count++;
    platformBreakdown[order.platform].value += order.value;
  }

  const eventVolume = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  const missingParamsRate = 0;

  const metrics: DailyAggregatedMetrics = {
    shopId,
    date: startOfDay,
    totalOrders,
    totalValue,
    successRate,
    platformBreakdown,
    eventVolume,
    missingParamsRate,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  try {

  } catch (error) {

    logger.debug("Daily metrics table not available, skipping aggregation", {
      shopId,
      date: startOfDay.toISOString(),
    });
  }

  return metrics;
}

export async function getAggregatedMetrics(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalOrders: number;
  totalValue: number;
  successRate: number;
  platformBreakdown: Record<string, { count: number; value: number }>;
  dailyBreakdown: Array<{
    date: Date;
    totalOrders: number;
    totalValue: number;
    successRate: number;
  }>;
}> {

  try {

  } catch (error) {
    logger.debug("Failed to get aggregated metrics, falling back to real-time calculation", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      EventLog: {
        eventName: {
          in: ["purchase", "checkout_completed"],
        },
      },
    },
    select: {
      destinationType: true,
      status: true,
      createdAt: true,
      EventLog: {
        select: {
          normalizedEventJson: true,
        },
      },
    },
    take: 10000,
  });

  const orders: Array<{ platform: string; status: string; value: number; createdAt: Date }> = [];
  for (const attempt of attempts) {
    const normalizedEvent = attempt.EventLog.normalizedEventJson as Record<string, unknown>;
    const value = typeof normalizedEvent.value === "number" ? normalizedEvent.value : 0;

    orders.push({
      platform: attempt.destinationType,
      status: attempt.status,
      value,
      createdAt: attempt.createdAt,
    });
  }

  const totalOrders = orders.length;
  const successfulOrders = orders.filter((o) => o.status === "ok").length;
  const totalValue = orders.reduce((sum, o) => sum + o.value, 0);
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;

  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const order of orders) {
    if (!platformBreakdown[order.platform]) {
      platformBreakdown[order.platform] = { count: 0, value: 0 };
    }
    platformBreakdown[order.platform].count++;
    platformBreakdown[order.platform].value += order.value;
  }

  const dailyMap = new Map<string, { orders: number; value: number; successful: number }>();
  for (const order of orders) {
    const dateKey = order.createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { orders: 0, value: 0, successful: 0 });
    }
    const day = dailyMap.get(dateKey)!;
    day.orders++;
    day.value += order.value;
    if (order.status === "ok") {
      day.successful++;
    }
  }

  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([dateKey, stats]) => ({
      date: new Date(dateKey),
      totalOrders: stats.orders,
      totalValue: stats.value,
      successRate: stats.orders > 0 ? stats.successful / stats.orders : 0,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    totalOrders,
    totalValue,
    successRate,
    platformBreakdown,
    dailyBreakdown,
  };
}

export async function batchAggregateMetrics(
  shopIds: string[],
  date: Date = new Date()
): Promise<number> {
  let successCount = 0;

  for (const shopId of shopIds) {
    try {
      await aggregateDailyMetrics(shopId, date);
      successCount++;
    } catch (error) {
      logger.error("Failed to aggregate metrics for shop", error instanceof Error ? error : new Error(String(error)), {
        shopId,
        date: date.toISOString(),
      });
    }
  }

  logger.info("Batch aggregation completed", {
    total: shopIds.length,
    success: successCount,
    failed: shopIds.length - successCount,
  });

  return successCount;
}
