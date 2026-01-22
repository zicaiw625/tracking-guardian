import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { parseReceiptPayload, extractPlatformFromPayload, isRecord } from "../utils/common";

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      eventType: {
        in: ["purchase", "checkout_completed"],
      },
    },
    select: {
      payloadJson: true,
      createdAt: true,
    },
    take: 10000,
  });
  const orders: Array<{ platform: string; status: string; value: number }> = [];
  for (const receipt of receipts) {
    const parsed = parseReceiptPayload(receipt.payloadJson);
    if (!parsed) {
      const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
      const platform = extractPlatformFromPayload(payload) || "unknown";
      const data = payload && isRecord(payload.data) ? payload.data : null;
      const value = data && typeof data.value === "number" ? data.value : 0;
      const hasValue = value > 0;
      const hasCurrency = data !== null && typeof data.currency === "string" && data.currency.trim().length > 0;
      orders.push({
        platform,
        status: hasValue && hasCurrency ? "ok" : "pending",
        value,
      });
    } else {
      orders.push({
        platform: parsed.platform,
        status: parsed.hasValue && parsed.hasCurrency ? "ok" : "pending",
        value: parsed.value,
      });
    }
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
  const ordersWithMissingParams = orders.filter((o) => o.status !== "ok").length;
  const missingParamsRate = totalOrders > 0 ? ordersWithMissingParams / totalOrders : 0;
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
    await prisma.dailyAggregatedMetrics.upsert({
      where: {
        shopId_date: {
          shopId,
          date: startOfDay,
        },
      },
      update: {
        totalOrders,
        totalValue,
        successRate,
        platformBreakdown,
        eventVolume,
        missingParamsRate,
        updatedAt: new Date(),
      },
      create: {
        shopId,
        date: startOfDay,
        totalOrders,
        totalValue,
        successRate,
        platformBreakdown,
        eventVolume,
        missingParamsRate,
      },
    });
  } catch (error) {
    logger.debug("Failed to persist daily metrics", {
      shopId,
      date: startOfDay.toISOString(),
      error: error instanceof Error ? error.message : String(error),
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
    const startDateOnly = new Date(startDate);
    startDateOnly.setUTCHours(0, 0, 0, 0);
    const endDateOnly = new Date(endDate);
    endDateOnly.setUTCHours(23, 59, 59, 999);
    
    const persistedMetrics = await prisma.dailyAggregatedMetrics.findMany({
      where: {
        shopId,
        date: {
          gte: startDateOnly,
          lte: endDateOnly,
        },
      },
      orderBy: {
        date: "asc",
      },
    });
    
    if (persistedMetrics.length > 0) {
      const totalOrders = persistedMetrics.reduce((sum: number, m: { totalOrders: number }) => sum + m.totalOrders, 0);
      const totalValue = persistedMetrics.reduce((sum: number, m: { totalValue: { toNumber?: () => number } | number }) => sum + Number(m.totalValue), 0);
      const totalSuccessful = persistedMetrics.reduce((sum: number, m: { totalOrders: number; successRate: number }) => sum + Math.round(m.totalOrders * m.successRate), 0);
      const successRate = totalOrders > 0 ? totalSuccessful / totalOrders : 0;
      
      const platformBreakdown: Record<string, { count: number; value: number }> = {};
      for (const metric of persistedMetrics) {
        const breakdown = metric.platformBreakdown as Record<string, { count: number; value: number }> | null;
        if (breakdown) {
          for (const [platform, stats] of Object.entries(breakdown)) {
            if (!platformBreakdown[platform]) {
              platformBreakdown[platform] = { count: 0, value: 0 };
            }
            platformBreakdown[platform].count += stats.count;
            platformBreakdown[platform].value += stats.value;
          }
        }
      }
      
      const dailyBreakdown = persistedMetrics.map((m: { date: Date; totalOrders: number; totalValue: { toNumber?: () => number } | number; successRate: number }) => ({
        date: m.date,
        totalOrders: m.totalOrders,
        totalValue: Number(m.totalValue),
        successRate: m.successRate,
      }));
      
      return {
        totalOrders,
        totalValue,
        successRate,
        platformBreakdown,
        dailyBreakdown,
      };
    }
  } catch (error) {
    logger.debug("Failed to read persisted metrics, falling back to real-time calculation", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      eventType: {
        in: ["purchase", "checkout_completed"],
      },
    },
    select: {
      payloadJson: true,
      createdAt: true,
    },
    take: 10000,
  });
  const orders: Array<{ platform: string; status: string; value: number; createdAt: Date }> = [];
  for (const receipt of receipts) {
    const parsed = parseReceiptPayload(receipt.payloadJson);
    if (!parsed) {
      const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
      const platform = extractPlatformFromPayload(payload) || "unknown";
      const data = payload && isRecord(payload.data) ? payload.data : null;
      const value = data && typeof data.value === "number" ? data.value : 0;
      const hasValue = value > 0;
      const hasCurrency = data !== null && typeof data.currency === "string" && data.currency.trim().length > 0;
      orders.push({
        platform,
        status: hasValue && hasCurrency ? "ok" : "pending",
        value,
        createdAt: receipt.createdAt,
      });
    } else {
      orders.push({
        platform: parsed.platform,
        status: parsed.hasValue && parsed.hasCurrency ? "ok" : "pending",
        value: parsed.value,
        createdAt: receipt.createdAt,
      });
    }
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
