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

export async function aggregateDailyMetrics(shopId: string, date: Date): Promise<DailyAggregatedMetrics> {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const [totalEvents, groupedByPlatform, validOrders] = await Promise.all([
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
  const totalValue = validOrdersGroups.reduce(
    (sum, group) => sum + (group._max.totalValue ? Number(group._max.totalValue) : 0),
    0
  );
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;
  const missingParamsRate = totalOrders > 0 ? (totalOrders - successfulOrders) / totalOrders : 0;

  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const group of groupedByPlatform as any[]) {
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
  // P0: Avoid unbounded in-memory aggregation and any hard take() truncation.
  // Use DB-side aggregation (dedupe by orderKey, group by day) for correctness and stability.
  const [orderStatsRows, dailyRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        total_orders: bigint;
        successful_orders: bigint;
        total_value: unknown;
      }>
    >`
      WITH per_order AS (
        SELECT
          "orderKey",
          bool_or("totalValue" IS NOT NULL AND "currency" IS NOT NULL) AS valid,
          max("totalValue") AS max_value
        FROM "PixelEventReceipt"
        WHERE
          "shopId" = ${shopId}
          AND "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
          AND "eventType" IN ('purchase', 'checkout_completed')
          AND "hmacMatched" = true
          AND "orderKey" IS NOT NULL
        GROUP BY "orderKey"
      )
      SELECT
        count(*)::bigint AS total_orders,
        count(*) FILTER (WHERE valid)::bigint AS successful_orders,
        COALESCE(sum(max_value) FILTER (WHERE valid), 0) AS total_value
      FROM per_order;
    `,
    prisma.$queryRaw<
      Array<{
        day: Date;
        total_orders: bigint;
        successful_orders: bigint;
        total_value: unknown;
      }>
    >`
      WITH per_order AS (
        SELECT
          date_trunc('day', "createdAt")::date AS day,
          "orderKey",
          bool_or("totalValue" IS NOT NULL AND "currency" IS NOT NULL) AS valid,
          max("totalValue") AS max_value
        FROM "PixelEventReceipt"
        WHERE
          "shopId" = ${shopId}
          AND "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
          AND "eventType" IN ('purchase', 'checkout_completed')
          AND "hmacMatched" = true
          AND "orderKey" IS NOT NULL
        GROUP BY day, "orderKey"
      )
      SELECT
        day,
        count(*)::bigint AS total_orders,
        count(*) FILTER (WHERE valid)::bigint AS successful_orders,
        COALESCE(sum(max_value) FILTER (WHERE valid), 0) AS total_value
      FROM per_order
      GROUP BY day
      ORDER BY day ASC;
    `,
  ]);

  const orderStats = orderStatsRows[0] ?? {
    total_orders: 0n,
    successful_orders: 0n,
    total_value: 0,
  };
  const totalOrders = Number(orderStats.total_orders ?? 0n);
  const successfulOrdersCount = Number(orderStats.successful_orders ?? 0n);
  const totalValue = Number(orderStats.total_value ?? 0) || 0;
  const successRate = totalOrders > 0 ? successfulOrdersCount / totalOrders : 0;

  const dailyBreakdown = dailyRows.map((r) => {
    const dayOrders = Number(r.total_orders ?? 0n);
    const daySuccessful = Number(r.successful_orders ?? 0n);
    const dayValue = Number(r.total_value ?? 0) || 0;
    return {
      date: new Date(r.day),
      totalOrders: dayOrders,
      totalValue: dayValue,
      successRate: dayOrders > 0 ? daySuccessful / dayOrders : 0,
    };
  });

  const [
    eventVolumeGrouped,
    validOrdersGrouped,
    // Global + daily order stats are computed via SQL above.
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

  for (const group of validOrdersGrouped as any[]) {
    const platform = group.platform || "unknown";
    const val = group._sum.totalValue ? Number(group._sum.totalValue) : 0;
    const cnt = group._count._all;
    platformBreakdown[platform] = {
      count: cnt,
      value: val,
    };
  }

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
  date: Date = new Date(),
  options?: { concurrency?: number }
): Promise<number> {
  let successCount = 0;
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 5));

  // Simple worker pool to limit DB pressure.
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      const shopId = shopIds[i];
      if (!shopId) return;
      try {
        await aggregateDailyMetrics(shopId, date);
        successCount++;
      } catch (error) {
        logger.error(
          "Failed to aggregate metrics for shop",
          error instanceof Error ? error : new Error(String(error)),
          {
            shopId,
            date: date.toISOString(),
          }
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, shopIds.length) }, () => worker()));

  logger.info("Batch aggregation completed", {
    total: shopIds.length,
    success: successCount,
    failed: shopIds.length - successCount,
  });
  return successCount;
}
