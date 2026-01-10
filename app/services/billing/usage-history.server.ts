import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { PlanId } from "./plans";

export interface UsageHistoryPoint {
  date: string;
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

export async function getUsageHistory(
  shopId: string,
  days: number = 30
): Promise<UsageHistory> {
  const endDate = new Date();
  endDate.setUTCHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - days);
  startDate.setUTCHours(0, 0, 0, 0);
  const pixelReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      orderKey: true,
      createdAt: true,
      payloadJson: true,
    },
  });
  const dailyData = new Map<string, {
    orderIds: Set<string>;
    eventCount: number;
    platformCounts: Record<string, number>;
  }>();
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    dailyData.set(dateStr, {
      orderIds: new Set(),
      eventCount: 0,
      platformCounts: {},
    });
  }
  pixelReceipts.forEach((receipt) => {
    if (!receipt.orderKey) return;
    const dateStr = new Date(receipt.createdAt).toISOString().split("T")[0];
    const dayData = dailyData.get(dateStr);
    if (dayData) {
      dayData.orderIds.add(receipt.orderKey);
      dayData.eventCount++;
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const platform = extractPlatformFromPayload(payload) || "unknown";
      dayData.platformCounts[platform] = (dayData.platformCounts[platform] || 0) + 1;
    }
  });
  const data: UsageHistoryPoint[] = Array.from(dailyData.entries())
    .map(([date, dayData]) => ({
      date,
      orders: dayData.orderIds.size,
      events: dayData.eventCount,
      platforms: { ...dayData.platformCounts },
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalOrders = new Set(
    pixelReceipts.map((receipt) => receipt.orderKey).filter(Boolean)
  ).size;
  const totalEvents = pixelReceipts.length;
  const averageDailyOrders = data.length > 0 ? totalOrders / data.length : 0;
  const averageDailyEvents = data.length > 0 ? totalEvents / data.length : 0;
  const peakDay = data.reduce(
    (max, day) => (day.orders > max.orders ? day : max),
    { date: data[0]?.date || "", orders: 0, events: 0, platforms: {} }
  );
  const platformTotals: Record<string, number> = {};
  pixelReceipts.forEach((receipt) => {
    const platform = receipt.platform || "unknown";
    platformTotals[platform] = (platformTotals[platform] || 0) + 1;
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
