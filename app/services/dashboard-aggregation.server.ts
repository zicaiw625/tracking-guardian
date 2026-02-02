import { randomUUID } from "crypto";
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

  const [
    totalEvents,
    groupedByPlatform,
    validOrders
  ] = await Promise.all([
    // 1. Total Event Volume (all events)
    prisma.pixelEventReceipt.count({
      where: {
        shopId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),

    // 2. Platform Breakdown (successful orders only)
    prisma.pixelEventReceipt.groupBy({
      by: ["platform"],
      where: {
        shopId,
        createdAt: { gte: startOfDay, lte: endOfDay },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
        totalValue: { not: null },
        currency: { not: null },
      },
      _sum: {
        totalValue: true,
      },
      _count: {
        _all: true,
      },
    } as any),

    // 3. Valid Orders stats (for total value and count)
    prisma.pixelEventReceipt.aggregate({
      where: {
        shopId,
        createdAt: { gte: startOfDay, lte: endOfDay },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
        totalValue: { not: null },
        currency: { not: null },
      },
      _sum: {
        totalValue: true,
      },
      _count: {
        _all: true,
      },
    } as any),
  ]);

  // 4. Calculate Missing Params (hmac matched but missing value/currency)
  const potentialOrders = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      createdAt: { gte: startOfDay, lte: endOfDay },
      eventType: { in: ["purchase", "checkout_completed"] },
      hmacMatched: true,
    } as any,
  });

  const totalOrders = potentialOrders;
  const successfulOrders = (validOrders as any)._count._all;
  const totalValue = (validOrders as any)._sum.totalValue ? Number((validOrders as any)._sum.totalValue) : 0;
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;
  const missingParamsRate = totalOrders > 0 ? (totalOrders - successfulOrders) / totalOrders : 0;

  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const group of (groupedByPlatform as any[])) {
    const platform = group.platform || "unknown";
    platformBreakdown[platform] = {
      count: group._count._all,
      value: group._sum.totalValue ? Number(group._sum.totalValue) : 0,
    };
  }

  const eventVolume = totalEvents;
  const now = new Date();

  await prisma.dailyAggregatedMetrics.upsert({
    where: { shopId_date: { shopId, date: startOfDay } },
    create: {
      id: randomUUID(),
      shopId,
      date: startOfDay,
      totalOrders,
      totalValue,
      successRate,
      platformBreakdown: platformBreakdown as object,
      eventVolume,
      missingParamsRate,
      updatedAt: now,
    },
    update: {
      totalOrders,
      totalValue,
      successRate,
      platformBreakdown: platformBreakdown as object,
      eventVolume,
      missingParamsRate,
      updatedAt: now,
    },
  });

  return {
    shopId,
    date: startOfDay,
    totalOrders,
    totalValue,
    successRate,
    platformBreakdown,
    eventVolume,
    missingParamsRate,
    createdAt: now,
    updatedAt: now,
  };
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
  eventVolumeByType: Record<string, number>;
  totalEventVolume: number;
}> {
  const [
    eventVolumeGrouped,
    validOrdersGrouped,
    potentialOrdersGrouped, // For success rate calc
    allMatchedReceipts
  ] = await Promise.all([
    // 1. Event Volume by Type
    prisma.pixelEventReceipt.groupBy({
      by: ["eventType"],
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
      },
      _count: {
        _all: true,
      },
    }),

    // 2. Platform Breakdown (valid orders)
    prisma.pixelEventReceipt.groupBy({
      by: ["platform"],
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
        totalValue: { not: null },
        currency: { not: null },
      },
      _sum: {
        totalValue: true,
      },
      _count: {
        _all: true,
      },
    } as any),

    // 3. Potential Orders (hmac matched) for success rate denominator
    prisma.pixelEventReceipt.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
      } as any,
    }),

    // 4. Daily Breakdown (fetch light data to aggregate in node)
    prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
      } as any,
      select: {
        createdAt: true,
        totalValue: true,
        currency: true,
      } as any,
      take: 50000,
    }),
  ]);

  const eventVolumeByType: Record<string, number> = {};
  let totalEventVolume = 0;
  for (const group of eventVolumeGrouped) {
    const type = group.eventType || "unknown";
    const count = group._count._all;
    eventVolumeByType[type] = count;
    totalEventVolume += count;
  }

  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  let totalValue = 0;
  let successfulOrdersCount = 0;
  
  for (const group of (validOrdersGrouped as any[])) {
    const platform = group.platform || "unknown";
    const val = group._sum.totalValue ? Number(group._sum.totalValue) : 0;
    const cnt = group._count._all;
    platformBreakdown[platform] = {
      count: cnt,
      value: val,
    };
    totalValue += val;
    successfulOrdersCount += cnt;
  }

  const totalOrders = potentialOrdersGrouped;
  const successRate = totalOrders > 0 ? successfulOrdersCount / totalOrders : 0;

  const dailyMap = new Map<string, { orders: number; value: number; successful: number }>();
  
  for (const r of allMatchedReceipts) {
    const dateKey = (r as any).createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { orders: 0, value: 0, successful: 0 });
    }
    const day = dailyMap.get(dateKey)!;
    day.orders++; // It is a matched receipt, so it counts as an order attempt
    
    const isValid = (r as any).totalValue !== null && (r as any).currency !== null;
    if (isValid) {
      day.successful++;
      day.value += Number((r as any).totalValue);
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
    eventVolumeByType,
    totalEventVolume,
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
