import { randomUUID } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface DailyAggregatedMetrics {
  shopId: string;
  date: Date;
  totalOrders: number;
  shopifyOrderCount: number;
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
    validOrders,
    shopifyOrderCount
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

    // 3. Valid Orders stats (for total value and count) - Deduped by orderKey
    prisma.pixelEventReceipt.groupBy({
      by: ["orderKey"],
      where: {
        shopId,
        createdAt: { gte: startOfDay, lte: endOfDay },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
        totalValue: { not: null },
        currency: { not: null },
        orderKey: { not: null },
      },
      _max: {
        totalValue: true,
      },
    }),

    // 4. Shopify Orders Count
    prisma.orderSummary.count({
      where: {
        shopId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
  ]);

  // 4. Calculate Missing Params (hmac matched but missing value/currency)
  // Deduped by orderKey to avoid inflating "Orders" count due to multi-platform delivery
  const potentialOrdersGroups = await prisma.pixelEventReceipt.groupBy({
    by: ["orderKey"],
    where: {
      shopId,
      createdAt: { gte: startOfDay, lte: endOfDay },
      eventType: { in: ["purchase", "checkout_completed"] },
      hmacMatched: true,
      orderKey: { not: null },
    },
  });

  const totalOrders = potentialOrdersGroups.length;
  const validOrdersGroups = validOrders as unknown as Array<{ orderKey: string; _max: { totalValue: string | null } }>;
  const successfulOrders = validOrdersGroups.length;
  const totalValue = validOrdersGroups.reduce((sum, group) => sum + (group._max.totalValue ? Number(group._max.totalValue) : 0), 0);
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
    shopifyOrderCount,
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
  shopifyOrderCount: number;
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
    allMatchedReceipts,
    validOrdersGlobal, // Deduped global stats
    shopifyOrderCount
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
    prisma.pixelEventReceipt.groupBy({
      by: ["orderKey"],
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
        orderKey: { not: null },
      },
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
        orderKey: true,
      } as any,
      take: 50000,
    }),

    // 5. Valid Orders Global (deduped)
    prisma.pixelEventReceipt.groupBy({
      by: ["orderKey"],
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
        eventType: { in: ["purchase", "checkout_completed"] },
        hmacMatched: true,
        totalValue: { not: null },
        currency: { not: null },
        orderKey: { not: null },
      },
      _max: { totalValue: true },
    }),

    // 6. Shopify Orders Count (for loss rate calc)
    prisma.orderSummary.count({
      where: {
        shopId,
        createdAt: { gte: startDate, lte: endDate },
      },
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
  
  for (const group of (validOrdersGrouped as any[])) {
    const platform = group.platform || "unknown";
    const val = group._sum.totalValue ? Number(group._sum.totalValue) : 0;
    const cnt = group._count._all;
    platformBreakdown[platform] = {
      count: cnt,
      value: val,
    };
  }

  // Calculate global stats from deduped groups
  const potentialOrdersList = potentialOrdersGrouped as unknown as any[];
  const validOrdersList = validOrdersGlobal as unknown as Array<{ orderKey: string; _max: { totalValue: string | null } }>;
  
  const totalOrders = potentialOrdersList.length;
  const successfulOrdersCount = validOrdersList.length;
  const totalValue = validOrdersList.reduce((sum, group) => sum + (group._max.totalValue ? Number(group._max.totalValue) : 0), 0);
  const successRate = totalOrders > 0 ? successfulOrdersCount / totalOrders : 0;

  const dailyMap = new Map<string, { orderKeys: Set<string>; validOrderKeys: Set<string>; value: number }>();
  
  for (const r of (allMatchedReceipts as unknown as any[])) {
    const dateKey = (r as any).createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { orderKeys: new Set(), validOrderKeys: new Set(), value: 0 });
    }
    const day = dailyMap.get(dateKey)!;
    const orderKey = (r as any).orderKey;
    if (!orderKey) continue;

    day.orderKeys.add(orderKey);
    
    const isValid = (r as any).totalValue !== null && (r as any).currency !== null;
    if (isValid) {
      if (!day.validOrderKeys.has(orderKey)) {
        day.validOrderKeys.add(orderKey);
        day.value += Number((r as any).totalValue);
      }
    }
  }

  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([dateKey, stats]) => ({
      date: new Date(dateKey),
      totalOrders: stats.orderKeys.size,
      totalValue: stats.value,
      successRate: stats.orderKeys.size > 0 ? stats.validOrderKeys.size / stats.orderKeys.size : 0,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    totalOrders,
    shopifyOrderCount,
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
