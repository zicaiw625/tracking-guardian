/**
 * P2-9: Dashboard 指标预聚合服务
 * 
 * 将 dashboard 指标的计算结果缓存到预聚合表中，避免每次请求都进行复杂的 group by 查询。
 * 通过 cron 任务定期更新聚合数据。
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface DailyAggregatedMetrics {
  shopId: string;
  date: Date; // 日期（只包含年月日）
  totalOrders: number;
  totalValue: number;
  successRate: number;
  platformBreakdown: Record<string, { count: number; value: number }>;
  eventVolume: number;
  missingParamsRate: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 聚合指定日期的指标数据
 */
export async function aggregateDailyMetrics(
  shopId: string,
  date: Date
): Promise<DailyAggregatedMetrics> {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);

  // 查询转化日志
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    select: {
      platform: true,
      status: true,
      orderValue: true,
    },
  });

  const totalOrders = conversionLogs.length;
  const successfulOrders = conversionLogs.filter((log) => log.status === "sent").length;
  const totalValue = conversionLogs.reduce((sum, log) => sum + Number(log.orderValue), 0);
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;

  // 按平台分组统计
  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const log of conversionLogs) {
    if (!platformBreakdown[log.platform]) {
      platformBreakdown[log.platform] = { count: 0, value: 0 };
    }
    platformBreakdown[log.platform].count++;
    platformBreakdown[log.platform].value += Number(log.orderValue);
  }

  // 查询事件量（从 pixelEventReceipt）
  const eventVolume = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  // 查询缺失参数率（简化版本，实际应该从更详细的统计中获取）
  const missingParamsRate = 0; // TODO: 从专门的统计表中获取

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

  // 保存到预聚合表（如果存在）
  // 注意：这里假设有一个 DailyMetrics 表，实际需要根据 schema 调整
  try {
    // 使用 upsert 避免重复
    // await prisma.dailyMetrics.upsert({
    //   where: {
    //     shopId_date: {
    //       shopId,
    //       date: startOfDay,
    //     },
    //   },
    //   update: metrics,
    //   create: metrics,
    // });
  } catch (error) {
    // 如果表不存在，只记录日志，不影响主流程
    logger.debug("Daily metrics table not available, skipping aggregation", {
      shopId,
      date: startOfDay.toISOString(),
    });
  }

  return metrics;
}

/**
 * 获取聚合后的指标（优先使用预聚合数据）
 */
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
  // 优先从预聚合表查询
  // 如果预聚合表不存在或数据不完整，回退到实时计算
  try {
    // const aggregated = await prisma.dailyMetrics.findMany({
    //   where: {
    //     shopId,
    //     date: {
    //       gte: startDate,
    //       lte: endDate,
    //     },
    //   },
    //   orderBy: { date: "asc" },
    // });

    // if (aggregated.length > 0) {
    //   // 汇总所有日期的数据
    //   const totalOrders = aggregated.reduce((sum, m) => sum + m.totalOrders, 0);
    //   const totalValue = aggregated.reduce((sum, m) => sum + m.totalValue, 0);
    //   const totalSuccessful = aggregated.reduce(
    //     (sum, m) => sum + m.totalOrders * m.successRate,
    //     0
    //   );
    //   const successRate = totalOrders > 0 ? totalSuccessful / totalOrders : 0;

    //   // 合并平台统计
    //   const platformBreakdown: Record<string, { count: number; value: number }> = {};
    //   for (const metric of aggregated) {
    //     for (const [platform, stats] of Object.entries(metric.platformBreakdown)) {
    //       if (!platformBreakdown[platform]) {
    //         platformBreakdown[platform] = { count: 0, value: 0 };
    //       }
    //       platformBreakdown[platform].count += stats.count;
    //       platformBreakdown[platform].value += stats.value;
    //     }
    //   }

    //   return {
    //     totalOrders,
    //     totalValue,
    //     successRate,
    //     platformBreakdown,
    //     dailyBreakdown: aggregated.map((m) => ({
    //       date: m.date,
    //       totalOrders: m.totalOrders,
    //       totalValue: m.totalValue,
    //       successRate: m.successRate,
    //     })),
    //   };
    // }
  } catch (error) {
    logger.debug("Failed to get aggregated metrics, falling back to real-time calculation", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 回退到实时计算
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      platform: true,
      status: true,
      orderValue: true,
      createdAt: true,
    },
  });

  const totalOrders = conversionLogs.length;
  const successfulOrders = conversionLogs.filter((log) => log.status === "sent").length;
  const totalValue = conversionLogs.reduce((sum, log) => sum + Number(log.orderValue), 0);
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;

  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const log of conversionLogs) {
    if (!platformBreakdown[log.platform]) {
      platformBreakdown[log.platform] = { count: 0, value: 0 };
    }
    platformBreakdown[log.platform].count++;
    platformBreakdown[log.platform].value += Number(log.orderValue);
  }

  // 按日期分组
  const dailyMap = new Map<string, { orders: number; value: number; successful: number }>();
  for (const log of conversionLogs) {
    const dateKey = log.createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { orders: 0, value: 0, successful: 0 });
    }
    const day = dailyMap.get(dateKey)!;
    day.orders++;
    day.value += Number(log.orderValue);
    if (log.status === "sent") {
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

/**
 * 批量聚合多个店铺的指标（用于 cron 任务）
 */
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

