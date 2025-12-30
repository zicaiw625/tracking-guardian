
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { PlanId } from "./plans";

export interface UsageHistoryPoint {
  date: string; // YYYY-MM-DD
  orders: number;
  events: number;
  platforms: Record<string, number>;
}

export interface UsageHistory {
  period: {
    startDate: Date;
    endDate: Date;
    days: number;
  };
  data: UsageHistoryPoint[];
  summary: {
    totalOrders: number;
    totalEvents: number;
    averageDailyOrders: number;
    averageDailyEvents: number;
    peakDay: {
      date: string;
      orders: number;
      events: number;
    };
    platformTotals: Record<string, number>;
  };
}

/**
 * 获取指定时间段的使用量历史
 */
export async function getUsageHistory(
  shopId: string,
  days: number = 30
): Promise<UsageHistory> {
  const endDate = new Date();
  endDate.setUTCHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - days);
  startDate.setUTCHours(0, 0, 0, 0);

  // 获取转化日志
  const conversionLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      status: "sent",
    },
    select: {
      platform: true,
      orderId: true,
      createdAt: true,
    },
  });

  // 获取像素事件收据
  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      orderId: true,
      createdAt: true,
    },
  });

  // 按日期分组
  const dailyData = new Map<string, {
    orderIds: Set<string>;
    eventCount: number;
    platformCounts: Record<string, number>;
  }>();

  // 初始化所有日期
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    dailyData.set(dateStr, {
      orderIds: new Set(),
      eventCount: 0,
      platformCounts: {},
    });
  }

  // 处理转化日志
  conversionLogs.forEach((log) => {
    const dateStr = new Date(log.createdAt).toISOString().split("T")[0];
    const dayData = dailyData.get(dateStr);
    if (dayData) {
      dayData.orderIds.add(log.orderId);
      dayData.eventCount++;
      dayData.platformCounts[log.platform] = (dayData.platformCounts[log.platform] || 0) + 1;
    }
  });

  // 处理像素收据（补充订单数）
  pixelReceipts.forEach((receipt) => {
    const dateStr = new Date(receipt.createdAt).toISOString().split("T")[0];
    const dayData = dailyData.get(dateStr);
    if (dayData) {
      dayData.orderIds.add(receipt.orderId);
    }
  });

  // 转换为数组格式
  const data: UsageHistoryPoint[] = Array.from(dailyData.entries())
    .map(([date, dayData]) => ({
      date,
      orders: dayData.orderIds.size,
      events: dayData.eventCount,
      platforms: { ...dayData.platformCounts },
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 计算汇总统计
  const totalOrders = new Set([
    ...conversionLogs.map((log) => log.orderId),
    ...pixelReceipts.map((receipt) => receipt.orderId),
  ]).size;
  const totalEvents = conversionLogs.length;
  const averageDailyOrders = data.length > 0 ? totalOrders / data.length : 0;
  const averageDailyEvents = data.length > 0 ? totalEvents / data.length : 0;

  // 找到峰值日
  const peakDay = data.reduce(
    (max, day) => (day.orders > max.orders ? day : max),
    { date: data[0]?.date || "", orders: 0, events: 0, platforms: {} }
  );

  // 计算平台总计
  const platformTotals: Record<string, number> = {};
  conversionLogs.forEach((log) => {
    platformTotals[log.platform] = (platformTotals[log.platform] || 0) + 1;
  });

  return {
    period: {
      startDate,
      endDate,
      days,
    },
    data,
    summary: {
      totalOrders,
      totalEvents,
      averageDailyOrders: Math.round(averageDailyOrders * 100) / 100,
      averageDailyEvents: Math.round(averageDailyEvents * 100) / 100,
      peakDay: {
        date: peakDay.date,
        orders: peakDay.orders,
        events: peakDay.events,
      },
      platformTotals,
    },
  };
}

/**
 * 获取使用量趋势（用于图表展示）
 */
export async function getUsageTrend(
  shopId: string,
  days: number = 30
): Promise<{
  labels: string[];
  orders: number[];
  events: number[];
  platforms: Record<string, number[]>;
}> {
  const history = await getUsageHistory(shopId, days);

  const labels = history.data.map((point) => {
    const date = new Date(point.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const orders = history.data.map((point) => point.orders);
  const events = history.data.map((point) => point.events);

  // 按平台分组
  const platforms: Record<string, number[]> = {};
  history.data.forEach((point) => {
    Object.entries(point.platforms).forEach(([platform, count]) => {
      if (!platforms[platform]) {
        platforms[platform] = new Array(history.data.length).fill(0);
      }
      const index = history.data.indexOf(point);
      if (index >= 0) {
        platforms[platform][index] = count;
      }
    });
  });

  return {
    labels,
    orders,
    events,
    platforms,
  };
}

